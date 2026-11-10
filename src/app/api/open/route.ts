import { NextRequest, NextResponse } from "next/server";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { resolveFileIn } from "@/lib/files";
import { devEnv } from "@/lib/devenv";
import { editorLaunch, terminalLaunch } from "@/lib/apps";
import { platform, vsCodeFallback, type Launch } from "@/lib/platform";
import { editorLabel, resolvePreferences, terminalLabel, type EditorId, type TerminalId } from "@/lib/preferences";
import { readSettings } from "@/lib/settings";

const run = promisify(execFile);

// POST /api/open { projectName, file?, app? } — opens the project in the
// editor chosen in Preferences (VS Code unless another was chosen), optionally
// one of its files in that project's window; or with app: "terminal" opens the
// chosen terminal there (by default Terminal on macOS, the first terminal
// found on Linux, Windows Terminal or else a Command Prompt on Windows).
// Which app is never part of the request: it's an id saved in settings.json,
// mapped to a fixed command in lib/apps.ts. Names are resolved inside the
// projects folder and passed via execFile/spawn (no shell; on Windows never
// through cmd.exe), so callers can't open arbitrary paths or inject commands.
export async function POST(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { projectName?: unknown; file?: unknown; app?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectDir = resolveProjectDir(body?.projectName);
  if (!projectDir) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const prefs = resolvePreferences(readSettings().preferences, platform());

  if (body.app === "terminal") {
    return openTerminal(projectDir, prefs.terminal);
  }

  let file: string | null = null;
  if (body.file !== undefined) {
    file = resolveFileIn(projectDir, body.file);
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (prefs.editor !== "vscode") return openEditor(prefs.editor, projectDir, file);

  if (platform() === "windows") {
    // `code` is code.cmd there, which can't be run without cmd.exe reading the paths: start Code.exe.
    const launch = vsCodeFallback(projectDir, file);
    if (!launch) {
      return NextResponse.json({ error: "Couldn't open VS Code: Code.exe wasn't found. Is VS Code installed?" }, { status: 500 });
    }
    try {
      await launchDetached(launch, projectDir);
      return NextResponse.json({ success: true });
    } catch (error) {
      return NextResponse.json({ error: "Couldn't open VS Code: " + (error as Error).message }, { status: 500 });
    }
  }

  try {
    try {
      // Passing the folder too makes VS Code use (or open) that project's window.
      // devEnv(): VS Code (and its terminals and extensions) must not inherit the
      // API token, NODE_ENV=production or workbench's own PORT.
      await run("code", file ? [projectDir, file] : [projectDir], { timeout: 10_000, env: devEnv() });
    } catch (e) {
      // `code` CLI not on PATH: launch the app (macOS) or the CLI from where it's installed (Linux).
      const fallback = (e as NodeJS.ErrnoException).code === "ENOENT" ? vsCodeFallback(projectDir, file) : null;
      if (!fallback) throw e;
      await run(fallback.command, fallback.args, { timeout: 10_000, env: devEnv() });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Couldn't open VS Code: " + (error as Error).message },
      { status: 500 }
    );
  }
}

/** Any editor but VS Code: its command, app or .exe from lib/apps.ts. */
async function openEditor(id: Exclude<EditorId, "vscode">, projectDir: string, file: string | null): Promise<NextResponse> {
  const label = editorLabel(id);
  const launch = editorLaunch(id, projectDir, file);
  if (!launch) {
    return NextResponse.json(
      { error: `Couldn't open ${label}: it wasn't found. Is it installed? You can choose another editor in Preferences.` },
      { status: 500 }
    );
  }
  try {
    if (launch.detached) await launchDetached(launch, projectDir);
    else await run(launch.command, launch.args, { timeout: 10_000, env: devEnv() });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't open ${label}: ` + (error as Error).message }, { status: 500 });
  }
}

async function openTerminal(projectDir: string, id: TerminalId): Promise<NextResponse> {
  const os = platform();
  if (os !== "mac" && os !== "linux" && os !== "windows") {
    return NextResponse.json({ error: "Open in Terminal only works on macOS, Linux and Windows" }, { status: 501 });
  }
  // The system's own default keeps its old wording; a chosen app is named.
  const chosen = id !== "terminal" && id !== "auto" && id !== "wt" && id !== "cmd";
  const name = chosen ? terminalLabel(id) : os === "mac" ? "Terminal" : "a terminal";
  const terminal = terminalLaunch(id, projectDir);
  if (!terminal) {
    return chosen
      ? NextResponse.json(
          { error: `Couldn't open ${name}: it wasn't found. Is it installed? You can choose another terminal in Preferences.` },
          { status: 500 }
        )
      : NextResponse.json(
          { error: "No terminal app found. Install one (such as GNOME Terminal, Konsole or xterm), or set $TERMINAL to yours." },
          { status: 501 }
        );
  }
  try {
    // macOS: `open -a`, which returns once the app has the folder. Elsewhere the terminal itself, let go.
    if (os === "mac") await run(terminal.command, terminal.args, { timeout: 10_000 });
    else await launchDetached(terminal, projectDir);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't open ${name}: ` + (error as Error).message }, { status: 500 });
  }
}

/**
 * Start a GUI app in `cwd` and let it go: its own session, no output, not
 * waited for, so it outlives workbench. It gets the environment dev servers
 * get (no workbench settings or API token). Not hidden on Windows: these are
 * windows to look at.
 */
function launchDetached({ command, args, verbatim }: Launch, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      env: devEnv(),
      ...(verbatim ? { windowsVerbatimArguments: true } : {}),
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

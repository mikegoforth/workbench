import { NextRequest, NextResponse } from "next/server";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { resolveFileIn } from "@/lib/files";
import { devEnv } from "@/lib/devenv";
import { linuxTerminal, platform, vsCodeFallback, windowsTerminal, type Launch } from "@/lib/platform";

const run = promisify(execFile);

// POST /api/open { projectName, file?, app? } — opens the project in VS Code
// (optionally one of its files, in that project's window), or with
// app: "terminal" opens a terminal window there (Terminal on macOS, the first
// terminal found on Linux, Windows Terminal or else a Command Prompt on
// Windows). Names are resolved inside the projects folder and passed via
// execFile/spawn (no shell; on Windows never through cmd.exe), so callers
// can't open arbitrary paths or inject commands.
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

  if (body.app === "terminal") {
    return openTerminal(projectDir);
  }

  let file: string | null = null;
  if (body.file !== undefined) {
    file = resolveFileIn(projectDir, body.file);
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

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

async function openTerminal(projectDir: string): Promise<NextResponse> {
  const os = platform();
  if (os === "mac") {
    try {
      await run("open", ["-a", "Terminal", projectDir], { timeout: 10_000 });
      return NextResponse.json({ success: true });
    } catch (error) {
      return NextResponse.json({ error: "Couldn't open Terminal: " + (error as Error).message }, { status: 500 });
    }
  }
  if (os !== "linux" && os !== "windows") {
    return NextResponse.json({ error: "Open in Terminal only works on macOS, Linux and Windows" }, { status: 501 });
  }
  const terminal = os === "windows" ? windowsTerminal() : linuxTerminal(projectDir);
  if (!terminal) {
    return NextResponse.json(
      { error: "No terminal app found. Install one (such as GNOME Terminal, Konsole or xterm), or set $TERMINAL to yours." },
      { status: 501 }
    );
  }
  try {
    await launchDetached(terminal, projectDir);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Couldn't open a terminal: " + (error as Error).message }, { status: 500 });
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

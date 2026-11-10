import fs from "fs";
import os from "os";
import path from "path";
import {
  linuxTerminal,
  linuxTerminalNamed,
  platform,
  programFiles,
  vsCodePaths,
  which,
  windowsCommandPrompt,
  windowsTerminal,
  windowsVsCode,
  type Launch,
  type Platform,
} from "./platform";
import {
  EDITORS,
  terminalsFor,
  type EditorId,
  type TerminalId,
} from "./preferences";
import type { AppChoices, AppOption } from "./types";

/*
 * The editors and terminals workbench can hand a project to, per system:
 * where each is installed and the exact command that opens it. A preference
 * is only ever an id (preferences.ts); every command and path here is fixed
 * or found on this machine, and the project folder (or a file in it, already
 * checked by the caller) is only ever one argument, or the working folder.
 *
 * Nothing goes through a shell. On Windows only real .exe files are started:
 * an editor's `cursor` / `windsurf` command there is a .cmd batch file, which
 * would put the project's path through cmd.exe, so the app itself is used.
 *
 * VS Code is opened by /api/open itself, as it always was (its `code` command,
 * then the app); vscodeInstalled() only says whether it's there.
 */

/** How an editor takes what to open: the folder and then a file (VS Code style), or a single path. */
type ArgStyle = "folder-and-file" | "one-path";

interface EditorSpec {
  /** Commands looked up on PATH (macOS and Linux), first match wins. */
  commands: string[];
  /** macOS app bundles, looked for in /Applications and ~/Applications. */
  macApps: string[];
  /** Linux launchers at their usual places, for when they aren't on PATH. */
  linux: (home: string) => string[];
  /** Windows: the app's own .exe, at its usual places. */
  windows: () => string[];
  args: ArgStyle;
}

const localPrograms = () => (process.env.LOCALAPPDATA ? [path.win32.join(process.env.LOCALAPPDATA, "Programs")] : []);

/** `<root>\<app>\<exe>` for each per-user and system-wide install root. */
const windowsInstalls = (folders: string[], exe: string) =>
  [...localPrograms(), programFiles()].flatMap((root) => folders.map((f) => path.win32.join(root, f, exe)));

/**
 * JetBrains IDEs install into a folder per version ("IntelliJ IDEA 2025.2"):
 * `bin\<exe>` in each folder under Program Files\JetBrains (or the per-user
 * Programs folder, Toolbox's) whose name starts with `prefix`, newest first.
 */
function jetbrainsWindows(prefix: string, exe: string): string[] {
  const roots = [...localPrograms(), path.win32.join(programFiles(), "JetBrains")];
  return roots.flatMap((root) => {
    let names: string[];
    try {
      names = fs.readdirSync(/*turbopackIgnore: true*/ root);
    } catch {
      return [];
    }
    return names
      .filter((n) => n.startsWith(prefix))
      .sort()
      .reverse()
      .map((n) => path.win32.join(root, n, "bin", exe));
  });
}

const toolbox = (home: string, script: string) => path.join(home, ".local", "share", "JetBrains", "Toolbox", "scripts", script);

const EDITOR_SPECS: Record<Exclude<EditorId, "vscode">, EditorSpec> = {
  cursor: {
    commands: ["cursor"],
    macApps: ["Cursor.app"],
    linux: () => ["/usr/bin/cursor", "/usr/share/cursor/bin/cursor"],
    windows: () => windowsInstalls(["cursor"], "Cursor.exe"),
    args: "folder-and-file",
  },
  zed: {
    // `zeditor` is what some distributions call it.
    commands: ["zed", "zeditor"],
    macApps: ["Zed.app"],
    linux: (home) => [path.join(home, ".local", "bin", "zed"), "/usr/bin/zeditor"],
    windows: () => windowsInstalls(["Zed"], "Zed.exe"),
    args: "folder-and-file",
  },
  windsurf: {
    commands: ["windsurf"],
    macApps: ["Windsurf.app"],
    linux: () => ["/usr/bin/windsurf", "/usr/share/windsurf/bin/windsurf"],
    windows: () => windowsInstalls(["Windsurf"], "Windsurf.exe"),
    args: "folder-and-file",
  },
  sublime: {
    commands: ["subl"],
    macApps: ["Sublime Text.app"],
    linux: () => ["/usr/bin/subl", "/snap/bin/subl", "/opt/sublime_text/sublime_text"],
    // subl.exe is a real program (not a batch file) that hands paths to a running Sublime Text.
    windows: () => windowsInstalls(["Sublime Text", "Sublime Text 3"], "subl.exe"),
    args: "folder-and-file",
  },
  idea: {
    commands: ["idea", "intellij-idea-ultimate", "intellij-idea-community"],
    macApps: ["IntelliJ IDEA.app", "IntelliJ IDEA Ultimate.app", "IntelliJ IDEA CE.app", "IntelliJ IDEA Community Edition.app"],
    linux: (home) => ["/snap/bin/intellij-idea-ultimate", "/snap/bin/intellij-idea-community", toolbox(home, "idea")],
    windows: () => jetbrainsWindows("IntelliJ IDEA", "idea64.exe"),
    // A JetBrains IDE opens a folder as a project, and a file in the project it belongs to.
    args: "one-path",
  },
  webstorm: {
    commands: ["webstorm"],
    macApps: ["WebStorm.app"],
    linux: (home) => ["/snap/bin/webstorm", toolbox(home, "webstorm")],
    windows: () => jetbrainsWindows("WebStorm", "webstorm64.exe"),
    args: "one-path",
  },
};

const MAC_TERMINAL_APPS: Partial<Record<TerminalId, string>> = {
  iterm2: "iTerm.app",
  warp: "Warp.app",
  ghostty: "Ghostty.app",
};

/** The first of these app bundles in /Applications or ~/Applications. */
function macApp(bundles: string[]): string | null {
  const dirs = ["/Applications", path.join(os.homedir(), "Applications")];
  for (const bundle of bundles) {
    for (const dir of dirs) {
      const app = path.join(/*turbopackIgnore: true*/ dir, bundle);
      if (fs.existsSync(/*turbopackIgnore: true*/ app)) return app;
    }
  }
  return null;
}

const isExe = (p: string) => /\.exe$/i.test(p);

/**
 * How to open `dir` (or `file` in it) in an editor other than VS Code, or
 * null if it isn't installed here. Every launch but `open -a` on macOS is
 * started detached: an IDE's launcher may keep running as the IDE itself.
 */
export function editorLaunch(id: Exclude<EditorId, "vscode">, dir: string, file: string | null): Launch | null {
  const spec = EDITOR_SPECS[id];
  const args = spec.args === "one-path" ? [file ?? dir] : file ? [dir, file] : [dir];
  const system = platform();
  if (system === "windows") {
    const exe = spec.windows().find((p) => isExe(p) && fs.existsSync(/*turbopackIgnore: true*/ p));
    return exe ? { command: exe, args, detached: true } : null;
  }
  if (system !== "mac" && system !== "linux") return null;
  // Its command on PATH first: it hands the folder and file to the right window.
  for (const name of spec.commands) {
    const command = which(name);
    if (command) return { command, args, detached: true };
  }
  if (system === "mac") {
    const app = macApp(spec.macApps);
    return app ? { command: "open", args: ["-a", app, file ?? dir] } : null;
  }
  // Not on PATH: where it usually installs (as VS Code's fallback looks).
  const installed = spec.linux(os.homedir()).find((p) => fs.existsSync(/*turbopackIgnore: true*/ p));
  return installed ? { command: installed, args, detached: true } : null;
}

/** Whether VS Code is installed: its `code` command or the app (on Windows, only Code.exe counts). */
export function vscodeInstalled(): boolean {
  if (platform() === "windows") return windowsVsCode() !== null;
  return which("code") !== null || vsCodePaths().some((p) => fs.existsSync(/*turbopackIgnore: true*/ p));
}

export function editorInstalled(id: EditorId): boolean {
  return id === "vscode" ? vscodeInstalled() : editorLaunch(id, path.sep, null) !== null;
}

/**
 * How to open a terminal in `dir`, or null if the one chosen isn't installed
 * (or nothing is, for Linux's "auto"). `id` must be one this system offers.
 *
 *   macOS    open -a Terminal|<the app> <dir>
 *   Linux    the chosen terminal (or the first found) with its folder argument, started in dir
 *   Windows  wt -d . (else a Command Prompt), or a Command Prompt, started in dir
 */
export function terminalLaunch(id: TerminalId, dir: string): Launch | null {
  switch (platform()) {
    case "mac": {
      if (id === "terminal") return { command: "open", args: ["-a", "Terminal", dir] };
      const bundle = MAC_TERMINAL_APPS[id];
      const app = bundle ? macApp([bundle]) : null;
      return app ? { command: "open", args: ["-a", app, dir] } : null;
    }
    case "linux":
      return id === "auto" ? linuxTerminal(dir) : linuxTerminalNamed(id, dir);
    case "windows":
      return id === "cmd" ? windowsCommandPrompt() : windowsTerminal();
    default:
      return null;
  }
}

/** Whether a terminal is there to open (Windows Terminal: wt itself, not the Command Prompt it falls back to). */
export function terminalInstalled(id: TerminalId): boolean {
  if (platform() === "windows") return id === "cmd" || which("wt") !== null;
  return terminalLaunch(id, path.sep) !== null;
}

function choices(all: AppOption[], current: string): AppChoices {
  return {
    offered: all.filter((o) => o.installed || o.id === current),
    missing: all.filter((o) => !o.installed && o.id !== current).map((o) => o.label),
  };
}

export function editorChoices(current: EditorId): AppChoices {
  return choices(
    EDITORS.map((e) => ({ id: e.id, label: e.label, installed: editorInstalled(e.id) })),
    current
  );
}

export function terminalChoices(current: TerminalId, os: Platform = platform()): AppChoices {
  return choices(
    terminalsFor(os).map((t) => {
      const installed = terminalInstalled(t.id);
      return { id: t.id, label: t.label, installed, ...terminalDetail(t.id, installed) };
    }),
    current
  );
}

function terminalDetail(id: TerminalId, installed: boolean): { detail?: string } {
  if (id === "auto") {
    const found = linuxTerminal(path.sep);
    if (!found) return { detail: "No terminal found" };
    const name = path.basename(found.command);
    const known = terminalsFor("linux").find((t) => t.id === name);
    return { detail: `Opens ${known ? known.label : name}` };
  }
  if (id === "wt" && !installed) return { detail: "Not found, so a Command Prompt opens instead" };
  return {};
}

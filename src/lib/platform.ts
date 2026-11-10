import fs from "fs";
import os from "os";
import path from "path";

/*
 * Everything workbench does differently per operating system, in one place.
 * Each function reads process.platform when it's called (never when this
 * module loads), so tests can switch platforms.
 *
 * macOS, Linux and Windows are supported. On Windows nothing workbench runs
 * goes through cmd.exe or PowerShell with text from a request or a repo:
 * programs are found by full path (see which) and started directly, and the
 * few fixed cmd.exe / PowerShell command lines are built here and in devenv.ts.
 *
 * Paths read here are fixed or chosen at runtime; the turbopackIgnore comments
 * keep the build from trying to bundle what they point at.
 */

export type Platform = "mac" | "linux" | "windows" | "other";

export function platform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "other";
  }
}

/** The command and arguments to run; always run without a shell. */
export interface Launch {
  command: string;
  args: string[];
  /**
   * Started and let go (spawn, detached, not waited for) rather than run to
   * completion: a GUI app on Windows that keeps running, unlike `open -a`.
   */
  detached?: boolean;
  /**
   * Windows only: `args` is one fixed cmd.exe command line, passed as is
   * (windowsVerbatimArguments). Never holds text from a request or a repo.
   */
  verbatim?: boolean;
}

// ---- Windows basics --------------------------------------------------------

/** C:\Windows, from the environment, as Windows itself sets it. */
function windowsDir(): string {
  return process.env.SystemRoot || process.env.windir || "C:\\Windows";
}

/** The full path of a program in System32 (cmd.exe, taskkill.exe…), so it's never looked up on PATH or in a project folder. */
export function system32(exe: string): string {
  return path.win32.join(windowsDir(), "System32", exe);
}

/** Windows PowerShell, which every Windows 10/11 has. */
export function powershellExe(): string {
  return path.win32.join(windowsDir(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Program Files, from the environment. */
function programFiles(): string {
  return process.env.ProgramFiles || "C:\\Program Files";
}

/**
 * Whether hardenExeSearch() set NoDefaultCurrentDirectoryInExePath itself
 * (so devEnv() can leave it out of what projects get).
 */
let exeSearchHardened = false;
export const exeSearchHardenedByUs = (): boolean => exeSearchHardened;

/**
 * Windows looks for a bare program name (git, docker) in the working folder
 * before PATH, so `git status` run in a cloned repo could start a git.exe the
 * repo contains. Setting NoDefaultCurrentDirectoryInExePath turns that off for
 * every program this server starts (Node and cmd.exe both honour it). Done once,
 * when this module loads; does nothing elsewhere.
 */
export function hardenExeSearch(): void {
  if (platform() !== "windows" || process.env.NoDefaultCurrentDirectoryInExePath !== undefined) return;
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  exeSearchHardened = true;
}
hardenExeSearch();

// ---- Data folder -----------------------------------------------------------

/**
 * The folder Electron's app.getPath("userData") gives an app called `appName`,
 * so `npm run dev` and the desktop app share it:
 *   macOS    ~/Library/Application Support/<app>
 *   Linux    $XDG_CONFIG_HOME/<app>, else ~/.config/<app>
 *   Windows  %APPDATA%\<app>
 */
export function userDataDir(appName: string): string {
  const home = os.homedir();
  switch (platform()) {
    case "mac":
      return path.join(home, "Library", "Application Support", appName);
    case "windows":
      return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), appName);
    default:
      // Like Electron (Chromium): any non-empty XDG_CONFIG_HOME, as is.
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), appName);
  }
}

// ---- Docker ----------------------------------------------------------------

export interface DockerApp extends Launch {
  /** As shown on the Start button ("Docker" reads as Docker Desktop). */
  name: "Docker" | "OrbStack";
}

/** Where Docker Desktop for Linux installs itself. */
export const LINUX_DOCKER_DESKTOP = "/opt/docker-desktop";

/**
 * Docker apps that can be installed, in order of preference: what the
 * requirements check looks for, and what Start launches.
 */
export function dockerApps(): { name: DockerApp["name"]; label: string; path: string }[] {
  switch (platform()) {
    case "mac":
      return [
        { name: "Docker", label: "Docker", path: "/Applications/Docker.app" },
        { name: "OrbStack", label: "OrbStack", path: "/Applications/OrbStack.app" },
      ];
    case "linux":
      return [{ name: "Docker", label: "Docker Desktop", path: LINUX_DOCKER_DESKTOP }];
    case "windows":
      return [{ name: "Docker", label: "Docker Desktop", path: windowsDockerDesktop() }];
    default:
      return [];
  }
}

/** Where Docker Desktop for Windows installs itself. */
export const windowsDockerDesktop = () => path.win32.join(programFiles(), "Docker", "Docker", "Docker Desktop.exe");

/** The installed app that starts the Docker daemon, and how to launch it; null if there's none. */
export function dockerApp(): DockerApp | null {
  const app = dockerApps().find((a) => fs.existsSync(a.path));
  if (!app) return null;
  switch (platform()) {
    case "mac":
      return { name: app.name, command: "open", args: ["-a", app.name] };
    case "windows":
      // The app itself, left running: it starts the engine and stays in the tray.
      return { name: app.name, command: app.path, args: [], detached: true };
    default:
      return { name: app.name, command: "systemctl", args: ["--user", "start", "docker-desktop"] };
  }
}

/**
 * How to start Docker by hand when there's no app to launch: Docker Engine on
 * Linux, which needs root (or, rootless, the user's own systemd). workbench
 * only ever shows this; it never runs it.
 */
export function dockerManualStart(): string | null {
  if (platform() !== "linux") return null;
  return /\/run\/user\//.test(process.env.DOCKER_HOST ?? "") ? "systemctl --user start docker" : "sudo systemctl start docker";
}

// ---- VS Code ---------------------------------------------------------------

/** Where VS Code lives when its `code` command isn't on PATH (on Windows: always, see windowsVsCode). */
export function vsCodePaths(): string[] {
  switch (platform()) {
    case "mac":
      return ["/Applications/Visual Studio Code.app"];
    case "linux":
      return ["/usr/share/code", "/usr/bin/code", "/snap/bin/code"];
    case "windows":
      return windowsVsCodeCandidates();
    default:
      return [];
  }
}

/**
 * Where Code.exe may be on Windows, most likely first: next to the `code`
 * command on PATH (bin\code.cmd is one folder below it), then the per-user
 * and the system-wide install folders.
 */
function windowsVsCodeCandidates(): string[] {
  const candidates: string[] = [];
  const cli = which("code");
  // which() builds this path with `path`, which is path.win32 on Windows.
  if (cli) candidates.push(path.join(path.dirname(cli), "..", "Code.exe"));
  if (process.env.LOCALAPPDATA) candidates.push(path.win32.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"));
  candidates.push(path.win32.join(programFiles(), "Microsoft VS Code", "Code.exe"));
  return candidates;
}

/**
 * VS Code's Code.exe on Windows, or null. The `code` command there is
 * code.cmd, a batch file: running it would put the project's path through
 * cmd.exe, so workbench starts the app itself, which hands the folder to an
 * open VS Code window the same way.
 */
export function windowsVsCode(): string | null {
  return windowsVsCodeCandidates().find((p) => fs.existsSync(p)) ?? null;
}

const LINUX_CODE_CLIS = ["/usr/bin/code", "/snap/bin/code", "/usr/share/code/bin/code"];

/**
 * How to open VS Code when `code` isn't on PATH: the app on macOS, the CLI's
 * usual places on Linux. On Windows this is how it's always opened: Code.exe,
 * started and let go.
 */
export function vsCodeFallback(projectDir: string, file: string | null): Launch | null {
  switch (platform()) {
    case "mac":
      return { command: "open", args: ["-a", "Visual Studio Code", file ?? projectDir] };
    case "linux": {
      const cli = LINUX_CODE_CLIS.find((p) => fs.existsSync(p));
      return cli ? { command: cli, args: file ? [projectDir, file] : [projectDir] } : null;
    }
    case "windows": {
      const exe = windowsVsCode();
      return exe ? { command: exe, args: file ? [projectDir, file] : [projectDir], detached: true } : null;
    }
    default:
      return null;
  }
}

// ---- Terminal --------------------------------------------------------------

/**
 * The full path of an executable: a bare name is looked up on PATH, a path is
 * checked as is (and must be absolute). Relative PATH entries are skipped, and
 * so is the working folder, which Windows itself would search first.
 *
 * On Windows PATH is split on ";", entries may be quoted, and a name without
 * one of the PATHEXT extensions (.com, .exe, .bat, .cmd…) is tried with each.
 */
export function which(cmd: string): string | null {
  if (!cmd) return null;
  const windows = platform() === "windows";
  const hasSeparator = cmd.includes("/") || (windows && cmd.includes("\\"));
  const bases = hasSeparator
    ? path.isAbsolute(cmd)
      ? [cmd]
      : []
    : (process.env.PATH ?? "")
        .split(windows ? ";" : path.delimiter)
        .map((d) => (windows ? d.trim().replace(/^"(.*)"$/, "$1") : d))
        .filter((d) => path.isAbsolute(d))
        .map((d) => path.join(d, cmd));
  const candidates = windows ? bases.flatMap(withPathExt) : bases;
  for (const candidate of candidates) {
    if (isExecutableFile(candidate, windows)) return candidate;
  }
  return null;
}

/** `name` as is when it already has a PATHEXT extension, then `name` plus each extension. */
function withPathExt(name: string): string[] {
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^\.[a-z0-9]+$/.test(e));
  const ext = path.win32.extname(name).toLowerCase();
  return [...(exts.includes(ext) ? [name] : []), ...exts.map((e) => name + e)];
}

function isExecutableFile(candidate: string, windows: boolean): boolean {
  try {
    fs.accessSync(/*turbopackIgnore: true*/ candidate, fs.constants.X_OK);
  } catch {
    return false; // Not there, or not executable.
  }
  try {
    return fs.statSync(/*turbopackIgnore: true*/ candidate).isFile();
  } catch {
    // An app execution alias (wt.exe in WindowsApps) is a reparse point stat
    // can't follow, but Windows starts it like any program.
    if (!windows) return false;
    try {
      return fs.lstatSync(/*turbopackIgnore: true*/ candidate).isSymbolicLink();
    } catch {
      return false;
    }
  }
}

/**
 * Linux terminals, in the order they're tried, with the arguments that open
 * them in a folder. Every one is also started in that folder, which is all
 * x-terminal-emulator (whatever it points to) and xterm go by.
 */
const LINUX_TERMINALS: [name: string, args: (dir: string) => string[]][] = [
  ["x-terminal-emulator", () => []],
  ["gnome-terminal", (dir) => [`--working-directory=${dir}`]],
  ["konsole", (dir) => ["--workdir", dir]],
  ["xfce4-terminal", (dir) => [`--working-directory=${dir}`]],
  ["kitty", (dir) => ["--directory", dir]],
  ["alacritty", (dir) => ["--working-directory", dir]],
  ["wezterm", (dir) => ["start", "--cwd", dir]],
  ["foot", (dir) => [`--working-directory=${dir}`]],
  // GNOME's newer terminals (Fedora, Ubuntu 25.10+), which have no x-terminal-emulator alias on Fedora.
  ["ptyxis", (dir) => [`--working-directory=${dir}`]],
  ["kgx", (dir) => [`--working-directory=${dir}`]],
  ["tilix", (dir) => [`--working-directory=${dir}`]],
  ["terminator", (dir) => [`--working-directory=${dir}`]],
  ["xterm", () => []],
];

/**
 * The terminal to open in `dir` on Linux: $TERMINAL if it names one that's
 * installed, else the first of LINUX_TERMINALS on PATH. Null if none is.
 */
export function linuxTerminal(dir: string): Launch | null {
  const argsFor = (command: string) => LINUX_TERMINALS.find(([name]) => name === path.basename(command))?.[1](dir) ?? [];
  const preferred = which(process.env.TERMINAL?.trim() ?? "");
  if (preferred) return { command: preferred, args: argsFor(preferred) };
  for (const [name] of LINUX_TERMINALS) {
    const command = which(name);
    if (command) return { command, args: argsFor(command) };
  }
  return null;
}

/**
 * The terminal to open on Windows, to be started (detached, visible) in the
 * project folder: Windows Terminal when wt is on PATH, else a new Command
 * Prompt window. The folder is only ever the working folder (`wt -d .` opens
 * there; `start` passes it on to the new cmd.exe), never part of a command
 * line, so cmd.exe never reads it, and a ";" in it means nothing to wt.
 */
export function windowsTerminal(): Launch {
  const wt = which("wt");
  if (wt) return { command: wt, args: ["-d", "."], detached: true };
  // A detached cmd.exe has no console of its own; `start` opens one for a second cmd.exe.
  const cmd = system32("cmd.exe");
  return { command: cmd, args: ["/d", "/s", "/c", `"start "" "${cmd}""`], detached: true, verbatim: true };
}

// ---- Processes -------------------------------------------------------------

/**
 * What identifies a running process on Linux, for telling it apart from a
 * later one that reuses its pid: this boot's id and the process's start time
 * in clock ticks since boot, from /proc. (`ps -o lstart` works out a wall-clock
 * time from the boot time, which moves whenever the clock is set, e.g. by NTP
 * after a laptop wakes, and the saved value would stop matching.) Null if the
 * process is gone.
 */
export function linuxProcessStart(pid: number): string | null {
  let stat: string;
  try {
    stat = fs.readFileSync(/*turbopackIgnore: true*/ `/proc/${pid}/stat`, "utf-8");
  } catch {
    return null;
  }
  // The command name (field 2) is in parentheses and may hold spaces or ")": count from the last ")".
  const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]; // field 22, starttime
  if (!/^\d+$/.test(ticks ?? "")) return null;
  let boot = "";
  try {
    boot = fs.readFileSync(/*turbopackIgnore: true*/ "/proc/sys/kernel/random/boot_id", "utf-8").trim();
  } catch {
    // No boot id (unusual sandboxes): the start time alone still tells pids apart within a boot.
  }
  return `${boot}:${ticks}`;
}

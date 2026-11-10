import fs from "fs";
import os from "os";
import path from "path";

/*
 * Everything workbench does differently per operating system, in one place.
 * Each function reads process.platform when it's called (never when this
 * module loads), so tests can switch platforms.
 *
 * macOS and Linux are supported. Windows gets the "not supported" answers it
 * always had (no Docker app to launch, no terminal, no VS Code fallback);
 * each switch below has a place for it.
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
}

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
    default:
      return [];
  }
}

/** The installed app that starts the Docker daemon, and how to launch it; null if there's none. */
export function dockerApp(): DockerApp | null {
  const app = dockerApps().find((a) => fs.existsSync(a.path));
  if (!app) return null;
  return platform() === "mac"
    ? { name: app.name, command: "open", args: ["-a", app.name] }
    : { name: app.name, command: "systemctl", args: ["--user", "start", "docker-desktop"] };
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

/** Where VS Code lives when its `code` command isn't on PATH. */
export function vsCodePaths(): string[] {
  switch (platform()) {
    case "mac":
      return ["/Applications/Visual Studio Code.app"];
    case "linux":
      return ["/usr/share/code", "/usr/bin/code", "/snap/bin/code"];
    default:
      return [];
  }
}

const LINUX_CODE_CLIS = ["/usr/bin/code", "/snap/bin/code", "/usr/share/code/bin/code"];

/** How to open VS Code when `code` isn't on PATH: the app on macOS, the CLI's usual places on Linux. */
export function vsCodeFallback(projectDir: string, file: string | null): Launch | null {
  switch (platform()) {
    case "mac":
      return { command: "open", args: ["-a", "Visual Studio Code", file ?? projectDir] };
    case "linux": {
      const cli = LINUX_CODE_CLIS.find((p) => fs.existsSync(p));
      return cli ? { command: cli, args: file ? [projectDir, file] : [projectDir] } : null;
    }
    default:
      return null;
  }
}

// ---- Terminal --------------------------------------------------------------

/** The full path of an executable: a bare name is looked up on PATH, an absolute path is checked as is. */
export function which(cmd: string): string | null {
  if (!cmd) return null;
  const candidates = cmd.includes("/")
    ? path.isAbsolute(cmd)
      ? [cmd]
      : []
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter((d) => path.isAbsolute(d))
        .map((d) => path.join(d, cmd));
  for (const candidate of candidates) {
    try {
      fs.accessSync(/*turbopackIgnore: true*/ candidate, fs.constants.X_OK);
      if (fs.statSync(/*turbopackIgnore: true*/ candidate).isFile()) return candidate;
    } catch {
      // Not there, or not executable: try the next.
    }
  }
  return null;
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

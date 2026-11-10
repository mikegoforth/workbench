import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dockerApp,
  dockerApps,
  dockerManualStart,
  linuxProcessStart,
  linuxTerminal,
  platform,
  powershellExe,
  system32,
  userDataDir,
  vsCodeFallback,
  vsCodePaths,
  which,
  windowsTerminal,
  windowsVsCode,
} from "./platform";

// platform.ts reads process.platform on every call, so each test pins it.
// File checks go through spies or a temp folder; nothing is launched.
const realPlatform = process.platform;
const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-platform-")));
const HOME = path.join(root, "home");

/** Paths that exist, for the fixed install locations platform.ts checks. */
let existing: Set<string>;

/**
 * Windows install locations in these tests are on a Q: drive, or under the
 * default C:\Program Files: never real folders, on any machine. (Temp folders
 * are on C:\ on a Windows machine, so C:\ itself isn't faked.)
 */
const FAKE_PREFIXES = ["/Applications/", "/opt/", "/usr/", "/snap/", "Q:\\", "C:\\Program Files\\"];

beforeEach(() => {
  existing = new Set();
  vi.spyOn(os, "homedir").mockReturnValue(HOME);
  const realExists = fs.existsSync;
  vi.spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p);
    return FAKE_PREFIXES.some((prefix) => s.startsWith(prefix)) ? existing.has(s) : realExists(p);
  });
});

/** An empty file, executable where that means something. */
function touch(dir: string, name: string) {
  const file = path.join(dir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, "");
  fs.chmodSync(file, 0o755);
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(realPlatform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("platform", () => {
  it.each([
    ["darwin", "mac"],
    ["linux", "linux"],
    ["win32", "windows"],
    ["freebsd", "other"],
  ] as const)("calls %s %s, at call time", (p, expected) => {
    setPlatform(p);
    expect(platform()).toBe(expected);
  });
});

describe("userDataDir", () => {
  it("is in Application Support on macOS", () => {
    setPlatform("darwin");
    vi.stubEnv("XDG_CONFIG_HOME", "/elsewhere");
    expect(userDataDir("workbench")).toBe(path.join(HOME, "Library", "Application Support", "workbench"));
  });

  it("is in ~/.config on Linux, or $XDG_CONFIG_HOME when set", () => {
    setPlatform("linux");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(userDataDir("workbench")).toBe(path.join(HOME, ".config", "workbench"));
    vi.stubEnv("XDG_CONFIG_HOME", "/xdg");
    expect(userDataDir("workbench")).toBe(path.join("/xdg", "workbench"));
  });

  it("is in %APPDATA% on Windows, else the usual Roaming folder", () => {
    setPlatform("win32");
    vi.stubEnv("APPDATA", "/appdata");
    expect(userDataDir("workbench")).toBe(path.join("/appdata", "workbench"));
    vi.stubEnv("APPDATA", "");
    expect(userDataDir("workbench")).toBe(path.join(HOME, "AppData", "Roaming", "workbench"));
  });

  it("follows the XDG layout on other Unixes", () => {
    setPlatform("freebsd");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(userDataDir("workbench")).toBe(path.join(HOME, ".config", "workbench"));
  });
});

describe("Docker apps", () => {
  it("prefers Docker Desktop over OrbStack on macOS, launched with open", () => {
    setPlatform("darwin");
    expect(dockerApp()).toBeNull();
    existing.add("/Applications/OrbStack.app");
    expect(dockerApp()).toEqual({ name: "OrbStack", command: "open", args: ["-a", "OrbStack"] });
    existing.add("/Applications/Docker.app");
    expect(dockerApp()).toEqual({ name: "Docker", command: "open", args: ["-a", "Docker"] });
    expect(dockerManualStart()).toBeNull();
  });

  it("starts Docker Desktop for Linux with systemd, and otherwise says how to start the engine", () => {
    setPlatform("linux");
    vi.stubEnv("DOCKER_HOST", "");
    expect(dockerApps().map((a) => a.label)).toEqual(["Docker Desktop"]);
    expect(dockerApp()).toBeNull();
    expect(dockerManualStart()).toBe("sudo systemctl start docker");
    existing.add("/opt/docker-desktop");
    expect(dockerApp()).toEqual({ name: "Docker", command: "systemctl", args: ["--user", "start", "docker-desktop"] });
  });

  it("reads an unset DOCKER_HOST as the system daemon", () => {
    setPlatform("linux");
    vi.stubEnv("DOCKER_HOST", undefined);
    expect(dockerManualStart()).toBe("sudo systemctl start docker");
  });

  it("starts Docker Desktop.exe from Program Files on Windows, detached", () => {
    setPlatform("win32");
    vi.stubEnv("ProgramFiles", "Q:\\Apps");
    const exe = "Q:\\Apps\\Docker\\Docker\\Docker Desktop.exe";
    existing.add("/Applications/Docker.app").add("/opt/docker-desktop");
    expect(dockerApps()).toEqual([{ name: "Docker", label: "Docker Desktop", path: exe }]);
    expect(dockerApp()).toBeNull();
    existing.add(exe);
    expect(dockerApp()).toEqual({ name: "Docker", command: exe, args: [], detached: true });
    expect(dockerManualStart()).toBeNull();
  });

  it("looks in C:\\Program Files when %ProgramFiles% isn't set", () => {
    setPlatform("win32");
    vi.stubEnv("ProgramFiles", "");
    expect(dockerApps()[0].path).toBe("C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe");
  });

  it("has nothing on other systems", () => {
    setPlatform("freebsd");
    existing.add("/Applications/Docker.app").add("/opt/docker-desktop");
    expect(dockerApps()).toEqual([]);
    expect(dockerApp()).toBeNull();
  });
});

describe("VS Code", () => {
  it("knows where it's installed", () => {
    setPlatform("darwin");
    expect(vsCodePaths()).toEqual(["/Applications/Visual Studio Code.app"]);
    setPlatform("linux");
    expect(vsCodePaths()).toEqual(["/usr/share/code", "/usr/bin/code", "/snap/bin/code"]);
    setPlatform("freebsd");
    expect(vsCodePaths()).toEqual([]);
  });

  it("falls back to the app on macOS, opening the file or else the folder", () => {
    setPlatform("darwin");
    expect(vsCodeFallback("/p", "/p/a.ts")).toEqual({ command: "open", args: ["-a", "Visual Studio Code", "/p/a.ts"] });
    expect(vsCodeFallback("/p", null)).toEqual({ command: "open", args: ["-a", "Visual Studio Code", "/p"] });
  });

  it("falls back to an installed CLI on Linux, if there is one", () => {
    setPlatform("linux");
    expect(vsCodeFallback("/p", null)).toBeNull();
    existing.add("/usr/share/code/bin/code");
    expect(vsCodeFallback("/p", "/p/a.ts")).toEqual({ command: "/usr/share/code/bin/code", args: ["/p", "/p/a.ts"] });
  });

  it("has no fallback on other systems", () => {
    setPlatform("freebsd");
    expect(vsCodeFallback("/p", null)).toBeNull();
  });
});

describe("VS Code on Windows", () => {
  const USER = "Q:\\Local\\Programs\\Microsoft VS Code\\Code.exe";
  const SYSTEM = "Q:\\Programs\\Microsoft VS Code\\Code.exe";

  beforeEach(() => {
    setPlatform("win32");
    vi.stubEnv("PATH", "");
    vi.stubEnv("LOCALAPPDATA", "Q:\\Local");
    vi.stubEnv("ProgramFiles", "Q:\\Programs");
  });

  it("looks for Code.exe in the per-user, then the system-wide install folder", () => {
    expect(vsCodePaths()).toEqual([USER, SYSTEM]);
    expect(windowsVsCode()).toBeNull();
    expect(vsCodeFallback("Q:\\p", null)).toBeNull();
    existing.add(SYSTEM);
    expect(windowsVsCode()).toBe(SYSTEM);
    existing.add(USER);
    expect(windowsVsCode()).toBe(USER);
  });

  it("starts Code.exe itself, detached, with the folder and the file as arguments", () => {
    existing.add(USER);
    expect(vsCodeFallback("Q:\\p", "Q:\\p\\a.ts")).toEqual({ command: USER, args: ["Q:\\p", "Q:\\p\\a.ts"], detached: true });
    expect(vsCodeFallback("Q:\\p", null)).toEqual({ command: USER, args: ["Q:\\p"], detached: true });
  });

  it("does without %LOCALAPPDATA%", () => {
    vi.stubEnv("LOCALAPPDATA", "");
    expect(vsCodePaths()).toEqual([SYSTEM]);
  });

  it("finds Code.exe one folder up from the code command on PATH first", () => {
    const install = path.join(root, "vscode");
    const bin = path.join(install, "bin");
    touch(bin, "code.cmd");
    touch(install, "Code.exe");
    existing.add(USER);
    vi.stubEnv("PATH", bin);
    expect(vsCodePaths()[0]).toBe(path.join(install, "Code.exe"));
    expect(windowsVsCode()).toBe(path.join(install, "Code.exe"));
  });
});

describe("which and linuxTerminal", () => {
  const bin = path.join(root, "bin");

  beforeEach(() => {
    setPlatform("linux");
    fs.rmSync(bin, { recursive: true, force: true });
    fs.mkdirSync(bin, { recursive: true });
    vi.stubEnv("PATH", bin);
    vi.stubEnv("TERMINAL", "");
  });

  const install = (name: string) => {
    const file = path.join(bin, name);
    fs.writeFileSync(file, "");
    fs.chmodSync(file, 0o755);
    return file;
  };

  it("finds executables on PATH, and nothing for an empty name", () => {
    const xterm = install("xterm");
    expect(which("xterm")).toBe(xterm);
    expect(which("")).toBeNull();
    expect(which("nope")).toBeNull();
  });

  // A Windows path (C:\…) has no "/", so it can't be read the POSIX way there.
  it.skipIf(realPlatform === "win32")("finds executables by absolute path", () => {
    const xterm = install("xterm");
    expect(which(xterm)).toBe(xterm);
  });

  // chmod can't take the executable bit away on Windows.
  it.skipIf(realPlatform === "win32")("skips files that aren't executable", () => {
    const xterm = install("xterm");
    fs.chmodSync(xterm, 0o644);
    expect(which("xterm")).toBeNull();
  });

  it("doesn't take a link it can't follow", () => {
    const xterm = install("xterm");
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });
    const lstat = vi.spyOn(fs, "lstatSync");
    expect(which("xterm")).toBeNull();
    expect(lstat).not.toHaveBeenCalledWith(xterm);
  });

  it("opens the folder with the terminal's own option, or relies on the working folder", () => {
    const foot = install("foot");
    expect(linuxTerminal("/p")).toEqual({ command: foot, args: ["--working-directory=/p"] });
    const xte = install("x-terminal-emulator");
    expect(linuxTerminal("/p")).toEqual({ command: xte, args: [] });
  });

  it("trims $TERMINAL", () => {
    install("xterm");
    const kitty = install("kitty");
    vi.stubEnv("TERMINAL", "  kitty ");
    expect(linuxTerminal("/p")).toEqual({ command: kitty, args: ["--directory", "/p"] });
  });

  it("is null when nothing is installed", () => {
    expect(linuxTerminal("/p")).toBeNull();
  });

  it("does without $TERMINAL", () => {
    vi.stubEnv("TERMINAL", undefined);
    const xterm = install("xterm");
    expect(linuxTerminal("/p")).toEqual({ command: xterm, args: [] });
  });
});

describe("which on Windows", () => {
  const a = path.join(root, "win-a");
  const b = path.join(root, "win b");

  beforeEach(() => {
    setPlatform("win32");
    for (const dir of [a, b]) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
    vi.stubEnv("PATHEXT", ".COM;.EXE;.BAT;.CMD");
    vi.stubEnv("PATH", [a, b].join(";"));
  });

  it("splits PATH on semicolons, unquotes entries, skips relative ones, and tries each PATHEXT extension", () => {
    touch(a, "npm"); // no extension: not a program on Windows
    const npm = touch(b, "npm.cmd");
    vi.stubEnv("PATH", ["relative", "", ` ${a} `, `"${b}"`].join(";"));
    expect(which("npm")).toBe(npm);
  });

  it("takes the first folder that has the program, and the first extension in PATHEXT within it", () => {
    touch(b, "tool.com");
    touch(a, "tool.cmd");
    const exe = touch(a, "tool.exe");
    expect(which("tool")).toBe(exe);
  });

  it("takes a name that already has one of the extensions as is, and matches extensions whatever their case", () => {
    const git = touch(a, "git.exe");
    expect(which("git.exe")).toBe(git);
    expect(which("git")).toBe(git);
    touch(a, "x.txt");
    expect(which("x.txt")).toBeNull();
  });

  it("uses the default PATHEXT when there is none, and ignores odd entries in it", () => {
    const docker = touch(a, "docker.exe");
    vi.stubEnv("PATHEXT", "");
    expect(which("docker")).toBe(docker);
    vi.stubEnv("PATHEXT", undefined);
    expect(which("docker")).toBe(docker);
    vi.stubEnv("PATHEXT", "exe;;.e*e;.CMD");
    expect(which("docker")).toBeNull();
  });

  it("checks a full path as is, and refuses a relative one with either slash", () => {
    const git = touch(a, "git.exe");
    expect(which(git)).toBe(git);
    expect(which("win-a\\git.exe")).toBeNull();
    expect(which("win-a/git.exe")).toBeNull();
  });

  it("skips a folder named like a program, and finds nothing without PATH", () => {
    fs.mkdirSync(path.join(a, "wt.exe"));
    expect(which("wt")).toBeNull();
    vi.stubEnv("PATH", undefined);
    expect(which("wt")).toBeNull();
  });

  it("takes an app execution alias (a link stat can't follow), as Windows starts those", () => {
    const wt = touch(a, "wt.exe");
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("UNKNOWN"), { code: "UNKNOWN" });
    });
    const lstat = vi.spyOn(fs, "lstatSync").mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
    expect(which("wt")).toBe(wt);
    lstat.mockReturnValue({ isSymbolicLink: () => false } as fs.Stats);
    expect(which("wt")).toBeNull();
    lstat.mockImplementation(() => {
      throw new Error("gone");
    });
    expect(which("wt")).toBeNull();
  });
});

describe("Windows terminal and system programs", () => {
  const a = path.join(root, "win-terminal");

  beforeEach(() => {
    setPlatform("win32");
    fs.rmSync(a, { recursive: true, force: true });
    fs.mkdirSync(a, { recursive: true });
    vi.stubEnv("PATH", a);
    vi.stubEnv("PATHEXT", ".EXE");
    vi.stubEnv("SystemRoot", "Q:\\Windows");
  });

  it("opens Windows Terminal in its working folder when wt is on PATH", () => {
    const wt = touch(a, "wt.exe");
    expect(windowsTerminal()).toEqual({ command: wt, args: ["-d", "."], detached: true });
  });

  it("otherwise opens a Command Prompt through start, with a fixed command line", () => {
    const cmd = "Q:\\Windows\\System32\\cmd.exe";
    expect(windowsTerminal()).toEqual({ command: cmd, args: ["/d", "/s", "/c", `"start "" "${cmd}""`], detached: true, verbatim: true });
  });

  it("finds System32 and PowerShell from %SystemRoot%, %windir% or C:\\Windows", () => {
    expect(system32("taskkill.exe")).toBe("Q:\\Windows\\System32\\taskkill.exe");
    expect(powershellExe()).toBe("Q:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    vi.stubEnv("SystemRoot", "");
    vi.stubEnv("windir", "Q:\\Win");
    expect(system32("cmd.exe")).toBe("Q:\\Win\\System32\\cmd.exe");
    vi.stubEnv("windir", "");
    expect(system32("cmd.exe")).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});

describe("hardenExeSearch", () => {
  // It runs when platform.ts loads, so each test loads a fresh copy (as a server would).
  async function fresh() {
    vi.resetModules();
    return import("./platform");
  }

  it("turns off Windows' search of the working folder for programs, when it loads", async () => {
    setPlatform("win32");
    vi.stubEnv("NoDefaultCurrentDirectoryInExePath", undefined);
    const mod = await fresh();
    expect(process.env.NoDefaultCurrentDirectoryInExePath).toBe("1");
    expect(mod.exeSearchHardenedByUs()).toBe(true);
  });

  it("leaves a value that's already set alone", async () => {
    setPlatform("win32");
    vi.stubEnv("NoDefaultCurrentDirectoryInExePath", "");
    const mod = await fresh();
    mod.hardenExeSearch();
    expect(process.env.NoDefaultCurrentDirectoryInExePath).toBe("");
    expect(mod.exeSearchHardenedByUs()).toBe(false);
  });

  it("does nothing off Windows", async () => {
    setPlatform("darwin");
    vi.stubEnv("NoDefaultCurrentDirectoryInExePath", undefined);
    const mod = await fresh();
    mod.hardenExeSearch();
    expect(process.env.NoDefaultCurrentDirectoryInExePath).toBeUndefined();
    expect(mod.exeSearchHardenedByUs()).toBe(false);
  });
});

describe("linuxProcessStart", () => {
  const BOOT = "454f4c74-22cd-42ac-9a76-a280f7013a0c";
  let stat: string | null;
  let boot: string | null;

  beforeEach(() => {
    stat = null;
    boot = `${BOOT}\n`;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: string) => {
      const value = file === "/proc/sys/kernel/random/boot_id" ? boot : file === "/proc/42/stat" ? stat : null;
      if (value === null) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
      return value;
    }) as unknown as typeof fs.readFileSync);
  });

  const statLine = (comm: string, ticks: string) =>
    `42 (${comm}) S 1 42 42 0 -1 4194560 100 0 0 0 1 0 0 0 20 0 1 0 ${ticks} 2437120 167 18446744073709551615 1 1 0 0 0\n`;

  it("is the boot id and the start ticks", () => {
    stat = statLine("node", "1414799");
    expect(linuxProcessStart(42)).toBe(`${BOOT}:1414799`);
  });

  it("copes with spaces and parentheses in the command name", () => {
    stat = statLine("npm run dev) S 1 2 3", "777");
    expect(linuxProcessStart(42)).toBe(`${BOOT}:777`);
  });

  it("is null for a process that's gone, or a stat line it can't read", () => {
    expect(linuxProcessStart(41)).toBeNull();
    stat = "42 (node) S 1 2 3";
    expect(linuxProcessStart(42)).toBeNull();
  });

  it("does without a boot id", () => {
    stat = statLine("node", "5");
    boot = null;
    expect(linuxProcessStart(42)).toBe(":5");
  });
});

// The real thing, where there is a /proc: the value is there, and stays the same.
describe.runIf(realPlatform === "linux")("linuxProcessStart on this Linux machine", () => {
  it("identifies this process the same way each time, and nothing for a pid that isn't running", () => {
    const first = linuxProcessStart(process.pid);
    expect(first).toMatch(/^[0-9a-f-]{36}:\d+$/);
    expect(linuxProcessStart(process.pid)).toBe(first);
    expect(linuxProcessStart(2 ** 22 + 1)).toBeNull();
  });
});

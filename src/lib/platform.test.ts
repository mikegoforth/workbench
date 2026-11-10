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
  userDataDir,
  vsCodeFallback,
  vsCodePaths,
  which,
} from "./platform";

// platform.ts reads process.platform on every call, so each test pins it.
// File checks go through spies or a temp folder; nothing is launched.
const realPlatform = process.platform;
const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-platform-")));
const HOME = path.join(root, "home");

/** Paths that exist, for the fixed install locations platform.ts checks. */
let existing: Set<string>;

beforeEach(() => {
  existing = new Set();
  vi.spyOn(os, "homedir").mockReturnValue(HOME);
  const realExists = fs.existsSync;
  vi.spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p);
    return s.startsWith("/Applications/") || s.startsWith("/opt/") || s.startsWith("/usr/") || s.startsWith("/snap/")
      ? existing.has(s)
      : realExists(p);
  });
});

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

  it("has nothing on Windows", () => {
    setPlatform("win32");
    existing.add("/Applications/Docker.app").add("/opt/docker-desktop");
    expect(dockerApps()).toEqual([]);
    expect(dockerApp()).toBeNull();
    expect(dockerManualStart()).toBeNull();
  });
});

describe("VS Code", () => {
  it("knows where it's installed", () => {
    setPlatform("darwin");
    expect(vsCodePaths()).toEqual(["/Applications/Visual Studio Code.app"]);
    setPlatform("linux");
    expect(vsCodePaths()).toEqual(["/usr/share/code", "/usr/bin/code", "/snap/bin/code"]);
    setPlatform("win32");
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

  it("has no fallback on Windows", () => {
    setPlatform("win32");
    expect(vsCodeFallback("/p", null)).toBeNull();
  });
});

describe("which and linuxTerminal", () => {
  const bin = path.join(root, "bin");

  beforeEach(() => {
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

  it("finds executables on PATH or by absolute path, and nothing for an empty name", () => {
    const xterm = install("xterm");
    expect(which("xterm")).toBe(xterm);
    expect(which(xterm)).toBe(xterm);
    expect(which("")).toBeNull();
    expect(which("nope")).toBeNull();
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

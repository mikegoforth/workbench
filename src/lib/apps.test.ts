import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  editorChoices,
  editorInstalled,
  editorLaunch,
  terminalChoices,
  terminalInstalled,
  terminalLaunch,
  vscodeInstalled,
} from "./apps";

// apps.ts reads process.platform on every call, so each test pins it. Fixed
// install places (/Applications, /usr, /snap, Q:\ on "Windows") are faked
// through spies; commands on PATH and the home folder are files in a temp
// folder that are never run. Nothing is launched: these only build argv.

const realPlatform = process.platform;
const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-apps-")));
const HOME = path.join(root, "home");
const bin = path.join(root, "bin");
const DIR = "/work/projects/alpha";
const FILE = "/work/projects/alpha/src/index.ts";

const FAKE_PREFIXES = ["/Applications/", "/usr/", "/snap/", "/opt/", "Q:\\"];
let existing: Set<string>;
/** Folder listings for the Windows install roots JetBrains IDEs are looked for in. */
let listings: Record<string, string[]>;

function install(name: string) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, "#!/bin/sh\n");
  fs.chmodSync(file, 0o755);
  return file;
}

function touch(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  fs.chmodSync(file, 0o755);
  return file;
}

beforeEach(() => {
  fs.rmSync(bin, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(HOME, { recursive: true });
  existing = new Set();
  listings = {};
  vi.spyOn(os, "homedir").mockReturnValue(HOME);
  const realExists = fs.existsSync;
  vi.spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p);
    return FAKE_PREFIXES.some((prefix) => s.startsWith(prefix)) ? existing.has(s) : realExists(p);
  });
  const realReaddir = fs.readdirSync;
  vi.spyOn(fs, "readdirSync").mockImplementation(((p: fs.PathLike, opts: never) => {
    const s = String(p);
    if (!s.startsWith("Q:\\")) return realReaddir(p, opts);
    if (!listings[s]) throw Object.assign(new Error(`ENOENT: ${s}`), { code: "ENOENT" });
    return listings[s];
  }) as typeof fs.readdirSync);
  vi.stubEnv("PATH", bin);
  vi.stubEnv("TERMINAL", "");
  vi.stubEnv("LOCALAPPDATA", "Q:\\Local");
  vi.stubEnv("ProgramFiles", "Q:\\Programs");
  vi.stubEnv("SystemRoot", "Q:\\Windows");
  vi.stubEnv("PATHEXT", ".EXE;.CMD");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setPlatform(realPlatform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("editorLaunch on macOS", () => {
  beforeEach(() => setPlatform("darwin"));

  it.each([
    ["cursor", "cursor"],
    ["zed", "zed"],
    ["windsurf", "windsurf"],
    ["sublime", "subl"],
  ] as const)("starts %s's own command with the folder and the file", (id, command) => {
    const cli = install(command);
    expect(editorLaunch(id, DIR, FILE)).toEqual({ command: cli, args: [DIR, FILE], detached: true });
    expect(editorLaunch(id, DIR, null)).toEqual({ command: cli, args: [DIR], detached: true });
  });

  it.each([
    ["idea", "idea"],
    ["webstorm", "webstorm"],
  ] as const)("gives %s one path: the file, else the folder", (id, command) => {
    const cli = install(command);
    expect(editorLaunch(id, DIR, FILE)).toEqual({ command: cli, args: [FILE], detached: true });
    expect(editorLaunch(id, DIR, null)).toEqual({ command: cli, args: [DIR], detached: true });
  });

  it("finds Zed's other command name", () => {
    const cli = install("zeditor");
    expect(editorLaunch("zed", DIR, null)?.command).toBe(cli);
  });

  it.each([
    ["cursor", "/Applications/Cursor.app"],
    ["zed", "/Applications/Zed.app"],
    ["windsurf", "/Applications/Windsurf.app"],
    ["sublime", "/Applications/Sublime Text.app"],
    ["idea", "/Applications/IntelliJ IDEA.app"],
    ["idea", "/Applications/IntelliJ IDEA CE.app"],
    ["webstorm", "/Applications/WebStorm.app"],
  ] as const)("opens %s's app (%s) with `open -a` when its command isn't on PATH", (id, app) => {
    existing.add(app);
    expect(editorLaunch(id, DIR, FILE)).toEqual({ command: "open", args: ["-a", app, FILE] });
    expect(editorLaunch(id, DIR, null)).toEqual({ command: "open", args: ["-a", app, DIR] });
  });

  it("finds an app in ~/Applications", () => {
    const app = path.posix.join(HOME, "Applications", "Cursor.app");
    fs.mkdirSync(app, { recursive: true });
    expect(editorLaunch("cursor", DIR, null)).toEqual({ command: "open", args: ["-a", app, DIR] });
  });

  it("is null when it isn't installed", () => {
    existing.add("/Applications/Cursor.app");
    expect(editorLaunch("zed", DIR, null)).toBeNull();
    expect(editorInstalled("zed")).toBe(false);
    expect(editorInstalled("cursor")).toBe(true);
  });
});

describe("editorLaunch on Linux", () => {
  beforeEach(() => setPlatform("linux"));

  it.each([
    ["cursor", "cursor", [DIR, FILE]],
    ["zed", "zed", [DIR, FILE]],
    ["windsurf", "windsurf", [DIR, FILE]],
    ["sublime", "subl", [DIR, FILE]],
    ["idea", "intellij-idea-community", [FILE]],
    ["webstorm", "webstorm", [FILE]],
  ] as const)("starts %s from PATH (%s), detached", (id, command, args) => {
    const cli = install(command);
    expect(editorLaunch(id, DIR, FILE)).toEqual({ command: cli, args, detached: true });
  });

  it.each([
    ["cursor", "/usr/share/cursor/bin/cursor"],
    ["zed", "/usr/bin/zeditor"],
    ["windsurf", "/usr/share/windsurf/bin/windsurf"],
    ["sublime", "/opt/sublime_text/sublime_text"],
    ["idea", "/snap/bin/intellij-idea-ultimate"],
    ["webstorm", "/snap/bin/webstorm"],
  ] as const)("falls back to where %s installs (%s)", (id, place) => {
    existing.add(place);
    expect(editorLaunch(id, DIR, null)).toEqual({ command: place, args: [DIR], detached: true });
  });

  it("finds Zed's installer copy and JetBrains Toolbox scripts in the home folder", () => {
    const zed = touch(path.posix.join(HOME, ".local", "bin", "zed"));
    const idea = touch(path.posix.join(HOME, ".local", "share", "JetBrains", "Toolbox", "scripts", "idea"));
    expect(editorLaunch("zed", DIR, FILE)).toEqual({ command: zed, args: [DIR, FILE], detached: true });
    expect(editorLaunch("idea", DIR, FILE)).toEqual({ command: idea, args: [FILE], detached: true });
  });

  it("never looks for macOS apps", () => {
    existing.add("/Applications/Cursor.app");
    expect(editorLaunch("cursor", DIR, null)).toBeNull();
  });
});

describe("editorLaunch on Windows", () => {
  beforeEach(() => {
    setPlatform("win32");
    vi.stubEnv("PATH", bin);
  });

  it.each([
    ["cursor", "Q:\\Local\\Programs\\cursor\\Cursor.exe"],
    ["cursor", "Q:\\Programs\\cursor\\Cursor.exe"],
    ["zed", "Q:\\Local\\Programs\\Zed\\Zed.exe"],
    ["windsurf", "Q:\\Local\\Programs\\Windsurf\\Windsurf.exe"],
    ["sublime", "Q:\\Programs\\Sublime Text\\subl.exe"],
    ["sublime", "Q:\\Programs\\Sublime Text 3\\subl.exe"],
  ] as const)("starts %s's own .exe (%s) with the folder and the file", (id, exe) => {
    existing.add(exe);
    expect(editorLaunch(id, DIR, FILE)).toEqual({ command: exe, args: [DIR, FILE], detached: true });
  });

  it("never runs an editor's .cmd command, which would go through cmd.exe", () => {
    install("cursor.cmd");
    install("windsurf.cmd");
    expect(editorLaunch("cursor", DIR, FILE)).toBeNull();
    expect(editorLaunch("windsurf", DIR, FILE)).toBeNull();
  });

  it("finds the newest IntelliJ IDEA under Program Files\\JetBrains", () => {
    listings["Q:\\Programs\\JetBrains"] = ["IntelliJ IDEA 2024.3", "IntelliJ IDEA 2025.2", "WebStorm 2025.1"];
    existing.add("Q:\\Programs\\JetBrains\\IntelliJ IDEA 2024.3\\bin\\idea64.exe");
    existing.add("Q:\\Programs\\JetBrains\\IntelliJ IDEA 2025.2\\bin\\idea64.exe");
    expect(editorLaunch("idea", DIR, FILE)).toEqual({
      command: "Q:\\Programs\\JetBrains\\IntelliJ IDEA 2025.2\\bin\\idea64.exe",
      args: [FILE],
      detached: true,
    });
    // Listed, but its .exe isn't there.
    expect(editorLaunch("webstorm", DIR, null)).toBeNull();
  });

  it("finds a Toolbox install in the per-user Programs folder", () => {
    listings["Q:\\Local\\Programs"] = ["WebStorm", "cursor"];
    existing.add("Q:\\Local\\Programs\\WebStorm\\bin\\webstorm64.exe");
    expect(editorLaunch("webstorm", DIR, null)).toEqual({
      command: "Q:\\Local\\Programs\\WebStorm\\bin\\webstorm64.exe",
      args: [DIR],
      detached: true,
    });
  });

  it("looks only in Program Files without LOCALAPPDATA", () => {
    vi.stubEnv("LOCALAPPDATA", "");
    existing.add("Q:\\Local\\Programs\\cursor\\Cursor.exe");
    expect(editorLaunch("cursor", DIR, null)).toBeNull();
    existing.add("Q:\\Programs\\cursor\\Cursor.exe");
    expect(editorLaunch("cursor", DIR, null)?.command).toBe("Q:\\Programs\\cursor\\Cursor.exe");
  });
});

describe("editorLaunch elsewhere", () => {
  it("is null on other systems", () => {
    setPlatform("freebsd");
    install("cursor");
    expect(editorLaunch("cursor", DIR, null)).toBeNull();
  });
});

describe("vscodeInstalled", () => {
  it("finds the code command, or the app, on macOS", () => {
    setPlatform("darwin");
    expect(vscodeInstalled()).toBe(false);
    existing.add("/Applications/Visual Studio Code.app");
    expect(vscodeInstalled()).toBe(true);
    existing.clear();
    install("code");
    expect(vscodeInstalled()).toBe(true);
    expect(editorInstalled("vscode")).toBe(true);
  });

  it("finds it where it installs on Linux", () => {
    setPlatform("linux");
    existing.add("/snap/bin/code");
    expect(vscodeInstalled()).toBe(true);
  });

  it("counts only Code.exe on Windows, not code.cmd", () => {
    setPlatform("win32");
    install("code.cmd");
    expect(vscodeInstalled()).toBe(false);
    existing.add("Q:\\Local\\Programs\\Microsoft VS Code\\Code.exe");
    expect(vscodeInstalled()).toBe(true);
  });
});

describe("terminalLaunch on macOS", () => {
  beforeEach(() => setPlatform("darwin"));

  it("opens Terminal as always", () => {
    expect(terminalLaunch("terminal", DIR)).toEqual({ command: "open", args: ["-a", "Terminal", DIR] });
    expect(terminalInstalled("terminal")).toBe(true);
  });

  it.each([
    ["iterm2", "/Applications/iTerm.app"],
    ["warp", "/Applications/Warp.app"],
    ["ghostty", "/Applications/Ghostty.app"],
  ] as const)("opens %s's app with `open -a` and the folder", (id, app) => {
    expect(terminalLaunch(id, DIR)).toBeNull();
    expect(terminalInstalled(id)).toBe(false);
    existing.add(app);
    expect(terminalLaunch(id, DIR)).toEqual({ command: "open", args: ["-a", app, DIR] });
    expect(terminalInstalled(id)).toBe(true);
  });

  it("has nothing for another system's terminal", () => {
    install("konsole");
    expect(terminalLaunch("konsole", DIR)).toBeNull();
  });
});

describe("terminalLaunch on Linux", () => {
  beforeEach(() => setPlatform("linux"));

  it("Automatic opens the first terminal found, as always", () => {
    install("xterm");
    const konsole = install("konsole");
    expect(terminalLaunch("auto", DIR)).toEqual({ command: konsole, args: ["--workdir", DIR] });
  });

  it.each([
    ["gnome-terminal", [`--working-directory=${DIR}`]],
    ["kitty", ["--directory", DIR]],
    ["alacritty", ["--working-directory", DIR]],
    ["wezterm", ["start", "--cwd", DIR]],
    ["xterm", []],
  ] as const)("opens the chosen %s with its folder argument", (name, args) => {
    const command = install(name);
    install("konsole");
    expect(terminalLaunch(name, DIR)).toEqual({ command, args });
  });

  it("doesn't swap in another terminal when the chosen one is missing", () => {
    install("xterm");
    expect(terminalLaunch("kitty", DIR)).toBeNull();
    expect(terminalInstalled("kitty")).toBe(false);
    expect(terminalInstalled("xterm")).toBe(true);
  });

  it("has nothing for another system's terminal", () => {
    install("xterm");
    expect(terminalLaunch("iterm2", DIR)).toBeNull();
  });
});

describe("terminalLaunch on Windows", () => {
  beforeEach(() => setPlatform("win32"));
  const cmd = "Q:\\Windows\\System32\\cmd.exe";
  const prompt = { command: cmd, args: ["/d", "/s", "/c", `"start "" "${cmd}""`], detached: true, verbatim: true };

  it("opens Windows Terminal in the working folder, never with the folder as an argument", () => {
    const wt = install("wt.exe");
    expect(terminalLaunch("wt", DIR)).toEqual({ command: wt, args: ["-d", "."], detached: true });
    expect(terminalInstalled("wt")).toBe(true);
  });

  it("falls back to a Command Prompt without Windows Terminal", () => {
    expect(terminalLaunch("wt", DIR)).toEqual(prompt);
    expect(terminalInstalled("wt")).toBe(false);
  });

  it("opens a Command Prompt when that's the choice, even with Windows Terminal installed", () => {
    install("wt.exe");
    expect(terminalLaunch("cmd", DIR)).toEqual(prompt);
    expect(terminalInstalled("cmd")).toBe(true);
    expect(JSON.stringify(terminalLaunch("cmd", DIR))).not.toContain("alpha");
  });
});

describe("terminalLaunch elsewhere", () => {
  it("is null on other systems", () => {
    setPlatform("freebsd");
    install("xterm");
    expect(terminalLaunch("auto", DIR)).toBeNull();
  });
});

describe("editorChoices", () => {
  it("offers what's installed, plus the current choice marked not installed", () => {
    setPlatform("darwin");
    existing.add("/Applications/Cursor.app");
    existing.add("/Applications/WebStorm.app");
    expect(editorChoices("vscode")).toEqual({
      offered: [
        { id: "vscode", label: "VS Code", installed: false },
        { id: "cursor", label: "Cursor", installed: true },
        { id: "webstorm", label: "WebStorm", installed: true },
      ],
      missing: ["Zed", "Windsurf", "Sublime Text", "IntelliJ IDEA"],
    });
  });
});

describe("terminalChoices", () => {
  it("on macOS: Terminal, and the others that are installed", () => {
    setPlatform("darwin");
    existing.add("/Applications/Ghostty.app");
    expect(terminalChoices("terminal")).toEqual({
      offered: [
        { id: "terminal", label: "Terminal", installed: true },
        { id: "ghostty", label: "Ghostty", installed: true },
      ],
      missing: ["iTerm2", "Warp"],
    });
  });

  it("on Linux: says which terminal Automatic opens", () => {
    setPlatform("linux");
    install("gnome-terminal");
    install("kitty");
    const { offered, missing } = terminalChoices("auto", "linux");
    expect(offered).toEqual([
      { id: "auto", label: "Automatic", installed: true, detail: "Opens GNOME Terminal" },
      { id: "gnome-terminal", label: "GNOME Terminal", installed: true },
      { id: "kitty", label: "kitty", installed: true },
    ]);
    expect(missing).toContain("Konsole");
  });

  // A Windows path (C:\…) has no "/", so it can't be read the POSIX way there.
  it.skipIf(realPlatform === "win32")("names a $TERMINAL it doesn't know by its file name", () => {
    setPlatform("linux");
    const mine = touch(path.join(root, "tools", "my-term"));
    vi.stubEnv("TERMINAL", mine);
    expect(terminalChoices("auto", "linux").offered[0]).toMatchObject({ id: "auto", detail: "Opens my-term" });
  });

  it("on Linux with no terminal: keeps Automatic, saying so", () => {
    setPlatform("linux");
    expect(terminalChoices("auto", "linux")).toMatchObject({
      offered: [{ id: "auto", label: "Automatic", installed: false, detail: "No terminal found" }],
    });
  });

  it("on Windows: says a Command Prompt opens when Windows Terminal is missing", () => {
    setPlatform("win32");
    expect(terminalChoices("wt", "windows").offered).toEqual([
      { id: "wt", label: "Windows Terminal", installed: false, detail: "Not found, so a Command Prompt opens instead" },
      { id: "cmd", label: "Command Prompt", installed: true },
    ]);
  });
});

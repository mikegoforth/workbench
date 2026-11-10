import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// execFile and spawn are mocked: neither VS Code nor any terminal is launched.
// Each execFile call is recorded and answered with `outcome(cmd)`: null for
// success, or an error. Each spawn hands back a fake child that reports
// "spawn" (or `spawnError`) on the next tick.
const child = await vi.hoisted(async () => {
  const { EventEmitter } = await import("events");
  const outcome = vi.fn<(cmd: string) => Error | null>(() => null);
  const execFile = vi.fn((cmd: string, _args: string[], _opts: object, cb: (e: Error | null, out?: string, err?: string) => void) => {
    cb(outcome(cmd), "", "");
  });
  const state = { spawnError: null as Error | null, unref: vi.fn() };
  const spawn = vi.fn<(cmd: string, args: string[], opts: object) => InstanceType<typeof EventEmitter>>(() => {
    const proc = Object.assign(new EventEmitter(), { unref: state.unref });
    const error = state.spawnError;
    process.nextTick(() => (error ? proc.emit("error", error) : proc.emit("spawn")));
    return proc;
  });
  return { execFile, outcome, spawn, state };
});
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const overrides = { execFile: child.execFile, spawn: child.spawn };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

import { POST } from "./route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-open-")));
const projects = path.join(root, "projects");
const alpha = path.join(projects, "alpha");
fs.mkdirSync(path.join(alpha, "src"), { recursive: true });
fs.mkdirSync(path.join(projects, ".hidden"));
fs.writeFileSync(path.join(alpha, "src", "index.ts"), "");
fs.writeFileSync(path.join(root, "outside.txt"), "");

// Fake terminals for PATH lookups: executable files that are never run.
const bin = path.join(root, "bin");
const otherBin = path.join(root, "other-bin");
fs.mkdirSync(bin);
fs.mkdirSync(otherBin);
function install(dir: string, name: string, mode = 0o755) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\n");
  fs.chmodSync(file, mode);
  return file;
}
function uninstallAll() {
  for (const dir of [bin, otherBin]) for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true });
}

/** Paths that exist as far as the VS Code fallback can tell. */
const LINUX_CODE = ["/usr/bin/code", "/snap/bin/code", "/usr/share/code/bin/code"];
/** Code.exe on Windows, with %LOCALAPPDATA% and %ProgramFiles% pointed at a drive no machine has. */
const WINDOWS_CODE = ["Q:\\Local\\Programs\\Microsoft VS Code\\Code.exe", "Q:\\Programs\\Microsoft VS Code\\Code.exe"];
let existing = new Set<string>();

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/open", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const enoent = () => Object.assign(new Error("spawn code ENOENT"), { code: "ENOENT" });

const realPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

const commands = () => child.execFile.mock.calls.map(([cmd, args]) => [cmd, args]);
const spawned = () => child.spawn.mock.calls.map(([cmd, args]) => [cmd, args]);

beforeEach(() => {
  child.execFile.mockClear();
  child.outcome.mockReset();
  child.outcome.mockReturnValue(null);
  child.spawn.mockClear();
  child.state.unref.mockClear();
  child.state.spawnError = null;
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  vi.stubEnv("PATH", [bin, otherBin].join(path.delimiter));
  vi.stubEnv("TERMINAL", "");
  uninstallAll();
  existing = new Set();
  // No preferences saved: VS Code and each system's own terminal.
  fs.rmSync(path.join(root, "data"), { recursive: true, force: true });
  // Apps in ~/Applications are looked for in a temp home folder, never the real one.
  vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
  const realExists = fs.existsSync;
  vi.spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p);
    return LINUX_CODE.includes(s) || s.startsWith("Q:\\") || s.startsWith("/Applications/") ? existing.has(s) : realExists(p);
  });
  setPlatform("darwin");
});

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(realPlatform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("POST /api/open in VS Code", () => {
  it("opens the project folder", async () => {
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(commands()).toEqual([["code", [alpha]]]);
    expect(child.execFile.mock.calls[0][2]).toMatchObject({ timeout: 10_000 });
  });

  // Every WORKBENCH_ variable (the API token among them) and workbench's own PORT stay behind.
  it("doesn't hand VS Code workbench's own settings", async () => {
    vi.stubEnv("PORT", "61171");
    await POST(post({ projectName: "alpha" }));
    const env = (child.execFile.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env;
    expect(env).not.toHaveProperty("WORKBENCH_DATA_DIR");
    expect(env).not.toHaveProperty("WORKBENCH_PROJECTS_DIR");
    expect(env).not.toHaveProperty("PORT");
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("opens a file in the project's window", async () => {
    const res = await POST(post({ projectName: "alpha", file: "src/index.ts" }));
    expect(res.status).toBe(200);
    expect(commands()).toEqual([["code", [alpha, path.join(alpha, "src", "index.ts")]]]);
  });

  it("falls back to the app on macOS when the code CLI isn't installed", async () => {
    child.outcome.mockImplementation((cmd) => (cmd === "code" ? enoent() : null));
    const res = await POST(post({ projectName: "alpha", file: "src/index.ts" }));
    expect(res.status).toBe(200);
    expect(commands()).toEqual([
      ["code", [alpha, path.join(alpha, "src", "index.ts")]],
      ["open", ["-a", "Visual Studio Code", path.join(alpha, "src", "index.ts")]],
    ]);
  });

  it("falls back to opening the folder when no file was asked for", async () => {
    child.outcome.mockImplementation((cmd) => (cmd === "code" ? enoent() : null));
    await POST(post({ projectName: "alpha" }));
    expect(commands()[1]).toEqual(["open", ["-a", "Visual Studio Code", alpha]]);
  });

  it("doesn't fall back off macOS", async () => {
    setPlatform("linux");
    child.outcome.mockImplementation(() => enoent());
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open VS Code: spawn code ENOENT" });
    expect(commands()).toEqual([["code", [alpha]]]);
  });

  it.each(LINUX_CODE)("falls back to %s on Linux when code isn't on PATH", async (cli) => {
    setPlatform("linux");
    existing.add(cli);
    child.outcome.mockImplementation((cmd) => (cmd === "code" ? enoent() : null));
    const res = await POST(post({ projectName: "alpha", file: "src/index.ts" }));
    expect(res.status).toBe(200);
    expect(commands()).toEqual([
      ["code", [alpha, path.join(alpha, "src", "index.ts")]],
      [cli, [alpha, path.join(alpha, "src", "index.ts")]],
    ]);
  });

  it("uses the first Linux location that exists, with just the folder", async () => {
    setPlatform("linux");
    existing.add("/snap/bin/code").add("/usr/share/code/bin/code");
    child.outcome.mockImplementation((cmd) => (cmd === "code" ? enoent() : null));
    await POST(post({ projectName: "alpha" }));
    expect(commands()[1]).toEqual(["/snap/bin/code", [alpha]]);
  });

  it("doesn't fall back on other systems", async () => {
    setPlatform("freebsd");
    existing.add("/usr/bin/code");
    child.outcome.mockImplementation(() => enoent());
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(500);
    expect(commands()).toHaveLength(1);
  });

  it("doesn't fall back when code fails for another reason", async () => {
    child.outcome.mockImplementation(() => new Error("timed out"));
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open VS Code: timed out" });
    expect(commands()).toHaveLength(1);
  });

  it("reports a failed fallback", async () => {
    child.outcome.mockImplementation((cmd) => (cmd === "code" ? enoent() : new Error("no such app")));
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open VS Code: no such app" });
  });

  it.each([
    ["a missing file", "nope.ts"],
    ["a path out of the project", "../../outside.txt"],
    ["an absolute path", path.join(root, "outside.txt")],
    ["a folder", "src"],
    ["a non-string", 5],
    ["null", null],
  ])("404s for %s", async (_label, file) => {
    const res = await POST(post({ projectName: "alpha", file }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "File not found" });
    expect(child.execFile).not.toHaveBeenCalled();
  });
});

describe("POST /api/open in Terminal", () => {
  it("opens a Terminal window in the project", async () => {
    const res = await POST(post({ projectName: "alpha", app: "terminal", file: "ignored" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(commands()).toEqual([["open", ["-a", "Terminal", alpha]]]);
  });

  it("never looks for Linux terminals on macOS", async () => {
    install(bin, "gnome-terminal");
    await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("501s on other systems", async () => {
    setPlatform("freebsd");
    install(bin, "xterm");
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "Open in Terminal only works on macOS, Linux and Windows" });
    expect(child.execFile).not.toHaveBeenCalled();
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("reports a failure", async () => {
    child.outcome.mockImplementation(() => new Error("not allowed"));
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open Terminal: not allowed" });
  });
});

describe("POST /api/open in a terminal on Linux", () => {
  beforeEach(() => {
    setPlatform("linux");
  });

  it("launches the terminal detached in the project folder, without a shell or workbench's settings", async () => {
    const gnome = install(bin, "gnome-terminal");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DISPLAY", ":0");
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(spawned()).toEqual([[gnome, [`--working-directory=${alpha}`]]]);
    const opts = child.spawn.mock.calls[0][2] as { cwd: string; detached: boolean; stdio: string; env: NodeJS.ProcessEnv; shell?: boolean };
    expect(opts).toMatchObject({ cwd: alpha, detached: true, stdio: "ignore" });
    expect(opts.shell).toBeUndefined();
    expect(opts.env.DISPLAY).toBe(":0");
    expect(opts.env).not.toHaveProperty("WORKBENCH_PROJECTS_DIR");
    expect(opts.env).not.toHaveProperty("NODE_ENV");
    expect(child.state.unref).toHaveBeenCalled();
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it.each([
    ["x-terminal-emulator", []],
    ["gnome-terminal", ["--working-directory=DIR"]],
    ["konsole", ["--workdir", "DIR"]],
    ["xfce4-terminal", ["--working-directory=DIR"]],
    ["kitty", ["--directory", "DIR"]],
    ["alacritty", ["--working-directory", "DIR"]],
    ["wezterm", ["start", "--cwd", "DIR"]],
    ["foot", ["--working-directory=DIR"]],
    ["ptyxis", ["--working-directory=DIR"]],
    ["kgx", ["--working-directory=DIR"]],
    ["tilix", ["--working-directory=DIR"]],
    ["terminator", ["--working-directory=DIR"]],
    ["xterm", []],
  ])("opens %s in the folder", async (name, args) => {
    const file = install(bin, name);
    await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(spawned()).toEqual([[file, args.map((a) => a.replace("DIR", alpha))]]);
    expect(child.spawn.mock.calls[0][2]).toMatchObject({ cwd: alpha });
  });

  it("tries terminals in order, across PATH", async () => {
    install(bin, "xterm");
    install(bin, "kitty");
    const konsole = install(otherBin, "konsole");
    await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(spawned()).toEqual([[konsole, ["--workdir", alpha]]]);
  });

  it("prefers $TERMINAL, with that terminal's arguments", async () => {
    install(bin, "x-terminal-emulator");
    const kitty = install(otherBin, "kitty");
    vi.stubEnv("TERMINAL", "kitty");
    await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(spawned()).toEqual([[kitty, ["--directory", alpha]]]);
  });

  // A Windows path (C:\…) has no "/", so it can't be read the POSIX way there.
  it.skipIf(realPlatform === "win32")("accepts $TERMINAL as a full path to a terminal it doesn't know", async () => {
    install(bin, "xterm");
    const mine = install(root, "my-term");
    vi.stubEnv("TERMINAL", mine);
    await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(spawned()).toEqual([[mine, []]]);
    expect(child.spawn.mock.calls[0][2]).toMatchObject({ cwd: alpha });
  });

  it.each([
    ["isn't installed", "nope-term"],
    ["is a relative path", "bin/xterm"],
    ["holds arguments", "xterm -e bash"],
  ])("falls back when $TERMINAL %s", async (_label, value) => {
    const xterm = install(bin, "xterm");
    vi.stubEnv("TERMINAL", value);
    await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(spawned()).toEqual([[xterm, []]]);
  });

  // chmod can't take the executable bit away on Windows.
  it.skipIf(realPlatform === "win32")("skips files that aren't executable, folders and relative PATH entries", async () => {
    install(bin, "gnome-terminal", 0o644);
    fs.mkdirSync(path.join(bin, "konsole"));
    vi.stubEnv("PATH", ["relative-bin", "", bin, otherBin].join(path.delimiter));
    const xterm = install(otherBin, "xterm");
    await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(spawned()).toEqual([[xterm, []]]);
  });

  it("501s when no terminal is installed", async () => {
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({
      error: "No terminal app found. Install one (such as GNOME Terminal, Konsole or xterm), or set $TERMINAL to yours.",
    });
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("501s with no PATH at all", async () => {
    install(bin, "xterm");
    vi.stubEnv("PATH", undefined);
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(501);
  });

  it("reports a terminal that fails to start", async () => {
    install(bin, "xterm");
    child.state.spawnError = Object.assign(new Error("spawn xterm EACCES"), { code: "EACCES" });
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open a terminal: spawn xterm EACCES" });
    expect(child.state.unref).not.toHaveBeenCalled();
  });

  // Windows doesn't allow quotes in a folder name.
  it.skipIf(realPlatform === "win32")("passes a folder with spaces and quotes as one argument", async () => {
    const odd = path.join(projects, `it's "odd" $(x)`);
    fs.mkdirSync(odd, { recursive: true });
    const gnome = install(bin, "gnome-terminal");
    const res = await POST(post({ projectName: path.basename(odd), app: "terminal" }));
    expect(res.status).toBe(200);
    expect(spawned()).toEqual([[gnome, [`--working-directory=${odd}`]]]);
    fs.rmSync(odd, { recursive: true });
  });
});

describe("POST /api/open on Windows", () => {
  const [USER_CODE] = WINDOWS_CODE;
  const opts = () => child.spawn.mock.calls[0][2] as Record<string, unknown> & { env: NodeJS.ProcessEnv };

  beforeEach(() => {
    setPlatform("win32");
    vi.stubEnv("LOCALAPPDATA", "Q:\\Local");
    vi.stubEnv("ProgramFiles", "Q:\\Programs");
    vi.stubEnv("PATHEXT", ".EXE;.CMD");
    vi.stubEnv("SystemRoot", "Q:\\Windows");
    vi.stubEnv("PATH", [bin, otherBin].join(";"));
  });

  it("starts Code.exe itself with the folder and file, never code.cmd", async () => {
    existing.add(USER_CODE);
    install(bin, "code.cmd");
    const res = await POST(post({ projectName: "alpha", file: "src/index.ts" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(spawned()).toEqual([[USER_CODE, [alpha, path.join(alpha, "src", "index.ts")]]]);
    expect(opts()).toMatchObject({ cwd: alpha, detached: true, stdio: "ignore" });
    expect(opts()).not.toHaveProperty("shell");
    expect(opts()).not.toHaveProperty("windowsVerbatimArguments");
    expect(opts().env).not.toHaveProperty("WORKBENCH_PROJECTS_DIR");
    expect(child.state.unref).toHaveBeenCalled();
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("says when there's no Code.exe", async () => {
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open VS Code: Code.exe wasn't found. Is VS Code installed?" });
    expect(child.spawn).not.toHaveBeenCalled();
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("reports Code.exe failing to start", async () => {
    existing.add(WINDOWS_CODE[1]);
    child.state.spawnError = new Error("spawn EPERM");
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open VS Code: spawn EPERM" });
  });

  it("opens Windows Terminal in the project folder, which is never an argument", async () => {
    const wt = install(otherBin, "wt.exe");
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(200);
    expect(spawned()).toEqual([[wt, ["-d", "."]]]);
    expect(opts()).toMatchObject({ cwd: alpha, detached: true, stdio: "ignore" });
    // A window to look at: not hidden.
    expect(opts()).not.toHaveProperty("windowsHide");
  });

  it("opens a Command Prompt without Windows Terminal, through a fixed command line", async () => {
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(200);
    const cmd = "Q:\\Windows\\System32\\cmd.exe";
    expect(spawned()).toEqual([[cmd, ["/d", "/s", "/c", `"start "" "${cmd}""`]]]);
    expect(opts()).toMatchObject({ cwd: alpha, detached: true, windowsVerbatimArguments: true });
    expect(JSON.stringify(child.spawn.mock.calls[0][1])).not.toContain("alpha");
  });

  it("reports a terminal that fails to start", async () => {
    child.state.spawnError = new Error("spawn ENOENT");
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open a terminal: spawn ENOENT" });
  });
});

describe("POST /api/open checks", () => {
  it("refuses a non-localhost Host", async () => {
    const res = await POST(post({ projectName: "alpha" }, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await POST(post({ projectName: "alpha" }, { "content-type": "text/plain;charset=UTF-8" }));
    expect(res.status).toBe(415);
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("400s on an invalid JSON body", async () => {
    const res = await POST(post("{"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([undefined, 1, "missing", "../x", ".hidden", "__proto__", "/etc"])("404s for project %j", async (projectName) => {
    const res = await POST(post({ projectName, app: "terminal" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Project not found" });
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("404s for a null body", async () => {
    const res = await POST(post(null));
    expect(res.status).toBe(404);
  });
});

/** Save preferences the way the Preferences page does: ids in settings.json. */
function prefer(preferences: Record<string, unknown>) {
  const dir = path.join(root, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ hiddenProjects: [], parked: {}, preferences }));
}

describe("POST /api/open in the editor chosen in Preferences", () => {
  const file = () => path.join(alpha, "src", "index.ts");
  const opts = () => child.spawn.mock.calls[0][2] as Record<string, unknown> & { env: NodeJS.ProcessEnv };

  it("starts the editor's command from PATH with the folder and file, detached, without a shell", async () => {
    prefer({ editor: "cursor" });
    const cursor = install(bin, "cursor");
    const res = await POST(post({ projectName: "alpha", file: "src/index.ts" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(spawned()).toEqual([[cursor, [alpha, file()]]]);
    expect(opts()).toMatchObject({ cwd: alpha, detached: true, stdio: "ignore" });
    expect(opts()).not.toHaveProperty("shell");
    expect(opts().env).not.toHaveProperty("WORKBENCH_PROJECTS_DIR");
    expect(child.state.unref).toHaveBeenCalled();
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("opens the app with `open -a` on macOS when its command isn't on PATH", async () => {
    prefer({ editor: "zed" });
    existing.add("/Applications/Zed.app");
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(200);
    expect(commands()).toEqual([["open", ["-a", "/Applications/Zed.app", alpha]]]);
    const env = (child.execFile.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env;
    expect(env).not.toHaveProperty("WORKBENCH_DATA_DIR");
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("gives a JetBrains IDE the one path: the file", async () => {
    prefer({ editor: "idea" });
    existing.add("/Applications/IntelliJ IDEA.app");
    await POST(post({ projectName: "alpha", file: "src/index.ts" }));
    expect(commands()).toEqual([["open", ["-a", "/Applications/IntelliJ IDEA.app", file()]]]);
  });

  it("says when the chosen editor isn't installed, and opens nothing else", async () => {
    prefer({ editor: "windsurf" });
    install(bin, "code");
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Couldn't open Windsurf: it wasn't found. Is it installed? You can choose another editor in Preferences.",
    });
    expect(child.execFile).not.toHaveBeenCalled();
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("reports an editor that fails to start", async () => {
    prefer({ editor: "sublime" });
    install(bin, "subl");
    child.state.spawnError = new Error("spawn EACCES");
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open Sublime Text: spawn EACCES" });
  });

  it("reports `open -a` failing", async () => {
    prefer({ editor: "webstorm" });
    existing.add("/Applications/WebStorm.app");
    child.outcome.mockImplementation(() => new Error("LSOpenURLsWithRole() failed"));
    const res = await POST(post({ projectName: "alpha" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open WebStorm: LSOpenURLsWithRole() failed" });
  });

  it("still only opens files inside the project", async () => {
    prefer({ editor: "cursor" });
    install(bin, "cursor");
    const res = await POST(post({ projectName: "alpha", file: "../../outside.txt" }));
    expect(res.status).toBe(404);
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it.each([{ editor: "emacs" }, { editor: "/bin/sh" }, { editor: ["cursor"] }])("opens VS Code when the saved editor is %j", async (preferences) => {
    prefer(preferences);
    install(bin, "cursor");
    await POST(post({ projectName: "alpha" }));
    expect(commands()).toEqual([["code", [alpha]]]);
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("starts the editor from PATH on Linux", async () => {
    setPlatform("linux");
    prefer({ editor: "sublime" });
    const subl = install(otherBin, "subl");
    await POST(post({ projectName: "alpha", file: "src/index.ts" }));
    expect(spawned()).toEqual([[subl, [alpha, file()]]]);
    expect(opts()).toMatchObject({ cwd: alpha, detached: true });
  });

  describe("on Windows", () => {
    beforeEach(() => {
      setPlatform("win32");
      vi.stubEnv("LOCALAPPDATA", "Q:\\Local");
      vi.stubEnv("ProgramFiles", "Q:\\Programs");
      vi.stubEnv("PATHEXT", ".EXE;.CMD");
      vi.stubEnv("PATH", [bin, otherBin].join(";"));
    });

    it("starts the editor's own .exe with the folder and file", async () => {
      prefer({ editor: "cursor" });
      const exe = "Q:\\Local\\Programs\\cursor\\Cursor.exe";
      existing.add(exe);
      install(bin, "cursor.cmd");
      const res = await POST(post({ projectName: "alpha", file: "src/index.ts" }));
      expect(res.status).toBe(200);
      expect(spawned()).toEqual([[exe, [alpha, file()]]]);
      expect(opts()).toMatchObject({ cwd: alpha, detached: true, stdio: "ignore" });
      expect(opts()).not.toHaveProperty("shell");
      expect(opts()).not.toHaveProperty("windowsVerbatimArguments");
    });

    it("never runs the editor's .cmd command", async () => {
      prefer({ editor: "cursor" });
      install(bin, "cursor.cmd");
      const res = await POST(post({ projectName: "alpha", file: "src/index.ts" }));
      expect(res.status).toBe(500);
      expect(child.spawn).not.toHaveBeenCalled();
      expect(child.execFile).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/open in the terminal chosen in Preferences", () => {
  it.each([
    ["iterm2", "/Applications/iTerm.app"],
    ["warp", "/Applications/Warp.app"],
    ["ghostty", "/Applications/Ghostty.app"],
  ])("opens %s with `open -a` and the folder on macOS", async (terminal, app) => {
    prefer({ terminal });
    existing.add(app);
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(200);
    expect(commands()).toEqual([["open", ["-a", app, alpha]]]);
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("says when the chosen terminal isn't installed, and doesn't open Terminal instead", async () => {
    prefer({ terminal: "warp" });
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Couldn't open Warp: it wasn't found. Is it installed? You can choose another terminal in Preferences.",
    });
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("reports the chosen terminal failing to open", async () => {
    prefer({ terminal: "ghostty" });
    existing.add("/Applications/Ghostty.app");
    child.outcome.mockImplementation(() => new Error("boom"));
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(await res.json()).toEqual({ error: "Couldn't open Ghostty: boom" });
  });

  it("opens Terminal when the saved terminal is another system's", async () => {
    prefer({ terminal: "konsole" });
    install(bin, "konsole");
    await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(commands()).toEqual([["open", ["-a", "Terminal", alpha]]]);
  });

  describe("on Linux", () => {
    beforeEach(() => setPlatform("linux"));

    it("opens the chosen terminal, not the first one found", async () => {
      prefer({ terminal: "kitty" });
      install(bin, "x-terminal-emulator");
      const kitty = install(otherBin, "kitty");
      const res = await POST(post({ projectName: "alpha", app: "terminal" }));
      expect(res.status).toBe(200);
      expect(spawned()).toEqual([[kitty, ["--directory", alpha]]]);
      expect(child.spawn.mock.calls[0][2]).toMatchObject({ cwd: alpha, detached: true, stdio: "ignore" });
    });

    it("says when the chosen terminal is missing, rather than opening another", async () => {
      prefer({ terminal: "kitty" });
      install(bin, "xterm");
      const res = await POST(post({ projectName: "alpha", app: "terminal" }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("Couldn't open kitty: it wasn't found. Is it installed? You can choose another terminal in Preferences.");
      expect(child.spawn).not.toHaveBeenCalled();
    });

    it("reports the chosen terminal failing to start", async () => {
      prefer({ terminal: "konsole" });
      install(bin, "konsole");
      child.state.spawnError = new Error("spawn EACCES");
      const res = await POST(post({ projectName: "alpha", app: "terminal" }));
      expect(await res.json()).toEqual({ error: "Couldn't open Konsole: spawn EACCES" });
    });

    it("goes back to Automatic when the saved terminal is another system's", async () => {
      prefer({ terminal: "iterm2" });
      const xterm = install(bin, "xterm");
      await POST(post({ projectName: "alpha", app: "terminal" }));
      expect(spawned()).toEqual([[xterm, []]]);
    });
  });

  describe("on Windows", () => {
    const cmd = "Q:\\Windows\\System32\\cmd.exe";
    beforeEach(() => {
      setPlatform("win32");
      vi.stubEnv("SystemRoot", "Q:\\Windows");
      vi.stubEnv("PATHEXT", ".EXE;.CMD");
      vi.stubEnv("PATH", [bin, otherBin].join(";"));
    });

    it("opens a Command Prompt when that's the choice, even with Windows Terminal installed", async () => {
      prefer({ terminal: "cmd" });
      install(bin, "wt.exe");
      const res = await POST(post({ projectName: "alpha", app: "terminal" }));
      expect(res.status).toBe(200);
      expect(spawned()).toEqual([[cmd, ["/d", "/s", "/c", `"start "" "${cmd}""`]]]);
      expect(child.spawn.mock.calls[0][2]).toMatchObject({ cwd: alpha, detached: true, windowsVerbatimArguments: true });
    });

    it("opens Windows Terminal when that's the choice", async () => {
      prefer({ terminal: "wt" });
      const wt = install(bin, "wt.exe");
      await POST(post({ projectName: "alpha", app: "terminal" }));
      expect(spawned()).toEqual([[wt, ["-d", "."]]]);
    });
  });
});

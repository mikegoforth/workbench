import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// connection() needs a live Next request scope; outside one it throws. Here it only
// marks the route as dynamic, so a stand-in that resolves is enough.
const next = vi.hoisted(() => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: next.connection,
}));

import { GET, PUT } from "./route";

// Settings live in a temp data folder; editors and terminals are "installed"
// as files on a temp PATH, or as fake app bundles through an existsSync spy.
// Nothing is launched: this route only reads and saves ids.

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-prefs-")));
const dataDir = path.join(root, "data");
const settingsFile = path.join(dataDir, "settings.json");
const bin = path.join(root, "bin");
fs.mkdirSync(bin);

let existing = new Set<string>();
const realPlatform = process.platform;
const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });

function install(name: string) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, "#!/bin/sh\n");
  fs.chmodSync(file, 0o755);
}

const get = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/preferences", { headers: { host: "localhost:3000", ...headers } });

const put = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/preferences", {
    method: "PUT",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const saved = () => JSON.parse(fs.readFileSync(settingsFile, "utf-8"));

beforeEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  for (const f of fs.readdirSync(bin)) fs.rmSync(path.join(bin, f));
  vi.stubEnv("WORKBENCH_DATA_DIR", dataDir);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  vi.stubEnv("PATH", bin);
  vi.stubEnv("TERMINAL", "");
  vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
  existing = new Set();
  const realExists = fs.existsSync;
  vi.spyOn(fs, "existsSync").mockImplementation((p) =>
    ["/Applications/", "/usr/", "/snap/", "/opt/"].some((prefix) => String(p).startsWith(prefix)) ? existing.has(String(p)) : realExists(p)
  );
  setPlatform("darwin");
});

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(realPlatform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/preferences", () => {
  it("gives the defaults and what's installed", async () => {
    existing.add("/Applications/Visual Studio Code.app");
    existing.add("/Applications/iTerm.app");
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      platform: "mac",
      preferences: { editor: "vscode", terminal: "terminal", rescan: "manual" },
      editors: {
        offered: [{ id: "vscode", label: "VS Code", installed: true }],
        missing: ["Cursor", "Zed", "Windsurf", "Sublime Text", "IntelliJ IDEA", "WebStorm"],
      },
      terminals: {
        offered: [
          { id: "terminal", label: "Terminal", installed: true },
          { id: "iterm2", label: "iTerm2", installed: true },
        ],
        missing: ["Warp", "Ghostty"],
      },
    });
  });

  it("keeps a saved choice that's no longer installed in the list, marked so", async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ preferences: { editor: "zed", terminal: "warp", rescan: "1m" } }));
    const body = await (await GET(get())).json();
    expect(body.preferences).toEqual({ editor: "zed", terminal: "warp", rescan: "1m" });
    expect(body.editors.offered).toEqual([{ id: "zed", label: "Zed", installed: false }]);
    expect(body.terminals.offered).toContainEqual({ id: "warp", label: "Warp", installed: false });
  });

  it("falls back to this system's default for another system's terminal", async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ preferences: { terminal: "konsole" } }));
    setPlatform("linux");
    install("konsole");
    const body = await (await GET(get())).json();
    expect(body.platform).toBe("linux");
    expect(body.preferences.terminal).toBe("konsole");
    setPlatform("darwin");
    expect((await (await GET(get())).json()).preferences.terminal).toBe("terminal");
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get({ host: "evil.example" }));
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/preferences", () => {
  it("saves each choice as an id, next to the other settings", async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ hiddenProjects: ["x"], parked: {}, projectsDir: "/Users/me/code" }));
    existing.add("/Applications/Cursor.app");
    let res = await PUT(put({ editor: "cursor" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferences).toEqual({ editor: "cursor", terminal: "terminal", rescan: "manual" });
    expect(body.editors.offered).toContainEqual({ id: "cursor", label: "Cursor", installed: true });

    res = await PUT(put({ terminal: "ghostty", rescan: "5m" }));
    expect(res.status).toBe(200);
    expect(saved()).toEqual({
      hiddenProjects: ["x"],
      parked: {},
      projectsDir: "/Users/me/code",
      preferences: { editor: "cursor", terminal: "ghostty", rescan: "5m" },
    });
  });

  it("accepts the Linux and Windows terminals on those systems", async () => {
    setPlatform("linux");
    expect((await PUT(put({ terminal: "alacritty" }))).status).toBe(200);
    setPlatform("win32");
    expect((await PUT(put({ terminal: "cmd" }))).status).toBe(200);
    expect(saved().preferences.terminal).toBe("cmd");
  });

  it.each([
    [{ editor: "/Applications/Calculator.app" }, "Unknown editor"],
    [{ editor: "code --disable-extensions" }, "Unknown editor"],
    [{ editor: null }, "Unknown editor"],
    [{ terminal: "konsole" }, "Unknown terminal"],
    [{ terminal: "/bin/sh" }, "Unknown terminal"],
    [{ rescan: 1000 }, "Unknown rescan interval"],
    [{ rescan: "10s" }, "Unknown rescan interval"],
    [{ command: "rm -rf ~" }, "Unknown preference: command"],
    [{ editor: "zed", __proto__: { x: 1 } }, null],
    [JSON.parse('{"__proto__": {"editor": "zed"}}'), "Unknown preference: __proto__"],
  ])("refuses %j and saves nothing", async (body, error) => {
    const res = await PUT(put(body));
    if (error === null) {
      // An object's prototype isn't one of its keys: only editor is sent.
      expect(res.status).toBe(200);
      return;
    }
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("refuses a valid editor sent with an invalid terminal, saving neither", async () => {
    const res = await PUT(put({ editor: "zed", terminal: "warpp" }));
    expect(res.status).toBe(400);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it.each(["{", "null", "[]", '"vscode"', "5"])("400s on the body %s", async (body) => {
    const res = await PUT(put(body));
    expect(res.status).toBe(400);
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await PUT(put({ editor: "zed" }, { "content-type": "text/plain;charset=UTF-8" }));
    expect(res.status).toBe(415);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("refuses a non-localhost Host", async () => {
    const res = await PUT(put({ editor: "zed" }, { host: "192.168.1.5:3000" }));
    expect(res.status).toBe(403);
  });

  it("500s when the settings can't be written", async () => {
    // The data "folder" is a file, so settings.json can't be created in it.
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(dataDir, "");
    const res = await PUT(put({ rescan: "30s" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/^Failed to save settings: /);
    fs.rmSync(dataDir);
  });
});

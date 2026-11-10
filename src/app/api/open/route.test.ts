import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// execFile is mocked: neither VS Code nor Terminal is launched. Each call is
// recorded and answered with `outcome(cmd)`: null for success, or an error.
const child = vi.hoisted(() => {
  const outcome = vi.fn<(cmd: string) => Error | null>(() => null);
  const execFile = vi.fn((cmd: string, _args: string[], _opts: object, cb: (e: Error | null, out?: string, err?: string) => void) => {
    cb(outcome(cmd), "", "");
  });
  return { execFile, outcome };
});
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, default: { ...actual, execFile: child.execFile }, execFile: child.execFile };
});

import { POST } from "./route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-open-")));
const projects = path.join(root, "projects");
const alpha = path.join(projects, "alpha");
fs.mkdirSync(path.join(alpha, "src"), { recursive: true });
fs.mkdirSync(path.join(projects, ".hidden"));
fs.writeFileSync(path.join(alpha, "src", "index.ts"), "");
fs.writeFileSync(path.join(root, "outside.txt"), "");

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

beforeEach(() => {
  child.execFile.mockClear();
  child.outcome.mockReset();
  child.outcome.mockReturnValue(null);
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  setPlatform("darwin");
});

afterEach(() => {
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
    expect(child.execFile.mock.calls[0][2]).toEqual({ timeout: 10_000 });
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

  it("501s off macOS", async () => {
    setPlatform("linux");
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(501);
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("reports a failure", async () => {
    child.outcome.mockImplementation(() => new Error("not allowed"));
    const res = await POST(post({ projectName: "alpha", app: "terminal" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't open Terminal: not allowed" });
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

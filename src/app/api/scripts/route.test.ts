import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Scripts are mocked: nothing runs. The guard and project-name checks are real.
const devenv = vi.hoisted(() => {
  class DevError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { DevError, runScript: vi.fn(), scriptStatus: vi.fn(), stopScript: vi.fn() };
});
vi.mock("@/lib/devenv", () => devenv);

import { GET, POST } from "./route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-scripts-")));
const projects = path.join(root, "projects");
fs.mkdirSync(path.join(projects, "alpha"), { recursive: true });
fs.mkdirSync(path.join(projects, ".hidden"));
const alpha = path.join(projects, "alpha");

const get = (query: string, host = "localhost:3000") =>
  new NextRequest(`http://localhost:3000/api/scripts${query}`, { headers: { host } });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/scripts", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const useSelfAsProject = () => {
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", path.dirname(process.cwd()));
  return path.basename(process.cwd());
};

const status = { scripts: { test: "vitest" }, running: null, output: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  devenv.scriptStatus.mockResolvedValue(status);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/scripts", () => {
  it("returns the project's scripts", async () => {
    const res = await GET(get("?project=alpha"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
    expect(devenv.scriptStatus).toHaveBeenCalledWith("alpha", alpha);
  });

  it("refuses a non-localhost Host", async () => {
    expect((await GET(get("?project=alpha", "evil.example"))).status).toBe(403);
    expect(devenv.scriptStatus).not.toHaveBeenCalled();
  });

  it.each(["", "?project=missing", "?project=../x", "?project=.hidden", "?project=__proto__"])(
    "404s for %j",
    async (query) => {
      const res = await GET(get(query));
      expect(res.status).toBe(404);
      expect(devenv.scriptStatus).not.toHaveBeenCalled();
    }
  );

  it("treats workbench itself as not found", async () => {
    const res = await GET(get(`?project=${useSelfAsProject()}`));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/scripts", () => {
  it("runs a script and returns the status", async () => {
    devenv.runScript.mockResolvedValue(undefined);
    const res = await POST(post({ projectName: "alpha", action: "run", script: "test" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
    expect(devenv.runScript).toHaveBeenCalledWith("alpha", alpha, "test");
    expect(devenv.scriptStatus).toHaveBeenCalledWith("alpha", alpha);
  });

  it("stops the running script", async () => {
    devenv.stopScript.mockResolvedValue(undefined);
    const res = await POST(post({ projectName: "alpha", action: "stop" }));
    expect(res.status).toBe(200);
    expect(devenv.stopScript).toHaveBeenCalledWith("alpha");
    expect(devenv.runScript).not.toHaveBeenCalled();
  });

  it("refuses a non-localhost Host", async () => {
    const res = await POST(post({ projectName: "alpha", action: "stop" }, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(devenv.stopScript).not.toHaveBeenCalled();
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await POST(post({ projectName: "alpha", action: "stop" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(devenv.stopScript).not.toHaveBeenCalled();
  });

  it("400s on an invalid JSON body", async () => {
    const res = await POST(post("nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([null, undefined, 3, "missing", "../x", ".hidden", "__proto__"])("404s for project %j", async (projectName) => {
    const res = await POST(post({ projectName, action: "stop" }));
    expect(res.status).toBe(404);
    expect(devenv.stopScript).not.toHaveBeenCalled();
  });

  it("404s for a null body", async () => {
    const res = await POST(post(null));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Project not found" });
  });

  it("won't run scripts in workbench itself", async () => {
    const res = await POST(post({ projectName: useSelfAsProject(), action: "run", script: "dev" }));
    expect(res.status).toBe(404);
    expect(devenv.runScript).not.toHaveBeenCalled();
  });

  it.each([
    ["run without a script", { action: "run" }],
    ["run with a non-string script", { action: "run", script: ["test"] }],
    ["an unknown action", { action: "restart" }],
    ["no action", {}],
  ])("400s for %s", async (_label, fields) => {
    const res = await POST(post({ projectName: "alpha", ...fields }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Send action "run"');
    expect(devenv.runScript).not.toHaveBeenCalled();
    expect(devenv.stopScript).not.toHaveBeenCalled();
  });

  it("passes a DevError's status through", async () => {
    devenv.runScript.mockRejectedValue(new devenv.DevError(404, "No script named nope"));
    const res = await POST(post({ projectName: "alpha", action: "run", script: "nope" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No script named nope" });
  });

  it("maps other errors to 500", async () => {
    devenv.stopScript.mockRejectedValue(new Error("kill failed"));
    const res = await POST(post({ projectName: "alpha", action: "stop" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "kill failed" });
  });
});

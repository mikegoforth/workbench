import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Docker and compose are mocked: nothing is started. The guard and
// project-name checks are real, against a temporary projects folder.
const devenv = vi.hoisted(() => {
  class DevError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { DevError, getStatus: vi.fn(), stackAction: vi.fn() };
});
const docker = vi.hoisted(() => ({
  dockerSnapshot: vi.fn(),
  invalidateDocker: vi.fn(),
  startDaemon: vi.fn(),
}));
vi.mock("@/lib/devenv", () => devenv);
vi.mock("@/lib/docker", () => docker);

import { POST } from "./route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-docker-")));
const projects = path.join(root, "projects");
fs.mkdirSync(path.join(projects, "alpha"), { recursive: true });
fs.mkdirSync(path.join(projects, ".hidden"));
const alpha = path.join(projects, "alpha");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/docker", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const stack = { projectName: "alpha", stack: "alpha", dir: "." };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  devenv.getStatus.mockResolvedValue({ state: "running" });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("POST /api/docker start-daemon", () => {
  it("starts Docker, drops the cached snapshot and returns the daemon state", async () => {
    docker.startDaemon.mockResolvedValue(undefined);
    docker.dockerSnapshot.mockResolvedValue({ daemon: "running", containers: [] });
    const res = await POST(post({ action: "start-daemon" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ docker: "running" });
    expect(docker.startDaemon).toHaveBeenCalledOnce();
    expect(docker.invalidateDocker).toHaveBeenCalledOnce();
    expect(docker.invalidateDocker.mock.invocationCallOrder[0]).toBeLessThan(
      docker.dockerSnapshot.mock.invocationCallOrder[0]
    );
  });

  it("maps a failure to 500", async () => {
    docker.startDaemon.mockRejectedValue(new Error("Docker Desktop isn't installed"));
    const res = await POST(post({ action: "start-daemon" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Docker Desktop isn't installed" });
    expect(docker.invalidateDocker).not.toHaveBeenCalled();
  });
});

describe("POST /api/docker stack actions", () => {
  it.each(["start", "stop", "restart"])("runs %s on one stack and returns the dev status", async (action) => {
    devenv.stackAction.mockResolvedValue(undefined);
    const res = await POST(post({ ...stack, dir: "services/api", action }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "running" });
    expect(devenv.stackAction).toHaveBeenCalledWith("alpha", alpha, "alpha", "services/api", action);
    expect(devenv.getStatus).toHaveBeenCalledWith("alpha", alpha);
  });

  it("refuses a non-localhost Host", async () => {
    const res = await POST(post({ action: "start-daemon" }, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(docker.startDaemon).not.toHaveBeenCalled();
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await POST(post({ action: "start-daemon" }, { "content-type": "application/x-www-form-urlencoded" }));
    expect(res.status).toBe(415);
    expect(docker.startDaemon).not.toHaveBeenCalled();
  });

  it("400s on an invalid JSON body", async () => {
    const res = await POST(post("{"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([{ ...stack }, { ...stack, action: "down" }, { ...stack, action: "START" }, null])(
    "400s on a bad action: %j",
    async (body) => {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("action must be");
      expect(devenv.stackAction).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, 7, "missing", "../x", ".hidden", "__proto__"])("404s for project %j", async (projectName) => {
    const res = await POST(post({ ...stack, projectName, action: "start" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Project not found" });
    expect(devenv.stackAction).not.toHaveBeenCalled();
  });

  it("won't touch workbench's own stacks", async () => {
    vi.stubEnv("WORKBENCH_PROJECTS_DIR", path.dirname(process.cwd()));
    const res = await POST(post({ ...stack, projectName: path.basename(process.cwd()), action: "stop" }));
    expect(res.status).toBe(404);
    expect(devenv.stackAction).not.toHaveBeenCalled();
  });

  it.each([
    ["no stack", { dir: "." }],
    ["an empty stack", { stack: "", dir: "." }],
    ["a non-string stack", { stack: 1, dir: "." }],
    ["no dir", { stack: "alpha" }],
    ["a non-string dir", { stack: "alpha", dir: null }],
  ])("400s with %s", async (_label, fields) => {
    const res = await POST(post({ projectName: "alpha", action: "start", ...fields }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "stack and dir are required" });
    expect(devenv.stackAction).not.toHaveBeenCalled();
  });

  it("passes a DevError's status through", async () => {
    devenv.stackAction.mockRejectedValue(new devenv.DevError(400, "Unknown stack"));
    const res = await POST(post({ ...stack, action: "restart" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown stack" });
  });

  it("maps other errors to 500", async () => {
    devenv.stackAction.mockRejectedValue(new Error("compose crashed"));
    const res = await POST(post({ ...stack, action: "start" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "compose crashed" });
  });
});

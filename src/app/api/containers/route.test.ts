import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The containers lib and stack actions are mocked: nothing touches Docker.
// The guard and project-name checks are real, against a temporary projects folder.
const devenv = vi.hoisted(() => {
  class DevError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { DevError, stackAction: vi.fn() };
});
const containers = vi.hoisted(() => {
  class ContainerError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ContainerError, listContainers: vi.fn(), otherContainerAction: vi.fn() };
});
vi.mock("@/lib/devenv", () => devenv);
vi.mock("@/lib/containers", () => containers);

import { GET, POST } from "./route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-containers-")));
const projects = path.join(root, "projects");
fs.mkdirSync(path.join(projects, "alpha"), { recursive: true });
const alpha = path.join(projects, "alpha");

const LIST = { docker: { state: "running", message: null, app: "Docker" }, groups: [{ project: "alpha", stacks: [] }] };
const ID = "ab".repeat(32);

const get = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/containers", { headers: { host: "localhost:3000", ...headers } });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/containers", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  containers.listContainers.mockResolvedValue(LIST);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/containers", () => {
  it("returns every container, grouped", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(LIST);
  });

  it("only answers on localhost", async () => {
    const res = await GET(get({ host: "192.168.1.20:3000" }));
    expect(res.status).toBe(403);
    expect(containers.listContainers).not.toHaveBeenCalled();
  });

  it("needs the desktop app's token when there is one", async () => {
    vi.stubEnv("WORKBENCH_API_TOKEN", "secret");
    expect((await GET(get())).status).toBe(403);
    expect((await GET(get({ "x-workbench-token": "secret" }))).status).toBe(200);
  });
});

describe("POST /api/containers", () => {
  it("refuses anything but a local JSON request", async () => {
    expect((await POST(post({ id: ID, action: "remove" }, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(post({ id: ID, action: "remove" }, { host: "evil.example:3000" }))).status).toBe(403);
    expect((await POST(post("{not json"))).status).toBe(400);
    expect(containers.otherContainerAction).not.toHaveBeenCalled();
    expect(devenv.stackAction).not.toHaveBeenCalled();
  });

  describe("stack actions", () => {
    it.each(["start", "stop", "restart"])("runs %s on a project's stack and returns the new list", async (action) => {
      devenv.stackAction.mockResolvedValue(undefined);
      const res = await POST(post({ project: "alpha", stack: "alpha", dir: "services/api", action }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(LIST);
      expect(devenv.stackAction).toHaveBeenCalledWith("alpha", alpha, "alpha", "services/api", action);
      expect(containers.otherContainerAction).not.toHaveBeenCalled();
    });

    it.each([
      [{ project: "alpha", stack: "alpha", dir: "", action: "remove" }, 400],
      [{ project: "alpha", stack: "alpha", dir: "" }, 400],
      [{ project: "missing", stack: "x", dir: "", action: "stop" }, 404],
      [{ project: "../alpha", stack: "x", dir: "", action: "stop" }, 404],
      [{ project: 7, stack: "x", dir: "", action: "stop" }, 404],
      [{ project: "alpha", stack: "", dir: "", action: "stop" }, 400],
      [{ project: "alpha", stack: "alpha", action: "stop" }, 400],
      [{ project: "alpha", stack: ["alpha"], dir: "", action: "stop" }, 400],
    ])("rejects %j with %i", async (body, status) => {
      const res = await POST(post(body));
      expect(res.status).toBe(status);
      expect(devenv.stackAction).not.toHaveBeenCalled();
    });

    it("passes on the stack action's status", async () => {
      devenv.stackAction.mockRejectedValue(new devenv.DevError(409, "Already starting or stopping"));
      const res = await POST(post({ project: "alpha", stack: "alpha", dir: "", action: "start" }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Already starting or stopping" });
    });
  });

  describe("containers outside projects", () => {
    it.each(["stop", "remove"])("hands %s to the lib with the id as sent, and returns the new list", async (action) => {
      containers.otherContainerAction.mockResolvedValue(undefined);
      const res = await POST(post({ id: ID, action }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(LIST);
      expect(containers.otherContainerAction).toHaveBeenCalledWith(ID, action);
      expect(devenv.stackAction).not.toHaveBeenCalled();
    });

    it("passes on the lib's status", async () => {
      containers.otherContainerAction.mockRejectedValue(new containers.ContainerError(403, "amplen-api-1 belongs to amplen"));
      const res = await POST(post({ id: ID, action: "stop" }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "amplen-api-1 belongs to amplen" });
    });

    it("maps anything unexpected to 500", async () => {
      containers.otherContainerAction.mockRejectedValue(new Error("boom"));
      const res = await POST(post({ id: ID, action: "remove" }));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "boom" });
    });

    it("handles a JSON null body", async () => {
      containers.otherContainerAction.mockRejectedValue(new containers.ContainerError(400, 'action must be "stop" or "remove"'));
      const res = await POST(post("null"));
      expect(res.status).toBe(400);
      expect(containers.otherContainerAction).toHaveBeenCalledWith(undefined, undefined);
    });
  });
});

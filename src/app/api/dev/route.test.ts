import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The dev environment itself is mocked: no processes are started. The guard and
// project-name checks are real, against a temporary projects folder.
const devenv = vi.hoisted(() => {
  class DevError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return {
    DevError,
    getStatus: vi.fn(),
    install: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
});
vi.mock("@/lib/devenv", () => devenv);

import { GET, POST } from "./route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-dev-")));
const projects = path.join(root, "projects");
const data = path.join(root, "data");
fs.mkdirSync(path.join(projects, "alpha"), { recursive: true });
fs.mkdirSync(path.join(projects, ".hidden"));
const alpha = path.join(projects, "alpha");

const get = (query: string, host = "localhost:3000") =>
  new NextRequest(`http://localhost:3000/api/dev${query}`, { headers: { host } });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/dev", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

// The server's own checkout, seen as a project in its parent folder.
const useSelfAsProject = () => {
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", path.dirname(process.cwd()));
  return path.basename(process.cwd());
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_DATA_DIR", data);
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  devenv.getStatus.mockResolvedValue({ state: "running", output: ["ready"] });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/dev", () => {
  it("returns the project's status", async () => {
    const res = await GET(get("?project=alpha"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "running", output: ["ready"] });
    expect(devenv.getStatus).toHaveBeenCalledWith("alpha", alpha);
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get("?project=alpha", "evil.example"));
    expect(res.status).toBe(403);
    expect(devenv.getStatus).not.toHaveBeenCalled();
  });

  it("refuses a request without the app's token when one is set", async () => {
    vi.stubEnv("WORKBENCH_API_TOKEN", "secret");
    expect((await GET(get("?project=alpha"))).status).toBe(403);
  });

  it.each(["", "?project=", "?project=missing", "?project=../projects", "?project=.hidden", "?project=__proto__"])(
    "404s for %j",
    async (query) => {
      const res = await GET(get(query));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Project not found" });
      expect(devenv.getStatus).not.toHaveBeenCalled();
    }
  );

  it("treats workbench itself as not found", async () => {
    const self = useSelfAsProject();
    const res = await GET(get(`?project=${self}`));
    expect(res.status).toBe(404);
    expect(devenv.getStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/dev", () => {
  it.each(["start", "stop", "install"] as const)("runs %s and returns the new status", async (action) => {
    devenv[action].mockResolvedValue(undefined);
    const res = await POST(post({ projectName: "alpha", action }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "running", output: ["ready"] });
    expect(devenv[action]).toHaveBeenCalledWith("alpha", alpha);
    expect(devenv.getStatus).toHaveBeenCalledWith("alpha", alpha);
    for (const other of (["start", "stop", "install"] as const).filter((a) => a !== action)) {
      expect(devenv[other]).not.toHaveBeenCalled();
    }
  });

  it("refuses a non-localhost Host", async () => {
    const res = await POST(post({ projectName: "alpha", action: "start" }, { host: "192.168.1.20:3000" }));
    expect(res.status).toBe(403);
    expect(devenv.start).not.toHaveBeenCalled();
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await POST(post({ projectName: "alpha", action: "start" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(devenv.start).not.toHaveBeenCalled();
  });

  it("400s on an invalid JSON body", async () => {
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([{ projectName: "alpha" }, { projectName: "alpha", action: "restart" }, { projectName: "alpha", action: 1 }, null])(
    "400s on a bad action: %j",
    async (body) => {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("action must be");
    }
  );

  it.each([undefined, 42, "missing", "../x", ".hidden", "__proto__", "alpha/sub"])(
    "404s for project %j",
    async (projectName) => {
      const res = await POST(post({ projectName, action: "start" }));
      expect(res.status).toBe(404);
      expect(devenv.start).not.toHaveBeenCalled();
    }
  );

  it("won't start or stop workbench itself", async () => {
    const self = useSelfAsProject();
    const res = await POST(post({ projectName: self, action: "stop" }));
    expect(res.status).toBe(404);
    expect(devenv.stop).not.toHaveBeenCalled();
  });

  it("passes a DevError's status through", async () => {
    devenv.start.mockRejectedValue(new devenv.DevError(409, "Already running"));
    const res = await POST(post({ projectName: "alpha", action: "start" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Already running" });
    expect(devenv.getStatus).not.toHaveBeenCalled();
  });

  it("maps other errors to 500", async () => {
    devenv.install.mockRejectedValue(new Error("spawn failed"));
    const res = await POST(post({ projectName: "alpha", action: "install" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "spawn failed" });
  });
});

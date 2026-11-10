import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => ({ projectLogs: vi.fn() }));
vi.mock("@/lib/docker", () => docker);

import { GET } from "./route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-logs-")));
const projects = path.join(root, "projects");
fs.mkdirSync(path.join(projects, "alpha"), { recursive: true });
fs.mkdirSync(path.join(projects, ".hidden"));

const get = (query: string, host = "localhost:3000") =>
  new NextRequest(`http://localhost:3000/api/docker/logs${query}`, { headers: { host } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  docker.projectLogs.mockResolvedValue({ lines: [{ container: "web", text: "listening" }] });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/docker/logs", () => {
  it("returns the project's logs", async () => {
    const res = await GET(get("?project=alpha"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: [{ container: "web", text: "listening" }] });
    expect(docker.projectLogs).toHaveBeenCalledWith("alpha", null);
  });

  it("passes since through", async () => {
    await GET(get("?project=alpha&since=2026-01-02T03:04:05Z"));
    expect(docker.projectLogs).toHaveBeenCalledWith("alpha", "2026-01-02T03:04:05Z");
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get("?project=alpha", "evil.example"));
    expect(res.status).toBe(403);
    expect(docker.projectLogs).not.toHaveBeenCalled();
  });

  it.each(["", "?project=", "?project=missing", "?project=../x", "?project=.hidden", "?project=__proto__"])(
    "404s for %j",
    async (query) => {
      const res = await GET(get(query));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Project not found" });
      expect(docker.projectLogs).not.toHaveBeenCalled();
    }
  );
});

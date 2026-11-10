import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const devenv = vi.hoisted(() => ({ runningProjects: vi.fn() }));
vi.mock("@/lib/devenv", () => devenv);

import { GET } from "./route";

const get = (host = "localhost:3000") =>
  new NextRequest("http://localhost:3000/api/dev/running", { headers: { host } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

describe("GET /api/dev/running", () => {
  it("lists running projects and the ports of those that publish any", async () => {
    const problems = [{ project: "beta", container: "db", reason: "unhealthy" }];
    devenv.runningProjects.mockResolvedValue({
      projects: [
        { name: "alpha", ports: [3000, 5432] },
        { name: "beta", ports: [] },
      ],
      problems,
      docker: "running",
    });
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      running: ["alpha", "beta"],
      ports: { alpha: [3000, 5432] },
      problems,
      docker: "running",
    });
  });

  it("returns empty lists when nothing runs", async () => {
    devenv.runningProjects.mockResolvedValue({ projects: [], problems: [], docker: "stopped" });
    expect(await (await GET(get())).json()).toEqual({ running: [], ports: {}, problems: [], docker: "stopped" });
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get("evil.example"));
    expect(res.status).toBe(403);
    expect(devenv.runningProjects).not.toHaveBeenCalled();
  });
});

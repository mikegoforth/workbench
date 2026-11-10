import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// gh is mocked: no network. The guard and project-name checks are real.
const github = vi.hoisted(() => {
  class GitHubError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { GitHubError, githubStatus: vi.fn() };
});
vi.mock("@/lib/github", () => github);

import { GET } from "./route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-github-")));
const projects = path.join(root, "projects");
fs.mkdirSync(path.join(projects, "alpha"), { recursive: true });
fs.mkdirSync(path.join(projects, ".hidden"));
const alpha = path.join(projects, "alpha");

const get = (query: string, host = "localhost:3000") =>
  new NextRequest(`http://localhost:3000/api/github${query}`, { headers: { host } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/github", () => {
  it("returns the repo's GitHub status, cached by default", async () => {
    const status = { pulls: [], issues: 3, ci: "passing" };
    github.githubStatus.mockResolvedValue(status);
    const res = await GET(get("?project=alpha"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
    expect(github.githubStatus).toHaveBeenCalledWith(alpha, { fresh: false });
  });

  it("asks for fresh data with fresh=1", async () => {
    github.githubStatus.mockResolvedValue({});
    await GET(get("?project=alpha&fresh=1"));
    expect(github.githubStatus).toHaveBeenCalledWith(alpha, { fresh: true });
  });

  it("refuses a non-localhost Host", async () => {
    expect((await GET(get("?project=alpha", "evil.example"))).status).toBe(403);
    expect(github.githubStatus).not.toHaveBeenCalled();
  });

  it.each(["", "?project=missing", "?project=../x", "?project=.hidden", "?project=__proto__"])(
    "404s for %j",
    async (query) => {
      const res = await GET(get(query));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Project not found" });
      expect(github.githubStatus).not.toHaveBeenCalled();
    }
  );

  it("passes a GitHubError's status through", async () => {
    github.githubStatus.mockRejectedValue(new github.GitHubError(401, "Run gh auth login"));
    const res = await GET(get("?project=alpha"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Run gh auth login" });
  });

  it("maps other errors to 500", async () => {
    github.githubStatus.mockRejectedValue(new Error("boom"));
    const res = await GET(get("?project=alpha"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});

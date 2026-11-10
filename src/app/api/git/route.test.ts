import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// git and the project scan are mocked: no git commands run. The guard,
// project-name and .git checks are real, against a temporary projects folder.
const gitinfo = vi.hoisted(() => {
  class GitError extends Error {}
  return { GitError, fetchRemotes: vi.fn(), gitHistory: vi.fn(), pullFastForward: vi.fn() };
});
const scan = vi.hoisted(() => ({ scanProject: vi.fn() }));
vi.mock("@/lib/gitinfo", () => gitinfo);
vi.mock("@/lib/scan", () => scan);

import { GET, POST } from "./route";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-git-")));
const projects = path.join(root, "projects");
fs.mkdirSync(path.join(projects, "repo", ".git"), { recursive: true });
fs.mkdirSync(path.join(projects, "plain"));
fs.mkdirSync(path.join(projects, ".hidden", ".git"), { recursive: true });
const repo = path.join(projects, "repo");

const get = (query: string, host = "localhost:3000") =>
  new NextRequest(`http://localhost:3000/api/git${query}`, { headers: { host } });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/git", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  scan.scanProject.mockResolvedValue({ name: "repo", branch: "main", behind: 0 });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/git", () => {
  it("returns the repo's history", async () => {
    const history = { commits: [{ hash: "abc123", message: "init" }], branches: ["main"], stashes: [] };
    gitinfo.gitHistory.mockResolvedValue(history);
    const res = await GET(get("?project=repo"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(history);
    expect(gitinfo.gitHistory).toHaveBeenCalledWith(repo);
  });

  it("refuses a non-localhost Host", async () => {
    expect((await GET(get("?project=repo", "evil.example"))).status).toBe(403);
    expect(gitinfo.gitHistory).not.toHaveBeenCalled();
  });

  it.each(["", "?project=plain", "?project=missing", "?project=../x", "?project=.hidden", "?project=__proto__"])(
    "404s for %j",
    async (query) => {
      const res = await GET(get(query));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not a git repository" });
      expect(gitinfo.gitHistory).not.toHaveBeenCalled();
    }
  );

  it("maps a failure to 500", async () => {
    gitinfo.gitHistory.mockRejectedValue(new Error("bad object HEAD"));
    const res = await GET(get("?project=repo"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "bad object HEAD" });
  });
});

describe("POST /api/git", () => {
  it("fetches and returns the output and the rescanned project", async () => {
    gitinfo.fetchRemotes.mockResolvedValue("From github.com:me/repo");
    const res = await POST(post({ projectName: "repo", action: "fetch" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      output: "From github.com:me/repo",
      project: { name: "repo", branch: "main", behind: 0 },
    });
    expect(gitinfo.fetchRemotes).toHaveBeenCalledWith(repo);
    expect(gitinfo.pullFastForward).not.toHaveBeenCalled();
    expect(scan.scanProject).toHaveBeenCalledWith("repo");
  });

  it("pulls (fast-forward only)", async () => {
    gitinfo.pullFastForward.mockResolvedValue("Fast-forward");
    const res = await POST(post({ projectName: "repo", action: "pull" }));
    expect(res.status).toBe(200);
    expect((await res.json()).output).toBe("Fast-forward");
    expect(gitinfo.pullFastForward).toHaveBeenCalledWith(repo);
    expect(gitinfo.fetchRemotes).not.toHaveBeenCalled();
  });

  it("refuses a non-localhost Host", async () => {
    const res = await POST(post({ projectName: "repo", action: "pull" }, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(gitinfo.pullFastForward).not.toHaveBeenCalled();
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await POST(post({ projectName: "repo", action: "pull" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(gitinfo.pullFastForward).not.toHaveBeenCalled();
  });

  it("400s on an invalid JSON body", async () => {
    const res = await POST(post("{oops"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([{ projectName: "repo" }, { projectName: "repo", action: "push" }, null])(
    "400s on a bad action: %j",
    async (body) => {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'action must be "fetch" or "pull"' });
    }
  );

  it.each([undefined, 1, "plain", "missing", "../x", ".hidden", "__proto__"])("404s for project %j", async (projectName) => {
    const res = await POST(post({ projectName, action: "fetch" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not a git repository" });
    expect(gitinfo.fetchRemotes).not.toHaveBeenCalled();
  });

  it("maps a GitError to 409", async () => {
    gitinfo.pullFastForward.mockRejectedValue(new gitinfo.GitError("Can't fast-forward: branches have diverged"));
    const res = await POST(post({ projectName: "repo", action: "pull" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Can't fast-forward: branches have diverged" });
    expect(scan.scanProject).not.toHaveBeenCalled();
  });

  it("maps other errors to 500", async () => {
    gitinfo.fetchRemotes.mockRejectedValue(new Error("network down"));
    const res = await POST(post({ projectName: "repo", action: "fetch" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "network down" });
  });
});

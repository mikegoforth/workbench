import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupCheck } from "./types";

// buildOverview reads remotes from real (local, offline) git repos in a temp
// projects folder. Setup checks come from a mocked devenv, and `gh` is never
// run: execFile is mocked and each test decides what it prints.
const { runGh, setupChecks } = vi.hoisted(() => ({ runGh: vi.fn(), setupChecks: vi.fn() }));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const util = await import("util");
  const execFile = Object.assign(
    () => {
      throw new Error("overview.ts only uses the promise form of execFile");
    },
    { [util.promisify.custom]: (...args: unknown[]) => runGh(...args) }
  );
  return { ...actual, execFile, default: { ...actual, execFile } };
});
vi.mock("./devenv", () => ({ setupChecks }));

import { execFileSync } from "child_process";

let root: string;
let home: string;
let projects: string;

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
  };
}

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
}

/** A project folder that's a git repo with one commit and the given origin. */
function repo(name: string, origin: string | null, branch = "main") {
  const dir = path.join(projects, name);
  fs.mkdirSync(dir);
  git(dir, "init", "-q", "-b", branch);
  git(dir, "commit", "-q", "--allow-empty", "-m", "Initial commit");
  if (origin) git(dir, "remote", "add", "origin", origin);
  return dir;
}

async function load() {
  vi.resetModules();
  return import("./overview");
}

/** The repos a gh call asked about, by index, read back from its -f fields. */
function askedRepos(args: string[]) {
  const fields = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-f") {
      const [key, ...rest] = args[i + 1].split("=");
      fields.set(key, rest.join("="));
    }
  }
  const repos: { owner: string; name: string; ref: string }[] = [];
  for (let i = 0; fields.has(`o${i}`); i++) {
    repos.push({ owner: fields.get(`o${i}`)!, name: fields.get(`n${i}`)!, ref: fields.get(`b${i}`)! });
  }
  return { query: fields.get("query")!, repos };
}

type RepoData = Record<string, unknown> | null;

/** Make gh answer each repo by "owner/name"; repos missing from `byRepo` get null. */
function ghAnswers(byRepo: Record<string, RepoData>, viewer: string | null = "octocat") {
  runGh.mockImplementationOnce(async (_cmd: string, args: string[]) => {
    const data: Record<string, unknown> = viewer ? { viewer: { login: viewer } } : {};
    askedRepos(args).repos.forEach((r, i) => {
      data[`r${i}`] = byRepo[`${r.owner}/${r.name}`] ?? null;
    });
    return { stdout: JSON.stringify({ data }), stderr: "" };
  });
}

function repoData({
  state = "SUCCESS" as string | null,
  url = "https://github.com/acme/x/commit/1",
  total = 0,
  reviewers = [] as (string | null)[][],
  ref = true,
} = {}): RepoData {
  return {
    pullRequests: {
      totalCount: total,
      nodes: reviewers.map((logins) => ({
        reviewRequests: { nodes: logins.map((login) => ({ requestedReviewer: login ? { login } : null })) },
      })),
    },
    ref: ref ? { target: { url, statusCheckRollup: state ? { state } : null } } : null,
  };
}

const check = (id: string, level: SetupCheck["level"], title = id): SetupCheck => ({ id, level, title });

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-overview-")));
  home = path.join(root, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(
    path.join(home, ".gitconfig"),
    "[user]\n  name = Test Author\n  email = test@example.com\n[commit]\n  gpgsign = false\n"
  );
});

beforeEach((ctx) => {
  projects = path.join(root, ctx.task.id, "projects");
  fs.mkdirSync(projects, { recursive: true });
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, ctx.task.id, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  }
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));
  runGh.mockReset();
  runGh.mockRejectedValue(new Error("unexpected gh call"));
  setupChecks.mockReset();
  setupChecks.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("buildOverview", () => {
  it("combines setup warnings and GitHub state for every project", async () => {
    const api = repo("api", "https://github.com/acme/api.git");
    repo("web", "git@github.com:acme/web.git", "feature/login");
    repo("lab", "git@gitlab.com:acme/lab.git");
    fs.mkdirSync(path.join(projects, "plain"));
    fs.mkdirSync(path.join(projects, ".hidden"));
    fs.writeFileSync(path.join(projects, "notes.txt"), "");

    setupChecks.mockImplementation(async (dir: string) =>
      dir === api
        ? [check("deps", "warn", "Install dependencies"), check("node", "ok"), check("tip", "info"), check("env", "warn", "Missing .env")]
        : []
    );
    ghAnswers({
      "acme/api": repoData({
        state: "FAILURE",
        url: "https://github.com/acme/api/commit/abc",
        total: 3,
        reviewers: [["octocat"], ["someone", null], [null, "octocat"]],
      }),
      "acme/web": repoData({ state: null, total: 0 }),
    });

    const { buildOverview } = await load();
    const overview = await buildOverview();

    expect(overview.githubError).toBeNull();
    expect(Number.isNaN(Date.parse(overview.generatedAt))).toBe(false);
    expect(Object.keys(overview.entries).sort()).toEqual(["api", "lab", "plain", "web"]);
    expect(overview.entries.api).toEqual({
      warnings: [
        { id: "deps", title: "Install dependencies" },
        { id: "env", title: "Missing .env" },
      ],
      github: { ci: "FAILURE", ciUrl: "https://github.com/acme/api/commit/abc", openPullRequests: 3, reviewRequested: 2 },
    });
    expect(overview.entries.web).toEqual({
      warnings: [],
      github: { ci: null, ciUrl: "https://github.com/acme/x/commit/1", openPullRequests: 0, reviewRequested: 0 },
    });
    expect(overview.entries.lab).toEqual({ warnings: [], github: null });
    expect(overview.entries.plain).toEqual({ warnings: [], github: null });
    expect(setupChecks).toHaveBeenCalledTimes(4);

    // One gh call for both GitHub repos, values as -f fields.
    expect(runGh).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = runGh.mock.calls[0];
    expect(cmd).toBe("gh");
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(options).toEqual({ timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
    const { query, repos } = askedRepos(args);
    expect(repos).toHaveLength(2);
    expect(repos).toEqual(
      expect.arrayContaining([
        { owner: "acme", name: "api", ref: "refs/heads/main" },
        { owner: "acme", name: "web", ref: "refs/heads/feature/login" },
      ])
    );
    expect(query).toContain("$o0: String!, $n0: String!, $b0: String!, $o1: String!");
    expect(query).toContain("r1: repository(owner: $o1, name: $n1)");
    expect(query).not.toContain("acme");
  });

  it("leaves out projects whose remote can't be a GitHub repo", async () => {
    repo("no-remote", null);
    repo("owner-only", "https://github.com/acme");
    repo("local-remote", "/srv/git/thing.git");
    const broken = path.join(projects, "broken");
    fs.mkdirSync(broken);
    fs.writeFileSync(path.join(broken, ".git"), "not a gitfile");

    const { buildOverview } = await load();
    const overview = await buildOverview();
    expect(runGh).not.toHaveBeenCalled();
    expect(overview.githubError).toBeNull();
    expect(overview.entries).toEqual({
      "no-remote": { warnings: [], github: null },
      "owner-only": { warnings: [], github: null },
      "local-remote": { warnings: [], github: null },
      broken: { warnings: [], github: null },
    });
  });

  it("asks about HEAD when a repo has no commit yet", async () => {
    const dir = path.join(projects, "unborn");
    fs.mkdirSync(dir);
    git(dir, "init", "-q");
    git(dir, "remote", "add", "origin", "https://github.com/acme/unborn");
    ghAnswers({ "acme/unborn": repoData({ ref: false }) });

    const { buildOverview } = await load();
    const overview = await buildOverview();
    expect(askedRepos(runGh.mock.calls[0][1]).repos).toEqual([
      { owner: "acme", name: "unborn", ref: "refs/heads/HEAD" },
    ]);
    expect(overview.entries.unborn.github).toEqual({ ci: null, ciUrl: null, openPullRequests: 0, reviewRequested: 0 });
  });

  it("treats a failed setup check as no warnings", async () => {
    fs.mkdirSync(path.join(projects, "odd"));
    setupChecks.mockRejectedValue(new Error("bad package.json"));
    const { buildOverview } = await load();
    expect((await buildOverview()).entries.odd).toEqual({ warnings: [], github: null });
  });

  it("leaves out workbench's own folder", async () => {
    const self = path.join(projects, "workbench");
    fs.mkdirSync(self);
    fs.mkdirSync(path.join(projects, "other"));
    vi.spyOn(process, "cwd").mockReturnValue(self);
    const { buildOverview } = await load();
    expect(Object.keys((await buildOverview()).entries)).toEqual(["other"]);
    expect(setupChecks).toHaveBeenCalledWith(path.join(projects, "other"));
    expect(setupChecks).not.toHaveBeenCalledWith(self);
  });

  it("gives null for a repo GitHub returned nothing for", async () => {
    repo("seen", "https://github.com/acme/seen");
    repo("unseen", "https://github.com/acme/unseen");
    ghAnswers({ "acme/seen": repoData({ total: 1 }) });
    const { buildOverview } = await load();
    const { entries, githubError } = await buildOverview();
    expect(entries.seen.github).toMatchObject({ openPullRequests: 1, ci: "SUCCESS" });
    expect(entries.unseen.github).toBeNull();
    expect(githubError).toBeNull();
  });

  it("counts no review requests when the viewer is unknown", async () => {
    repo("api", "https://github.com/acme/api");
    ghAnswers({ "acme/api": repoData({ total: 2, reviewers: [["octocat"], ["octocat"]] }) }, null);
    const { buildOverview } = await load();
    expect((await buildOverview()).entries.api.github).toMatchObject({ openPullRequests: 2, reviewRequested: 0 });
  });

  it("handles a response with no data", async () => {
    repo("api", "https://github.com/acme/api");
    runGh.mockResolvedValueOnce({ stdout: JSON.stringify({ errors: [{ message: "boom" }] }), stderr: "" });
    const { buildOverview } = await load();
    const overview = await buildOverview();
    expect(overview.entries.api.github).toBeNull();
    expect(overview.githubError).toBeNull();
  });

  it("says when GitHub's response can't be read", async () => {
    repo("api", "https://github.com/acme/api");
    runGh.mockResolvedValueOnce({ stdout: "<html>Unicorn!</html>", stderr: "" });
    const { buildOverview } = await load();
    const overview = await buildOverview();
    expect(overview.githubError).toBe("Couldn't read GitHub's response");
    expect(overview.entries.api.github).toBeNull();
  });
});

describe("gh failures", () => {
  const fail = (fields: Record<string, unknown>) =>
    runGh.mockRejectedValueOnce(Object.assign(new Error("Command failed: gh api graphql"), fields));

  it.each([
    ["gh isn't installed", { code: "ENOENT" }, "GitHub CLI (gh) isn't installed"],
    [
      "gh isn't logged in",
      { code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login\n" },
      "Run `gh auth login` to see CI and reviews",
    ],
    [
      "gh reports not logged in",
      { code: 1, stderr: "You are not logged into any GitHub hosts." },
      "Run `gh auth login` to see CI and reviews",
    ],
    [
      "GitHub rate-limits",
      { code: 1, stdout: "", stderr: "first line\ngh: API rate limit exceeded for user ID 1234.\n" },
      "API rate limit exceeded for user ID 1234.",
    ],
    ["gh fails with empty stderr", { code: 1, stderr: "  " }, "Command failed: gh api graphql"],
    ["gh fails with no output at all", { code: 1 }, "Command failed: gh api graphql"],
  ])("explains when %s", async (_label, fields, message) => {
    repo("api", "https://github.com/acme/api");
    fail(fields);
    const { buildOverview } = await load();
    const overview = await buildOverview();
    expect(overview.githubError).toBe(message);
    expect(overview.entries.api).toEqual({ warnings: [], github: null });
  });

  it("uses the data gh printed even when it exits non-zero", async () => {
    repo("api", "https://github.com/acme/api");
    repo("gone", "https://github.com/acme/gone");
    runGh.mockImplementationOnce(async (_cmd: string, args: string[]) => {
      const data: Record<string, unknown> = { viewer: { login: "octocat" } };
      askedRepos(args).repos.forEach((r, i) => {
        data[`r${i}`] = r.name === "api" ? repoData({ total: 5 }) : null;
      });
      throw Object.assign(new Error("Command failed"), {
        code: 1,
        stdout: JSON.stringify({ data }),
        stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/gone'. (r1)",
      });
    });
    const { buildOverview } = await load();
    const overview = await buildOverview();
    expect(overview.githubError).toBeNull();
    expect(overview.entries.api.github).toMatchObject({ openPullRequests: 5 });
    expect(overview.entries.gone.github).toBeNull();
  });

  it("keeps the first error when the output also can't be read", async () => {
    repo("api", "https://github.com/acme/api");
    fail({ code: 4, stdout: "not json", stderr: "gh auth login required" });
    const { buildOverview } = await load();
    expect((await buildOverview()).githubError).toBe("Run `gh auth login` to see CI and reviews");
  });
});

describe("GitHub cache", () => {
  it("reuses the batch for a minute while the repo set is the same", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
    repo("api", "https://github.com/acme/api");
    ghAnswers({ "acme/api": repoData({ total: 1 }) });
    ghAnswers({ "acme/api": repoData({ total: 2 }) });
    const { buildOverview } = await load();

    expect((await buildOverview()).entries.api.github?.openPullRequests).toBe(1);
    vi.setSystemTime(new Date("2024-06-01T12:00:59Z"));
    expect((await buildOverview()).entries.api.github?.openPullRequests).toBe(1);
    expect(runGh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2024-06-01T12:01:00Z"));
    expect((await buildOverview()).entries.api.github?.openPullRequests).toBe(2);
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  it("asks again when fresh is set", async () => {
    repo("api", "https://github.com/acme/api");
    ghAnswers({ "acme/api": repoData({ total: 1 }) });
    ghAnswers({ "acme/api": repoData({ total: 4 }) });
    const { buildOverview } = await load();
    await buildOverview();
    expect((await buildOverview({ fresh: true })).entries.api.github?.openPullRequests).toBe(4);
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  it("asks again when the set of repos or branches changes", async () => {
    const api = repo("api", "https://github.com/acme/api");
    ghAnswers({ "acme/api": repoData({ total: 1 }) });
    ghAnswers({ "acme/api": repoData({ total: 2 }) });
    ghAnswers({ "acme/api": repoData({ total: 3 }), "acme/web": repoData({ total: 9 }) });
    const { buildOverview } = await load();
    await buildOverview();

    git(api, "checkout", "-q", "-b", "next");
    expect((await buildOverview()).entries.api.github?.openPullRequests).toBe(2);

    repo("web", "https://github.com/acme/web");
    const overview = await buildOverview();
    expect(overview.entries.web.github?.openPullRequests).toBe(9);
    expect(runGh).toHaveBeenCalledTimes(3);
  });

  it("caches an error too, until fresh is set", async () => {
    repo("api", "https://github.com/acme/api");
    runGh.mockRejectedValueOnce(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));
    ghAnswers({ "acme/api": repoData() });
    const { buildOverview } = await load();
    expect((await buildOverview()).githubError).toBe("GitHub CLI (gh) isn't installed");
    expect((await buildOverview()).githubError).toBe("GitHub CLI (gh) isn't installed");
    expect(runGh).toHaveBeenCalledTimes(1);
    expect((await buildOverview({ fresh: true })).githubError).toBeNull();
  });
});

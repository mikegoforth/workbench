import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// githubStatus reads the remote and branch from a real (local, offline) git
// repo, then asks `gh` for the rest. `gh` is never run: execFile is mocked and
// each test decides what it prints.
const { runGh } = vi.hoisted(() => ({ runGh: vi.fn() }));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const util = await import("util");
  const execFile = Object.assign(
    () => {
      throw new Error("github.ts only uses the promise form of execFile");
    },
    { [util.promisify.custom]: (...args: unknown[]) => runGh(...args) }
  );
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import { execFileSync } from "child_process";

let root: string;
let home: string;

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

/** A local repo with the given remotes; one commit unless `empty`. */
function repo(name: string, remotes: Record<string, string>, { branch = "main", empty = false } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  git(dir, "init", "-q", "-b", branch);
  if (!empty) git(dir, "commit", "-q", "--allow-empty", "-m", "Initial commit");
  for (const [remote, url] of Object.entries(remotes)) git(dir, "remote", "add", remote, url);
  return dir;
}

async function load() {
  vi.resetModules();
  return import("./github");
}

/** What `gh api graphql` prints, with overrides for the repository part. */
function response(repository: Record<string, unknown> = {}, viewer = "octocat") {
  return JSON.stringify({
    data: {
      viewer: { login: viewer },
      repository: {
        issues: { totalCount: 4 },
        pullRequests: { totalCount: 0, nodes: [] },
        ref: null,
        ...repository,
      },
    },
  });
}

const ghOk = (stdout: string) => runGh.mockResolvedValueOnce({ stdout, stderr: "" });
const ghFails = (fields: Record<string, unknown>, message = "Command failed: gh api graphql") =>
  runGh.mockRejectedValueOnce(Object.assign(new Error(message), fields));

let widgets: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-github-")));
  home = path.join(root, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(
    path.join(home, ".gitconfig"),
    "[user]\n  name = Test Author\n  email = test@example.com\n[commit]\n  gpgsign = false\n"
  );
  widgets = repo("widgets", { origin: "git@github.com:acme/widgets.git" });
});

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  }
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));
  runGh.mockReset();
  runGh.mockRejectedValue(new Error("unexpected gh call"));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("which repo it asks about", () => {
  it("sends owner, name and branch as separate fields", async () => {
    ghOk(response());
    const { githubStatus } = await load();
    await githubStatus(widgets);

    expect(runGh).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = runGh.mock.calls[0];
    expect(cmd).toBe("gh");
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(args.slice(4)).toEqual(["-f", "owner=acme", "-f", "name=widgets", "-f", "ref=refs/heads/main"]);
    expect(args[2]).toBe("-f");
    expect(args[3]).toMatch(/^query=\s*query\(\$owner: String!, \$name: String!, \$ref: String!\)/);
    expect(options).toEqual({ timeout: 20_000, maxBuffer: 5 * 1024 * 1024 });
  });

  it("uses the checked-out branch name", async () => {
    const dir = repo("on-feature", { origin: "https://github.com/acme/feature.git" }, { branch: "feat/x;$(id)" });
    ghOk(response());
    const { githubStatus } = await load();
    const status = await githubStatus(dir);
    expect(runGh.mock.calls[0][1]).toContain("ref=refs/heads/feat/x;$(id)");
    expect(status.branch).toBe("feat/x;$(id)");
  });

  it("falls back to HEAD when there's no commit to name a branch", async () => {
    const dir = repo("unborn", { origin: "https://github.com/acme/unborn" }, { empty: true });
    ghOk(response());
    const { githubStatus } = await load();
    const status = await githubStatus(dir);
    expect(runGh.mock.calls[0][1]).toContain("ref=refs/heads/HEAD");
    expect(status.branch).toBe("HEAD");
  });

  it("prefers origin, else the first remote", async () => {
    const both = repo("both", {
      aaa: "https://github.com/someone/fork.git",
      origin: "https://github.com/acme/real.git",
    });
    const onlyOther = repo("only-other", { upstream: "ssh://git@github.com/acme/upstream.git" });
    ghOk(response());
    ghOk(response());
    const { githubStatus } = await load();
    expect((await githubStatus(both)).repo).toBe("acme/real");
    expect((await githubStatus(onlyOther)).repo).toBe("acme/upstream");
  });

  it.each([
    ["no remote", {}],
    ["a GitLab remote", { origin: "git@gitlab.com:acme/widgets.git" }],
    ["a local-path remote", { origin: "/srv/git/widgets.git" }],
    ["a GitHub URL without a repo name", { origin: "https://github.com/acme" }],
  ])("refuses %s with a 404 and never runs gh", async (label, remotes) => {
    const dir = repo(`refuse-${label.replace(/\W+/g, "-")}`, remotes);
    const { githubStatus, GitHubError } = await load();
    const error = await githubStatus(dir).catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("This project's remote isn't on github.com");
    expect(runGh).not.toHaveBeenCalled();
  });
});

describe("what it reports", () => {
  it("maps pull requests, issues and the viewer", async () => {
    ghOk(
      response({
        issues: { totalCount: 7 },
        pullRequests: {
          totalCount: 12,
          nodes: [
            {
              number: 42,
              title: "Add widgets",
              url: "https://github.com/acme/widgets/pull/42",
              isDraft: false,
              updatedAt: "2024-05-01T10:00:00Z",
              headRefName: "add-widgets",
              reviewDecision: "REVIEW_REQUIRED",
              author: { login: "alice" },
              reviewRequests: {
                nodes: [{ requestedReviewer: null }, { requestedReviewer: { login: "octocat" } }],
              },
              commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
            },
            {
              number: 41,
              title: "Draft by a deleted user",
              url: "https://github.com/acme/widgets/pull/41",
              isDraft: true,
              updatedAt: "2024-04-01T10:00:00Z",
              headRefName: "wip",
              reviewDecision: null,
              author: null,
              // A team review request has no login.
              reviewRequests: { nodes: [{ requestedReviewer: {} }, { requestedReviewer: { login: "bob" } }] },
              commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
            },
            {
              number: 40,
              title: "No commits visible",
              url: "https://github.com/acme/widgets/pull/40",
              isDraft: false,
              updatedAt: "2024-03-01T10:00:00Z",
              headRefName: "empty",
              author: { login: "carol" },
              reviewRequests: { nodes: [] },
              commits: { nodes: [] },
            },
          ],
        },
      })
    );
    const { githubStatus } = await load();
    const status = await githubStatus(widgets);

    expect(status).toEqual({
      repo: "acme/widgets",
      viewer: "octocat",
      openIssues: 7,
      openPullRequests: 12,
      pullRequests: [
        {
          number: 42,
          title: "Add widgets",
          url: "https://github.com/acme/widgets/pull/42",
          draft: false,
          updatedAt: "2024-05-01T10:00:00Z",
          branch: "add-widgets",
          reviewDecision: "REVIEW_REQUIRED",
          author: "alice",
          reviewRequestedFromYou: true,
          checks: "FAILURE",
        },
        {
          number: 41,
          title: "Draft by a deleted user",
          url: "https://github.com/acme/widgets/pull/41",
          draft: true,
          updatedAt: "2024-04-01T10:00:00Z",
          branch: "wip",
          reviewDecision: null,
          author: null,
          reviewRequestedFromYou: false,
          checks: null,
        },
        {
          number: 40,
          title: "No commits visible",
          url: "https://github.com/acme/widgets/pull/40",
          draft: false,
          updatedAt: "2024-03-01T10:00:00Z",
          branch: "empty",
          reviewDecision: null,
          author: "carol",
          reviewRequestedFromYou: false,
          checks: null,
        },
      ],
      ci: null,
      branch: "main",
      fetchedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(status.fetchedAt))).toBe(false);
  });

  it("sorts CI checks into failing and pending", async () => {
    const nodes = [
      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "u1" },
      { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "u2" },
      { __typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: null, detailsUrl: null },
      { __typename: "CheckRun", name: "queued", status: "QUEUED", conclusion: null, detailsUrl: null },
      { __typename: "CheckRun", name: "slow", status: "COMPLETED", conclusion: "TIMED_OUT", detailsUrl: null },
      { __typename: "CheckRun", name: "skip", status: "COMPLETED", conclusion: "SKIPPED", detailsUrl: "u3" },
      { __typename: "CheckRun", name: "odd", status: "COMPLETED", conclusion: null, detailsUrl: null },
      { __typename: "CheckRun", name: "stop", status: "COMPLETED", conclusion: "CANCELLED", detailsUrl: "u4" },
      { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", targetUrl: "s1" },
      { __typename: "StatusContext", context: "ci/pending", state: "PENDING", targetUrl: null },
      { __typename: "StatusContext", context: "ci/expected", state: "EXPECTED", targetUrl: null },
      { __typename: "StatusContext", context: "ci/fail", state: "FAILURE", targetUrl: "s2" },
      { __typename: "StatusContext", context: "ci/error", state: "ERROR", targetUrl: null },
      { __typename: "SomethingNew" },
    ];
    ghOk(
      response({
        ref: {
          target: {
            oid: "abc123",
            url: "https://github.com/acme/widgets/commit/abc123",
            statusCheckRollup: { state: "FAILURE", contexts: { nodes } },
          },
        },
      })
    );
    const { githubStatus } = await load();
    const { ci } = await githubStatus(widgets);

    expect(ci).toEqual({
      branch: "main",
      sha: "abc123",
      url: "https://github.com/acme/widgets/commit/abc123",
      state: "FAILURE",
      failing: [
        { name: "test", url: "u2" },
        { name: "slow", url: null },
        { name: "stop", url: "u4" },
        { name: "ci/fail", url: "s2" },
        { name: "ci/error", url: null },
      ],
      pending: 4,
      total: nodes.length,
    });
  });

  it("reports a pushed commit with no checks", async () => {
    ghOk(response({ ref: { target: { oid: "def456", url: "https://x/commit/def456", statusCheckRollup: null } } }));
    const { githubStatus } = await load();
    expect((await githubStatus(widgets)).ci).toEqual({
      branch: "main",
      sha: "def456",
      url: "https://x/commit/def456",
      state: null,
      failing: [],
      pending: 0,
      total: 0,
    });
  });

  it("has no CI when the ref points at something other than a commit", async () => {
    // e.g. the branch isn't on GitHub: GraphQL returns an empty target.
    ghOk(response({ ref: { target: {} } }));
    const { githubStatus } = await load();
    expect((await githubStatus(widgets)).ci).toBeNull();
  });
});

describe("gh failures", () => {
  it.each([
    ["gh isn't installed", { code: "ENOENT" }, "GitHub CLI (gh) isn't installed"],
    ["gh times out", { killed: true, signal: "SIGTERM" }, "GitHub didn't respond in time"],
    [
      "gh isn't logged in",
      { code: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login\n" },
      "Run `gh auth login` to see GitHub status",
    ],
    [
      "the token is bad",
      { code: 1, stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login\n" },
      "Run `gh auth login` to see GitHub status",
    ],
    [
      "the login can't see the repo",
      { code: 1, stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/widgets'. (repository)\n" },
      "Your gh login can't see this repo",
    ],
    [
      "GitHub rate-limits",
      { code: 1, stderr: "something first\ngh: API rate limit exceeded for user ID 1234.\n" },
      "API rate limit exceeded for user ID 1234.",
    ],
    ["gh fails silently", { code: 1, stderr: "" }, "Command failed: gh api graphql"],
    ["gh fails with no stderr at all", { code: 1 }, "Command failed: gh api graphql"],
  ])("explains when %s (502)", async (_label, fields, message) => {
    ghFails(fields);
    const { githubStatus, GitHubError } = await load();
    const error = await githubStatus(widgets).catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.status).toBe(502);
    expect(error.message).toBe(message);
  });

  it("doesn't cache a failure", async () => {
    ghFails({ code: "ENOENT" });
    ghOk(response());
    const { githubStatus } = await load();
    await expect(githubStatus(widgets)).rejects.toThrow("isn't installed");
    await expect(githubStatus(widgets)).resolves.toMatchObject({ repo: "acme/widgets" });
    expect(runGh).toHaveBeenCalledTimes(2);
  });
});

describe("caching", () => {
  it("reuses a result for a minute per repo and branch", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
    ghOk(response({ issues: { totalCount: 1 } }));
    ghOk(response({ issues: { totalCount: 2 } }));
    const { githubStatus } = await load();

    const first = await githubStatus(widgets);
    expect(first.openIssues).toBe(1);
    expect(first.fetchedAt).toBe("2024-06-01T12:00:00.000Z");

    vi.setSystemTime(new Date("2024-06-01T12:00:59Z"));
    expect(await githubStatus(widgets)).toBe(first);
    expect(runGh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2024-06-01T12:01:00Z"));
    const second = await githubStatus(widgets);
    expect(second.openIssues).toBe(2);
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  it("asks again when fresh is set", async () => {
    ghOk(response({ issues: { totalCount: 1 } }));
    ghOk(response({ issues: { totalCount: 3 } }));
    const { githubStatus } = await load();
    expect((await githubStatus(widgets)).openIssues).toBe(1);
    expect((await githubStatus(widgets, { fresh: true })).openIssues).toBe(3);
    // The fresh result replaces the cached one.
    expect((await githubStatus(widgets)).openIssues).toBe(3);
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  it("keeps separate entries for separate branches", async () => {
    const dir = repo("branches", { origin: "https://github.com/acme/branches.git" });
    ghOk(response());
    ghOk(response());
    const { githubStatus } = await load();
    await githubStatus(dir);
    git(dir, "checkout", "-q", "-b", "other");
    expect((await githubStatus(dir)).branch).toBe("other");
    expect(runGh).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `gh` is never run: execFile is mocked and each test decides what it prints.
// The payloads below follow what `gh api graphql` really returns for the query.
const { runGh } = vi.hoisted(() => ({ runGh: vi.fn() }));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const util = await import("util");
  const execFile = Object.assign(
    () => {
      throw new Error("pullRequests.ts only uses the promise form of execFile");
    },
    { [util.promisify.custom]: (...args: unknown[]) => runGh(...args) }
  );
  return { ...actual, execFile, default: { ...actual, execFile } };
});

async function load() {
  vi.resetModules();
  return import("./pullRequests");
}

function node(repo: string, number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    isDraft: false,
    updatedAt: "2026-11-08T10:00:00Z",
    reviewDecision: "REVIEW_REQUIRED",
    author: { login: "hubot" },
    repository: { nameWithOwner: repo, url: `https://github.com/${repo}` },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
    ...overrides,
  };
}

const search = (nodes: unknown[], issueCount = nodes.length) => ({ issueCount, nodes });

function response(parts: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    data: {
      viewer: { login: "octocat" },
      review: search([]),
      authored: search([]),
      assigned: search([]),
      ...parts,
    },
    ...extra,
  });
}

const ghOk = (stdout: string) => runGh.mockResolvedValueOnce({ stdout, stderr: "" });
const ghFails = (fields: Record<string, unknown>, message = "Command failed: gh api graphql") =>
  runGh.mockRejectedValueOnce(Object.assign(new Error(message), fields));

beforeEach(() => {
  runGh.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pullRequests", () => {
  it("runs one fixed GraphQL query through gh, with nothing else on the command line", async () => {
    const { pullRequests, QUERY } = await load();
    ghOk(response());
    await pullRequests();
    expect(runGh).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = runGh.mock.calls[0];
    expect(cmd).toBe("gh");
    expect(args).toEqual(["api", "graphql", "-f", `query=${QUERY}`]);
    expect(opts).toMatchObject({ windowsHide: true, timeout: 30_000 });
    expect(QUERY).toContain('review: search(type: ISSUE, first: 50, query: "is:open is:pr review-requested:@me archived:false sort:updated-desc")');
    expect(QUERY).toContain('authored: search(type: ISSUE, first: 50, query: "is:open is:pr author:@me archived:false sort:updated-desc")');
    expect(QUERY).toContain('assigned: search(type: ISSUE, first: 50, query: "is:open is:pr assignee:@me archived:false sort:updated-desc")');
    expect(QUERY).toContain("statusCheckRollup { state }");
  });

  it("maps each search to rows", async () => {
    const { pullRequests } = await load();
    ghOk(
      response({
        review: search([
          node("acme/api", 12, { isDraft: true, author: null, reviewDecision: null, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }),
        ]),
        authored: search([
          node("octocat/site", 3, { reviewDecision: "APPROVED", commits: { nodes: [] } }),
          node("octocat/cli", 9, { reviewDecision: "CHANGES_REQUESTED", commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }),
        ]),
      })
    );
    const prs = await pullRequests();
    expect(prs.viewer).toBe("octocat");
    expect(prs.warning).toBeNull();
    expect(Date.parse(prs.fetchedAt)).not.toBeNaN();
    expect(prs.review).toEqual({
      total: 1,
      truncated: false,
      items: [
        {
          repo: "acme/api",
          repoUrl: "https://github.com/acme/api",
          number: 12,
          title: "Change 12",
          url: "https://github.com/acme/api/pull/12",
          draft: true,
          author: null,
          updatedAt: "2026-11-08T10:00:00Z",
          reviewDecision: null,
          checks: null,
        },
      ],
    });
    expect(prs.authored.items.map((r) => [r.repo, r.number, r.reviewDecision, r.checks, r.author])).toEqual([
      ["octocat/site", 3, "APPROVED", null, "hubot"],
      ["octocat/cli", 9, "CHANGES_REQUESTED", "FAILURE", "hubot"],
    ]);
    expect(prs.assigned).toEqual({ items: [], total: 0, truncated: false });
  });

  it("lists each PR once, in the first section it belongs to", async () => {
    const { pullRequests } = await load();
    const mine = node("octocat/site", 3);
    const theirs = node("acme/api", 12);
    ghOk(
      response({
        review: search([theirs]),
        authored: search([mine]),
        assigned: search([mine, theirs, node("acme/web", 40)]),
      })
    );
    const prs = await pullRequests();
    expect(prs.review.items.map((r) => r.number)).toEqual([12]);
    expect(prs.authored.items.map((r) => r.number)).toEqual([3]);
    expect(prs.assigned.items.map((r) => r.number)).toEqual([40]);
    expect(prs.assigned.total).toBe(3);
  });

  it("says when GitHub has more than one page", async () => {
    const { pullRequests } = await load();
    ghOk(response({ authored: search([node("a/b", 1), node("a/b", 2)], 73) }));
    const prs = await pullRequests();
    expect(prs.authored).toMatchObject({ total: 73, truncated: true });
    expect(prs.authored.items).toHaveLength(2);
  });

  it("skips nodes the login can't read, and a missing search", async () => {
    const { pullRequests } = await load();
    ghOk(JSON.stringify({ data: { viewer: { login: "octocat" }, review: search([null, {}, node("a/b", 5)]), authored: null } }));
    const prs = await pullRequests();
    expect(prs.review.items.map((r) => r.number)).toEqual([5]);
    expect(prs.authored).toEqual({ items: [], total: 0, truncated: false });
    expect(prs.assigned).toEqual({ items: [], total: 0, truncated: false });
  });

  it("shows what it got when part of the result errors, with a warning", async () => {
    const { pullRequests } = await load();
    const stdout = response(
      { review: search([null, node("a/b", 5)], 2) },
      { errors: [{ message: "Resource protected by organization SAML enforcement." }] }
    );
    ghFails({ code: 1, stdout, stderr: "gh: Resource protected by organization SAML enforcement.\n" });
    const prs = await pullRequests();
    expect(prs.review.items.map((r) => r.number)).toEqual([5]);
    expect(prs.warning).toBe("Some pull requests couldn't be read: Resource protected by organization SAML enforcement.");
  });

  it("falls back to gh's stderr for the warning when the body has no errors", async () => {
    const { pullRequests } = await load();
    ghFails({ code: 1, stdout: response(), stderr: "GraphQL: Something partial happened\n" });
    expect((await pullRequests()).warning).toBe("Some pull requests couldn't be read: Something partial happened");
  });

  it("uses partial output without a warning when gh gives no reason", async () => {
    const { pullRequests } = await load();
    ghFails({ code: 1, stdout: response({ authored: search([node("a/b", 1)]) }) });
    const prs = await pullRequests();
    expect(prs.authored.items).toHaveLength(1);
    expect(prs.warning).toBeNull();
  });

  it("warns about errors in a successful response too", async () => {
    const { pullRequests } = await load();
    ghOk(response({}, { errors: [{ message: "Something was hidden" }] }));
    expect((await pullRequests()).warning).toBe("Some pull requests couldn't be read: Something was hidden");
  });
});

describe("gh failures", () => {
  async function failure() {
    const { pullRequests, PullRequestsError } = await load();
    const error = await pullRequests().then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(PullRequestsError);
    const e = error as InstanceType<typeof PullRequestsError>;
    return { status: e.status, reason: e.reason, message: e.message };
  }

  it("says when gh isn't installed", async () => {
    ghFails({ code: "ENOENT" }, "spawn gh ENOENT");
    expect(await failure()).toEqual({ status: 503, reason: "missing", message: "GitHub CLI (gh) isn't installed" });
  });

  it("says when gh isn't signed in", async () => {
    ghFails({
      code: 4,
      stdout: "",
      stderr: "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n",
    });
    expect(await failure()).toEqual({ status: 401, reason: "signed-out", message: "GitHub CLI isn't signed in" });
  });

  it("says when the token is no longer valid", async () => {
    ghFails({ code: 1, stdout: "", stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login\n" });
    expect((await failure()).reason).toBe("signed-out");
  });

  it("says when the rate limit is used up", async () => {
    ghFails({ code: 1, stdout: "", stderr: "GraphQL: API rate limit exceeded for user ID 583231.\n" });
    expect(await failure()).toEqual({ status: 429, reason: "rate-limited", message: "GitHub's API rate limit is used up. Try again in a few minutes." });
  });

  it("says when GitHub is too slow", async () => {
    ghFails({ killed: true, signal: "SIGTERM", stdout: "", stderr: "" });
    expect(await failure()).toEqual({ status: 504, reason: "failed", message: "GitHub didn't respond in time" });
  });

  it("passes on the last line of anything else gh says", async () => {
    ghFails({ code: 1, stdout: "", stderr: "something first\ngh: error connecting to api.github.com\n" });
    expect(await failure()).toEqual({ status: 502, reason: "failed", message: "error connecting to api.github.com" });
  });

  it("falls back to the error message when gh says nothing", async () => {
    ghFails({ code: 1 }, "Command failed: gh api graphql");
    expect(await failure()).toEqual({ status: 502, reason: "failed", message: "Command failed: gh api graphql" });
  });

  it("doesn't use output that has no data in it", async () => {
    ghFails({ code: 1, stdout: '{"errors":[{"message":"Field missing"}]}', stderr: "gh: Field missing\n" });
    expect(await failure()).toEqual({ status: 502, reason: "failed", message: "Field missing" });
  });

  it("explains a response that isn't JSON", async () => {
    ghOk("<html>Unicorn!</html>");
    expect(await failure()).toEqual({ status: 502, reason: "failed", message: "Couldn't read GitHub's response" });
  });

  it("explains JSON without data", async () => {
    ghOk('{"errors":[{"message":"Something went wrong while executing your query."}]}');
    expect(await failure()).toEqual({ status: 502, reason: "failed", message: "Something went wrong while executing your query." });
    ghOk("{}");
    expect(await failure()).toEqual({ status: 502, reason: "failed", message: "Couldn't read GitHub's response" });
  });
});

describe("cache", () => {
  it("reuses a result for a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { pullRequests } = await load();
    ghOk(response({ authored: search([node("a/b", 1)]) }));
    const first = await pullRequests();
    vi.advanceTimersByTime(59_000);
    expect(await pullRequests()).toBe(first);
    expect(runGh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    ghOk(response({ authored: search([node("a/b", 1), node("a/b", 2)]) }));
    expect((await pullRequests()).authored.items).toHaveLength(2);
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  it("asks again when fresh is set", async () => {
    const { pullRequests } = await load();
    ghOk(response());
    await pullRequests();
    ghOk(response({ review: search([node("a/b", 1)]) }));
    expect((await pullRequests({ fresh: true })).review.items).toHaveLength(1);
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  it("shares one gh call between requests made at once", async () => {
    const { pullRequests } = await load();
    let finish: (v: { stdout: string; stderr: string }) => void = () => {};
    runGh.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const a = pullRequests();
    const b = pullRequests();
    finish({ stdout: response(), stderr: "" });
    expect(await a).toBe(await b);
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  it("doesn't cache a failure", async () => {
    const { pullRequests } = await load();
    ghFails({ code: "ENOENT" });
    await expect(pullRequests()).rejects.toThrow("isn't installed");
    ghOk(response());
    expect((await pullRequests()).viewer).toBe("octocat");
  });

  it("keeps the newer result when a fresh call overlaps an older one", async () => {
    const { pullRequests } = await load();
    let finishOld: (v: { stdout: string; stderr: string }) => void = () => {};
    runGh.mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)));
    const old = pullRequests();
    ghOk(response({ review: search([node("a/b", 1)]) }));
    const fresh = await pullRequests({ fresh: true });
    finishOld({ stdout: response(), stderr: "" });
    expect((await old).review.items).toHaveLength(0);
    // The older answer landing late doesn't replace the newer one in the cache.
    expect(await pullRequests()).toBe(fresh);
    expect(runGh).toHaveBeenCalledTimes(2);
  });
});

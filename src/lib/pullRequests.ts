import { execFile } from "child_process";
import { promisify } from "util";
import type { CheckState, PullRequestList, PullRequestRow, PullRequests, PullRequestsErrorReason } from "./types";

// Every open pull request that involves you, across all of GitHub, from GitHub
// search through the user's own `gh` login: one GraphQL call, three searches.
// The query is a fixed string; nothing from a request ever reaches gh.

const run = promisify(execFile);
const TTL_MS = 60_000;
/** Per search; past this the page links to the full list on GitHub. */
export const PAGE_SIZE = 50;

export class PullRequestsError extends Error {
  constructor(
    public status: number,
    public reason: PullRequestsErrorReason,
    message: string
  ) {
    super(message);
  }
}

const SEARCHES = {
  // review-requested also matches requests to a team you're in (user-review-requested wouldn't).
  review: "is:open is:pr review-requested:@me archived:false sort:updated-desc",
  authored: "is:open is:pr author:@me archived:false sort:updated-desc",
  assigned: "is:open is:pr assignee:@me archived:false sort:updated-desc",
} as const;

type Section = keyof typeof SEARCHES;

export const QUERY = `
query {
  viewer { login }
${Object.entries(SEARCHES)
  .map(([alias, q]) => `  ${alias}: search(type: ISSUE, first: ${PAGE_SIZE}, query: "${q}") { issueCount nodes { ...pr } }`)
  .join("\n")}
}
fragment pr on PullRequest {
  number title url isDraft updatedAt reviewDecision
  author { login }
  repository { nameWithOwner url }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

interface Node {
  number?: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  reviewDecision: PullRequestRow["reviewDecision"];
  author: { login: string } | null;
  repository: { nameWithOwner: string; url: string };
  commits: { nodes: ({ commit: { statusCheckRollup: { state: CheckState } | null } } | null)[] };
}

interface SearchResult {
  issueCount: number;
  nodes: (Node | null)[];
}

const lastLine = (s: string) => s.trim().split("\n").at(-1)!.replace(/^(gh|GraphQL): /, "");

/** A failed gh run as an error the page can explain: not installed, not signed in, rate limited, or other. */
function ghError(e: unknown): PullRequestsError {
  const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
  if (err.code === "ENOENT") return new PullRequestsError(503, "missing", "GitHub CLI (gh) isn't installed");
  if (err.killed) return new PullRequestsError(504, "failed", "GitHub didn't respond in time");
  const stderr = err.stderr ?? "";
  if (/auth login|not logged in|authentication|bad credentials|HTTP 401/i.test(stderr)) {
    return new PullRequestsError(401, "signed-out", "GitHub CLI isn't signed in");
  }
  if (/rate limit|submitted too quickly/i.test(stderr)) {
    return new PullRequestsError(429, "rate-limited", "GitHub's API rate limit is used up. Try again in a few minutes.");
  }
  return new PullRequestsError(502, "failed", lastLine(stderr) || err.message);
}

function toRow(n: Node): PullRequestRow {
  return {
    repo: n.repository.nameWithOwner,
    repoUrl: n.repository.url,
    number: n.number as number,
    title: n.title,
    url: n.url,
    draft: n.isDraft,
    author: n.author?.login ?? null,
    updatedAt: n.updatedAt,
    reviewDecision: n.reviewDecision ?? null,
    checks: n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
  };
}

/**
 * One section's rows, leaving out PRs an earlier section already shows (a PR
 * you're assigned to is usually also yours). Nodes the login can't read come
 * back null or empty; they're skipped.
 */
function toList(result: SearchResult | null | undefined, seen: Set<string>): PullRequestList {
  const nodes = result?.nodes ?? [];
  const items: PullRequestRow[] = [];
  for (const n of nodes) {
    if (!n?.number || seen.has(n.url)) continue;
    seen.add(n.url);
    items.push(toRow(n));
  }
  return { items, total: result?.issueCount ?? 0, truncated: (result?.issueCount ?? 0) > nodes.length };
}

let cache: { at: number; value: PullRequests } | null = null;
let inflight: Promise<PullRequests> | null = null;
/** Bumped per gh call, so an older call finishing late can't overwrite a newer answer. */
let generation = 0;

async function fetchPullRequests(): Promise<PullRequests> {
  let stdout: string;
  let stderr = "";
  try {
    ({ stdout } = await run("gh", ["api", "graphql", "-f", `query=${QUERY}`], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (e) {
    // gh exits non-zero when part of the result errors (e.g. an org that needs
    // SSO) but still prints what it got; show that, and say some are missing.
    const err = e as { stdout?: string; stderr?: string };
    if (!err.stdout || !/"viewer"/.test(err.stdout)) throw ghError(e);
    stdout = err.stdout;
    stderr = err.stderr ?? "";
  }

  let body: { data?: Record<string, unknown> & { viewer?: { login: string } }; errors?: { message: string }[] };
  try {
    body = JSON.parse(stdout);
  } catch {
    throw new PullRequestsError(502, "failed", "Couldn't read GitHub's response");
  }
  const data = body.data;
  if (!data?.viewer) {
    throw new PullRequestsError(502, "failed", body.errors?.[0]?.message ?? "Couldn't read GitHub's response");
  }

  const seen = new Set<string>();
  const list = (s: Section) => toList(data[s] as SearchResult | null, seen);
  const problem = body.errors?.[0]?.message ?? lastLine(stderr);
  return {
    viewer: data.viewer.login,
    // Order matters: each PR is listed once, in the first section it belongs to.
    review: list("review"),
    authored: list("authored"),
    assigned: list("assigned"),
    warning: problem ? `Some pull requests couldn't be read: ${problem}` : null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Open PRs waiting on your review, yours, and assigned to you. Cached for a minute unless `fresh`. */
export async function pullRequests({ fresh = false } = {}): Promise<PullRequests> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  // Two pages asking at once share one gh call.
  if (!fresh && inflight) return inflight;
  const p = fetchPullRequests();
  const gen = ++generation;
  inflight = p;
  try {
    const value = await p;
    if (gen === generation) cache = { at: Date.now(), value };
    return value;
  } finally {
    if (inflight === p) inflight = null;
  }
}

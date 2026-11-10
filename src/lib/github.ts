import { execFile } from "child_process";
import { promisify } from "util";
import { simpleGit } from "simple-git";
import { toWebUrl } from "./repoUrl";
import { CheckState, GitHubStatus, PullRequestSummary } from "./types";

// GitHub status via the user's own `gh` login, so private repos work without
// any token configured in workbench.

const run = promisify(execFile);
const TTL_MS = 60_000;

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const QUERY = `
query($owner: String!, $name: String!, $ref: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN, first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number title url isDraft updatedAt headRefName reviewDecision
        author { login }
        reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
    ref(qualifiedName: $ref) {
      target {
        ... on Commit {
          oid
          url
          statusCheckRollup {
            state
            contexts(first: 50) {
              nodes {
                __typename
                ... on CheckRun { name status conclusion detailsUrl }
                ... on StatusContext { context state targetUrl }
              }
            }
          }
        }
      }
    }
  }
}`;

type Context =
  | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null };

const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

function ghMessage(e: unknown): string {
  const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
  if (err.code === "ENOENT") return "GitHub CLI (gh) isn't installed";
  if (err.killed) return "GitHub didn't respond in time";
  const stderr = err.stderr?.trim() ?? "";
  if (/auth login|not logged in|authentication/i.test(stderr)) return "Run `gh auth login` to see GitHub status";
  if (/Could not resolve to a Repository/i.test(stderr)) return "Your gh login can't see this repo";
  return stderr.split("\n").pop()?.replace(/^gh: /, "") || err.message;
}

function githubRepo(webUrl: string | null): { owner: string; name: string } | null {
  if (!webUrl) return null;
  const url = new URL(webUrl);
  if (url.hostname !== "github.com") return null;
  const [owner, name] = url.pathname.slice(1).split("/");
  return owner && name ? { owner: decodeURIComponent(owner), name: decodeURIComponent(name) } : null;
}

const cache = new Map<string, { at: number; value: GitHubStatus }>();

export async function githubStatus(dir: string, { fresh = false } = {}): Promise<GitHubStatus> {
  const git = simpleGit(dir);
  const [remotes, branch] = await Promise.all([
    git.getRemotes(true),
    git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "HEAD"),
  ]);
  const remote = remotes.find((r) => r.name === "origin") ?? remotes[0];
  const repo = githubRepo(remote ? toWebUrl(remote.refs.fetch) : null);
  if (!repo) throw new GitHubError(404, "This project's remote isn't on github.com");

  const key = `${repo.owner}/${repo.name}@${branch}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let stdout: string;
  try {
    // Values go in as separate -f fields (and execFile has no shell), so a
    // branch name can't change the query.
    ({ stdout } = await run(
      "gh",
      [
        "api", "graphql",
        "-f", `query=${QUERY}`,
        "-f", `owner=${repo.owner}`,
        "-f", `name=${repo.name}`,
        "-f", `ref=refs/heads/${branch}`,
      ],
      { timeout: 20_000, maxBuffer: 5 * 1024 * 1024, windowsHide: true }
    ));
  } catch (e) {
    throw new GitHubError(502, ghMessage(e));
  }

  const data = JSON.parse(stdout).data;
  const repository = data.repository;
  const viewer: string = data.viewer.login;

  const pullRequests: PullRequestSummary[] = repository.pullRequests.nodes.map(
    (pr: {
      number: number;
      title: string;
      url: string;
      isDraft: boolean;
      updatedAt: string;
      headRefName: string;
      reviewDecision: PullRequestSummary["reviewDecision"];
      author: { login: string } | null;
      reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] };
      commits: { nodes: { commit: { statusCheckRollup: { state: CheckState } | null } }[] };
    }) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      draft: pr.isDraft,
      updatedAt: pr.updatedAt,
      branch: pr.headRefName,
      reviewDecision: pr.reviewDecision ?? null,
      author: pr.author?.login ?? null,
      reviewRequestedFromYou: pr.reviewRequests.nodes.some(
        (n) => n.requestedReviewer?.login === viewer
      ),
      checks: pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    })
  );

  const commit = repository.ref?.target;
  let ci: GitHubStatus["ci"] = null;
  if (commit?.oid) {
    const contexts: Context[] = commit.statusCheckRollup?.contexts.nodes ?? [];
    const failing: { name: string; url: string | null }[] = [];
    let pending = 0;
    for (const c of contexts) {
      if (c.__typename === "CheckRun") {
        if (c.status !== "COMPLETED") pending++;
        else if (c.conclusion && FAILED_CONCLUSIONS.has(c.conclusion)) failing.push({ name: c.name, url: c.detailsUrl });
      } else if (c.__typename === "StatusContext") {
        if (c.state === "PENDING" || c.state === "EXPECTED") pending++;
        else if (c.state === "FAILURE" || c.state === "ERROR") failing.push({ name: c.context, url: c.targetUrl });
      }
    }
    ci = {
      branch,
      sha: commit.oid,
      url: commit.url,
      state: commit.statusCheckRollup?.state ?? null,
      failing,
      pending,
      total: contexts.length,
    };
  }

  const value: GitHubStatus = {
    repo: `${repo.owner}/${repo.name}`,
    viewer,
    openIssues: repository.issues.totalCount,
    openPullRequests: repository.pullRequests.totalCount,
    pullRequests,
    ci,
    branch,
    fetchedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

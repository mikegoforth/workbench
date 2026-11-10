import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { simpleGit } from "simple-git";
import { setupChecks } from "./devenv";
import { isSelf, projectsDir } from "./paths";
import { toWebUrl } from "./repoUrl";
import { CheckState, Overview, OverviewEntry } from "./types";

// Everything the board needs beyond the git scan: setup warnings for every
// project, and CI + review requests for every GitHub repo in ONE GraphQL call.

const run = promisify(execFile);
const GITHUB_TTL_MS = 60_000;

interface GitHubRepo {
  project: string;
  owner: string;
  name: string;
  branch: string;
}

type GitHubResult = Record<string, OverviewEntry["github"]>;
let githubCache: { key: string; at: number; value: GitHubResult; error: string | null } | null = null;

async function githubRepoFor(project: string, dir: string): Promise<GitHubRepo | null> {
  if (!fs.existsSync(path.join(dir, ".git"))) return null;
  try {
    const git = simpleGit(dir);
    const [remotes, branch] = await Promise.all([
      git.getRemotes(true),
      git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "HEAD"),
    ]);
    const remote = remotes.find((r) => r.name === "origin") ?? remotes[0];
    const webUrl = remote ? toWebUrl(remote.refs.fetch) : null;
    if (!webUrl) return null;
    const url = new URL(webUrl);
    if (url.hostname !== "github.com") return null;
    const [owner, name] = url.pathname.slice(1).split("/").map(decodeURIComponent);
    return owner && name ? { project, owner, name, branch } : null;
  } catch {
    return null;
  }
}

/** CI + review requests for many repos at once. Values travel as -f fields, never inside the query. */
async function githubBatch(repos: GitHubRepo[], fresh: boolean) {
  const key = repos.map((r) => `${r.owner}/${r.name}@${r.branch}`).join(",");
  if (!fresh && githubCache?.key === key && Date.now() - githubCache.at < GITHUB_TTL_MS) {
    return githubCache;
  }
  if (repos.length === 0) return { key, at: Date.now(), value: {}, error: null };

  const vars = repos.map((_, i) => `$o${i}: String!, $n${i}: String!, $b${i}: String!`).join(", ");
  const fields = repos
    .map(
      (_, i) => `r${i}: repository(owner: $o${i}, name: $n${i}) {
        pullRequests(states: OPEN, first: 50) {
          totalCount
          nodes { reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } } }
        }
        ref(qualifiedName: $b${i}) { target { ... on Commit { url statusCheckRollup { state } } } }
      }`
    )
    .join("\n");
  const query = `query(${vars}) { viewer { login } ${fields} }`;
  const args = ["api", "graphql", "-f", `query=${query}`];
  repos.forEach((r, i) => {
    args.push("-f", `o${i}=${r.owner}`, "-f", `n${i}=${r.name}`, "-f", `b${i}=refs/heads/${r.branch}`);
  });

  let stdout = "";
  let error: string | null = null;
  try {
    ({ stdout } = await run("gh", args, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }));
  } catch (e) {
    // gh exits non-zero when any repo errors but still prints the data it got.
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    stdout = err.stdout ?? "";
    if (err.code === "ENOENT") error = "GitHub CLI (gh) isn't installed";
    else if (/auth login|not logged in/i.test(err.stderr ?? "")) error = "Run `gh auth login` to see CI and reviews";
    else if (!stdout) error = err.stderr?.trim().split("\n").pop()?.replace(/^gh: /, "") || err.message;
  }

  const value: GitHubResult = {};
  if (stdout) {
    try {
      const data = JSON.parse(stdout).data ?? {};
      const viewer: string | undefined = data.viewer?.login;
      repos.forEach((r, i) => {
        const repo = data[`r${i}`];
        if (!repo) return;
        const commit = repo.ref?.target;
        value[r.project] = {
          ci: (commit?.statusCheckRollup?.state as CheckState | undefined) ?? null,
          ciUrl: commit?.url ?? null,
          openPullRequests: repo.pullRequests.totalCount,
          reviewRequested: repo.pullRequests.nodes.filter(
            (pr: { reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] } }) =>
              viewer && pr.reviewRequests.nodes.some((n) => n.requestedReviewer?.login === viewer)
          ).length,
        };
      });
    } catch {
      error ??= "Couldn't read GitHub's response";
    }
  }

  githubCache = { key, at: Date.now(), value, error };
  return githubCache;
}

export async function buildOverview({ fresh = false } = {}): Promise<Overview> {
  const root = projectsDir();
  const projects = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !isSelf(path.join(root, e.name)))
    .map((e) => ({ name: e.name, dir: path.join(root, e.name) }));

  const [checks, repos] = await Promise.all([
    Promise.all(projects.map((p) => setupChecks(p.dir).catch(() => []))),
    Promise.all(projects.map((p) => githubRepoFor(p.name, p.dir))),
  ]);
  const github = await githubBatch(
    repos.filter((r): r is GitHubRepo => r !== null),
    fresh
  );

  const entries: Record<string, OverviewEntry> = {};
  projects.forEach((p, i) => {
    entries[p.name] = {
      warnings: checks[i].filter((c) => c.level === "warn").map((c) => ({ id: c.id, title: c.title })),
      github: github.value[p.name] ?? null,
    };
  });
  return { generatedAt: new Date().toISOString(), entries, githubError: github.error };
}

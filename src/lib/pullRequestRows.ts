import type { PullRequestList, PullRequestRow } from "./types";

// Pure helpers for the Pull requests page (safe to import in the browser).

const repoKey = (webUrl: string) => webUrl.replace(/\/+$/, "").toLowerCase();

/**
 * Local projects by their GitHub repo, from the remote URL the scan derived
 * (repoUrl.ts), so a PR can link to the project's workbench page. GitHub
 * treats owner and name case-insensitively, so the match does too. With two
 * clones of one repo, a shown project wins over a hidden one, then the first by name.
 */
export function projectsByRepo(projects: { name: string; repoUrl?: string; hidden?: boolean }[]): Map<string, string> {
  const byRepo = new Map<string, string>();
  const sorted = [...projects].sort((a, b) => Number(!!a.hidden) - Number(!!b.hidden) || a.name.localeCompare(b.name));
  for (const p of sorted) {
    if (!p.repoUrl) continue;
    const key = repoKey(p.repoUrl);
    if (!byRepo.has(key)) byRepo.set(key, p.name);
  }
  return byRepo;
}

/**
 * How many to say a section has: what's listed, or GitHub's total when there
 * are more than one page of them (the page links to the rest).
 */
export const listCount = (list: PullRequestList): number => (list.truncated ? list.total : list.items.length);

/** The local project for a PR's repo, if there's one. */
export function localProject(byRepo: Map<string, string>, pr: Pick<PullRequestRow, "repoUrl">): string | null {
  return byRepo.get(repoKey(pr.repoUrl)) ?? null;
}

/**
 * Does a PR match the filter box? Every word has to appear in its title, repo,
 * #number, author or local project name (case-insensitive).
 */
export function matchesFilter(pr: PullRequestRow, query: string, project: string | null = null): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [pr.title, pr.repo, `#${pr.number}`, pr.author ?? "", project ?? "", pr.draft ? "draft" : ""].join("\n").toLowerCase();
  return words.every((w) => haystack.includes(w));
}

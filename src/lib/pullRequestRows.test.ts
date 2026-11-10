import { describe, expect, it } from "vitest";
import { listCount, localProject, matchesFilter, projectsByRepo } from "./pullRequestRows";
import { toWebUrl } from "./repoUrl";
import type { PullRequestRow } from "./types";

const pr = (overrides: Partial<PullRequestRow> = {}): PullRequestRow => ({
  repo: "Acme/API",
  repoUrl: "https://github.com/Acme/API",
  number: 42,
  title: "Fix the login redirect",
  url: "https://github.com/Acme/API/pull/42",
  draft: false,
  author: "hubot",
  updatedAt: "2026-11-08T10:00:00Z",
  reviewDecision: null,
  checks: null,
  ...overrides,
});

describe("projectsByRepo / localProject", () => {
  it("matches a PR to the local clone of its repo, whatever the remote style or case", () => {
    const byRepo = projectsByRepo([
      { name: "api", repoUrl: toWebUrl("git@github.com:acme/api.git") ?? undefined },
      { name: "site", repoUrl: toWebUrl("https://github.com/acme/site") ?? undefined },
      { name: "scratch" },
    ]);
    expect(localProject(byRepo, pr())).toBe("api");
    expect(localProject(byRepo, pr({ repoUrl: "https://github.com/acme/site/" }))).toBe("site");
    expect(localProject(byRepo, pr({ repoUrl: "https://github.com/acme/other" }))).toBeNull();
  });

  it("prefers a shown clone over a hidden one, then the first by name", () => {
    const url = "https://github.com/acme/api";
    expect(
      localProject(
        projectsByRepo([
          { name: "api-old", repoUrl: url, hidden: true },
          { name: "api-b", repoUrl: url },
          { name: "api-a", repoUrl: url },
        ]),
        pr()
      )
    ).toBe("api-a");
    expect(localProject(projectsByRepo([{ name: "api-old", repoUrl: url, hidden: true }]), pr())).toBe("api-old");
  });
});

describe("listCount", () => {
  it("counts what's listed, or GitHub's total past the first page", () => {
    expect(listCount({ items: [pr(), pr()], total: 3, truncated: false })).toBe(2);
    expect(listCount({ items: [pr(), pr()], total: 73, truncated: true })).toBe(73);
  });
});

describe("matchesFilter", () => {
  it("matches everything when the filter is empty", () => {
    expect(matchesFilter(pr(), "")).toBe(true);
    expect(matchesFilter(pr(), "   ")).toBe(true);
  });

  it.each(["login", "LOGIN redirect", "acme/api", "#42", "42", "hubot", "local-api", "draft"])("matches %j", (q) => {
    expect(matchesFilter(pr({ draft: true }), q, "local-api")).toBe(true);
  });

  it("needs every word to match", () => {
    expect(matchesFilter(pr(), "login nope")).toBe(false);
    expect(matchesFilter(pr(), "draft")).toBe(false);
    expect(matchesFilter(pr({ author: null }), "hubot")).toBe(false);
  });
});

"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CircleCheck, CircleSlash, ExternalLink, FolderGit2, GitPullRequest, LoaderCircle, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { ageShort, timeAgo } from "@/lib/format";
import { listCount, localProject, matchesFilter, projectsByRepo } from "@/lib/pullRequestRows";
import type { PullRequestList, PullRequestRow, PullRequests, PullRequestsErrorReason } from "@/lib/types";
import type { Tone } from "@/lib/status";
import { Badge, Button, Card, CardHeader, ChecksBadge, EmptyState, FilterBar, LinkButton, PageBody, TABLE, TD, TH, TitleBar } from "./ui";
import type { Ctx } from "./model";

export interface PullRequestsState {
  data: PullRequests | null;
  error: { message: string; reason: PullRequestsErrorReason } | null;
  loading: boolean;
}

class LoadError extends Error {
  constructor(
    message: string,
    public reason: PullRequestsErrorReason
  ) {
    super(message);
  }
}

/** GET /api/pull-requests; a failure keeps its reason (not installed, signed out, rate limited) for the page. */
export async function loadPullRequests(fresh: boolean): Promise<PullRequests> {
  const res = await fetch(`/api/pull-requests${fresh ? "?fresh=1" : ""}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new LoadError(body?.error ?? `Request failed (${res.status})`, body?.reason ?? "failed");
  return body as PullRequests;
}

export const loadErrorOf = (e: unknown): NonNullable<PullRequestsState["error"]> => ({
  message: (e as Error).message,
  reason: e instanceof LoadError ? e.reason : "failed",
});

type SectionKey = "review" | "authored" | "assigned";

const SECTIONS: {
  key: SectionKey;
  title: string;
  description: string;
  /** The same list on GitHub, for more than a page or anything else. */
  github: string;
  showAuthor: boolean;
  countTone?: Tone;
  empty: { icon: LucideIcon; title: string; body: string };
  /** Only shown when there's something in it. */
  optional?: boolean;
}[] = [
  {
    key: "review",
    title: "Waiting on your review",
    description: "Review requested from you or a team you're on.",
    github: "https://github.com/pulls/review-requested",
    showAuthor: true,
    countTone: "warn",
    empty: {
      icon: CircleCheck,
      title: "No pull requests are waiting on you",
      body: "When someone asks you, or a team you're on, to review a pull request, it shows up here.",
    },
  },
  {
    key: "authored",
    title: "Yours",
    description: "Opened by you, on any repo.",
    github: "https://github.com/pulls",
    showAuthor: false,
    empty: {
      icon: GitPullRequest,
      title: "You have no open pull requests",
      body: "Pull requests you open show up here with their checks and reviews.",
    },
  },
  {
    key: "assigned",
    title: "Assigned to you",
    description: "Someone else's pull request, assigned to you.",
    github: "https://github.com/pulls/assigned",
    showAuthor: true,
    optional: true,
    empty: { icon: GitPullRequest, title: "Nothing assigned to you", body: "" },
  },
];

function ReviewBadge({ decision }: { decision: PullRequestRow["reviewDecision"] }) {
  switch (decision) {
    case "APPROVED":
      return <Badge tone="ok">Approved</Badge>;
    case "CHANGES_REQUESTED":
      return <Badge tone="bad">Changes requested</Badge>;
    case "REVIEW_REQUIRED":
      return <Badge>Review required</Badge>;
    default:
      return (
        <span className="text-[13px] text-fg-3" title="This repo doesn't require a review">
          —
        </span>
      );
  }
}

function PullRequestTable({
  rows,
  showAuthor,
  projectFor,
  onOpenProject,
}: {
  rows: PullRequestRow[];
  showAuthor: boolean;
  projectFor: (pr: PullRequestRow) => string | null;
  onOpenProject: (name: string) => void;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className={TABLE}>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Pull request
            </th>
            {/* Fixed widths, so the columns line up from one section's card to the next. */}
            <th scope="col" className={`${TH} hidden w-36 md:table-cell`}>
              Checks
            </th>
            <th scope="col" className={`${TH} hidden w-48 md:table-cell`}>
              Review
            </th>
            <th scope="col" className={`${TH} hidden w-28 sm:table-cell`}>
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((pr) => {
            const project = projectFor(pr);
            return (
              <tr key={pr.url} className="transition-colors hover:bg-hover">
                <td className={TD}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <a href={pr.url} target="_blank" rel="noopener noreferrer" className="font-medium wrap-break-word text-fg hover:text-brand-text hover:underline">
                      {pr.title}
                    </a>
                    {pr.draft && <Badge>Draft</Badge>}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-3">
                    <span className="font-mono">
                      {pr.repo} #{pr.number}
                    </span>
                    {showAuthor && pr.author && <span>by {pr.author}</span>}
                    <span className="sm:hidden" title={new Date(pr.updatedAt).toLocaleString()}>
                      {timeAgo(pr.updatedAt)}
                    </span>
                    {project && (
                      <button
                        type="button"
                        onClick={() => onOpenProject(project)}
                        title={`Open ${project} in workbench`}
                        className="inline-flex items-center gap-1 font-medium text-brand-text hover:underline"
                      >
                        <FolderGit2 aria-hidden size={13} strokeWidth={2.25} />
                        {project}
                      </button>
                    )}
                  </span>
                  {/* Narrow screens: checks and review under the title instead of in their columns. */}
                  <span className="mt-2 flex flex-wrap gap-1.5 md:hidden">
                    <ChecksBadge state={pr.checks} />
                    {pr.reviewDecision && <ReviewBadge decision={pr.reviewDecision} />}
                  </span>
                </td>
                <td className={`${TD} hidden md:table-cell`}>
                  <ChecksBadge state={pr.checks} />
                </td>
                <td className={`${TD} hidden md:table-cell`}>
                  <ReviewBadge decision={pr.reviewDecision} />
                </td>
                <td className={`${TD} hidden sm:table-cell whitespace-nowrap text-fg-2 tabular-nums`} title={new Date(pr.updatedAt).toLocaleString()}>
                  {ageShort(pr.updatedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Why there's nothing to show: gh missing, signed out, rate limited, or another failure, each with its fix. */
function Unavailable({ error, loading, onRetry }: { error: NonNullable<PullRequestsState["error"]>; loading: boolean; onRetry: () => void }) {
  const copy: Record<PullRequestsErrorReason, { title: string; body: ReactNode }> = {
    missing: {
      title: "GitHub CLI (gh) isn't installed",
      body: "Without it there's no CI status, pull requests or review requests. Install it, run gh auth login in a terminal, then check again.",
    },
    "signed-out": {
      title: "GitHub CLI isn't signed in",
      body: (
        <>
          Run <code className="font-mono text-fg-2">gh auth login</code> in a terminal, then check again.
        </>
      ),
    },
    "rate-limited": { title: "GitHub's rate limit is used up", body: "Try again in a few minutes." },
    failed: { title: "Couldn't load pull requests", body: error.message },
  };
  const { title, body } = copy[error.reason];
  return (
    <Card>
      <EmptyState icon={error.reason === "failed" || error.reason === "rate-limited" ? TriangleAlert : CircleSlash} title={title}>
        <p>{body}</p>
        <span className="mt-4 flex flex-wrap justify-center gap-2">
          {error.reason === "missing" && (
            <LinkButton size="sm" icon={ExternalLink} href="https://cli.github.com/">
              Get GitHub CLI
            </LinkButton>
          )}
          <Button size="sm" icon={RefreshCw} spin={loading} disabled={loading} onClick={onRetry}>
            Check again
          </Button>
        </span>
      </EmptyState>
    </Card>
  );
}

export default function PullRequestsView({ ctx, prs, onRefresh }: { ctx: Ctx; prs: PullRequestsState; onRefresh: () => void }) {
  const [query, setQuery] = useState("");
  const { data, error, loading } = prs;

  const byRepo = useMemo(() => projectsByRepo(ctx.items.map((i) => i.project)), [ctx.items]);
  const projectFor = (pr: PullRequestRow) => localProject(byRepo, pr);

  const sections = data
    ? SECTIONS.map((s) => {
        const list: PullRequestList = data[s.key];
        return { ...s, list, rows: list.items.filter((pr) => matchesFilter(pr, query, projectFor(pr))) };
      }).filter((s) => !s.optional || s.list.items.length > 0)
    : [];

  return (
    <>
      <TitleBar
        title="Pull requests"
        actions={
          <>
            <Button variant="ghost" icon={RefreshCw} spin={loading} disabled={loading} onClick={onRefresh}>
              Refresh
            </Button>
            <LinkButton variant="ghost" icon={ExternalLink} href="https://github.com/pulls">
              Open on GitHub
            </LinkButton>
          </>
        }
      />
      <PageBody className="space-y-6">
        <p className="text-[13.5px] text-fg-2">
          Open pull requests across GitHub that are waiting on your review or are yours, from your gh login
          {data && (
            <>
              {" "}
              (<span className="font-medium text-fg">{data.viewer}</span>), updated {timeAgo(data.fetchedAt)}
            </>
          )}
          .
        </p>

        {data && error && (
          <p role="alert" className="rounded border border-warn-line bg-warn-soft px-5 py-3 text-[13.5px] text-warn">
            Couldn&apos;t refresh: {error.message}. Showing what GitHub said {timeAgo(data.fetchedAt)}.
          </p>
        )}
        {data?.warning && <p className="rounded border border-warn-line bg-warn-soft px-5 py-3 text-[13.5px] text-warn">{data.warning}</p>}

        {!data && error ? (
          <Unavailable error={error} loading={loading} onRetry={onRefresh} />
        ) : !data ? (
          <Card>
            <p className="flex items-center justify-center gap-2.5 px-5 py-10 text-[13.5px] text-fg-2">
              <LoaderCircle aria-hidden size={18} className="animate-spin text-brand" />
              Asking GitHub…
            </p>
          </Card>
        ) : (
          <>
            <Card>
              <FilterBar value={query} onChange={setQuery} placeholder="Title, repo, #number, author or project" className="" />
            </Card>
            {sections.map((s) => {
              const id = `prs-${s.key}`;
              return (
                <Card key={s.key} aria-labelledby={id}>
                  <CardHeader
                    id={id}
                    title={s.title}
                    count={listCount(s.list)}
                    countTone={s.list.items.length && s.countTone ? s.countTone : undefined}
                    description={s.description}
                    actions={
                      <LinkButton size="sm" variant="ghost" icon={ExternalLink} href={s.github}>
                        On GitHub
                      </LinkButton>
                    }
                  />
                  {s.list.items.length === 0 ? (
                    <EmptyState icon={s.empty.icon} title={s.empty.title}>
                      {s.empty.body}
                    </EmptyState>
                  ) : s.rows.length === 0 ? (
                    <p className="px-5 py-6 text-center text-[13px] text-fg-3">No pull requests here match &ldquo;{query.trim()}&rdquo;.</p>
                  ) : (
                    <PullRequestTable rows={s.rows} showAuthor={s.showAuthor} projectFor={projectFor} onOpenProject={ctx.actions.open} />
                  )}
                  {s.list.truncated && (
                    <p className="px-5 py-3 text-[12.5px] text-fg-3">
                      GitHub has {s.list.total}; these are the most recently updated.{" "}
                      <a href={s.github} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-text hover:underline">
                        See them all on GitHub
                      </a>
                    </p>
                  )}
                </Card>
              );
            })}
          </>
        )}
      </PageBody>
    </>
  );
}

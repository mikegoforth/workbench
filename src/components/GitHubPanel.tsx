"use client";

import { useEffect, useState } from "react";
import { Circle, CircleCheck, CircleX, ExternalLink, GitPullRequest, LoaderCircle, RefreshCw, type LucideIcon } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { CheckState, GitHubStatus } from "@/lib/types";
import { Badge, Button, EmptyState, LinkButton, Panel } from "./ui";

function checkTone(state: CheckState | null): { Icon: LucideIcon; tone: string; word: string } {
  if (state === "SUCCESS") return { Icon: CircleCheck, tone: "text-ok", word: "Passing" };
  if (state === "FAILURE" || state === "ERROR") return { Icon: CircleX, tone: "text-bad", word: "Failing" };
  if (state === "PENDING" || state === "EXPECTED") return { Icon: LoaderCircle, tone: "text-warn", word: "In progress" };
  return { Icon: Circle, tone: "text-fg-3", word: "No checks" };
}

async function load(projectName: string, fresh: boolean) {
  const res = await fetch(`/api/github?project=${encodeURIComponent(projectName)}${fresh ? "&fresh=1" : ""}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "Couldn't load GitHub status");
  return body as GitHubStatus;
}

export default function GitHubPanel({ projectName, className = "" }: { projectName: string; className?: string }) {
  const [data, setData] = useState<GitHubStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load(projectName, false)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectName]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setData(await load(projectName, true));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const repoUrl = data ? `https://github.com/${data.repo}` : null;
  const ci = data?.ci;
  const ciTone = checkTone(ci && ci.total > 0 ? ci.state : null);

  return (
    <div className={`space-y-4 ${className}`}>
      <Panel
        id="github-heading"
        title="Checks"
        description={data ? `${data.repo} · updated ${timeAgo(data.fetchedAt)}` : undefined}
        actions={
          <>
            {repoUrl && (
              <LinkButton size="sm" icon={ExternalLink} href={repoUrl}>
                Open on GitHub
              </LinkButton>
            )}
            <Button size="sm" icon={RefreshCw} spin={refreshing} onClick={refresh} disabled={refreshing} aria-label="Refresh from GitHub" title="Refresh" />
          </>
        }
      >
        {error ? (
          <p className="text-[13px] text-fg-2">{error}</p>
        ) : !data ? (
          <p className="text-[13px] text-fg-3">Asking GitHub…</p>
        ) : (
          <div className="space-y-4 text-[13px]">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-line p-3">
                <p className="text-[12px] font-medium text-fg-3">CI</p>
                {ci ? (
                  <p className={`mt-1 inline-flex items-center gap-1.5 text-[15px] font-semibold ${ciTone.tone}`}>
                    <ciTone.Icon aria-hidden size={16} strokeWidth={2.25} />
                    {ciTone.word}
                  </p>
                ) : (
                  <p className="mt-1 text-[15px] font-semibold text-fg-3">Not pushed</p>
                )}
                <p className="mt-1 text-[12px] text-fg-3">
                  {ci ? (
                    <>
                      <span className="font-mono">{ci.branch}</span>
                      {ci.total > 0 && ` · ${ci.total} check${ci.total === 1 ? "" : "s"}`}
                      {ci.pending > 0 && ` · ${ci.pending} running`}
                    </>
                  ) : data.branch === "HEAD" ? (
                    "Detached HEAD"
                  ) : (
                    <>
                      <span className="font-mono">{data.branch}</span> isn&apos;t on GitHub yet
                    </>
                  )}
                </p>
              </div>
              <a
                href={`${repoUrl}/pulls`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-line p-3 hover:border-line-strong hover:bg-subtle"
              >
                <p className="text-[12px] font-medium text-fg-3">Open pull requests</p>
                <p className="mt-1 text-[22px] leading-tight font-semibold text-fg tabular-nums">{data.openPullRequests}</p>
              </a>
              <a
                href={`${repoUrl}/issues`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-line p-3 hover:border-line-strong hover:bg-subtle"
              >
                <p className="text-[12px] font-medium text-fg-3">Open issues</p>
                <p className="mt-1 text-[22px] leading-tight font-semibold text-fg tabular-nums">{data.openIssues}</p>
              </a>
            </div>

            {ci && ci.failing.length > 0 && (
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-fg-3">Failing checks</p>
                <ul className="space-y-1">
                  {ci.failing.map((f) => (
                    <li key={f.name} className="flex items-center gap-2 font-medium text-bad">
                      <CircleX aria-hidden size={14} strokeWidth={2.25} />
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {f.name}
                        </a>
                      ) : (
                        f.name
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>

      {data && (
        <Panel id="prs-heading" title="Pull requests" count={data.pullRequests.length} bodyClassName="">
          {data.pullRequests.length === 0 ? (
            <EmptyState icon={GitPullRequest} title="No open pull requests" />
          ) : (
            <ul className="divide-y divide-line">
              {data.pullRequests.map((pr) => {
                const tone = checkTone(pr.checks);
                return (
                  <li key={pr.number}>
                    <a href={pr.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 px-4 py-3 hover:bg-subtle">
                      <tone.Icon aria-label={`Checks ${tone.word}`} size={15} strokeWidth={2.25} className={`mt-0.5 shrink-0 ${tone.tone}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] wrap-break-word text-fg">
                          {pr.title} <span className="text-fg-3">#{pr.number}</span>
                        </span>
                        <span className="mt-0.5 block text-[12px] text-fg-3">
                          {pr.author === data.viewer ? "You" : (pr.author ?? "unknown")} · <span className="font-mono">{pr.branch}</span> · updated{" "}
                          {timeAgo(pr.updatedAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap justify-end gap-1">
                        {pr.reviewRequestedFromYou && <Badge tone="warn">Your review</Badge>}
                        {pr.draft && <Badge>Draft</Badge>}
                        {pr.reviewDecision === "APPROVED" && <Badge tone="ok">Approved</Badge>}
                        {pr.reviewDecision === "CHANGES_REQUESTED" && <Badge tone="bad">Changes requested</Badge>}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { ageShort, timeAgo } from "@/lib/format";
import type { GitHistory } from "@/lib/types";
import { Badge, EmptyState, Panel, Segmented, ShowAll, TextButton } from "./ui";

const LIMIT = 10;

// One fetch per project per repo change, shared by Recent commits and History.
const cache = new Map<string, { key: string; promise: Promise<GitHistory> }>();

function loadHistory(projectName: string, refreshKey: string): Promise<GitHistory> {
  const hit = cache.get(projectName);
  if (hit && hit.key === refreshKey) return hit.promise;
  const promise = fetch(`/api/git?project=${encodeURIComponent(projectName)}`).then(async (res) => {
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? "Couldn't load history");
    return body as GitHistory;
  });
  cache.set(projectName, { key: refreshKey, promise });
  promise.catch(() => cache.delete(projectName));
  return promise;
}

function useGitHistory(projectName: string, refreshKey: string) {
  const [state, setState] = useState<{ data: GitHistory | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    loadHistory(projectName, refreshKey)
      .then((data) => {
        if (!cancelled) setState({ data, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ data: null, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [projectName, refreshKey]);
  return state;
}

function CommitRows({ commits, repoUrl }: { commits: GitHistory["commits"]; repoUrl?: string }) {
  return (
    <ul className="divide-y divide-line">
      {commits.map((c) => {
        const link = repoUrl && c.pushed !== false ? `${repoUrl}/commit/${c.hash}` : null;
        return (
          <li key={c.hash} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] text-fg" title={c.subject}>
                {c.subject}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-fg-3">
                {c.author} · {timeAgo(c.date)}
              </p>
            </div>
            {c.pushed === false && <Badge tone="warn">Not pushed</Badge>}
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[11.5px] text-fg-2 hover:border-line-strong hover:text-fg"
              >
                {c.hash.slice(0, 7)}
              </a>
            ) : (
              <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[11.5px] text-fg-3">
                {c.hash.slice(0, 7)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Loading({ error }: { error: string | null }) {
  return error ? (
    <p className="px-5 py-3.5 text-[13px] font-medium text-bad">{error}</p>
  ) : (
    <p className="px-5 py-3.5 text-[13px] text-fg-3">Reading the log…</p>
  );
}

/** The last few commits, for the project overview. */
export function RecentCommits({
  projectName,
  repoUrl,
  refreshKey,
  onViewAll,
  className = "",
}: {
  projectName: string;
  repoUrl?: string;
  refreshKey: string;
  onViewAll?: () => void;
  className?: string;
}) {
  const { data, error } = useGitHistory(projectName, refreshKey);
  return (
    <Panel
      id="recent-heading"
      title="Recent commits"
      className={className}
      bodyClassName=""
      actions={onViewAll ? <TextButton onClick={onViewAll}>View history</TextButton> : undefined}
    >
      {!data ? (
        <Loading error={error} />
      ) : data.commits.length === 0 ? (
        <EmptyState icon={GitCommitHorizontal} title="No commits yet" />
      ) : (
        <CommitRows commits={data.commits.slice(0, 5)} repoUrl={repoUrl} />
      )}
    </Panel>
  );
}

type Tab = "commits" | "branches" | "stashes";

/** Commits, branches and stashes. */
export default function HistoryPanel({
  projectName,
  repoUrl,
  refreshKey,
  className = "",
}: {
  projectName: string;
  repoUrl?: string;
  refreshKey: string;
  className?: string;
}) {
  const { data, error } = useGitHistory(projectName, refreshKey);
  const [tab, setTab] = useState<Tab>("commits");
  const [expanded, setExpanded] = useState(false);
  const limited = <T,>(rows: T[]) => (expanded ? rows : rows.slice(0, LIMIT));

  return (
    <Panel
      id="history-heading"
      title="History"
      className={className}
      bodyClassName=""
      actions={
        <Segmented
          label="History view"
          size="sm"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setExpanded(false);
          }}
          items={[
            { id: "commits", label: "Commits", count: data?.commits.length },
            { id: "branches", label: "Branches", count: data?.branches.length },
            { id: "stashes", label: "Stashes", count: data?.stashes.length },
          ]}
        />
      }
    >
      {!data ? (
        <Loading error={error} />
      ) : tab === "commits" ? (
        data.commits.length === 0 ? (
          <EmptyState icon={GitCommitHorizontal} title="No commits yet" />
        ) : (
          <CommitRows commits={data.commits} repoUrl={repoUrl} />
        )
      ) : tab === "branches" ? (
        <>
          <ul className="divide-y divide-line">
            {limited(data.branches).map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[12.5px]">
                <span className={`font-mono text-[13px] break-all ${b.current ? "font-semibold text-fg" : "text-fg"}`}>{b.name}</span>
                {b.current && <Badge tone="info">Current</Badge>}
                {b.gone ? (
                  <Badge tone="bad">Upstream deleted</Badge>
                ) : b.upstream ? (
                  <span className="font-mono text-fg-3">
                    {b.upstream}
                    {b.ahead > 0 && <span className="ml-2 font-medium text-warn">{b.ahead} ahead</span>}
                    {b.behind > 0 && <span className="ml-2 font-medium text-warn">{b.behind} behind</span>}
                  </span>
                ) : (
                  <Badge>Local only</Badge>
                )}
                <span className="ml-auto text-fg-3 tabular-nums">{ageShort(b.lastCommitDate)}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-3">
            <ShowAll total={data.branches.length} limit={LIMIT} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
          </div>
        </>
      ) : data.stashes.length === 0 ? (
        <EmptyState icon={GitCommitHorizontal} title="No stashes" />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {limited(data.stashes).map((s) => (
              <li key={s.index} className="flex items-baseline gap-3 px-5 py-3">
                <span className="shrink-0 font-mono text-[12px] text-fg-3">stash@{`{${s.index}}`}</span>
                <p className="min-w-0 flex-1 text-[13px] wrap-break-word text-fg">{s.message}</p>
                <span className="shrink-0 text-[12px] text-fg-3 tabular-nums">{ageShort(s.date)}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-3">
            <ShowAll total={data.stashes.length} limit={LIMIT} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
          </div>
        </>
      )}
    </Panel>
  );
}

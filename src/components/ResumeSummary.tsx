"use client";

import type { ReactNode } from "react";
import { plural, timeAgo } from "@/lib/format";
import type { ProjectInfo } from "@/lib/types";
import { devState, type DevControls } from "./DevEnvironment";
import { useGitHistory } from "./HistoryPanel";
import { Badge, Card, SyncValue, TextButton } from "./ui";

/** One fact: a small grey label over its value, with an optional quieter second line. */
function Fact({ label, sub, className = "", children }: { label: string; sub?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[12px] text-fg-3">{label}</dt>
      <dd className="mt-1 min-w-0 text-[13.5px] text-fg">
        {children}
        {sub && <span className="mt-0.5 block text-[12px] text-fg-3">{sub}</span>}
      </dd>
    </div>
  );
}

const FACTS = "mt-3 grid grid-cols-2 gap-x-8 gap-y-4 md:flex md:flex-wrap md:gap-x-12";

/** The git half: branch, uncommitted work, upstream, stashes, last commit. */
function GitFacts({
  project,
  historyKey,
  fetching,
  onFetch,
  onChanges,
  onHistory,
}: {
  project: ProjectInfo;
  historyKey: string;
  fetching: boolean;
  onFetch?: () => void;
  onChanges: () => void;
  onHistory: () => void;
}) {
  // Shares Recent commits' fetch (same key), so the stash count costs nothing extra.
  const { data } = useGitHistory(project.name, historyKey);
  const stashes = data?.stashes.length ?? 0;
  const modified = project.uncommittedChanges ?? 0;
  const untracked = project.untrackedFiles ?? 0;
  const changed = modified + untracked;
  const ahead = project.aheadBehind?.ahead ?? 0;
  const behind = project.aheadBehind?.behind ?? 0;

  let upstream: ReactNode;
  let upstreamSub: ReactNode = null;
  if (!project.hasRemote) {
    upstream = <span className="text-fg-3">No remote</span>;
  } else if (!project.lastFetchedAt) {
    // Ahead/behind means nothing until the remote has been fetched once.
    upstream = <span className="text-fg-2">{fetching ? "Fetching…" : "Not fetched yet"}</span>;
    if (!fetching && onFetch) {
      upstreamSub = (
        <TextButton onClick={onFetch} className="text-[12px]!" title="git fetch --all --prune">
          Fetch now
        </TextButton>
      );
    }
  } else {
    upstream = (
      <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <SyncValue ahead={ahead} behind={behind} />
        <span className="text-fg-2">{ahead || behind ? [behind && `${behind} behind`, ahead && `${ahead} unpushed`].filter(Boolean).join(", ") : "In sync"}</span>
      </span>
    );
    upstreamSub = fetching ? "fetching now" : `fetched ${timeAgo(project.lastFetchedAt)}`;
  }

  return (
    <dl className={FACTS}>
      <Fact label="Branch">
        <span className="font-mono text-[13px] break-all">{project.branch ?? "detached HEAD"}</span>
      </Fact>
      <Fact
        label="Uncommitted"
        sub={changed ? [modified && `${modified} modified`, untracked && `${untracked} untracked`].filter(Boolean).join(", ") : undefined}
      >
        {changed ? (
          <TextButton onClick={onChanges} className="text-[13.5px]!">
            {plural(changed, "changed file")}
          </TextButton>
        ) : (
          <span className="text-fg-2">Clean</span>
        )}
      </Fact>
      <Fact label="Upstream" sub={upstreamSub}>
        {upstream}
      </Fact>
      {stashes > 0 && (
        <Fact label="Stashed">
          <TextButton onClick={onHistory} className="text-[13.5px]!" title="See them in History, under Stashes">
            {plural(stashes, "stash")}
          </TextButton>
        </Fact>
      )}
      <Fact
        label="Last commit"
        className="col-span-2 md:min-w-64 md:flex-1"
        sub={project.lastCommitDate ? `${project.lastCommitAuthor} · ${timeAgo(project.lastCommitDate)}` : undefined}
      >
        {project.lastCommitDate ? (
          <span className="block truncate" title={project.lastCommitMessage}>
            {project.lastCommitMessage}
          </span>
        ) : (
          <span className="text-fg-3">No commits yet</span>
        )}
      </Fact>
    </dl>
  );
}

/**
 * "Where you left off": the few facts that answer "what was I doing here?" in one
 * glance, at the top of a project's Details tab.
 */
export default function ResumeSummary({
  project,
  dev,
  historyKey,
  fetching,
  onFetch,
  onChanges,
  onHistory,
}: {
  project: ProjectInfo;
  dev: DevControls;
  historyKey: string;
  fetching: boolean;
  /** Fetch the remote; omitted when there's nothing to fetch from. */
  onFetch?: () => void;
  onChanges: () => void;
  onHistory: () => void;
}) {
  const run = devState(dev);
  return (
    <Card aria-labelledby="resume-heading" className="px-5 pt-4 pb-5">
      <h2 id="resume-heading" className="text-[15px] leading-tight font-medium text-fg">
        Where you left off
      </h2>
      {project.isGitRepo ? (
        <GitFacts project={project} historyKey={historyKey} fetching={fetching} onFetch={onFetch} onChanges={onChanges} onHistory={onHistory} />
      ) : (
        <dl className={FACTS}>
          <Fact label="Location" className="col-span-2 md:col-span-1">
            <span className="font-mono text-[13px] break-all">{project.path}</span>
          </Fact>
          <Fact label="Dev environment" sub={dev.status?.url ?? undefined}>
            <Badge tone={run.tone} dot pulse={run.tone === "ok" || run.busy}>
              {run.label}
            </Badge>
          </Fact>
          <Fact label="Git">
            <span className="text-fg-2">Not a git repository</span>
          </Fact>
        </dl>
      )}
    </Card>
  );
}

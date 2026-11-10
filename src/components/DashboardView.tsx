"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  CircleCheck,
  EyeOff,
  FileDiff,
  FolderGit2,
  GitCommitHorizontal,
  Info,
  ListTodo,
  RefreshCw,
  Server,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { ageShort, timeAgo } from "@/lib/format";
import { changedCount } from "@/lib/status";
import { Button, Count, EmptyState, PageBody, Panel, PropertyList, ReasonBadge, StatusIcon, TextButton, TitleBar } from "./ui";
import type { Counts, Ctx, Item, View } from "./model";
import { ReasonActions } from "./AttentionView";
import { Serving, useServer } from "./ServersView";

function GoTo({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-2 rounded px-2.5 text-[13px] font-medium text-brand-text hover:bg-brand-soft">
      <ArrowRight aria-hidden size={15} strokeWidth={2.25} />
      {label}
    </button>
  );
}

function ProjectLink({ name, onOpen }: { name: string; onOpen: (name: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(name)} className="min-w-0 truncate text-left font-medium text-brand-text hover:underline">
      {name}
    </button>
  );
}

function ServerLine({ item, ctx }: { item: Item; ctx: Ctx }) {
  const { dev } = useServer(item.project.name, ctx.actions.activity);
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <StatusIcon status={item.status} size={16} />
      <ProjectLink name={item.project.name} onOpen={ctx.actions.open} />
      <span className="ml-auto min-w-0 truncate text-right">
        <Serving dev={dev} ports={ctx.ports[item.project.name]} />
      </span>
    </li>
  );
}

function ResourceRow({ icon: Icon, label, count, tone, onClick }: { icon: LucideIcon; label: string; count: number; tone?: "ok" | "warn" | "info"; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-5 py-3 text-left text-[13.5px] hover:bg-hover">
        <Icon aria-hidden size={17} strokeWidth={2} className="shrink-0 text-fg-3" />
        <span className="flex-1 text-brand-text">{label}</span>
        <Count tone={count && tone ? tone : "neutral"}>{count}</Count>
      </button>
    </li>
  );
}

function CiSummary({ items, ctx }: { items: Item[]; ctx: Ctx }) {
  const entries = items.map((i) => ctx.overview?.entries[i.project.name]?.github).filter((g) => !!g);
  const tally = { pass: 0, fail: 0, running: 0, none: 0 };
  for (const g of entries) {
    if (g.ci === "SUCCESS") tally.pass++;
    else if (g.ci === "FAILURE" || g.ci === "ERROR") tally.fail++;
    else if (g.ci === "PENDING" || g.ci === "EXPECTED") tally.running++;
    else tally.none++;
  }
  const total = entries.length;
  const seg: { key: keyof typeof tally; label: string; color: string }[] = [
    { key: "fail", label: "Failing", color: "bg-bad-dot" },
    { key: "running", label: "In progress", color: "bg-warn-dot" },
    { key: "pass", label: "Passing", color: "bg-ok-dot" },
    { key: "none", label: "No checks", color: "bg-line-strong" },
  ];
  if (!ctx.overview) return <p className="text-[13px] text-fg-3">Asking GitHub…</p>;
  if (ctx.overview.githubError) return <p className="text-[13px] text-warn">Unavailable: {ctx.overview.githubError}</p>;
  if (total === 0) return <p className="text-[13px] text-fg-3">None of the visible projects are on GitHub.</p>;
  return (
    <div>
      <p className="text-[13px] text-fg-2">
        <span className="text-[26px] leading-none font-normal text-fg tabular-nums">{tally.pass}</span> of {total} GitHub repos passing
      </p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-hover" role="img" aria-label={seg.map((s) => `${tally[s.key]} ${s.label.toLowerCase()}`).join(", ")}>
        {seg.map((s) => (tally[s.key] ? <span key={s.key} className={s.color} style={{ width: `${(tally[s.key] / total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] text-fg-2">
        {seg.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span aria-hidden className={`size-2.5 rounded-sm ${s.color}`} />
            {s.label}
            <span className="ml-auto text-fg tabular-nums">{tally[s.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One masonry tile. */
function Tile({ children }: { children: ReactNode }) {
  return <div className="mb-6 break-inside-avoid">{children}</div>;
}

export default function DashboardView({ ctx, counts, visible, attention, servers }: { ctx: Ctx; counts: Counts; visible: Item[]; attention: Item[]; servers: Item[] }) {
  const { actions: a } = ctx;
  const go = (v: View) => () => a.go(v);
  const open = attention.filter((i) => !i.state.parked);
  const recent = visible
    .filter((i) => i.project.lastCommitDate)
    .sort((x, y) => Date.parse(y.project.lastCommitDate!) - Date.parse(x.project.lastCommitDate!))
    .slice(0, 6);
  const todos = visible.flatMap(({ project: p }) => (p.todos ?? []).filter((t) => !t.done).map((t) => ({ todo: t, project: p.name })));
  const filesChanged = visible.reduce((n, i) => n + changedCount(i.project), 0);
  const total = ctx.items.length;

  return (
    <>
      <TitleBar
        title="Dashboard"
        actions={
          <Button variant="ghost" icon={RefreshCw} spin={ctx.scanning} disabled={ctx.scanning} onClick={a.rescan}>
            Refresh
          </Button>
        }
      />
      <PageBody>
        <div className="columns-1 gap-6 lg:columns-2 xl:columns-3">
          <Tile>
            <Panel
              id="dash-attention"
              title="Needs attention"
              icon={TriangleAlert}
              count={open.length}
              countTone={open.length ? "warn" : undefined}
              bodyClassName=""
              footer={<GoTo label={`View all issues${attention.length > open.length ? ` (${attention.length - open.length} parked)` : ""}`} onClick={go("attention")} />}
            >
              {open.length === 0 ? (
                <EmptyState icon={CircleCheck} title="All clear">
                  No failing CI, conflicts, reviews or out-of-sync branches.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {open.slice(0, 5).map((item) => (
                    <li key={item.project.name} className="flex items-start gap-3 px-5 py-3.5">
                      <span className="pt-0.5">
                        <StatusIcon status={item.status} size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <ProjectLink name={item.project.name} onOpen={a.open} />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.state.reasons
                            .filter((r) => r.severity !== "note")
                            .map((r) => (
                              <ReasonBadge key={r.id} reason={r} />
                            ))}
                        </div>
                      </div>
                      <span className="flex shrink-0 gap-1">
                        <ReasonActions item={item} ctx={ctx} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </Tile>

          <Tile>
            <Panel
              id="dash-servers"
              title="Running"
              icon={Server}
              count={servers.length}
              countTone={servers.length ? "ok" : undefined}
              bodyClassName=""
              footer={<GoTo label="See everything running" onClick={go("servers")} />}
            >
              {servers.length === 0 ? (
                <EmptyState icon={Server} title="Nothing running">
                  Open a project and press Start.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {servers.map((item) => (
                    <ServerLine key={item.project.name} item={item} ctx={ctx} />
                  ))}
                </ul>
              )}
            </Panel>
          </Tile>

          <Tile>
            <Panel id="dash-resources" title="Resources" icon={FolderGit2} bodyClassName="">
              <ul className="divide-y divide-line">
                <ResourceRow icon={FolderGit2} label="Projects" count={counts.projects} onClick={go("projects")} />
                <ResourceRow icon={Server} label="Running projects" count={counts.servers} tone="ok" onClick={go("servers")} />
                <ResourceRow icon={TriangleAlert} label="Needing attention" count={counts.attention} tone="warn" onClick={go("attention")} />
                <ResourceRow icon={FileDiff} label="With uncommitted changes" count={counts.changes} onClick={go("projects")} />
                <ResourceRow icon={ListTodo} label="Open todos" count={counts.todos} tone="info" onClick={go("todos")} />
                <ResourceRow icon={EyeOff} label="Hidden" count={counts.hidden} onClick={go("hidden")} />
              </ul>
            </Panel>
          </Tile>

          <Tile>
            <Panel
              id="dash-activity"
              title="Recent activity"
              icon={GitCommitHorizontal}
              bodyClassName=""
              footer={<GoTo label="View activity" onClick={go("activity")} />}
            >
              {recent.length === 0 ? (
                <EmptyState icon={GitCommitHorizontal} title="No commits yet" />
              ) : (
                <ul className="divide-y divide-line">
                  {recent.map(({ project: p }) => (
                    <li key={p.name} className="px-5 py-3">
                      <div className="flex items-baseline gap-3">
                        <ProjectLink name={p.name} onOpen={a.open} />
                        <span className="ml-auto shrink-0 text-[12px] text-fg-3 tabular-nums" title={timeAgo(p.lastCommitDate!)}>
                          {ageShort(p.lastCommitDate!)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[12.5px] text-fg-2" title={p.lastCommitMessage}>
                        {p.lastCommitMessage}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </Tile>

          <Tile>
            <Panel id="dash-ci" title="CI status" icon={ShieldCheck} footer={<GoTo label="Go to Projects" onClick={go("projects")} />}>
              <CiSummary items={visible} ctx={ctx} />
            </Panel>
          </Tile>

          <Tile>
            <Panel
              id="dash-todos"
              title="Open todos"
              icon={ListTodo}
              count={todos.length}
              bodyClassName=""
              footer={<GoTo label="Go to Todos" onClick={go("todos")} />}
            >
              {todos.length === 0 ? (
                <EmptyState icon={ListTodo} title="No open todos">
                  Add them on a project&apos;s Details tab.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {todos.slice(0, 6).map(({ todo, project }) => (
                    <li key={todo.id} className="flex items-center gap-3 px-5 py-3">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => a.toggleTodo(project, todo.id)}
                        aria-label={`Mark "${todo.text}" done`}
                        className="size-4 shrink-0 accent-brand"
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{todo.text}</span>
                      <span className="shrink-0 text-[12px]">
                        <ProjectLink name={project} onOpen={a.open} />
                      </span>
                    </li>
                  ))}
                  {todos.length > 6 && (
                    <li className="px-5 py-2.5 text-[12.5px] text-fg-3">
                      <TextButton onClick={go("todos")}>{todos.length - 6} more</TextButton>
                    </li>
                  )}
                </ul>
              )}
            </Panel>
          </Tile>

          <Tile>
            <Panel id="dash-info" title="Workspace info" icon={Info} bodyClassName="" footer={<GoTo label="Refresh all projects" onClick={a.rescan} />}>
              <PropertyList
                rows={[
                  {
                    label: "Location",
                    value: (
                      <span className="flex flex-wrap items-center gap-x-3">
                        <span className="font-mono text-[12.5px]">{ctx.projectsDir}</span>
                        <TextButton onClick={go("folder")}>Change</TextButton>
                      </span>
                    ),
                  },
                  { label: "Projects", value: `${total} (${counts.projects} shown, ${counts.hidden} hidden)` },
                  { label: "Git repositories", value: ctx.items.filter((i) => i.project.isGitRepo).length },
                  { label: "Files changed", value: `${filesChanged} across ${counts.changes} projects` },
                  { label: "Last scan", value: ctx.scanning ? "Scanning…" : ctx.scannedAt ? timeAgo(ctx.scannedAt) : "—" },
                ]}
              />
            </Panel>
          </Tile>
        </div>
      </PageBody>
    </>
  );
}

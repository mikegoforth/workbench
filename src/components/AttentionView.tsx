"use client";

import { CircleCheck, ExternalLink, LoaderCircle, RefreshCw, ScrollText } from "lucide-react";
import { ageShort } from "@/lib/format";
import { Button, Card, CardHeader, CiBadge, EmptyState, LinkButton, PageBody, ReasonBadge, StatusIcon, TABLE, TD, TH, TitleBar, TR } from "./ui";
import type { Ctx, Item } from "./model";
import { rowOpener } from "./ProjectsView";

/** The fix for each reason that has one: Pull, Checks, Review. */
export function ReasonActions({ item, ctx }: { item: Item; ctx: Ctx }) {
  const { project: p, state } = item;
  const pulling = ctx.pending[p.name] === "pull";
  // One Logs button however many containers are failing.
  const logs = state.reasons.some((r) => r.action?.kind === "logs");
  return (
    <>
      {logs && (
        <Button size="sm" icon={ScrollText} onClick={() => ctx.actions.openTab(p.name, "logs")}>
          Logs
        </Button>
      )}
      {state.reasons.map((r) =>
        r.action?.kind === "pull" ? (
          <Button key={r.id} size="sm" icon={pulling ? LoaderCircle : undefined} spin={pulling} disabled={pulling} onClick={() => ctx.actions.pull(p.name)} title="git pull --ff-only">
            {pulling ? "Pulling" : "Pull"}
          </Button>
        ) : r.action?.kind === "link" ? (
          <LinkButton key={r.id} size="sm" icon={ExternalLink} href={r.action.href}>
            {r.action.label}
          </LinkButton>
        ) : null
      )}
    </>
  );
}

function IssueTable({ items, ctx, parked }: { items: Item[]; ctx: Ctx; parked: boolean }) {
  const { actions: a, overview } = ctx;
  return (
    <div className="relative overflow-x-auto">
      <table className={TABLE}>
        <thead>
          <tr>
            <th scope="col" className={`${TH} w-12 pl-4`}>
              <span className="sr-only">Severity</span>
            </th>
            <th scope="col" className={TH}>
              Project
            </th>
            <th scope="col" className={TH}>
              Issues
            </th>
            <th scope="col" className={`${TH} hidden md:table-cell`}>
              CI
            </th>
            <th scope="col" className={`${TH} hidden sm:table-cell`}>
              Updated
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const { project: p, state, status } = item;
            const issues = state.reasons.filter((r) => r.severity !== "note");
            return (
              <tr key={p.name} onClick={rowOpener(() => a.open(p.name))} className={TR}>
                <td className={`${TD} pl-4`}>
                  <StatusIcon status={status} />
                </td>
                <td className={TD}>
                  <button type="button" onClick={() => a.open(p.name)} className="text-left font-medium wrap-break-word text-brand-text hover:underline">
                    {p.name}
                  </button>
                  <span className="block font-mono text-[12px] text-fg-3">{p.branch}</span>
                </td>
                <td className={TD}>
                  <span className="flex flex-wrap gap-1">
                    {issues.map((r) => (
                      <ReasonBadge key={r.id} reason={r} />
                    ))}
                  </span>
                  {ctx.errors[p.name] && (
                    <span role="alert" className="mt-1 block text-[12px] font-medium text-bad">
                      {ctx.errors[p.name]}
                    </span>
                  )}
                </td>
                <td className={`${TD} hidden md:table-cell`}>
                  <CiBadge github={overview?.entries[p.name]?.github} loaded={!!overview} />
                </td>
                <td className={`${TD} hidden sm:table-cell text-fg-2 tabular-nums`}>{p.lastCommitDate ? ageShort(p.lastCommitDate) : "—"}</td>
                <td className={`${TD} text-right`}>
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    {!parked && <ReasonActions item={item} ctx={ctx} />}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ctx.pending[p.name] === "park"}
                      onClick={() => a.park(p.name, parked ? null : state.fingerprint)}
                      title={parked ? "Back to Needs attention" : "Acknowledge: hide these issues until something about them changes"}
                    >
                      {parked ? "Unpark" : "Park"}
                    </Button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AttentionView({ ctx, items }: { ctx: Ctx; items: Item[] }) {
  const open = items.filter((i) => !i.state.parked);
  const parked = items.filter((i) => i.state.parked);
  return (
    <>
      <TitleBar
        title="Needs attention"
        actions={
          <Button variant="ghost" icon={RefreshCw} spin={ctx.scanning} disabled={ctx.scanning} onClick={ctx.actions.rescan}>
            Refresh
          </Button>
        }
      />
      <PageBody className="space-y-4">
        <p className="text-[13.5px] text-fg-2">
          Failing containers, failing CI, merge conflicts, review requests, and branches behind or ahead of their remote. Park a
          project to acknowledge its issues; it comes back when they change.
        </p>
        {ctx.overview?.githubError && (
          <p className="rounded border border-warn-line bg-warn-soft px-4 py-2.5 text-[13.5px] text-warn">
            CI and review requests unavailable: {ctx.overview.githubError}
          </p>
        )}
        <Card>
          <CardHeader title="Open issues" count={open.length} countTone={open.length ? "warn" : undefined} />
          {open.length === 0 ? (
            <EmptyState icon={CircleCheck} title="All clear">
              Nothing needs you right now.
            </EmptyState>
          ) : (
            <IssueTable items={open} ctx={ctx} parked={false} />
          )}
        </Card>
        {parked.length > 0 && (
          <Card>
            <CardHeader title="Parked" count={parked.length} description="Acknowledged; back here when something about them changes." />
            <IssueTable items={parked} ctx={ctx} parked />
          </Card>
        )}
      </PageBody>
    </>
  );
}

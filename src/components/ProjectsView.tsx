"use client";

import { useState, type MouseEvent } from "react";
import {
  ArrowDown,
  CirclePause,
  CirclePlay,
  CodeXml,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  FolderGit2,
  RefreshCw,
  SquareTerminal,
  StickyNote,
} from "lucide-react";
import { ageShort } from "@/lib/format";
import { openInEditor, openInTerminal } from "@/lib/openInEditor";
import { repoHostLabel } from "@/lib/repoUrl";
import { changedCount } from "@/lib/status";
import {
  Button,
  Card,
  Chip,
  CiBadge,
  EmptyState,
  FilterBar,
  Menu,
  PageBody,
  ReasonBadge,
  SortTh,
  StatusIcon,
  SyncValue,
  TABLE,
  TD,
  TH,
  TitleBar,
  TR,
  type MenuItem,
} from "./ui";
import type { Ctx, Item } from "./model";
import { CHIPS, inList, matchesQuery, type ChipId, type Sort, type SortKey } from "./projectQuery";

/** Row actions shared by every table that lists projects. */
export function projectMenuItems(item: Item, ctx: Ctx, onError: (msg: string) => void): MenuItem[] {
  const { project: p, state } = item;
  const a = ctx.actions;
  const items: MenuItem[] = [
    { label: "Open in Terminal", icon: SquareTerminal, onSelect: () => openInTerminal(p.name).catch((e: Error) => onError(e.message)) },
  ];
  if (p.repoUrl) items.push({ label: `View on ${repoHostLabel(p.repoUrl)}`, icon: ExternalLink, href: p.repoUrl });
  if ((p.aheadBehind?.behind ?? 0) > 0) {
    items.push({ label: `Pull ${p.aheadBehind?.behind} commits`, icon: ArrowDown, onSelect: () => a.pull(p.name), disabled: ctx.pending[p.name] === "pull" });
  }
  if (state.fingerprint) {
    items.push(
      state.parked
        ? { label: "Unpark", icon: CirclePlay, onSelect: () => a.park(p.name, null) }
        : { label: "Park until it changes", icon: CirclePause, onSelect: () => a.park(p.name, state.fingerprint) }
    );
  }
  items.push(
    p.hidden
      ? { label: "Unhide", icon: Eye, onSelect: () => a.setHidden([p.name], false) }
      : { label: "Hide", icon: EyeOff, onSelect: () => a.setHidden([p.name], true) }
  );
  return items;
}

/** Click anywhere on a row that isn't a control to open the project. */
export const rowOpener = (open: () => void) => (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest("a, button, input, label, [role=menu]")) return;
  open();
};

export default function ProjectsView({
  ctx,
  hidden,
  rows,
  query,
  onQuery,
  chips,
  onChip,
  sort,
  onSort,
  focusName,
}: {
  ctx: Ctx;
  /** The Hidden projects page instead of Projects. */
  hidden: boolean;
  rows: Item[];
  query: string;
  onQuery: (q: string) => void;
  chips: Set<ChipId>;
  onChip: (id: ChipId) => void;
  sort: Sort;
  onSort: (key: SortKey) => void;
  focusName: string | null;
}) {
  const { actions: a, overview } = ctx;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const total = ctx.items.filter((i) => inList(i, hidden)).length;
  const base = ctx.items.filter((i) => inList(i, hidden) && matchesQuery(i, query));
  // Only rows still on screen count as selected.
  const chosen = rows.filter((r) => selected.has(r.project.name)).map((r) => r.project.name);
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const bulkHide = () => {
    a.setHidden(chosen, !hidden);
    setSelected(new Set());
  };

  const sortTh = (key: SortKey, label: string, className = "") => (
    <SortTh label={label} active={sort.key === key} dir={sort.dir} onSort={() => onSort(key)} className={className} />
  );

  return (
    <>
      <TitleBar
        title={hidden ? "Hidden projects" : "Projects"}
        actions={
          <>
            <Button variant="ghost" icon={RefreshCw} spin={ctx.scanning} disabled={ctx.scanning} onClick={a.rescan}>
              Refresh
            </Button>
            <Button variant="ghost" icon={hidden ? Eye : EyeOff} disabled={chosen.length === 0} onClick={bulkHide}>
              {hidden ? "Unhide" : "Hide"}
              {chosen.length > 0 && ` (${chosen.length})`}
            </Button>
          </>
        }
      />
      <PageBody>
        {hidden && (
          <p className="mb-4 text-[13.5px] text-fg-2">
            Hidden projects stay off the dashboard and the Projects list. They still show under Dev servers while they run.
          </p>
        )}
        {error && (
          <p role="alert" className="mb-4 rounded border border-bad-line bg-bad-soft px-4 py-2.5 text-[13.5px] text-bad">
            {error}
          </p>
        )}
        <Card>
          <FilterBar value={query} onChange={onQuery} placeholder="Filter by name, branch, status, commit or note">
            {CHIPS.map((c) => (
              <Chip key={c.id} active={chips.has(c.id)} onClick={() => onChip(c.id)} count={base.filter(c.test).length}>
                {c.label}
              </Chip>
            ))}
          </FilterBar>
          <div className="relative overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={`${TH} w-11 pr-0 pl-4`}>
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={allChosen}
                      ref={(el) => {
                        if (el) el.indeterminate = chosen.length > 0 && !allChosen;
                      }}
                      onChange={() => setSelected(allChosen ? new Set() : new Set(rows.map((r) => r.project.name)))}
                      className="size-4 accent-brand"
                    />
                  </th>
                  {sortTh("status", "Status", "w-20")}
                  {sortTh("name", "Name")}
                  <th scope="col" className={`${TH} hidden md:table-cell`}>
                    Branch
                  </th>
                  <th scope="col" className={`${TH} hidden sm:table-cell`}>
                    Sync
                  </th>
                  {sortTh("changes", "Changes")}
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>
                    CI
                  </th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>
                    Issues
                  </th>
                  <th scope="col" className={`${TH} hidden 2xl:table-cell`}>
                    Last commit
                  </th>
                  {sortTh("updated", "Updated")}
                  <th scope="col" className={`${TH} text-right`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="border-b border-line">
                      <EmptyState icon={FolderGit2} title={total === 0 ? (hidden ? "Nothing hidden" : "No projects") : "No projects match"}>
                        {total > 0 && "Change the filter or clear the chips."}
                      </EmptyState>
                    </td>
                  </tr>
                )}
                {rows.map((item) => {
                  const { project: p, state, status } = item;
                  const isSelected = selected.has(p.name);
                  const focused = p.name === focusName;
                  const changed = changedCount(p);
                  const issues = state.reasons.filter((r) => r.severity !== "note");
                  return (
                    <tr
                      key={p.name}
                      data-row={p.name}
                      onClick={rowOpener(() => a.open(p.name))}
                      className={`${TR} ${isSelected ? "bg-brand-soft hover:bg-brand-soft" : ""} ${focused ? "outline-2 -outline-offset-2 outline-brand" : ""}`}
                    >
                      <td className={`${TD} pr-0 pl-4`}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.name}`}
                          checked={isSelected}
                          onChange={() => toggle(p.name)}
                          className="size-4 accent-brand"
                        />
                      </td>
                      <td className={TD}>
                        <StatusIcon status={status} />
                      </td>
                      <td className={TD}>
                        <span className="flex items-center gap-2">
                          <button type="button" onClick={() => a.open(p.name)} className="text-left font-medium wrap-break-word text-brand-text hover:underline">
                            {p.name}
                          </button>
                          {p.notes?.trim() && <StickyNote aria-label="Has notes" size={13} className="shrink-0 text-fg-3" />}
                        </span>
                      </td>
                      <td className={`${TD} hidden md:table-cell`}>
                        <span className="block max-w-44 truncate font-mono text-[12.5px] text-fg-2" title={p.branch}>
                          {p.isGitRepo ? (p.branch ?? "detached") : <span className="font-sans text-fg-3">Not a repo</span>}
                        </span>
                      </td>
                      <td className={`${TD} hidden sm:table-cell`}>
                        {p.isGitRepo ? <SyncValue ahead={p.aheadBehind?.ahead ?? 0} behind={p.aheadBehind?.behind ?? 0} /> : <span className="text-fg-3">—</span>}
                      </td>
                      <td className={`${TD} tabular-nums ${changed ? "text-fg" : "text-fg-3"}`}>{changed}</td>
                      <td className={`${TD} hidden lg:table-cell`}>
                        <CiBadge github={overview?.entries[p.name]?.github} loaded={!!overview} />
                      </td>
                      <td className={`${TD} hidden lg:table-cell`}>
                        <span className="flex flex-wrap gap-1">
                          {issues.length === 0 ? <span className="text-fg-3">—</span> : issues.map((r) => <ReasonBadge key={r.id} reason={r} />)}
                          {state.parked && <span className="text-[12px] text-fg-3">parked</span>}
                        </span>
                      </td>
                      <td className={`${TD} hidden 2xl:table-cell`}>
                        <span className="block max-w-sm truncate text-fg-2" title={p.lastCommitMessage}>
                          {p.lastCommitMessage ?? "—"}
                        </span>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-fg-2 tabular-nums`} title={p.lastCommitDate ? new Date(p.lastCommitDate).toLocaleString() : undefined}>
                        {p.lastCommitDate ? ageShort(p.lastCommitDate) : "—"}
                      </td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        <span className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            icon={CodeXml}
                            onClick={() => openInEditor(p.name).catch((e: Error) => setError(e.message))}
                            title="Open in VS Code"
                            className="max-sm:hidden"
                          >
                            VS Code
                          </Button>
                          <Menu label={`Actions for ${p.name}`} icon={EllipsisVertical} items={projectMenuItems(item, ctx, setError)} />
                        </span>
                        {ctx.errors[p.name] && (
                          <span role="alert" className="mt-1 block text-[12px] font-medium whitespace-normal text-bad">
                            {ctx.errors[p.name]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-4 px-4 py-2.5 text-[12.5px] text-fg-2">
            {chosen.length > 0 && <span className="mr-auto">{chosen.length} selected</span>}
            <span className="tabular-nums">
              {rows.length === 0 ? 0 : 1} – {rows.length} of {rows.length}
              {rows.length !== total && <span className="text-fg-3"> · filtered from {total}</span>}
            </span>
          </div>
        </Card>
      </PageBody>
    </>
  );
}

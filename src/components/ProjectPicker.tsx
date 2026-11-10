"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, EyeOff, LayoutDashboard, Search, X } from "lucide-react";
import { ageShort } from "@/lib/format";
import { Kbd, StatusIcon } from "./ui";
import { VIEW_TITLE, VIEWS, type Item, type View } from "./model";

type Row = { kind: "page"; view: View } | { kind: "project"; item: Item };

const matches = (q: string, ...fields: (string | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(q));

/**
 * The "Select a project" dialog, which is also the search box: projects (and
 * pages) matching the query, arrow keys to move, Enter to open.
 */
export default function ProjectPicker({
  title,
  items,
  currentProject,
  onOpenProject,
  onGo,
  onClose,
}: {
  title: string;
  items: Item[];
  currentProject: string | null;
  onOpenProject: (name: string) => void;
  onGo: (view: View) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const pages: Row[] = q ? VIEWS.filter((v) => matches(q, VIEW_TITLE[v])).map((view) => ({ kind: "page", view })) : [];
    const projects = items
      .filter(({ project: p }) => !q || matches(q, p.name, p.branch, p.notes, p.lastCommitMessage))
      .sort((a, b) => {
        // Name matches first, then visible before hidden, then most recent.
        if (q) {
          const an = a.project.name.toLowerCase().includes(q) ? 0 : 1;
          const bn = b.project.name.toLowerCase().includes(q) ? 0 : 1;
          if (an !== bn) return an - bn;
        }
        if (!!a.project.hidden !== !!b.project.hidden) return a.project.hidden ? 1 : -1;
        const t = (i: Item) => (i.project.lastCommitDate ? Date.parse(i.project.lastCommitDate) : 0);
        return t(b) - t(a);
      })
      .map<Row>((item) => ({ kind: "project", item }));
    return [...pages, ...projects];
  }, [items, query]);

  const index = Math.min(active, Math.max(0, rows.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    if (row.kind === "page") onGo(row.view);
    else onOpenProject(row.item.project.name);
  };

  const firstProject = rows.findIndex((r) => r.kind === "project");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[76vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-surface shadow-pop">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="text-[18px] font-normal text-fg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-fg-2 hover:bg-hover">
            <X aria-hidden size={18} />
          </button>
        </div>
        <div className="px-5 pb-3">
          <label className="flex h-10 items-center gap-2.5 rounded border border-line px-3 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
            <Search aria-hidden size={17} strokeWidth={2} className="shrink-0 text-fg-2" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  setActive(Math.min(rows.length - 1, Math.max(0, index + step)));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  choose(rows[index]);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
              placeholder="Search projects, branches, notes and pages"
              aria-label="Search projects"
              role="combobox"
              aria-expanded="true"
              aria-controls="picker-list"
              aria-activedescendant={rows.length ? `picker-row-${index}` : undefined}
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-fg focus:outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,9rem)_4rem] gap-3 border-y border-line bg-subtle px-5 py-2 text-[12px] font-medium text-fg-2 max-sm:hidden">
          <span>Name</span>
          <span>Status</span>
          <span>Branch</span>
          <span className="text-right">Updated</span>
        </div>
        <div ref={listRef} id="picker-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto py-1">
          {rows.length === 0 && <p className="px-5 py-6 text-center text-[13.5px] text-fg-3">No projects or pages match “{query}”.</p>}
          {rows.map((row, i) => {
            const selected = i === index;
            const base = `grid cursor-pointer items-center gap-3 px-5 text-[13.5px] ${selected ? "bg-brand-soft" : "hover:bg-hover"}`;
            if (row.kind === "page") {
              return (
                <div
                  key={`page-${row.view}`}
                  id={`picker-row-${i}`}
                  data-row={i}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(row)}
                  className={`${base} h-10 grid-cols-[minmax(0,1fr)_auto]`}
                >
                  <span className="flex items-center gap-3 text-fg">
                    <LayoutDashboard aria-hidden size={16} className="text-fg-2" />
                    {VIEW_TITLE[row.view]}
                    <span className="text-[12px] text-fg-3">Page</span>
                  </span>
                  {selected && <CornerDownLeft aria-hidden size={14} className="text-fg-3" />}
                </div>
              );
            }
            const { project: p, status } = row.item;
            return (
              <div key={p.name}>
                {i === firstProject && firstProject > 0 && <div className="mx-5 my-1 border-t border-line" />}
                <div
                  id={`picker-row-${i}`}
                  data-row={i}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(row)}
                  className={`${base} h-11 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,9rem)_4rem]`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-brand-text">{p.name}</span>
                    {p.name === currentProject && <span className="shrink-0 text-[12px] text-fg-3">Current</span>}
                    {p.hidden && <EyeOff aria-label="Hidden" size={13} className="shrink-0 text-fg-3" />}
                  </span>
                  <span className="max-sm:hidden">
                    <StatusIcon status={status} label size={16} />
                  </span>
                  <span className="truncate font-mono text-[12.5px] text-fg-2 max-sm:hidden">{p.isGitRepo ? (p.branch ?? "detached") : "—"}</span>
                  <span className="text-right text-[12.5px] text-fg-3 tabular-nums">{p.lastCommitDate ? ageShort(p.lastCommitDate) : "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-2.5 text-[12px] text-fg-3">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↵</Kbd> open
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>esc</Kbd> close
          </span>
          <span className="ml-auto">{rows.filter((r) => r.kind === "project").length} projects</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { changedCount } from "@/lib/status";
import { Card, EmptyState, FilterBar, PageBody, TABLE, TD, TH, TitleBar, TR } from "./ui";
import type { Ctx, Item } from "./model";
import { matchesQuery } from "./projectQuery";
import { rowOpener } from "./ProjectsView";

/** The latest commit in every visible project, newest first. */
export default function ActivityView({ ctx, items }: { ctx: Ctx; items: Item[] }) {
  const [query, setQuery] = useState("");
  const rows = items
    .filter((i) => i.project.lastCommitDate && matchesQuery(i, query))
    .sort((a, b) => Date.parse(b.project.lastCommitDate!) - Date.parse(a.project.lastCommitDate!));

  return (
    <>
      <TitleBar title="Activity" />
      <PageBody>
        <p className="mb-4 text-[13.5px] text-fg-2">The most recent commit in each project, newest first. Hidden projects are left out.</p>
        <Card>
          <FilterBar value={query} onChange={setQuery} placeholder="Filter by project, branch or commit message" />
          <div className="relative overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={`${TH} pl-4`}>
                    When
                  </th>
                  <th scope="col" className={TH}>
                    Project
                  </th>
                  <th scope="col" className={TH}>
                    Commit
                  </th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>
                    Author
                  </th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>
                    Branch
                  </th>
                  <th scope="col" className={`${TH} hidden sm:table-cell text-right`}>
                    Uncommitted
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="border-b border-line">
                      <EmptyState icon={GitCommitHorizontal} title="No commits" />
                    </td>
                  </tr>
                )}
                {rows.map(({ project: p }) => (
                  <tr key={p.name} onClick={rowOpener(() => ctx.actions.open(p.name))} className={TR}>
                    <td className={`${TD} pl-4 whitespace-nowrap text-fg-2`} title={new Date(p.lastCommitDate!).toLocaleString()}>
                      {timeAgo(p.lastCommitDate!)}
                    </td>
                    <td className={TD}>
                      <button type="button" onClick={() => ctx.actions.open(p.name)} className="text-left font-medium wrap-break-word text-brand-text hover:underline">
                        {p.name}
                      </button>
                    </td>
                    <td className={TD}>
                      <span className="line-clamp-2 text-fg" title={p.lastCommitMessage}>
                        {p.lastCommitMessage}
                      </span>
                    </td>
                    <td className={`${TD} hidden lg:table-cell whitespace-nowrap text-fg-2`}>{p.lastCommitAuthor ?? "—"}</td>
                    <td className={`${TD} hidden md:table-cell`}>
                      <span className="block max-w-44 truncate font-mono text-[12.5px] text-fg-2">{p.branch}</span>
                    </td>
                    <td className={`${TD} hidden sm:table-cell text-right tabular-nums ${changedCount(p) ? "text-fg" : "text-fg-3"}`}>{changedCount(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}

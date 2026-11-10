"use client";

import { useState } from "react";
import { ListTodo } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { TodoItem } from "@/lib/types";
import { Card, Chip, EmptyState, FilterBar, PageBody, TABLE, TD, TH, TitleBar, TR } from "./ui";
import type { Ctx, Item } from "./model";
import { rowOpener } from "./ProjectsView";

/** Every todo across visible projects; tick them off here or on the project. */
export default function TodosView({ ctx, items }: { ctx: Ctx; items: Item[] }) {
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const q = query.trim().toLowerCase();

  const all = items.flatMap(({ project: p }) => (p.todos ?? []).map((todo) => ({ todo, project: p.name })));
  const doneCount = all.filter((r) => r.todo.done).length;
  const rows = all
    .filter((r) => (showDone || !r.todo.done) && (!q || r.todo.text.toLowerCase().includes(q) || r.project.toLowerCase().includes(q)))
    .sort((a, b) => Number(a.todo.done) - Number(b.todo.done) || Date.parse(b.todo.createdAt) - Date.parse(a.todo.createdAt));

  return (
    <>
      <TitleBar title="Todos" />
      <PageBody>
        <p className="mb-4 text-[13.5px] text-fg-2">Todos from every project. Add new ones on a project&apos;s Details tab.</p>
        <Card>
          <FilterBar value={query} onChange={setQuery} placeholder="Filter by todo or project">
            <Chip active={showDone} onClick={() => setShowDone((v) => !v)} count={doneCount}>
              Show completed
            </Chip>
          </FilterBar>
          <div className="relative overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={`${TH} w-11 pl-4`}>
                    <span className="sr-only">Done</span>
                  </th>
                  <th scope="col" className={TH}>
                    Todo
                  </th>
                  <th scope="col" className={TH}>
                    Project
                  </th>
                  <th scope="col" className={`${TH} hidden sm:table-cell`}>
                    Added
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="border-b border-line">
                      <EmptyState icon={ListTodo} title={all.length === 0 ? "No todos yet" : "Nothing to do"}>
                        {all.length === 0 ? "Open a project and add todos on its Details tab." : "Every todo here is done."}
                      </EmptyState>
                    </td>
                  </tr>
                )}
                {rows.map(({ todo, project }: { todo: TodoItem; project: string }) => (
                  <tr key={todo.id} onClick={rowOpener(() => ctx.actions.open(project))} className={TR}>
                    <td className={`${TD} pl-4`}>
                      <input
                        type="checkbox"
                        checked={todo.done}
                        onChange={() => ctx.actions.toggleTodo(project, todo.id)}
                        aria-label={`Mark "${todo.text}" ${todo.done ? "open" : "done"}`}
                        className="size-4 accent-brand"
                      />
                    </td>
                    <td className={`${TD} ${todo.done ? "text-fg-3 line-through" : "text-fg"}`}>{todo.text}</td>
                    <td className={TD}>
                      <button type="button" onClick={() => ctx.actions.open(project)} className="text-left font-medium wrap-break-word text-brand-text hover:underline">
                        {project}
                      </button>
                    </td>
                    <td className={`${TD} hidden sm:table-cell whitespace-nowrap text-fg-2`}>{timeAgo(todo.createdAt)}</td>
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

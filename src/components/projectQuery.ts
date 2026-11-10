import type { SortDir } from "./ui";
import type { Item } from "./model";
import { changedCount, openTodoCount } from "@/lib/status";

export type ChipId = "changes" | "todos" | "behind" | "unpushed" | "failing";
export type SortKey = "status" | "name" | "changes" | "updated";
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

export const CHIPS: { id: ChipId; label: string; test: (i: Item) => boolean }[] = [
  { id: "changes", label: "Uncommitted changes", test: (i) => changedCount(i.project) > 0 },
  { id: "behind", label: "Behind remote", test: (i) => (i.project.aheadBehind?.behind ?? 0) > 0 },
  { id: "unpushed", label: "Unpushed", test: (i) => (i.project.aheadBehind?.ahead ?? 0) > 0 },
  { id: "failing", label: "Failing", test: (i) => i.state.reasons.some((r) => r.severity === "nogo") },
  { id: "todos", label: "Open todos", test: (i) => openTodoCount(i.project) > 0 },
];

/** Projects page lists what's not hidden; the Hidden page lists the rest. */
export const inList = (i: Item, hidden: boolean) => !!i.project.hidden === hidden;

export function matchesQuery(i: Item, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const p = i.project;
  return [p.name, p.branch, p.lastCommitMessage, p.notes, i.status.label].some((s) => s?.toLowerCase().includes(q));
}

const time = (i: Item) => (i.project.lastCommitDate ? Date.parse(i.project.lastCommitDate) : 0);

export function compareItems(a: Item, b: Item, sort: Sort): number {
  const sign = sort.dir === "asc" ? 1 : -1;
  let d = 0;
  switch (sort.key) {
    case "status":
      d = a.status.rank - b.status.rank;
      break;
    case "name":
      d = a.project.name.localeCompare(b.project.name);
      break;
    case "changes":
      d = changedCount(a.project) - changedCount(b.project);
      break;
    case "updated":
      d = time(a) - time(b);
      break;
  }
  if (d !== 0) return d * sign;
  // Ties: most recently committed first.
  return time(b) - time(a);
}

export function queryRows(items: Item[], hidden: boolean, query: string, chips: Set<ChipId>, sort: Sort): Item[] {
  const tests = CHIPS.filter((c) => chips.has(c.id));
  return items
    .filter((i) => inList(i, hidden) && matchesQuery(i, query) && tests.every((c) => c.test(i)))
    .sort((a, b) => compareItems(a, b, sort));
}

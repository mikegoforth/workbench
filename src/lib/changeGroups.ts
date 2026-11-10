import type { ChangedFile } from "./types";

export type ChangeGroupId = "conflict" | "staged" | "modified" | "untracked" | "deleted" | "renamed";

export interface ChangeGroup {
  id: ChangeGroupId;
  label: string;
  files: ChangedFile[];
}

/** Display order: what blocks you first, then what's ready to commit, then the rest. */
export const CHANGE_GROUPS: { id: ChangeGroupId; label: string }[] = [
  { id: "conflict", label: "Conflicts" },
  { id: "staged", label: "Staged" },
  { id: "modified", label: "Modified" },
  { id: "untracked", label: "Untracked" },
  { id: "deleted", label: "Deleted" },
  { id: "renamed", label: "Renamed" },
];

/** Unmerged paths, as `git status` reports them (same rule as the attention check). */
export const isConflict = ({ index: x, workingDir: y }: ChangedFile) =>
  x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");

/** Which one group a file belongs in, from git's two-column (index, working tree) code. */
export function changeGroupOf(file: ChangedFile): ChangeGroupId {
  const { index: x, workingDir: y } = file;
  if (isConflict(file)) return "conflict";
  if (x === "?") return "untracked";
  if (x === "R" || x === "C" || y === "R" || y === "C") return "renamed";
  if (x === "D" || y === "D") return "deleted";
  if (x !== " " && x !== "!") return "staged";
  return "modified";
}

/** The non-empty groups, in display order; files keep their order within a group. */
export function groupChanges(files: ChangedFile[]): ChangeGroup[] {
  const byId = new Map<ChangeGroupId, ChangedFile[]>();
  for (const file of files) {
    const id = changeGroupOf(file);
    const list = byId.get(id);
    if (list) list.push(file);
    else byId.set(id, [file]);
  }
  return CHANGE_GROUPS.flatMap(({ id, label }) => {
    const list = byId.get(id);
    return list ? [{ id, label, files: list }] : [];
  });
}

/** Case-insensitive path match, on the new or (for renames) the old path. */
export function matchesPath(file: ChangedFile, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return file.path.toLowerCase().includes(q) || (file.from?.toLowerCase().includes(q) ?? false);
}

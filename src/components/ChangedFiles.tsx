"use client";

import { Fragment, useMemo, useState } from "react";
import { CircleCheck } from "lucide-react";
import { groupChanges, isConflict, matchesPath, type ChangeGroup, type ChangeGroupId } from "@/lib/changeGroups";
import { openInEditor } from "@/lib/openInEditor";
import type { ChangedFile } from "@/lib/types";
import { Chip, Count, EmptyState, FilterBar, Panel, ShowAll, TextButton } from "./ui";

/** Above this many files the full list gets a path filter. */
const FILTER_FROM = 15;

/** Folder muted, filename in full ink; lines break only after a slash. */
function PathText({ path }: { path: string }) {
  const cut = path.lastIndexOf("/", path.endsWith("/") ? path.length - 2 : path.length);
  const folders = cut >= 0 ? path.slice(0, cut).split("/") : [];
  return (
    <>
      {folders.length > 0 && (
        <span className="text-fg-3">
          {folders.map((folder, i) => (
            <Fragment key={i}>
              {folder}/<wbr />
            </Fragment>
          ))}
        </span>
      )}
      <span className="text-fg">{path.slice(cut + 1)}</span>
    </>
  );
}

interface Kind {
  letter: string;
  label: string;
  badge: string;
}

/** Turn git's two-column status (index, working tree) into one readable kind. */
function kindOf(file: ChangedFile): Kind {
  const { index: x, workingDir: y } = file;
  if (x === "?") return { letter: "U", label: "Untracked", badge: "bg-subtle text-fg-2 ring-line" };
  if (isConflict(file)) {
    return { letter: "!", label: "Merge conflict", badge: "bg-bad-soft text-bad ring-bad-line" };
  }
  switch (x !== " " ? x : y) {
    case "A":
      return { letter: "A", label: "Added", badge: "bg-ok-soft text-ok ring-ok-line" };
    case "D":
      return { letter: "D", label: "Deleted", badge: "bg-bad-soft text-bad ring-bad-line" };
    case "R":
      return { letter: "R", label: "Renamed", badge: "bg-brand-soft text-brand-text ring-brand-line" };
    case "C":
      return { letter: "C", label: "Copied", badge: "bg-brand-soft text-brand-text ring-brand-line" };
    default:
      return { letter: "M", label: "Modified", badge: "bg-warn-soft text-warn ring-warn-line" };
  }
}

/** One file: its kind, its path, whether it's staged; opens in VS Code when it can. */
function FileRow({ file, group, onOpen }: { file: ChangedFile; group?: ChangeGroupId; onOpen: (path: string) => void }) {
  const kind = kindOf(file);
  const staged = file.index !== " " && file.index !== "?";
  const partlyStaged = staged && file.workingDir !== " ";
  // Under "Staged" only a partly staged file needs saying so.
  const note = partlyStaged ? "partly staged" : staged && group !== "staged" ? "staged" : null;
  // Deleted files and untracked folders ("dir/") can't be opened.
  const openable = kind.letter !== "D" && file.workingDir !== "D" && !file.path.endsWith("/");
  const content = (
    <>
      <span
        title={kind.label}
        className={`grid size-5 shrink-0 place-items-center rounded font-mono text-[10.5px] font-semibold ring-1 ring-inset ${kind.badge}`}
      >
        {kind.letter}
      </span>
      <span className="min-w-0 flex-1 font-mono text-[12.5px] wrap-break-word">
        {file.from && (
          <span className="text-fg-3">
            <PathText path={file.from} /> →{" "}
          </span>
        )}
        <PathText path={file.path} />
      </span>
      {note && <span className="shrink-0 text-[11.5px] text-fg-3">{note}</span>}
    </>
  );
  return (
    <li>
      {openable ? (
        <button
          type="button"
          onClick={() => onOpen(file.path)}
          title={`${kind.label}. Open in VS Code`}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-2.5 px-2 py-1.5" title={kind.label}>
          {content}
        </div>
      )}
    </li>
  );
}

const fileKey = (file: ChangedFile) => `${file.from ?? ""}\u0000${file.path}`;

export default function ChangedFiles({
  projectName,
  files,
  truncated = 0,
  limit = 8,
  onViewAll,
  className = "",
}: {
  projectName: string;
  files: ChangedFile[];
  truncated?: number;
  /** Files shown per status group (or in the preview) before "Show all". */
  limit?: number;
  /** When set, the panel previews `limit` files and links here instead of expanding. */
  onViewAll?: () => void;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<Set<ChangeGroupId>>(new Set());
  const [expanded, setExpanded] = useState<Set<ChangeGroupId>>(new Set());
  const groups = useMemo(() => groupChanges(files), [files]);
  const total = files.length + truncated;
  const preview = !!onViewAll;

  const open = async (file: string) => {
    setError(null);
    try {
      await openInEditor(projectName, file);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = (set: (fn: (prev: Set<ChangeGroupId>) => Set<ChangeGroupId>) => void, id: ChangeGroupId) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The preview stays a short flat list, in group order so conflicts lead.
  if (preview) {
    const shown = groups.flatMap((g) => g.files).slice(0, limit);
    return (
      <Panel
        id="changes-heading"
        title="Changed files"
        count={total}
        className={className}
        bodyClassName="p-2"
        actions={total > limit ? <TextButton onClick={onViewAll}>View all</TextButton> : undefined}
      >
        {files.length === 0 ? (
          <EmptyState icon={CircleCheck} title="Working tree is clean" />
        ) : (
          <ul>
            {shown.map((file) => (
              <FileRow key={fileKey(file)} file={file} onOpen={open} />
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="px-2 pt-2 text-[13px] font-medium text-bad">
            {error}
          </p>
        )}
      </Panel>
    );
  }

  const filtering = files.length > FILTER_FROM;
  const visible: ChangeGroup[] = groups
    .filter((g) => only.size === 0 || only.has(g.id))
    .map((g) => ({ ...g, files: query.trim() ? g.files.filter((f) => matchesPath(f, query)) : g.files }))
    .filter((g) => g.files.length > 0);

  return (
    <Panel
      id="changes-heading"
      title="Changed files"
      count={total}
      // Up front, so the group counts below (of the files listed) aren't read as the total.
      description={truncated > 0 ? `Showing the first ${files.length} of ${total}` : undefined}
      className={className}
      bodyClassName=""
    >
      {files.length === 0 ? (
        <EmptyState icon={CircleCheck} title="Working tree is clean" />
      ) : (
        <>
          {filtering && (
            <FilterBar value={query} onChange={setQuery} placeholder="Filter by path">
              {groups.length > 1 &&
                groups.map((g) => (
                  <Chip key={g.id} active={only.has(g.id)} onClick={() => toggle(setOnly, g.id)} count={g.files.length}>
                    {g.label}
                  </Chip>
                ))}
            </FilterBar>
          )}
          {visible.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-fg-3">No files match the filter.</p>
          ) : (
            <div className="divide-y divide-line">
              {visible.map((g) => {
                const isExpanded = expanded.has(g.id);
                const headingId = `changes-group-${g.id}`;
                return (
                  <section key={g.id} aria-labelledby={headingId}>
                    <h3
                      id={headingId}
                      className="flex items-center gap-2 border-b border-line bg-subtle px-5 py-2.5 text-[11.5px] font-medium tracking-[0.06em] text-fg-3 uppercase"
                    >
                      {g.label}
                      <Count tone={g.id === "conflict" ? "bad" : "neutral"}>{g.files.length}</Count>
                    </h3>
                    <ul className="p-2">
                      {(isExpanded ? g.files : g.files.slice(0, limit)).map((file) => (
                        <FileRow key={fileKey(file)} file={file} group={g.id} onOpen={open} />
                      ))}
                    </ul>
                    {g.files.length > limit && (
                      <div className="px-4 pb-3">
                        <ShowAll total={g.files.length} limit={limit} expanded={isExpanded} onToggle={() => toggle(setExpanded, g.id)} />
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
      {truncated > 0 && (
        <p className="border-t border-line px-5 py-3 text-[12px] text-fg-3">
          Showing the first {files.length}; {truncated} more not listed.
        </p>
      )}
      {error && (
        <p role="alert" className="px-5 pb-3 text-[13px] font-medium text-bad">
          {error}
        </p>
      )}
    </Panel>
  );
}

"use client";

import { Fragment, useState } from "react";
import { CircleCheck } from "lucide-react";
import { openInEditor } from "@/lib/openInEditor";
import type { ChangedFile } from "@/lib/types";
import { EmptyState, Panel, ShowAll, TextButton } from "./ui";

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
function kindOf({ index: x, workingDir: y }: ChangedFile): Kind {
  if (x === "?") return { letter: "U", label: "Untracked", badge: "bg-subtle text-fg-2 ring-line" };
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
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
  limit?: number;
  /** When set, the panel previews `limit` files and links here instead of expanding. */
  onViewAll?: () => void;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? files : files.slice(0, limit);
  const total = files.length + truncated;

  const open = async (file: string) => {
    setError(null);
    try {
      await openInEditor(projectName, file);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Panel
      id="changes-heading"
      title="Changed files"
      count={total}
      className={className}
      bodyClassName="p-2"
      actions={onViewAll && total > limit ? <TextButton onClick={onViewAll}>View all</TextButton> : undefined}
    >
      {files.length === 0 ? (
        <EmptyState icon={CircleCheck} title="Working tree is clean" />
      ) : (
        <ul>
          {shown.map((file) => {
            const kind = kindOf(file);
            const staged = file.index !== " " && file.index !== "?";
            const partlyStaged = staged && file.workingDir !== " ";
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
                {staged && <span className="shrink-0 text-[11.5px] text-fg-3">{partlyStaged ? "partly staged" : "staged"}</span>}
              </>
            );
            return (
              <li key={`${file.from ?? ""}${file.path}`}>
                {openable ? (
                  <button
                    type="button"
                    onClick={() => open(file.path)}
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
          })}
        </ul>
      )}
      {(!onViewAll || expanded) && (
        <div className="px-2">
          <ShowAll total={files.length} limit={limit} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        </div>
      )}
      {truncated > 0 && !onViewAll && (expanded || files.length <= limit) && (
        <p className="px-2 pt-2 text-[12px] text-fg-3">
          Showing the first {files.length}; {truncated} more not listed.
        </p>
      )}
      {error && (
        <p role="alert" className="px-2 pt-2 text-[13px] font-medium text-bad">
          {error}
        </p>
      )}
    </Panel>
  );
}

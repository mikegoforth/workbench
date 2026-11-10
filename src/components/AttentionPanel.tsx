"use client";

import type { ReactNode } from "react";
import { Check, CircleCheck, CircleX, ExternalLink, Info, LoaderCircle, ScrollText, TriangleAlert } from "lucide-react";
import type { StripState } from "@/lib/attention";
import { plural } from "@/lib/format";
import { openInEditor } from "@/lib/openInEditor";
import type { ProjectInfo, SetupCheck } from "@/lib/types";
import type { DevControls } from "./DevEnvironment";
import { Button, LinkButton, Panel } from "./ui";
import { useAppLabels } from "./usePreferences";

function Row({
  severity,
  title,
  detail,
  action,
}: {
  severity: "nogo" | "hold" | "info";
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  const Icon = severity === "nogo" ? CircleX : severity === "hold" ? TriangleAlert : Info;
  const tone = severity === "nogo" ? "text-bad" : severity === "hold" ? "text-warn" : "text-fg-3";
  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <Icon aria-hidden size={16} strokeWidth={2.25} className={`mt-px shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-fg">{title}</p>
        {detail && <p className="mt-0.5 text-[12.5px] wrap-break-word text-fg-3">{detail}</p>}
      </div>
      {action}
    </li>
  );
}

/**
 * Needs attention: no-go and hold reasons plus failing setup checks, each with its fix.
 * Uncommitted work is shown too, as a quiet info row: it never counts as needing you
 * (see stripState), but it isn't "all clear" either.
 */
export default function AttentionPanel({
  project,
  state,
  dev,
  pullPending,
  onPull,
  onLogs,
  onChanges,
  className = "",
}: {
  project: ProjectInfo;
  state: StripState;
  dev: DevControls;
  pullPending: boolean;
  onPull: () => void;
  /** Open the project's container logs. */
  onLogs?: () => void;
  /** Open the project's changed files. */
  onChanges?: () => void;
  className?: string;
}) {
  const { editor } = useAppLabels();
  const reasons = state.reasons.filter((r) => r.severity !== "note");
  const checks = dev.status?.checks ?? [];
  const problems = checks.filter((c) => c.level !== "ok");
  const passing = checks.filter((c) => c.level === "ok");
  const count = reasons.length + problems.filter((c) => c.level === "warn").length;
  const worst = reasons.some((r) => r.severity === "nogo") ? "bad" : count ? "warn" : undefined;
  const modified = project.uncommittedChanges ?? 0;
  const untracked = project.untrackedFiles ?? 0;
  const uncommitted = modified + untracked;
  const blocking = reasons.length > 0 || problems.some((c) => c.level === "warn");
  const hasRows = reasons.length > 0 || problems.length > 0 || uncommitted > 0;

  const fixFor = (check: SetupCheck) => {
    const action = check.action;
    if (!action) return null;
    if (action.kind === "install") {
      return (
        <Button
          size="sm"
          icon={dev.pending === "install" ? LoaderCircle : undefined}
          spin={dev.pending === "install"}
          disabled={!dev.canStart && dev.pending !== null}
          onClick={() => dev.act("install")}
        >
          {action.label}
        </Button>
      );
    }
    return (
      <Button size="sm" title={`Open in ${editor}`} onClick={() => openInEditor(project.name, action.file, editor).catch((e: Error) => dev.setActionError(e.message))}>
        {action.label}
      </Button>
    );
  };

  return (
    <Panel
      id="attention-heading"
      title="Needs attention"
      count={count || undefined}
      countTone={worst}
      className={className}
      bodyClassName=""
    >
      {!blocking && (
        <p className={`flex items-center gap-2.5 px-5 py-3.5 text-[13.5px] text-fg-2 ${hasRows ? "border-b border-line" : ""}`}>
          <CircleCheck aria-hidden size={16} strokeWidth={2.25} className="text-ok" />
          {hasRows ? "Nothing blocking" : "All clear"}
          {state.parked ? " (parked)" : ""}.
        </p>
      )}
      {hasRows && (
        <ul className="divide-y divide-line">
          {reasons.map((r) => (
            <Row
              key={r.id}
              severity={r.severity === "nogo" ? "nogo" : "hold"}
              title={r.label}
              detail={
                r.id === "ahead"
                  ? "Push from a terminal when it's ready."
                  : r.id === "behind"
                    ? "Pull only fast-forwards; it never merges."
                    : r.action?.kind === "logs"
                      ? "A container is failing its health check, restarting in a loop, or exited with an error."
                      : undefined
              }
              action={
                r.action?.kind === "pull" ? (
                  <Button
                    size="sm"
                    icon={pullPending ? LoaderCircle : undefined}
                    spin={pullPending}
                    disabled={pullPending}
                    onClick={onPull}
                    title="git pull --ff-only"
                  >
                    {pullPending ? "Pulling" : "Pull"}
                  </Button>
                ) : r.action?.kind === "link" ? (
                  <LinkButton size="sm" icon={ExternalLink} href={r.action.href}>
                    {r.action.label}
                  </LinkButton>
                ) : r.action?.kind === "logs" && onLogs ? (
                  <Button size="sm" icon={ScrollText} onClick={onLogs}>
                    Logs
                  </Button>
                ) : undefined
              }
            />
          ))}
          {problems
            .filter((c) => c.level === "warn")
            .map((c) => (
              <Row key={c.id} severity="hold" title={c.title} detail={c.detail} action={fixFor(c)} />
            ))}
          {uncommitted > 0 && (
            <Row
              severity="info"
              title={plural(uncommitted, "uncommitted file")}
              detail={[modified && `${modified} modified`, untracked && `${untracked} untracked`].filter(Boolean).join(", ")}
              action={
                onChanges ? (
                  <Button size="sm" onClick={onChanges} aria-label={`View ${plural(uncommitted, "uncommitted file")}`}>
                    View
                  </Button>
                ) : undefined
              }
            />
          )}
          {problems
            .filter((c) => c.level !== "warn")
            .map((c) => (
              <Row key={c.id} severity="info" title={c.title} detail={c.detail} action={fixFor(c)} />
            ))}
        </ul>
      )}
      {passing.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-[12px] text-fg-3">
          {passing.map((c) => (
            <li key={c.id} className="inline-flex items-center gap-1">
              <Check aria-hidden size={12} strokeWidth={2.5} className="text-ok" />
              {c.title}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

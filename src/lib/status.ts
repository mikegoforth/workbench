import type { Severity, StripState } from "./attention";
import type { ProjectInfo } from "./types";

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info";

export interface Status {
  label: string;
  tone: Tone;
  /** Sort order: failing first, idle last. */
  rank: number;
}

/** One status per project, as shown in the Status column and on the project page. */
export function projectStatus(state: StripState): Status {
  const nogo = state.reasons.some((r) => r.severity === "nogo");
  const hold = state.reasons.some((r) => r.severity === "hold");
  // A failing container is the running thing itself breaking, so it outranks Running.
  const containerFailing = state.reasons.some((r) => r.action?.kind === "logs");
  if (!state.parked && (containerFailing || (nogo && state.bay !== "running"))) return { label: "Failing", tone: "bad", rank: 0 };
  if (!state.parked && hold && state.bay !== "running") return { label: "Attention", tone: "warn", rank: 1 };
  if (state.bay === "running") return { label: "Running", tone: "ok", rank: 2 };
  if (state.parked) return { label: "Parked", tone: "neutral", rank: 3 };
  return { label: "Idle", tone: "neutral", rank: 4 };
}

export const SEVERITY_TONE: Record<Severity, Tone> = { nogo: "bad", hold: "warn", note: "neutral" };

export const changedCount = (p: ProjectInfo) => (p.uncommittedChanges ?? 0) + (p.untrackedFiles ?? 0);

export const openTodoCount = (p: ProjectInfo) => p.todos?.filter((t) => !t.done).length ?? 0;

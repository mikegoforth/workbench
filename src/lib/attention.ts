import { plural } from "./format";
import { ChangedFile, ContainerProblem, OverviewEntry, ProjectInfo } from "./types";

// Where each strip sits on the board, what color paper it's printed on, and
// the reasons printed in its remarks. Paper is the truth (it never changes
// because you parked something); the bay is where your attention is routed.

export type BayId = "needs" | "running" | "quiet";
export type Paper = "nogo" | "hold" | "run" | "quiet" | "hidden";
export type Severity = "nogo" | "hold" | "note";

export type ReasonAction =
  | { kind: "pull" }
  | { kind: "link"; href: string; label: string }
  /** Open the project's container logs. */
  | { kind: "logs" };

export interface Reason {
  id: string;
  severity: Severity;
  label: string;
  action?: ReasonAction;
}

export interface StripState {
  bay: BayId;
  paper: Paper;
  reasons: Reason[];
  /** Identifies the current no-go and hold conditions; parking stores it. */
  fingerprint: string;
  parked: boolean;
}

const isConflict = ({ index: x, workingDir: y }: ChangedFile) =>
  x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");

function describeProblem(c: ContainerProblem): string {
  switch (c.kind) {
    case "unhealthy":
      return `${c.service} unhealthy`;
    case "restarting":
      return `${c.service} restarting`;
    case "oom":
      return `${c.service} out of memory`;
    case "exited":
      return `${c.service} exited (${c.exitCode})`;
  }
}

export function stripState(
  p: ProjectInfo,
  entry: OverviewEntry | undefined,
  running: boolean,
  containers: ContainerProblem[] = []
): StripState {
  const reasons: Reason[] = [];
  const gh = entry?.github;

  // Containers that are failing: up to two by name, more as a count.
  if (containers.length > 2) {
    reasons.push({ id: "containers", severity: "nogo", label: plural(containers.length, "container") + " failing", action: { kind: "logs" } });
  } else {
    for (const c of containers) {
      reasons.push({ id: `container:${c.stack}/${c.service}`, severity: "nogo", label: describeProblem(c), action: { kind: "logs" } });
    }
  }

  if (gh && (gh.ci === "FAILURE" || gh.ci === "ERROR")) {
    reasons.push({
      id: "ci",
      severity: "nogo",
      label: "CI failing",
      action: gh.ciUrl ? { kind: "link", href: gh.ciUrl, label: "Checks" } : undefined,
    });
  }
  const conflicts = (p.files ?? []).filter(isConflict).length;
  if (conflicts) reasons.push({ id: "conflict", severity: "nogo", label: plural(conflicts, "merge conflict") });

  if (gh?.reviewRequested) {
    reasons.push({
      id: "review",
      severity: "hold",
      label: gh.reviewRequested === 1 ? "Review requested" : `${gh.reviewRequested} reviews requested`,
      action: p.repoUrl
        ? { kind: "link", href: `${p.repoUrl}/pulls?q=is%3Apr+is%3Aopen+review-requested%3A%40me`, label: "Review" }
        : undefined,
    });
  }
  const behind = p.aheadBehind?.behind ?? 0;
  const ahead = p.aheadBehind?.ahead ?? 0;
  if (behind) reasons.push({ id: "behind", severity: "hold", label: `${behind} behind`, action: { kind: "pull" } });
  if (ahead) reasons.push({ id: "ahead", severity: "hold", label: `${ahead} unpushed` });

  // Notes are printed on the strip but never pull it into Needs you on their own.
  const changed = (p.uncommittedChanges ?? 0) + (p.untrackedFiles ?? 0);
  if (changed) reasons.push({ id: "changes", severity: "note", label: plural(changed, "changed file") });
  const warnings = entry?.warnings ?? [];
  if (warnings.length) {
    reasons.push({
      id: "setup",
      severity: "note",
      label: warnings.length === 1 ? warnings[0].title : plural(warnings.length, "setup warning"),
    });
  }

  const fingerprint = reasons
    .filter((r) => r.severity !== "note")
    .map((r) => `${r.id}:${r.label}`)
    .join("|");
  const parked = !!fingerprint && p.parkedFingerprint === fingerprint;
  const hasNogo = reasons.some((r) => r.severity === "nogo");
  const hasHold = reasons.some((r) => r.severity === "hold");

  return {
    bay: running ? "running" : (hasNogo || hasHold) && !parked ? "needs" : "quiet",
    paper: p.hidden ? "hidden" : hasNogo ? "nogo" : hasHold ? "hold" : running ? "run" : "quiet",
    reasons,
    fingerprint,
    parked,
  };
}

/** Board order inside a bay: no-go before hold, then most recently committed. */
export function compareStrips(
  a: { project: ProjectInfo; state: StripState },
  b: { project: ProjectInfo; state: StripState }
): number {
  const rank = (s: StripState) => (s.paper === "nogo" ? 0 : s.paper === "hold" ? 1 : 2);
  const byRank = rank(a.state) - rank(b.state);
  if (byRank !== 0) return byRank;
  const time = (p: ProjectInfo) => (p.lastCommitDate ? Date.parse(p.lastCommitDate) : 0);
  return time(b.project) - time(a.project);
}

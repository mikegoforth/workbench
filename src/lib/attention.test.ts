import { describe, expect, it } from "vitest";
import { compareStrips, stripState } from "./attention";
import { projectStatus } from "./status";
import type { ContainerProblem, OverviewEntry, ProjectInfo } from "./types";

const project = (over: Partial<ProjectInfo> = {}): ProjectInfo => ({ name: "alpha", path: "/p/alpha", isGitRepo: true, ...over });

const entry = (github: Partial<NonNullable<OverviewEntry["github"]>> | null, warnings: OverviewEntry["warnings"] = []) =>
  ({
    warnings,
    github: github && { ci: null, ciUrl: null, openPullRequests: 0, reviewRequested: 0, ...github },
  }) as OverviewEntry;

const container = (service: string, kind: ContainerProblem["kind"] = "exited"): ContainerProblem => ({
  stack: "app",
  service,
  kind,
  exitCode: kind === "exited" ? 1 : null,
});

describe("stripState", () => {
  it("puts a clean, idle project in Quiet", () => {
    const s = stripState(project(), undefined, false);
    expect(s).toEqual({ bay: "quiet", paper: "quiet", reasons: [], fingerprint: "", parked: false });
    expect(projectStatus(s)).toMatchObject({ label: "Idle", tone: "neutral" });
  });

  it("puts a running project in Running", () => {
    const s = stripState(project(), undefined, true);
    expect(s).toMatchObject({ bay: "running", paper: "run" });
    expect(projectStatus(s).label).toBe("Running");
  });

  it("flags failing CI as no-go, linking to the checks", () => {
    const s = stripState(project(), entry({ ci: "FAILURE", ciUrl: "https://ci/1" }), false);
    expect(s).toMatchObject({ bay: "needs", paper: "nogo" });
    expect(s.reasons).toEqual([{ id: "ci", severity: "nogo", label: "CI failing", action: { kind: "link", href: "https://ci/1", label: "Checks" } }]);
    expect(projectStatus(s)).toMatchObject({ label: "Failing", tone: "bad" });
  });

  it("counts merge conflicts", () => {
    const files = [
      { path: "a", index: "U", workingDir: "U" },
      { path: "b", index: "A", workingDir: "A" },
      { path: "c", index: "D", workingDir: "D" },
      { path: "d", index: "M", workingDir: " " },
    ];
    const s = stripState(project({ files }), undefined, false);
    expect(s.reasons).toContainEqual({ id: "conflict", severity: "nogo", label: "3 merge conflicts" });
  });

  it("names up to two failing containers, then counts them", () => {
    const two = stripState(project(), undefined, true, [container("db", "unhealthy"), container("api", "oom")]);
    expect(two.reasons.map((r) => r.label)).toEqual(["db unhealthy", "api out of memory"]);
    const three = stripState(project(), undefined, true, [container("a"), container("b", "restarting"), container("c")]);
    expect(three.reasons).toEqual([{ id: "containers", severity: "nogo", label: "3 containers failing", action: { kind: "logs" } }]);
    // A failing container outranks Running.
    expect(projectStatus(three).label).toBe("Failing");
  });

  it("holds for review requests, commits behind and unpushed work", () => {
    const s = stripState(
      project({ repoUrl: "https://github.com/o/alpha", aheadBehind: { ahead: 1, behind: 2 } }),
      entry({ reviewRequested: 2 }),
      false
    );
    expect(s).toMatchObject({ bay: "needs", paper: "hold" });
    expect(s.reasons.map((r) => r.label)).toEqual(["2 reviews requested", "2 behind", "1 unpushed"]);
    expect(s.reasons[0].action).toMatchObject({ kind: "link", label: "Review" });
    expect(s.reasons[1].action).toEqual({ kind: "pull" });
    expect(projectStatus(s)).toMatchObject({ label: "Attention", tone: "warn" });
  });

  it("prints notes without pulling the strip into Needs you", () => {
    const s = stripState(project({ uncommittedChanges: 2, untrackedFiles: 1 }), entry(null, [{ id: "deps", title: "Dependencies not installed" }]), false);
    expect(s.bay).toBe("quiet");
    expect(s.reasons.map((r) => r.label)).toEqual(["3 changed files", "Dependencies not installed"]);
    expect(s.fingerprint).toBe("");
  });

  it("keeps a parked strip in Quiet until its conditions change", () => {
    const behind = project({ aheadBehind: { ahead: 0, behind: 2 } });
    const { fingerprint } = stripState(behind, undefined, false);
    expect(fingerprint).toBe("behind:2 behind");

    const parked = stripState({ ...behind, parkedFingerprint: fingerprint }, undefined, false);
    expect(parked).toMatchObject({ bay: "quiet", paper: "hold", parked: true });
    expect(projectStatus(parked).label).toBe("Parked");

    const changed = stripState({ ...behind, aheadBehind: { ahead: 0, behind: 3 }, parkedFingerprint: fingerprint }, undefined, false);
    expect(changed).toMatchObject({ bay: "needs", parked: false });
  });

  it("prints hidden projects on hidden paper", () => {
    expect(stripState(project({ hidden: true }), entry({ ci: "ERROR" }), false).paper).toBe("hidden");
  });
});

describe("compareStrips", () => {
  const strip = (over: Partial<ProjectInfo>, ci: "FAILURE" | null, behind = 0) => {
    const p = project({ aheadBehind: { ahead: 0, behind }, ...over });
    return { project: p, state: stripState(p, entry({ ci }), false) };
  };

  it("orders no-go, then hold, then the rest, newest commit first", () => {
    const quietOld = strip({ name: "quiet-old", lastCommitDate: "2026-01-01" }, null);
    const quietNew = strip({ name: "quiet-new", lastCommitDate: "2026-11-01" }, null);
    const hold = strip({ name: "hold" }, null, 1);
    const nogo = strip({ name: "nogo" }, "FAILURE");
    const sorted = [quietOld, hold, quietNew, nogo].sort(compareStrips).map((s) => s.project.name);
    expect(sorted).toEqual(["nogo", "hold", "quiet-new", "quiet-old"]);
  });
});

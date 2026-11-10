import { describe, expect, it } from "vitest";
import type { Reason, StripState } from "./attention";
import { changedCount, openTodoCount, projectStatus, SEVERITY_TONE } from "./status";
import type { ProjectInfo } from "./types";

const state = (over: Partial<StripState> = {}): StripState => ({
  bay: "quiet",
  paper: "quiet",
  reasons: [],
  fingerprint: "",
  parked: false,
  ...over,
});

const nogo: Reason = { id: "ci", severity: "nogo", label: "CI failing" };
const hold: Reason = { id: "behind", severity: "hold", label: "2 behind", action: { kind: "pull" } };
const note: Reason = { id: "changes", severity: "note", label: "3 changed files" };
const container: Reason = { id: "containers", severity: "nogo", label: "db exited", action: { kind: "logs" } };

const project = (over: Partial<ProjectInfo> = {}): ProjectInfo => ({ name: "alpha", path: "/p/alpha", isGitRepo: true, ...over });

describe("projectStatus", () => {
  it.each([
    ["idle with nothing to say", state(), "Idle", "neutral", 4],
    ["idle with only notes", state({ reasons: [note] }), "Idle", "neutral", 4],
    ["a no-go while stopped", state({ bay: "needs", reasons: [nogo] }), "Failing", "bad", 0],
    ["a hold while stopped", state({ bay: "needs", reasons: [hold, note] }), "Attention", "warn", 1],
    ["no-go and hold together", state({ bay: "needs", reasons: [hold, nogo] }), "Failing", "bad", 0],
    // Running hides no-go and hold reasons that aren't the running thing failing.
    ["running with a no-go", state({ bay: "running", reasons: [nogo] }), "Running", "ok", 2],
    ["running with a hold", state({ bay: "running", reasons: [hold] }), "Running", "ok", 2],
    ["running with a failing container", state({ bay: "running", reasons: [container] }), "Failing", "bad", 0],
    ["parked no-go", state({ reasons: [nogo], parked: true }), "Parked", "neutral", 3],
    ["parked hold", state({ reasons: [hold], parked: true }), "Parked", "neutral", 3],
    ["parked failing container", state({ reasons: [container], parked: true }), "Parked", "neutral", 3],
    ["parked but running", state({ bay: "running", reasons: [container], parked: true }), "Running", "ok", 2],
  ])("%s → %s", (_label, s, label, tone, rank) => {
    expect(projectStatus(s)).toEqual({ label, tone, rank });
  });

  it("ranks failing first and idle last", () => {
    const ranks = [
      state(),
      state({ reasons: [nogo], parked: true }),
      state({ bay: "running" }),
      state({ reasons: [hold] }),
      state({ reasons: [nogo] }),
    ].map((s) => projectStatus(s).rank);
    expect(ranks).toEqual([4, 3, 2, 1, 0]);
  });
});

describe("SEVERITY_TONE", () => {
  it("maps each severity to a tone", () => {
    expect(SEVERITY_TONE).toEqual({ nogo: "bad", hold: "warn", note: "neutral" });
  });
});

describe("changedCount", () => {
  it("adds uncommitted and untracked files", () => {
    expect(changedCount(project({ uncommittedChanges: 3, untrackedFiles: 2 }))).toBe(5);
  });

  it("treats missing counts as zero", () => {
    expect(changedCount(project())).toBe(0);
    expect(changedCount(project({ uncommittedChanges: 4 }))).toBe(4);
    expect(changedCount(project({ untrackedFiles: 1 }))).toBe(1);
  });
});

describe("openTodoCount", () => {
  const todo = (id: string, done: boolean) => ({ id, text: id, done, createdAt: "2026-01-01T00:00:00.000Z" });

  it("counts only the todos not done", () => {
    expect(openTodoCount(project({ todos: [todo("a", false), todo("b", true), todo("c", false)] }))).toBe(2);
  });

  it("is zero without todos", () => {
    expect(openTodoCount(project())).toBe(0);
    expect(openTodoCount(project({ todos: [] }))).toBe(0);
  });
});

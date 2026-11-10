import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ageShort, plural, timeAgo } from "./format";

const NOW = new Date("2026-11-09T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("timeAgo", () => {
  it.each([
    [30_000, "just now"],
    [MIN, "1m ago"],
    [59 * MIN, "59m ago"],
    [HOUR, "1h ago"],
    [23 * HOUR, "23h ago"],
    [DAY, "1d ago"],
    [29 * DAY, "29d ago"],
    [30 * DAY, "1mo ago"],
    [400 * DAY, "13mo ago"],
  ])("%i ms → %s", (ms, label) => {
    expect(timeAgo(ago(ms))).toBe(label);
  });
});

describe("ageShort", () => {
  it.each([
    [0, "now"],
    [5 * MIN, "5m"],
    [3 * HOUR, "3h"],
    [4 * DAY, "4d"],
    [60 * DAY, "2mo"],
    [719 * DAY, "23mo"],
    [720 * DAY, "2y"],
  ])("%i ms → %s", (ms, label) => {
    expect(ageShort(ago(ms))).toBe(label);
  });
});

describe("plural", () => {
  it("adds an s except for one", () => {
    expect(plural(0, "file")).toBe("0 files");
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(2, "file")).toBe("2 files");
  });
});

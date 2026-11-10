import { describe, expect, it } from "vitest";
import { atLeast, MIN_NODE } from "./requirements";

describe("atLeast", () => {
  it.each([
    ["22.12.0", "22.12.0", true],
    ["22.12.1", "22.12.0", true],
    ["22.13.0", "22.12.0", true],
    ["24.0.0", "22.12.0", true],
    // Numeric, not string, comparison: 22.9 is older than 22.12.
    ["22.9.0", "22.12.0", false],
    ["22.11.9", "22.12.0", false],
    ["20.19.5", "22.12.0", false],
    ["100.0.0", "22.12.0", true],
    // Missing parts count as 0.
    ["22.12", "22.12.0", true],
    ["23", "22.12.0", true],
  ])("%s >= %s is %s", (a, b, expected) => {
    expect(atLeast(a, b)).toBe(expected);
  });

  it("reads a prerelease by its numeric parts", () => {
    expect(atLeast("23.0.0-nightly2026", "22.12.0")).toBe(true);
  });
});

describe("MIN_NODE", () => {
  it("is a supported Node line", () => {
    expect(atLeast(MIN_NODE, "22.0.0")).toBe(true);
  });
});

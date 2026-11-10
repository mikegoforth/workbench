import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { compareVersions, formatReleaseDate, RELEASES, releasesUpTo } from "./releaseNotes";

const packageVersion: string = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")).version;

describe("RELEASES", () => {
  // Bumping the version without notes fails here, so What's new never shows an empty release.
  it("has dated notes for the version in package.json", () => {
    const current = RELEASES.find((r) => r.version === packageVersion);
    expect(current, `no release notes for ${packageVersion}`).toBeDefined();
    expect(current?.date, `set the release date for ${packageVersion}`).toBeDefined();
  });

  it("dates every released version", () => {
    for (const r of releasesUpTo(packageVersion)) expect(r.date, r.version).toBeDefined();
  });

  it("is newest first, with no duplicates", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version), `${RELEASES[i - 1].version} before ${RELEASES[i].version}`).toBeGreaterThan(0);
    }
  });

  it.each(RELEASES)("$version is well-formed", (release) => {
    expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
    if (release.date) {
      expect(release.date).toMatch(/^\d{4}-\d\d-\d\d$/);
      expect(Number.isNaN(Date.parse(release.date))).toBe(false);
    }
    expect(release.changes.length).toBeGreaterThan(0);
    for (const change of release.changes) {
      expect(["new", "changed", "fixed", "security"]).toContain(change.kind);
      // Full sentences for people, not commit subjects (the product name stays lowercase).
      expect(change.text).toMatch(/^([A-Z]|workbench\b).*\.$/);
    }
  });
});

describe("APP_VERSION", () => {
  it("comes from the build's WORKBENCH_VERSION", async () => {
    vi.stubEnv("WORKBENCH_VERSION", "9.9.9");
    vi.resetModules();
    expect((await import("./releaseNotes")).APP_VERSION).toBe("9.9.9");
  });

  it("falls back when it isn't set (tests, tools)", async () => {
    vi.stubEnv("WORKBENCH_VERSION", undefined);
    vi.resetModules();
    expect((await import("./releaseNotes")).APP_VERSION).toBe("0.0.0");
  });
});

describe("compareVersions and releasesUpTo", () => {
  it.each([
    ["0.1.10", "0.1.9", 1],
    ["0.2.0", "0.1.99", 1],
    ["1.0.0", "1.0.0", 0],
    ["0.1.1", "0.1.2", -1],
    ["1.0", "1.0.0", 0],
  ])("%s vs %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });

  it("hides notes for versions newer than the one running", () => {
    const shown = releasesUpTo("0.1.1").map((r) => r.version);
    expect(shown).toContain("0.1.1");
    expect(shown.every((v) => compareVersions(v, "0.1.1") <= 0)).toBe(true);
    expect(releasesUpTo("0.0.1")).toEqual([]);
  });
});

describe("formatReleaseDate", () => {
  it("shows the calendar day in any time zone", () => {
    expect(formatReleaseDate("2026-11-09")).toBe("Nov 9, 2026");
    expect(formatReleaseDate("2027-01-01")).toBe("Jan 1, 2027");
  });
});

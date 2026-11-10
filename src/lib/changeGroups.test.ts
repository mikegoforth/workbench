import { describe, expect, it } from "vitest";
import { changeGroupOf, groupChanges, matchesPath } from "./changeGroups";
import type { ChangedFile } from "./types";

const f = (code: string, path = "a.txt", from?: string): ChangedFile => ({ path, from, index: code[0], workingDir: code[1] });

describe("changeGroupOf", () => {
  it.each([
    ["UU", "conflict"],
    ["AU", "conflict"],
    ["UD", "conflict"],
    ["AA", "conflict"],
    ["DD", "conflict"],
    ["??", "untracked"],
    ["R ", "renamed"],
    ["RM", "renamed"],
    ["C ", "renamed"],
    ["D ", "deleted"],
    [" D", "deleted"],
    ["MD", "deleted"],
    ["M ", "staged"],
    ["MM", "staged"],
    ["A ", "staged"],
    ["AM", "staged"],
    [" M", "modified"],
    [" T", "modified"],
  ])("%j is %s", (code, group) => {
    expect(changeGroupOf(f(code))).toBe(group);
  });
});

describe("groupChanges", () => {
  it("puts conflicts first, skips empty groups and keeps file order within a group", () => {
    const files = [f(" M", "b"), f("??", "new/"), f("UU", "c"), f(" M", "a"), f("M ", "s"), f("R ", "to", "from")];
    expect(groupChanges(files).map((g) => [g.id, g.files.map((x) => x.path)])).toEqual([
      ["conflict", ["c"]],
      ["staged", ["s"]],
      ["modified", ["b", "a"]],
      ["untracked", ["new/"]],
      ["renamed", ["to"]],
    ]);
  });

  it("returns nothing for a clean tree", () => {
    expect(groupChanges([])).toEqual([]);
  });
});

describe("matchesPath", () => {
  it("matches a case-insensitive substring of the path or the old path", () => {
    expect(matchesPath(f(" M", "src/App.tsx"), "app")).toBe(true);
    expect(matchesPath(f("R ", "lib/new.ts", "src/old.ts"), "old")).toBe(true);
    expect(matchesPath(f(" M", "src/App.tsx"), "zzz")).toBe(false);
    expect(matchesPath(f(" M", "x"), "  ")).toBe(true);
  });
});

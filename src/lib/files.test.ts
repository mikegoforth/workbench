import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findReadme, resolveFileIn } from "./files";

let root: string;
let project: string;

beforeAll(() => {
  // realpath: on macOS the temp folder is behind the /var -> /private/var symlink.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-files-")));
  project = path.join(root, "project");
  fs.mkdirSync(path.join(project, "docs"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), "{}");
  fs.writeFileSync(path.join(project, "docs", "guide.md"), "# Guide");
  // A sibling whose name starts with the project's: "project-secrets".
  fs.mkdirSync(path.join(root, "project-secrets"));
  fs.writeFileSync(path.join(root, "project-secrets", "key"), "secret");
  fs.writeFileSync(path.join(root, "outside.txt"), "outside");
  // Symlinks a cloned repo could ship.
  fs.symlinkSync(path.join(root, "outside.txt"), path.join(project, "escape.txt"));
  fs.symlinkSync(root, path.join(project, "escape-dir"));
  fs.symlinkSync(path.join(project, "package.json"), path.join(project, "inside-link.json"));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveFileIn", () => {
  it("resolves files inside the folder", () => {
    expect(resolveFileIn(project, "package.json")).toBe(path.join(project, "package.json"));
    expect(resolveFileIn(project, "docs/guide.md")).toBe(path.join(project, "docs", "guide.md"));
    expect(resolveFileIn(project, "docs/../package.json")).toBe(path.join(project, "package.json"));
  });

  it("follows a symlink that stays inside", () => {
    expect(resolveFileIn(project, "inside-link.json")).toBe(path.join(project, "package.json"));
  });

  it.each([
    ["a parent path", "../outside.txt"],
    ["a sibling with a matching prefix", "../project-secrets/key"],
    ["an absolute path", "/etc/hosts"],
    ["a symlink to a file outside", "escape.txt"],
    ["a path through a symlinked folder", "escape-dir/outside.txt"],
    ["a folder", "docs"],
    ["the folder itself", "."],
    ["a missing file", "nope.txt"],
    ["an empty path", ""],
  ])("refuses %s", (_label, file) => {
    expect(resolveFileIn(project, file)).toBeNull();
  });

  it.each([undefined, null, 42, ["package.json"], { path: "package.json" }])("refuses a non-string (%j)", (file) => {
    expect(resolveFileIn(project, file)).toBeNull();
  });
});

describe("findReadme", () => {
  const withFiles = (names: string[]) => {
    const dir = fs.mkdtempSync(path.join(root, "readme-"));
    for (const name of names) fs.writeFileSync(path.join(dir, name), "");
    return dir;
  };

  it("prefers a markdown README over a plain one", () => {
    expect(findReadme(withFiles(["README", "README.md"]))).toBe("README.md");
  });

  it("matches any case and .markdown", () => {
    expect(findReadme(withFiles(["readme.markdown"]))).toBe("readme.markdown");
  });

  it("falls back to a plain README", () => {
    expect(findReadme(withFiles(["README", "index.js"]))).toBe("README");
  });

  it("ignores other files", () => {
    expect(findReadme(withFiles(["README.txt", "READMEs.md"]))).toBeNull();
  });

  it("returns null for a missing folder", () => {
    expect(findReadme(path.join(root, "missing"))).toBeNull();
  });
});

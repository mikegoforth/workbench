import fs from "fs";
import os from "os";
import path from "path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findReadme, resolveFileIn } from "./files";

// Creating symlinks on Windows needs admin rights or Developer Mode: the
// symlink cases only run elsewhere.
const symlinks = process.platform !== "win32";

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
  if (symlinks) {
    fs.symlinkSync(path.join(root, "outside.txt"), path.join(project, "escape.txt"));
    fs.symlinkSync(root, path.join(project, "escape-dir"));
    fs.symlinkSync(path.join(project, "package.json"), path.join(project, "inside-link.json"));
  }
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

  it.skipIf(!symlinks)("follows a symlink that stays inside", () => {
    expect(resolveFileIn(project, "inside-link.json")).toBe(path.join(project, "package.json"));
  });

  it.each([
    ["a parent path", "../outside.txt"],
    ["a sibling with a matching prefix", "../project-secrets/key"],
    ["an absolute path", "/etc/hosts"],
    // A parent path on Windows; a (missing) file name elsewhere.
    ["a parent path with backslashes", "..\\outside.txt"],
    ["a folder", "docs"],
    ["the folder itself", "."],
    ["a missing file", "nope.txt"],
    ["an empty path", ""],
  ])("refuses %s", (_label, file) => {
    expect(resolveFileIn(project, file)).toBeNull();
  });

  it.skipIf(!symlinks).each([
    ["a symlink to a file outside", "escape.txt"],
    ["a path through a symlinked folder", "escape-dir/outside.txt"],
  ])("refuses %s", (_label, file) => {
    expect(resolveFileIn(project, file)).toBeNull();
  });

  it.each([undefined, null, 42, ["package.json"], { path: "package.json" }])("refuses a non-string (%j)", (file) => {
    expect(resolveFileIn(project, file)).toBeNull();
  });

  // Property-based (fast-check): many generated paths, not just the cases above.
  // They're built from the pieces an escape would combine: parent and current
  // folder steps, both separators, drive and UNC prefixes, the symlinks and the
  // look-alike sibling set up above, and arbitrary Unicode (NUL included).
  const knownPiece = fc.constantFrom(
    "..",
    ".",
    "",
    "docs",
    "guide.md",
    "package.json",
    "project",
    "project-secrets",
    "key",
    "outside.txt",
    "escape.txt",
    "escape-dir",
    "inside-link.json",
    "C:",
    "\\\\server\\share",
    "~",
  );
  // Mostly known pieces, so enough paths reach a real file to test the success path too.
  const piece = fc.oneof(
    { weight: 3, arbitrary: knownPiece },
    { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 6 }) },
  );
  const anyPath = fc.oneof(
    {
      weight: 4,
      arbitrary: fc
        .array(fc.tuple(piece, fc.constantFrom("/", "\\")), { minLength: 1, maxLength: 5 })
        .map((parts) => parts.map(([p, sep]) => p + sep).join("").replace(/[/\\]$/, "")),
    },
    { weight: 1, arbitrary: fc.string({ unit: "binary" }) },
  );

  it("never resolves outside the folder, for any path", () => {
    const realProject = fs.realpathSync(project);
    fc.assert(
      fc.property(anyPath, (file) => {
        const result = resolveFileIn(project, file);
        if (result === null) return;
        // Checked a different way from resolveFileIn's own prefix test.
        const rel = path.relative(realProject, result);
        expect(rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)).toBe(false);
        expect(fs.realpathSync(result)).toBe(result);
        expect(fs.statSync(result).isFile()).toBe(true);
      }),
      { numRuns: 2000 },
    );
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

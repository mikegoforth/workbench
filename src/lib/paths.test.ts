import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// paths.ts reads settings from the data folder, which dataDir() caches per
// module instance, so each test imports fresh copies pointed at temp folders.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-paths-")));
const dataDir = path.join(root, "data");
const projects = path.join(root, "projects");
fs.mkdirSync(path.join(projects, "alpha"), { recursive: true });
fs.mkdirSync(path.join(projects, ".hidden"));
fs.writeFileSync(path.join(projects, "notes.txt"), "");

async function load() {
  vi.resetModules();
  return import("./paths");
}

const realPlatform = process.platform;
const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });

beforeEach(() => {
  vi.stubEnv("WORKBENCH_DATA_DIR", dataDir);
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  setPlatform(realPlatform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("expandHome and tildify", () => {
  it("expands ~ and ~/x", async () => {
    const { expandHome } = await load();
    expect(expandHome("~")).toBe(os.homedir());
    expect(expandHome("~/code")).toBe(path.join(os.homedir(), "code"));
    expect(expandHome("~other/code")).toBe("~other/code");
    expect(expandHome("/abs")).toBe("/abs");
  });

  it("shortens paths in the home folder", async () => {
    const { tildify } = await load();
    expect(tildify(os.homedir())).toBe("~");
    expect(tildify(path.join(os.homedir(), "code"))).toBe(path.join("~", "code"));
    // Same prefix, different folder: /Users/me-old is not under /Users/me.
    expect(tildify(os.homedir() + "-old")).toBe(os.homedir() + "-old");
  });

  it("matches the home folder case-sensitively off Windows", async () => {
    setPlatform("linux");
    const { tildify } = await load();
    const upper = os.homedir().toUpperCase();
    if (upper !== os.homedir()) expect(tildify(path.join(upper, "code"))).toBe(path.join(upper, "code"));
  });

  describe("on Windows", () => {
    beforeEach(() => setPlatform("win32"));

    it("expands ~\\x too", async () => {
      const { expandHome } = await load();
      expect(expandHome("~\\code")).toBe(path.join(os.homedir(), "code"));
      expect(expandHome("~/code")).toBe(path.join(os.homedir(), "code"));
      expect(expandHome("~other\\code")).toBe("~other\\code");
    });

    it("shortens the home folder whatever its case", async () => {
      const { tildify } = await load();
      expect(tildify(os.homedir().toUpperCase())).toBe("~");
      expect(tildify(path.join(os.homedir().toLowerCase(), "code"))).toBe(path.join("~", "code"));
    });
  });
});

describe("projectsDirInfo", () => {
  it("uses the env var when settings don't name a folder", async () => {
    const { projectsDirInfo } = await load();
    expect(projectsDirInfo()).toEqual({ dir: projects, source: "env" });
  });

  it("prefers the folder saved in settings", async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ projectsDir: "/saved/projects" }));
    const { projectsDirInfo } = await load();
    expect(projectsDirInfo()).toEqual({ dir: "/saved/projects", source: "settings" });
  });

  it("falls back to ~/Projects", async () => {
    vi.stubEnv("WORKBENCH_PROJECTS_DIR", "  ");
    const { projectsDirInfo, DEFAULT_PROJECTS_DIR } = await load();
    expect(DEFAULT_PROJECTS_DIR).toBe(path.join(os.homedir(), "Projects"));
    expect(projectsDirInfo()).toEqual({ dir: DEFAULT_PROJECTS_DIR, source: "default" });
  });
});

describe("validateProjectsDir", () => {
  it("accepts an existing folder", async () => {
    const { validateProjectsDir } = await load();
    expect(validateProjectsDir(projects)).toEqual({ dir: projects });
    expect(validateProjectsDir(`  ${projects}/alpha/..  `)).toEqual({ dir: projects });
    expect(validateProjectsDir("~")).toEqual({ dir: os.homedir() });
  });

  it.each([
    ["a non-string", 42, "Enter a folder path"],
    ["an empty string", "   ", "Enter a folder path"],
    ["a very long path", "/" + "a".repeat(1024), "Enter a folder path"],
    ["a relative path", "projects", "Use a full path"],
    ["the disk root", "/", "not the whole disk"],
    ["a file", path.join(projects, "notes.txt"), "isn't a folder"],
    ["a missing folder", path.join(root, "missing"), "doesn't exist"],
  ])("refuses %s", async (_label, input, message) => {
    const { validateProjectsDir } = await load();
    const result = validateProjectsDir(input);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain(message);
  });

  it.each([
    ["darwin", "Use a full path, like ~/Projects or /Users/you/code"],
    ["linux", "Use a full path, like ~/Projects or /home/you/code"],
    ["win32", "Use a full path, like ~\\Projects or C:\\Users\\you\\code"],
    ["freebsd", "Use a full path, like ~/Projects or /Users/you/code"],
  ] as const)("gives a %s example of a full path", async (platform, message) => {
    setPlatform(platform);
    const { validateProjectsDir } = await load();
    expect(validateProjectsDir("code")).toEqual({ error: message });
  });
});

describe("resolveProjectDir", () => {
  it("resolves a project folder by name", async () => {
    const { resolveProjectDir } = await load();
    expect(resolveProjectDir("alpha")).toBe(path.join(projects, "alpha"));
  });

  it.each([
    ["a parent path", "../data"],
    ["a nested path", "alpha/sub"],
    ["an absolute path", path.join(projects, "alpha")],
    ["a dot-folder", ".hidden"],
    ["the projects folder itself", "."],
    ["..", ".."],
    ["__proto__", "__proto__"],
    ["a file", "notes.txt"],
    ["a missing folder", "missing"],
    ["an empty name", ""],
    ["a non-string", 7],
    ["null", null],
  ])("refuses %s", async (_label, name) => {
    const { resolveProjectDir } = await load();
    expect(resolveProjectDir(name)).toBeNull();
  });

  describe("on Windows", () => {
    beforeEach(() => setPlatform("win32"));

    it("resolves a project folder by name", async () => {
      const { resolveProjectDir } = await load();
      expect(resolveProjectDir("alpha")).toBe(path.join(projects, "alpha"));
    });

    it.each([
      ["a parent path with a backslash", "..\\data"],
      ["a nested path with a backslash", "alpha\\sub"],
      ["a nested path with a slash", "alpha/sub"],
      ["a drive-relative path", "C:alpha"],
      ["a bare drive", "C:"],
      ["an absolute path", "C:\\Windows"],
      ["a UNC path", "\\\\server\\share"],
      ["an alternate data stream", "alpha:stream"],
      ["a trailing dot", "alpha."],
      ["a trailing space", "alpha "],
      ["a name that would mean the folder itself", " .."],
      ["a device name", "NUL"],
      ["a device name with an extension", "com1.txt"],
      ["a reserved character", "a<b"],
      ["a control character", "a\x01b"],
    ])("refuses %s", async (_label, name) => {
      const { resolveProjectDir } = await load();
      expect(resolveProjectDir(name)).toBeNull();
    });
  });
});

describe("isSelf", () => {
  it("matches only the server's own folder", async () => {
    const { isSelf } = await load();
    expect(isSelf(process.cwd())).toBe(true);
    expect(isSelf(path.join(process.cwd(), "src", ".."))).toBe(true);
    expect(isSelf(path.join(projects, "alpha"))).toBe(false);
  });
});

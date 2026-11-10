import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// dataDir.ts reads process.cwd() when it loads, os.homedir() when it picks the
// default folder, and caches the folder it picks, so each test points both at
// a temp folder (until it ends) and imports a fresh copy. The platform is
// pinned, so the defaults don't depend on the machine running the tests.
// Nothing here touches the real repo's data/, ~/Library or ~/.config.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-datadir-")));
const repo = path.join(root, "repo");
const home = path.join(root, "home");
const legacy = path.join(repo, "data");
const target = path.join(root, "app-support", "data");

const realPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

async function load() {
  vi.resetModules();
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(repo);
  vi.spyOn(os, "homedir").mockReturnValue(home);
  const mod = await import("./dataDir");
  cwd.mockRestore();
  return mod;
}

function writeLegacy() {
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "settings.json"), '{"projectsDir":"/old"}');
  fs.mkdirSync(path.join(legacy, "logs"));
  fs.writeFileSync(path.join(legacy, "logs", "alpha.log"), "ready");
}

beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });
  vi.stubEnv("WORKBENCH_DATA_DIR", target);
  vi.stubEnv("NODE_ENV", "test");
  setPlatform("darwin");
});

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(realPlatform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("dataDir", () => {
  it("creates the folder named by WORKBENCH_DATA_DIR", async () => {
    const { dataDir } = await load();
    expect(dataDir()).toBe(target);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it("trims the variable", async () => {
    vi.stubEnv("WORKBENCH_DATA_DIR", `  ${target}  `);
    const { dataDir } = await load();
    expect(dataDir()).toBe(target);
  });

  it("defaults to Application Support when the variable is blank", async () => {
    vi.stubEnv("WORKBENCH_DATA_DIR", "   ");
    const { dataDir } = await load();
    const expected = path.join(home, "Library", "Application Support", "workbench", "data");
    expect(dataDir()).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
  });

  describe("default folder, where Electron keeps the desktop app's data", () => {
    beforeEach(() => {
      vi.stubEnv("WORKBENCH_DATA_DIR", "");
    });

    it("uses ~/.config on Linux", async () => {
      setPlatform("linux");
      vi.stubEnv("XDG_CONFIG_HOME", "");
      const { dataDir } = await load();
      expect(dataDir()).toBe(path.join(home, ".config", "workbench", "data"));
    });

    it("follows XDG_CONFIG_HOME on Linux", async () => {
      setPlatform("linux");
      vi.stubEnv("XDG_CONFIG_HOME", path.join(root, "xdg"));
      const { dataDir } = await load();
      expect(dataDir()).toBe(path.join(root, "xdg", "workbench", "data"));
    });

    it("uses %APPDATA% on Windows", async () => {
      setPlatform("win32");
      vi.stubEnv("APPDATA", path.join(root, "Roaming"));
      const { dataDir } = await load();
      expect(dataDir()).toBe(path.join(root, "Roaming", "workbench", "data"));
    });
  });

  it("leaves an existing folder's contents alone", async () => {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "notes.json"), "{}");
    const { dataDir } = await load();
    expect(dataDir()).toBe(target);
    expect(fs.readdirSync(target)).toEqual(["notes.json"]);
  });

  it("keeps the first folder it picked", async () => {
    const { dataDir } = await load();
    expect(dataDir()).toBe(target);
    vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "elsewhere"));
    expect(dataDir()).toBe(target);
    expect(fs.existsSync(path.join(root, "elsewhere"))).toBe(false);
  });

  describe("moving the repo's old data/ folder", () => {
    it("copies it across once in development, keeping the original", async () => {
      vi.stubEnv("NODE_ENV", "development");
      writeLegacy();
      const { dataDir } = await load();
      expect(dataDir()).toBe(target);
      expect(fs.readFileSync(path.join(target, "settings.json"), "utf-8")).toBe('{"projectsDir":"/old"}');
      expect(fs.readFileSync(path.join(target, "logs", "alpha.log"), "utf-8")).toBe("ready");
      expect(fs.existsSync(path.join(legacy, "settings.json"))).toBe(true);
    });

    it("doesn't copy over a folder that already exists", async () => {
      vi.stubEnv("NODE_ENV", "development");
      writeLegacy();
      fs.mkdirSync(target, { recursive: true });
      const { dataDir } = await load();
      expect(dataDir()).toBe(target);
      expect(fs.readdirSync(target)).toEqual([]);
    });

    it("starts empty in development when there's no old folder", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const { dataDir } = await load();
      expect(dataDir()).toBe(target);
      expect(fs.readdirSync(target)).toEqual([]);
    });

    it("never copies outside development", async () => {
      vi.stubEnv("NODE_ENV", "production");
      writeLegacy();
      const { dataDir } = await load();
      expect(dataDir()).toBe(target);
      expect(fs.readdirSync(target)).toEqual([]);
    });
  });
});

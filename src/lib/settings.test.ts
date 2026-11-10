import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-settings-")));
const dataDir = path.join(root, "data");
const file = path.join(dataDir, "settings.json");

async function load() {
  vi.resetModules();
  return import("./settings");
}

beforeEach(() => {
  vi.stubEnv("WORKBENCH_DATA_DIR", dataDir);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const save = (data: unknown) => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
};

describe("readSettings", () => {
  it("returns empty settings when there's no file (and creates the data folder)", async () => {
    const { readSettings } = await load();
    expect(readSettings()).toEqual({ hiddenProjects: [], parked: {} });
    expect(fs.existsSync(dataDir)).toBe(true);
  });

  it("returns empty settings for a corrupt file", async () => {
    save("{ not json");
    const { readSettings } = await load();
    expect(readSettings()).toEqual({ hiddenProjects: [], parked: {} });
  });

  it("keeps only well-formed values", async () => {
    save({
      hiddenProjects: ["alpha", 3, null, "beta"],
      parked: { alpha: "ci:CI failing", beta: 5 },
      projectsDir: "relative/path",
      setupCompletedAt: 123,
      extra: true,
    });
    const { readSettings } = await load();
    expect(readSettings()).toEqual({ hiddenProjects: ["alpha", "beta"], parked: { alpha: "ci:CI failing" } });
  });

  it("reads the projects folder and setup time", async () => {
    save({ projectsDir: "/Users/me/code", setupCompletedAt: "2026-11-09T00:00:00.000Z" });
    const { readSettings } = await load();
    expect(readSettings()).toMatchObject({ projectsDir: "/Users/me/code", setupCompletedAt: "2026-11-09T00:00:00.000Z" });
  });

  it("treats a non-object as empty", async () => {
    save("null");
    const { readSettings } = await load();
    expect(readSettings()).toEqual({ hiddenProjects: [], parked: {} });
  });
});

describe("writeSettings", () => {
  it("writes settings that read back the same", async () => {
    const { readSettings, writeSettings } = await load();
    const data = { hiddenProjects: ["alpha"], parked: { beta: "behind:2 behind" }, projectsDir: "/Users/me/code" };
    writeSettings(data);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual(data);
    expect(readSettings()).toEqual(data);
  });

  it("recreates the data folder if it was removed", async () => {
    const { writeSettings } = await load();
    writeSettings({ hiddenProjects: [], parked: {} });
    fs.rmSync(dataDir, { recursive: true });
    writeSettings({ hiddenProjects: ["x"], parked: {} });
    expect(fs.existsSync(file)).toBe(true);
  });
});

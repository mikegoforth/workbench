import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// notes.ts stores notes.json in the data folder, which dataDir() caches per
// module instance, so each test imports a fresh copy pointed at a temp folder.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-notes-")));
const dataDir = path.join(root, "data");
const notesFile = path.join(dataDir, "notes.json");

async function load() {
  vi.resetModules();
  return import("./notes");
}

beforeEach(() => {
  vi.stubEnv("WORKBENCH_DATA_DIR", dataDir);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("readNotes", () => {
  it("is empty before anything is saved", async () => {
    const { readNotes } = await load();
    expect(readNotes()).toEqual({});
  });

  it("is empty when notes.json is corrupt", async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(notesFile, "{ not json");
    const { readNotes } = await load();
    expect(readNotes()).toEqual({});
  });
});

describe("writeNotes", () => {
  const data = {
    alpha: { notes: "Remember the seed script", todos: [{ id: "1", text: "Fix CI", done: false, createdAt: "2026-01-01T00:00:00.000Z" }] },
  };

  it("saves notes that read back the same", async () => {
    const { readNotes, writeNotes } = await load();
    writeNotes(data);
    expect(readNotes()).toEqual(data);
    // Pretty-printed, so the file is readable by hand.
    expect(fs.readFileSync(notesFile, "utf-8")).toBe(JSON.stringify(data, null, 2));
  });

  it("overwrites what was there", async () => {
    const { readNotes, writeNotes } = await load();
    writeNotes(data);
    writeNotes({ beta: { notes: "", todos: [] } });
    expect(readNotes()).toEqual({ beta: { notes: "", todos: [] } });
  });

  it("recreates the data folder if it was removed", async () => {
    const { readNotes, writeNotes } = await load();
    expect(readNotes()).toEqual({});
    // dataDir() created and cached the folder; take it away underneath it.
    fs.rmSync(dataDir, { recursive: true, force: true });
    writeNotes(data);
    expect(JSON.parse(fs.readFileSync(notesFile, "utf-8"))).toEqual(data);
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "./route";

// Everything is real: notes are saved in a temporary data folder.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-notes-")));
const projects = path.join(root, "projects");
const data = path.join(root, "data");
for (const name of ["alpha", "beta", ".hidden"]) fs.mkdirSync(path.join(projects, name), { recursive: true });
const notesFile = path.join(data, "notes.json");
const saved = () => JSON.parse(fs.readFileSync(notesFile, "utf-8"));

const todo = (text = "ship it") => ({ id: "t1", text, done: false, createdAt: "2026-01-01T00:00:00.000Z" });

const put = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/notes", {
    method: "PUT",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv("WORKBENCH_DATA_DIR", data);
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  fs.rmSync(data, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("PUT /api/notes", () => {
  it("saves notes and todos, each without touching the other", async () => {
    let res = await PUT(put({ projectName: "alpha", notes: "remember the milk" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(saved()).toEqual({ alpha: { notes: "remember the milk", todos: [] } });

    res = await PUT(put({ projectName: "alpha", todos: [todo()] }));
    expect(res.status).toBe(200);
    expect(saved()).toEqual({ alpha: { notes: "remember the milk", todos: [todo()] } });

    await PUT(put({ projectName: "beta", notes: "", todos: [] }));
    expect(saved()).toEqual({
      alpha: { notes: "remember the milk", todos: [todo()] },
      beta: { notes: "", todos: [] },
    });
  });

  it("creates an empty entry when neither field is sent", async () => {
    await PUT(put({ projectName: "alpha" }));
    expect(saved()).toEqual({ alpha: { notes: "", todos: [] } });
  });

  it("refuses a non-localhost Host", async () => {
    const res = await PUT(put({ projectName: "alpha", notes: "x" }, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(fs.existsSync(notesFile)).toBe(false);
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await PUT(put({ projectName: "alpha", notes: "x" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(fs.existsSync(notesFile)).toBe(false);
  });

  it("400s on an invalid JSON body", async () => {
    const res = await PUT(put("{"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([undefined, 1, "missing", "../x", ".hidden", "__proto__", "constructor"])(
    "400s for project %j",
    async (projectName) => {
      const res = await PUT(put({ projectName, notes: "x" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Unknown project" });
      expect(fs.existsSync(notesFile)).toBe(false);
    }
  );

  it("400s for a null body", async () => {
    const res = await PUT(put(null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown project" });
  });

  it.each([
    ["a non-string", 5],
    ["null", null],
    ["over 100,000 characters", "x".repeat(100_001)],
  ])("400s for notes that are %s", async (_label, notes) => {
    const res = await PUT(put({ projectName: "alpha", notes }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("notes must be a string");
  });

  it("accepts notes of exactly 100,000 characters", async () => {
    expect((await PUT(put({ projectName: "alpha", notes: "x".repeat(100_000) }))).status).toBe(200);
  });

  it.each([
    ["not a list", { 0: todo() }],
    ["over 500 items", Array.from({ length: 501 }, () => todo())],
    ["a null item", [null]],
    ["an item without an id", [{ ...todo(), id: undefined }]],
    ["an item with a numeric id", [{ ...todo(), id: 1 }]],
    ["an item without text", [{ ...todo(), text: undefined }]],
    ["an item with over 2,000 characters", [todo("x".repeat(2_001))]],
    ["an item with a string done", [{ ...todo(), done: "no" }]],
    ["an item without createdAt", [{ ...todo(), createdAt: undefined }]],
  ])("400s for todos that are %s", async (_label, todos) => {
    const res = await PUT(put({ projectName: "alpha", todos }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("todos must be a list");
    expect(fs.existsSync(notesFile)).toBe(false);
  });

  it("accepts 500 todos of 2,000 characters", async () => {
    const todos = Array.from({ length: 500 }, (_, i) => ({ ...todo("x".repeat(2_000)), id: `t${i}` }));
    expect((await PUT(put({ projectName: "alpha", todos }))).status).toBe(200);
    expect(saved().alpha.todos).toHaveLength(500);
  });

  it("500s when notes can't be saved", async () => {
    fs.mkdirSync(notesFile, { recursive: true });
    const res = await PUT(put({ projectName: "alpha", notes: "x" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/^Failed to save notes: /);
  });
});

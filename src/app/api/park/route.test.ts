import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "./route";

// Everything is real: settings are saved in a temporary data folder.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-park-")));
const projects = path.join(root, "projects");
const data = path.join(root, "data");
for (const name of ["alpha", "beta", ".hidden"]) fs.mkdirSync(path.join(projects, name), { recursive: true });
const settingsFile = path.join(data, "settings.json");
const saved = () => JSON.parse(fs.readFileSync(settingsFile, "utf-8"));

const put = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/park", {
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

describe("PUT /api/park", () => {
  it("parks and unparks a project", async () => {
    let res = await PUT(put({ projectName: "alpha", fingerprint: "ci:failed|pr:2" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ parked: { alpha: "ci:failed|pr:2" } });

    res = await PUT(put({ projectName: "beta", fingerprint: "" }));
    expect(await res.json()).toEqual({ parked: { alpha: "ci:failed|pr:2", beta: "" } });
    expect(saved().parked).toEqual({ alpha: "ci:failed|pr:2", beta: "" });

    res = await PUT(put({ projectName: "alpha", fingerprint: null }));
    expect(await res.json()).toEqual({ parked: { beta: "" } });
    expect(saved().parked).toEqual({ beta: "" });
  });

  it("unparking a project that isn't parked is fine", async () => {
    const res = await PUT(put({ projectName: "alpha", fingerprint: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ parked: {} });
  });

  it("refuses a non-localhost Host", async () => {
    const res = await PUT(put({ projectName: "alpha", fingerprint: "x" }, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await PUT(put({ projectName: "alpha", fingerprint: "x" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("400s on an invalid JSON body", async () => {
    const res = await PUT(put("]"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([
    ["no project", { fingerprint: "x" }],
    ["a missing project", { projectName: "missing", fingerprint: "x" }],
    ["a parent path", { projectName: "../x", fingerprint: "x" }],
    ["a dot-folder", { projectName: ".hidden", fingerprint: "x" }],
    ["__proto__", { projectName: "__proto__", fingerprint: "x" }],
    ["no fingerprint", { projectName: "alpha" }],
    ["a numeric fingerprint", { projectName: "alpha", fingerprint: 3 }],
    ["a 500-character fingerprint", { projectName: "alpha", fingerprint: "x".repeat(500) }],
    ["a null body", null],
  ])("400s for %s", async (_label, body) => {
    const res = await PUT(put(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("projectName (string) and fingerprint (string or null)");
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("accepts a 499-character fingerprint", async () => {
    const res = await PUT(put({ projectName: "alpha", fingerprint: "x".repeat(499) }));
    expect(res.status).toBe(200);
  });

  it("500s when settings can't be saved", async () => {
    fs.mkdirSync(settingsFile, { recursive: true });
    const res = await PUT(put({ projectName: "alpha", fingerprint: "x" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/^Failed to save settings: /);
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "./route";

// Everything is real: settings are saved in a temporary data folder.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-hidden-")));
const projects = path.join(root, "projects");
const data = path.join(root, "data");
for (const name of ["alpha", "beta", ".hidden"]) fs.mkdirSync(path.join(projects, name), { recursive: true });
const settingsFile = path.join(data, "settings.json");
const saved = () => JSON.parse(fs.readFileSync(settingsFile, "utf-8"));

const put = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/hidden", {
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

describe("PUT /api/hidden", () => {
  it("hides projects, sorted and without duplicates, and unhides them", async () => {
    let res = await PUT(put({ projectName: "beta", hidden: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hiddenProjects: ["beta"] });

    await PUT(put({ projectName: "alpha", hidden: true }));
    res = await PUT(put({ projectName: "alpha", hidden: true }));
    expect(await res.json()).toEqual({ hiddenProjects: ["alpha", "beta"] });
    expect(saved().hiddenProjects).toEqual(["alpha", "beta"]);

    res = await PUT(put({ projectName: "beta", hidden: false }));
    expect(await res.json()).toEqual({ hiddenProjects: ["alpha"] });
    expect(saved().hiddenProjects).toEqual(["alpha"]);
  });

  it("keeps other settings", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ hiddenProjects: [], parked: { beta: "fp" } }));
    await PUT(put({ projectName: "alpha", hidden: true }));
    expect(saved()).toEqual({ hiddenProjects: ["alpha"], parked: { beta: "fp" } });
  });

  it("refuses a non-localhost Host", async () => {
    const res = await PUT(put({ projectName: "alpha", hidden: true }, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await PUT(put({ projectName: "alpha", hidden: true }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("400s on an invalid JSON body", async () => {
    const res = await PUT(put("{"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([
    ["no project", { hidden: true }],
    ["a missing project", { projectName: "missing", hidden: true }],
    ["a parent path", { projectName: "../x", hidden: true }],
    ["a dot-folder", { projectName: ".hidden", hidden: true }],
    ["__proto__", { projectName: "__proto__", hidden: true }],
    ["a non-boolean hidden", { projectName: "alpha", hidden: "yes" }],
    ["no hidden", { projectName: "alpha" }],
    ["a null body", null],
  ])("400s for %s", async (_label, body) => {
    const res = await PUT(put(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("projectName (string) and hidden (boolean)");
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("500s when settings can't be saved", async () => {
    fs.mkdirSync(settingsFile, { recursive: true });
    const res = await PUT(put({ projectName: "alpha", hidden: true }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/^Failed to save settings: /);
  });
});

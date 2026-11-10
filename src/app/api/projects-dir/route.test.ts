import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// connection() needs a live Next request scope; outside one it throws. Here it only
// marks the route as dynamic, so a stand-in that resolves is enough.
const next = vi.hoisted(() => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: next.connection,
}));

import { GET, PUT } from "./route";

// Paths and settings are real, against temporary folders.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-projects-dir-")));
const projects = path.join(root, "projects");
const other = path.join(root, "other");
const data = path.join(root, "data");
fs.mkdirSync(projects, { recursive: true });
fs.mkdirSync(other);
fs.writeFileSync(path.join(root, "file.txt"), "");
const settingsFile = path.join(data, "settings.json");
const saved = () => JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
const tilde = (p: string) => {
  const home = os.homedir();
  return p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
};
const defaultDisplay = "~" + path.sep + "Projects";

const get = (host = "localhost:3000") =>
  new NextRequest("http://localhost:3000/api/projects-dir", { headers: { host } });

const put = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/projects-dir", {
    method: "PUT",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  next.connection.mockClear();
  vi.stubEnv("WORKBENCH_DATA_DIR", data);
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  fs.rmSync(data, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/projects-dir", () => {
  it("describes the folder from the env var", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dir: projects,
      display: tilde(projects),
      source: "env",
      exists: true,
      defaultDisplay,
    });
    expect(next.connection).toHaveBeenCalledOnce();
  });

  it("says when the folder doesn't exist", async () => {
    vi.stubEnv("WORKBENCH_PROJECTS_DIR", path.join(root, "missing"));
    expect(await (await GET(get())).json()).toMatchObject({ dir: path.join(root, "missing"), exists: false });
  });

  it("says when the path is a file", async () => {
    vi.stubEnv("WORKBENCH_PROJECTS_DIR", path.join(root, "file.txt"));
    expect(await (await GET(get())).json()).toMatchObject({ exists: false });
  });

  it("refuses a non-localhost Host", async () => {
    expect((await GET(get("evil.example"))).status).toBe(403);
  });
});

describe("PUT /api/projects-dir", () => {
  it("saves a folder, then goes back to the env var with null", async () => {
    let res = await PUT(put({ dir: other }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dir: other, source: "settings", exists: true });
    expect(saved().projectsDir).toBe(other);

    res = await PUT(put({ dir: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dir: projects, source: "env" });
    expect(saved()).not.toHaveProperty("projectsDir");
  });

  it("normalizes the saved path", async () => {
    const res = await PUT(put({ dir: `  ${projects}/../other/  ` }));
    expect(res.status).toBe(200);
    expect(saved().projectsDir).toBe(other);
  });

  it("refuses a non-localhost Host", async () => {
    const res = await PUT(put({ dir: other }, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await PUT(put({ dir: other }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("400s on an invalid JSON body", async () => {
    const res = await PUT(put("{"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([
    ["no dir", {}, "Enter a folder path"],
    ["a null body", null, "Enter a folder path"],
    ["a non-string", { dir: 5 }, "Enter a folder path"],
    ["a relative path", { dir: "code" }, "Use a full path"],
    ["the disk root", { dir: "/" }, "not the whole disk"],
    ["a file", { dir: path.join(root, "file.txt") }, "isn't a folder"],
    ["a missing folder", { dir: path.join(root, "missing") }, "doesn't exist"],
  ])("400s for %s", async (_label, body, message) => {
    const res = await PUT(put(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("500s when settings can't be saved", async () => {
    fs.mkdirSync(settingsFile, { recursive: true });
    const res = await PUT(put({ dir: other }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/^Failed to save settings: /);
  });
});

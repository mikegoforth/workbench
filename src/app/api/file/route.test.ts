import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// Everything is real here: the guard, project names and file resolution, against
// a temporary projects folder.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-file-")));
const projects = path.join(root, "projects");
const alpha = path.join(projects, "alpha");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
fs.mkdirSync(path.join(alpha, "docs"), { recursive: true });
fs.mkdirSync(path.join(projects, ".hidden"));
fs.writeFileSync(path.join(alpha, "docs", "shot.png"), png);
fs.writeFileSync(path.join(alpha, "Logo.JPG"), "jpeg");
fs.writeFileSync(path.join(alpha, "icon.svg"), "<svg/>");
fs.writeFileSync(path.join(alpha, "notes.txt"), "text");
fs.writeFileSync(path.join(projects, ".hidden", "a.png"), png);
fs.writeFileSync(path.join(root, "secret.png"), "outside");
fs.symlinkSync(path.join(root, "secret.png"), path.join(alpha, "link.png"));
// Sparse: no real 10 MB written.
fs.writeFileSync(path.join(alpha, "huge.png"), "");
fs.truncateSync(path.join(alpha, "huge.png"), 10 * 1024 * 1024 + 1);

const get = (query: string, host = "localhost:3000") =>
  new NextRequest(`http://localhost:3000/api/file${query}`, { headers: { host } });

const q = (project: string, file: string) =>
  `?project=${encodeURIComponent(project)}&path=${encodeURIComponent(file)}`;

beforeEach(() => {
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/file", () => {
  it("serves an image with locked-down headers", async () => {
    const res = await GET(get(q("alpha", "docs/shot.png")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
  });

  it.each([
    ["Logo.JPG", "image/jpeg"],
    ["icon.svg", "image/svg+xml"],
  ])("types %s as %s", async (file, type) => {
    const res = await GET(get(q("alpha", file)));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(type);
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get(q("alpha", "docs/shot.png"), "evil.example"));
    expect(res.status).toBe(403);
  });

  it.each([
    ["no params", ""],
    ["a missing project", q("missing", "docs/shot.png")],
    ["a parent project", q("../projects", "alpha/docs/shot.png")],
    ["a dot-folder project", q(".hidden", "a.png")],
    ["__proto__", q("__proto__", "a.png")],
    ["no path", "?project=alpha"],
    ["a missing file", q("alpha", "nope.png")],
    ["a non-image", q("alpha", "notes.txt")],
    ["a folder", q("alpha", "docs")],
    ["a path out of the project", q("alpha", "../../secret.png")],
    ["an absolute path", q("alpha", path.join(root, "secret.png"))],
    ["a symlink out of the project", q("alpha", "link.png")],
  ])("404s for %s", async (_label, query) => {
    const res = await GET(get(query));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Image not found" });
  });

  it("413s for an image over 10 MB", async () => {
    const res = await GET(get(q("alpha", "huge.png")));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Image too large" });
  });
});

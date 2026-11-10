import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// Everything is real here, against a temporary projects folder.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-readme-")));
const projects = path.join(root, "projects");
for (const name of ["alpha", "big", "bare", ".hidden"]) fs.mkdirSync(path.join(projects, name), { recursive: true });
fs.writeFileSync(path.join(projects, "alpha", "README.md"), "# Alpha\n");
fs.writeFileSync(path.join(projects, "alpha", "README"), "plain");
fs.writeFileSync(path.join(projects, "big", "readme.markdown"), "x".repeat(256 * 1024 + 10));
fs.writeFileSync(path.join(projects, ".hidden", "README.md"), "secret");
// A cloned repo whose README points outside it, and one whose README is a folder.
fs.writeFileSync(path.join(root, "id_ed25519"), "PRIVATE KEY");
fs.mkdirSync(path.join(projects, "sneaky"));
fs.symlinkSync(path.join(root, "id_ed25519"), path.join(projects, "sneaky", "README.md"));
fs.mkdirSync(path.join(projects, "folder", "README.md"), { recursive: true });
fs.mkdirSync(path.join(projects, "linked"));
fs.symlinkSync(path.join(projects, "alpha", "README.md"), path.join(projects, "linked", "README.md"));

const get = (query: string, host = "localhost:3000") =>
  new NextRequest(`http://localhost:3000/api/readme${query}`, { headers: { host } });

beforeEach(() => {
  vi.stubEnv("WORKBENCH_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/readme", () => {
  it("returns the markdown README", async () => {
    const res = await GET(get("?project=alpha"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ file: "README.md", content: "# Alpha\n", truncated: false });
  });

  it("cuts a README off at 256 KB", async () => {
    const res = await GET(get("?project=big"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file).toBe("readme.markdown");
    expect(body.content).toHaveLength(256 * 1024);
    expect(body.truncated).toBe(true);
  });

  it("404s when the project has no README", async () => {
    const res = await GET(get("?project=bare"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No README" });
  });

  it("won't follow a README symlink out of the project", async () => {
    const res = await GET(get("?project=sneaky"));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("PRIVATE KEY");
  });

  it("404s (rather than crashing) when the README is a folder", async () => {
    const res = await GET(get("?project=folder"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No README" });
  });

  it("refuses a README symlink into another project", async () => {
    // linked/README.md -> alpha/README.md leaves the "linked" project.
    expect((await GET(get("?project=linked"))).status).toBe(404);
  });

  it("refuses a non-localhost Host", async () => {
    expect((await GET(get("?project=alpha", "evil.example"))).status).toBe(403);
  });

  it.each(["", "?project=missing", "?project=../projects", "?project=.hidden", "?project=__proto__"])(
    "404s for %j",
    async (query) => {
      const res = await GET(get(query));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Project not found" });
    }
  );
});

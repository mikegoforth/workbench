import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// connection() needs a live Next request scope; outside one it throws. Here it only
// marks the route as dynamic, so a stand-in that resolves is enough.
const next = vi.hoisted(() => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: next.connection,
}));

import { GET, PUT } from "./route";

// Settings are real, saved in a temporary data folder.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-api-setup-")));
const data = path.join(root, "data");
const settingsFile = path.join(data, "settings.json");
const saved = () => JSON.parse(fs.readFileSync(settingsFile, "utf-8"));

const get = (host = "localhost:3000") =>
  new NextRequest("http://localhost:3000/api/setup", { headers: { host } });

const put = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/setup", {
    method: "PUT",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  next.connection.mockClear();
  vi.stubEnv("WORKBENCH_DATA_DIR", data);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  fs.rmSync(data, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/setup", () => {
  it("reports setup as not done on first run", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ completedAt: null });
    expect(next.connection).toHaveBeenCalledOnce();
  });

  it("returns when setup was finished", async () => {
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ setupCompletedAt: "2026-03-04T05:06:07.000Z" }));
    expect(await (await GET(get())).json()).toEqual({ completedAt: "2026-03-04T05:06:07.000Z" });
  });

  it("refuses a non-localhost Host", async () => {
    expect((await GET(get("evil.example"))).status).toBe(403);
  });
});

describe("PUT /api/setup", () => {
  it("marks setup finished now, then resets it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-06T07:08:09.000Z"));
    let res = await PUT(put({ completed: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ completedAt: "2026-05-06T07:08:09.000Z" });
    expect(saved().setupCompletedAt).toBe("2026-05-06T07:08:09.000Z");

    res = await PUT(put({ completed: false }));
    expect(await res.json()).toEqual({ completedAt: null });
    expect(saved()).not.toHaveProperty("setupCompletedAt");
  });

  it("refuses a non-localhost Host", async () => {
    const res = await PUT(put({ completed: true }, { host: "evil.example" }));
    expect(res.status).toBe(403);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("refuses a write without a JSON content type", async () => {
    const res = await PUT(put({ completed: true }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("400s on an invalid JSON body", async () => {
    const res = await PUT(put("{"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([{}, { completed: "yes" }, { completed: 1 }, null])("400s for %j", async (body) => {
    const res = await PUT(put(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "completed (boolean) is required" });
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("500s when settings can't be saved", async () => {
    fs.mkdirSync(settingsFile, { recursive: true });
    const res = await PUT(put({ completed: true }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/^Failed to save settings: /);
  });
});

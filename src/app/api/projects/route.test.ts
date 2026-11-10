import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scan = vi.hoisted(() => ({ scanAll: vi.fn() }));
vi.mock("@/lib/scan", () => scan);

// connection() needs a live Next request scope; outside one it throws. Here it only
// marks the route as dynamic, so a stand-in that resolves is enough.
const next = vi.hoisted(() => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: next.connection,
}));

import { GET } from "./route";

const get = (host = "localhost:3000") =>
  new NextRequest("http://localhost:3000/api/projects", { headers: { host } });

beforeEach(() => {
  vi.resetAllMocks();
  next.connection.mockResolvedValue(undefined);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

describe("GET /api/projects", () => {
  it("returns the scanned projects", async () => {
    const result = { projects: [{ name: "alpha" }], hidden: [] };
    scan.scanAll.mockResolvedValue(result);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(next.connection).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual(result);
  });

  it("maps a scan failure to 500", async () => {
    scan.scanAll.mockRejectedValue(new Error("EACCES"));
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to scan projects: EACCES" });
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get("evil.example"));
    expect(res.status).toBe(403);
    expect(scan.scanAll).not.toHaveBeenCalled();
  });
});

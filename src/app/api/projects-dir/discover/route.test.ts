import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const discover = vi.hoisted(() => ({ discoverProjectRoots: vi.fn() }));
vi.mock("@/lib/discover", () => discover);

// connection() needs a live Next request scope; outside one it throws. Here it only
// marks the route as dynamic, so a stand-in that resolves is enough.
const next = vi.hoisted(() => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: next.connection,
}));

import { GET } from "./route";

const get = (host = "localhost:3000") =>
  new NextRequest("http://localhost:3000/api/projects-dir/discover", { headers: { host } });

beforeEach(() => {
  vi.resetAllMocks();
  next.connection.mockResolvedValue(undefined);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

describe("GET /api/projects-dir/discover", () => {
  it("returns the suggested folders", async () => {
    const roots = [{ dir: "/Users/me/code", display: "~/code", repos: 12, github: 9 }];
    discover.discoverProjectRoots.mockResolvedValue(roots);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(next.connection).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual(roots);
  });

  it("maps a failure to 500", async () => {
    discover.discoverProjectRoots.mockRejectedValue(new Error("timed out"));
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't scan for repositories: timed out" });
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get("evil.example"));
    expect(res.status).toBe(403);
    expect(discover.discoverProjectRoots).not.toHaveBeenCalled();
  });
});

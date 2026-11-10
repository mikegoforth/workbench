import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requirements = vi.hoisted(() => ({ checkRequirements: vi.fn() }));
vi.mock("@/lib/requirements", () => requirements);

// connection() needs a live Next request scope; outside one it throws. Here it only
// marks the route as dynamic, so a stand-in that resolves is enough.
const next = vi.hoisted(() => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: next.connection,
}));

import { GET } from "./route";

const get = (host = "localhost:3000") =>
  new NextRequest("http://localhost:3000/api/requirements", { headers: { host } });

beforeEach(() => {
  vi.resetAllMocks();
  next.connection.mockResolvedValue(undefined);
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

describe("GET /api/requirements", () => {
  it("returns the requirement checks", async () => {
    const checks = [{ name: "Node", installed: true, version: "22.12.0" }];
    requirements.checkRequirements.mockResolvedValue(checks);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(next.connection).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual(checks);
    expect(requirements.checkRequirements).toHaveBeenCalledOnce();
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get("192.168.1.20"));
    expect(res.status).toBe(403);
    expect(requirements.checkRequirements).not.toHaveBeenCalled();
  });
});

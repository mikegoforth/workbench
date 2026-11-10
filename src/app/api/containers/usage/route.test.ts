import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// docker stats is mocked away; only the guard is real.
const containers = vi.hoisted(() => ({ containerUsage: vi.fn() }));
vi.mock("@/lib/containers", () => containers);

import { GET } from "./route";

const get = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/containers/usage", { headers: { host: "localhost:3000", ...headers } });

const USAGE = { at: "2026-11-09T12:00:00.000Z", error: null, usage: { ["ab".repeat(32)]: { cpu: 9.87, memory: 134_427_443, memoryLimit: 8_316_000_000 } } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
  containers.containerUsage.mockResolvedValue(USAGE);
});

describe("GET /api/containers/usage", () => {
  it("returns the latest CPU and memory sample", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(USAGE);
  });

  it("only answers on localhost", async () => {
    const res = await GET(get({ host: "10.0.0.5:3000" }));
    expect(res.status).toBe(403);
    expect(containers.containerUsage).not.toHaveBeenCalled();
  });
});

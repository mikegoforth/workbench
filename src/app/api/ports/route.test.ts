import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({ listPorts: vi.fn() }));
vi.mock("@/lib/ports", () => ports);

import { GET } from "./route";

const get = (host = "localhost:3000", headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/ports?cmd=rm%20-rf", { headers: { host, ...headers } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

describe("GET /api/ports", () => {
  it("returns the listening ports, ignoring anything in the query", async () => {
    const result = {
      ports: [
        {
          port: 3000,
          addresses: ["127.0.0.1"],
          scope: "loopback",
          pid: 42,
          process: "node",
          startedAt: null,
          owner: { kind: "run", project: "alpha", slot: "dev", task: "dev", script: null },
          url: "http://localhost:3000",
        },
      ],
      source: "lsof",
      error: null,
      note: null,
      scannedAt: "2026-11-09T10:00:00.000Z",
    };
    ports.listPorts.mockResolvedValue(result);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(ports.listPorts).toHaveBeenCalledWith();
  });

  it("says why when listing fails", async () => {
    ports.listPorts.mockRejectedValue(new Error("boom"));
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get("evil.example"));
    expect(res.status).toBe(403);
    expect(ports.listPorts).not.toHaveBeenCalled();
  });

  it("refuses the desktop app's API without its token", async () => {
    vi.stubEnv("WORKBENCH_API_TOKEN", "secret");
    ports.listPorts.mockResolvedValue({ ports: [], source: "lsof", error: null, note: null, scannedAt: "2026-11-09T10:00:00.000Z" });
    expect((await GET(get())).status).toBe(403);
    expect((await GET(get("localhost:3000", { "x-workbench-token": "secret" }))).status).toBe(200);
  });
});

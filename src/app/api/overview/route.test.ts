import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const overview = vi.hoisted(() => ({ buildOverview: vi.fn() }));
vi.mock("@/lib/overview", () => overview);

import { GET } from "./route";

const get = (query = "", host = "localhost:3000") =>
  new NextRequest(`http://localhost:3000/api/overview${query}`, { headers: { host } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

describe("GET /api/overview", () => {
  it("returns the overview, cached by default", async () => {
    overview.buildOverview.mockResolvedValue({ projects: { alpha: { warnings: [] } } });
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projects: { alpha: { warnings: [] } } });
    expect(overview.buildOverview).toHaveBeenCalledWith({ fresh: false });
  });

  it.each([
    ["?fresh=1", true],
    ["?fresh=0", false],
    ["?fresh=true", false],
  ])("passes %s as fresh: %s", async (query, fresh) => {
    overview.buildOverview.mockResolvedValue({});
    await GET(get(query));
    expect(overview.buildOverview).toHaveBeenCalledWith({ fresh });
  });

  it("maps a failure to 500", async () => {
    overview.buildOverview.mockRejectedValue(new Error("gh exploded"));
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "gh exploded" });
  });

  it("refuses a non-localhost Host", async () => {
    const res = await GET(get("", "evil.example:3000"));
    expect(res.status).toBe(403);
    expect(overview.buildOverview).not.toHaveBeenCalled();
  });
});

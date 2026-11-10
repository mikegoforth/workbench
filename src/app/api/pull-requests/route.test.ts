import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The lib is mocked (its own tests cover gh); the guard is real.
const lib = vi.hoisted(() => {
  class PullRequestsError extends Error {
    constructor(
      public status: number,
      public reason: string,
      message: string
    ) {
      super(message);
    }
  }
  return { PullRequestsError, pullRequests: vi.fn() };
});
vi.mock("@/lib/pullRequests", () => lib);

import { GET } from "./route";

const get = (query = "", host = "localhost:3000") =>
  new NextRequest(`http://localhost:3000/api/pull-requests${query}`, { headers: { host } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKBENCH_API_TOKEN", "");
});

describe("GET /api/pull-requests", () => {
  const prs = {
    viewer: "octocat",
    review: { items: [], total: 0, truncated: false },
    authored: { items: [], total: 0, truncated: false },
    assigned: { items: [], total: 0, truncated: false },
    warning: null,
    fetchedAt: "2026-11-09T00:00:00.000Z",
  };

  it("returns the pull requests, cached by default", async () => {
    lib.pullRequests.mockResolvedValue(prs);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(prs);
    expect(lib.pullRequests).toHaveBeenCalledWith({ fresh: false });
  });

  it("asks for fresh data with fresh=1, and ignores anything else in the query", async () => {
    lib.pullRequests.mockResolvedValue(prs);
    await GET(get("?fresh=1&q=author:someone-else"));
    expect(lib.pullRequests).toHaveBeenCalledWith({ fresh: true });
    await GET(get("?fresh=yes"));
    expect(lib.pullRequests).toHaveBeenLastCalledWith({ fresh: false });
  });

  it("refuses a non-localhost Host", async () => {
    expect((await GET(get("", "evil.example"))).status).toBe(403);
    expect(lib.pullRequests).not.toHaveBeenCalled();
  });

  it.each([
    [503, "missing", "GitHub CLI (gh) isn't installed"],
    [401, "signed-out", "GitHub CLI isn't signed in"],
    [429, "rate-limited", "GitHub's API rate limit is used up. Try again in a few minutes."],
  ])("passes a %i (%s) through with its reason", async (status, reason, message) => {
    lib.pullRequests.mockRejectedValue(new lib.PullRequestsError(status, reason, message));
    const res = await GET(get());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message, reason });
  });

  it("maps other errors to 500", async () => {
    lib.pullRequests.mockRejectedValue(new Error("boom"));
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom", reason: "failed" });
  });
});

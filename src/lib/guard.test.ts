import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { rejectNonLocal, rejectUntrusted, TOKEN_HEADER } from "./guard";

const request = (headers: Record<string, string>, method = "GET") =>
  new NextRequest("http://127.0.0.1:3000/api/projects", { method, headers });

describe("rejectUntrusted", () => {
  it.each(["localhost", "localhost:3000", "127.0.0.1:61171", "[::1]:3000", "LOCALHOST:3000"])(
    "lets a request for %s through",
    (host) => {
      expect(rejectUntrusted(request({ host }))).toBeNull();
    }
  );

  // DNS rebinding (a page on evil.example resolving to 127.0.0.1) and LAN access.
  it.each(["evil.example", "evil.example:3000", "192.168.1.20:3000", "localhost.evil.example", "127.0.0.1.nip.io", ""])(
    "refuses a request for %j",
    async (host) => {
      const res = rejectUntrusted(request({ host }));
      expect(res?.status).toBe(403);
      expect(await res?.json()).toEqual({ error: "Only available from localhost" });
    }
  );

  describe("with the desktop app's token set", () => {
    const token = "a".repeat(64);

    it("lets a request with the right token through", () => {
      vi.stubEnv("WORKBENCH_API_TOKEN", token);
      expect(rejectUntrusted(request({ host: "127.0.0.1", [TOKEN_HEADER]: token }))).toBeNull();
    });

    it.each([
      ["no token", {}],
      ["a wrong token", { [TOKEN_HEADER]: "b".repeat(64) }],
      ["a token of a different length", { [TOKEN_HEADER]: "a".repeat(63) }],
      ["an empty token", { [TOKEN_HEADER]: "" }],
    ])("refuses a request with %s", (_label, headers) => {
      vi.stubEnv("WORKBENCH_API_TOKEN", token);
      expect(rejectUntrusted(request({ host: "127.0.0.1", ...headers }))?.status).toBe(403);
    });

    it("still checks the host first", () => {
      vi.stubEnv("WORKBENCH_API_TOKEN", token);
      expect(rejectUntrusted(request({ host: "evil.example", [TOKEN_HEADER]: token }))?.status).toBe(403);
    });
  });

  it("doesn't ask for a token when none is set (npm run dev)", () => {
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    expect(rejectUntrusted(request({ host: "localhost:3000" }))).toBeNull();
  });
});

describe("rejectNonLocal", () => {
  const host = "localhost:3000";

  it("lets a read through without a content type", () => {
    expect(rejectNonLocal(request({ host }), { write: false })).toBeNull();
  });

  it.each(["application/json", "application/json; charset=utf-8", "Application/JSON"])(
    "lets a write with %s through",
    (type) => {
      expect(rejectNonLocal(request({ host, "content-type": type }, "POST"), { write: true })).toBeNull();
    }
  );

  // Content types a cross-site page can send without a CORS preflight.
  it.each([undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"])(
    "refuses a write sent as %s",
    (type) => {
      const headers: Record<string, string> = { host };
      if (type) headers["content-type"] = type;
      expect(rejectNonLocal(request(headers, "POST"), { write: true })?.status).toBe(415);
    }
  );

  it("applies the host check too", () => {
    const res = rejectNonLocal(request({ host: "evil.example", "content-type": "application/json" }, "POST"), { write: true });
    expect(res?.status).toBe(403);
  });
});

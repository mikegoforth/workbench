import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

describe("proxy", () => {
  it("only runs for API routes", () => {
    expect(config.matcher).toBe("/api/:path*");
  });

  it("passes a localhost request on", () => {
    const res = proxy(new NextRequest("http://localhost:3000/api/projects", { headers: { host: "localhost:3000" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("refuses a request for another host", () => {
    const res = proxy(new NextRequest("http://evil.example/api/projects", { headers: { host: "evil.example" } }));
    expect(res.status).toBe(403);
  });
});

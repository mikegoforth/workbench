import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Header the desktop app adds to every request from its window. */
export const TOKEN_HEADER = "x-workbench-token";

function tokenMatches(sent: string | null, expected: string): boolean {
  if (!sent) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Who may call the API at all. Returns an error response, or null to proceed.
 * Runs for every /api request (src/proxy.ts) and again in each route.
 *
 * - The Host header must be a loopback name. This blocks DNS-rebinding pages
 *   and requests that reach the dev server over the LAN.
 * - In the desktop app, WORKBENCH_API_TOKEN is a random secret made at each
 *   launch, and the app's window sends it on every request. Other programs on
 *   this Mac can reach 127.0.0.1 too, but don't know it, so they can't start
 *   scripts or read project files through the API. (`npm run dev` has no
 *   token: there, only the Host and Content-Type checks apply.)
 */
export function rejectUntrusted(request: NextRequest): NextResponse | null {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    return NextResponse.json({ error: "Only available from localhost" }, { status: 403 });
  }
  const token = process.env.WORKBENCH_API_TOKEN;
  if (token && !tokenMatches(request.headers.get(TOKEN_HEADER), token)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  return null;
}

/**
 * For routes that run commands on this machine or change saved state.
 * Returns an error response to send back, or null if the request may proceed.
 *
 * On top of rejectUntrusted: writes must send `Content-Type: application/json`.
 * Browsers only allow a cross-site page to send that after a CORS preflight,
 * which these routes never approve, so other websites can't fire requests here.
 */
export function rejectNonLocal(
  request: NextRequest,
  { write }: { write: boolean }
): NextResponse | null {
  const untrusted = rejectUntrusted(request);
  if (untrusted) return untrusted;
  const type = request.headers.get("content-type") ?? "";
  if (write && !type.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "Expected Content-Type: application/json" },
      { status: 415 }
    );
  }
  return null;
}

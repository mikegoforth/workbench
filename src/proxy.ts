import { NextResponse, type NextRequest } from "next/server";
import { rejectUntrusted } from "@/lib/guard";

// Every API request passes the localhost (and, in the desktop app, token)
// check here, so a route that forgets its own guard is still covered.
export function proxy(request: NextRequest) {
  return rejectUntrusted(request) ?? NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};

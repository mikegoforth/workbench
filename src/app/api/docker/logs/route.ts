import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { projectLogs } from "@/lib/docker";

// GET /api/docker/logs?project=<name>[&since=<RFC 3339 timestamp>] — recent
// output from the project's containers, merged in time order. With `since`,
// only lines from then on (the client drops the overlap).
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;

  const name = request.nextUrl.searchParams.get("project");
  if (!name || !resolveProjectDir(name)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(await projectLogs(name, request.nextUrl.searchParams.get("since")));
}

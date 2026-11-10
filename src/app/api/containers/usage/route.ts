import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { containerUsage } from "@/lib/containers";

// GET /api/containers/usage — CPU and memory of every running container, from
// one `docker stats --no-stream` sample (shared for a few seconds). Slower
// than the list, so the page asks for it on its own, less often.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  return NextResponse.json(await containerUsage());
}

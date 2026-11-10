import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { listPorts } from "@/lib/ports";

// GET /api/ports — every TCP port listening on this machine and what holds it:
// a process workbench started for a project, a Docker container, workbench
// itself, or another process. Takes no parameters: nothing from the request
// reaches the commands that list them.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  try {
    return NextResponse.json(await listPorts());
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

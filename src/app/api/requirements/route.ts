import { connection, NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { checkRequirements } from "@/lib/requirements";

// GET /api/requirements — is Node, Docker and Git installed, with versions and where to get them.
export async function GET(request: NextRequest) {
  await connection();
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  return NextResponse.json(await checkRequirements());
}

import { connection, NextRequest, NextResponse } from "next/server";
import { discoverProjectRoots } from "@/lib/discover";
import { rejectNonLocal } from "@/lib/guard";

// GET /api/projects-dir/discover — look through the home folder for git repos and
// suggest the folders that hold them, most GitHub repos first. Takes a few seconds.
export async function GET(request: NextRequest) {
  await connection();
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  try {
    return NextResponse.json(await discoverProjectRoots());
  } catch (error) {
    return NextResponse.json(
      { error: "Couldn't scan for repositories: " + (error as Error).message },
      { status: 500 }
    );
  }
}

import { connection, NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { scanAll } from "@/lib/scan";

export async function GET(request: NextRequest) {
  // Always scan at request time; never prerender this at build.
  await connection();
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  try {
    return NextResponse.json(await scanAll());
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to scan projects: " + (error as Error).message },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { buildOverview } from "@/lib/overview";

// GET /api/overview[?fresh=1] — setup warnings and GitHub CI/reviews for every project.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  try {
    return NextResponse.json(
      await buildOverview({ fresh: request.nextUrl.searchParams.get("fresh") === "1" })
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

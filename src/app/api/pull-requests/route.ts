import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { PullRequestsError, pullRequests } from "@/lib/pullRequests";

// GET /api/pull-requests[?fresh=1] — open PRs waiting on your review, yours, and assigned to you, across GitHub.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  try {
    return NextResponse.json(await pullRequests({ fresh: request.nextUrl.searchParams.get("fresh") === "1" }));
  } catch (error) {
    if (error instanceof PullRequestsError) {
      return NextResponse.json({ error: error.message, reason: error.reason }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message, reason: "failed" }, { status: 500 });
  }
}

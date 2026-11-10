import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { GitHubError, githubStatus } from "@/lib/github";

// GET /api/github?project=<name>[&fresh=1] — PRs, issues and CI for the project's GitHub repo.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;

  const params = request.nextUrl.searchParams;
  const dir = resolveProjectDir(params.get("project"));
  if (!dir) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    return NextResponse.json(await githubStatus(dir, { fresh: params.get("fresh") === "1" }));
  } catch (error) {
    const status = error instanceof GitHubError ? error.status : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

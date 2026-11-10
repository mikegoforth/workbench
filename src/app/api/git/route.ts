import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { fetchRemotes, GitError, gitHistory, pullFastForward } from "@/lib/gitinfo";
import { scanProject } from "@/lib/scan";

function resolveRepo(name: unknown): string | null {
  const dir = resolveProjectDir(name);
  return dir && fs.existsSync(path.join(dir, ".git")) ? dir : null;
}

// GET /api/git?project=<name> — recent commits, branches and stashes.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;

  const dir = resolveRepo(request.nextUrl.searchParams.get("project"));
  if (!dir) return NextResponse.json({ error: "Not a git repository" }, { status: 404 });
  try {
    return NextResponse.json(await gitHistory(dir));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/git { projectName, action: "fetch" | "pull" } — returns the rescanned project.
export async function POST(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { projectName?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectName, action } = body ?? {};
  if (action !== "fetch" && action !== "pull") {
    return NextResponse.json({ error: 'action must be "fetch" or "pull"' }, { status: 400 });
  }
  const dir = resolveRepo(projectName);
  if (typeof projectName !== "string" || !dir) {
    return NextResponse.json({ error: "Not a git repository" }, { status: 404 });
  }

  try {
    const output = action === "fetch" ? await fetchRemotes(dir) : await pullFastForward(dir);
    return NextResponse.json({ output, project: await scanProject(projectName) });
  } catch (error) {
    const status = error instanceof GitError ? 409 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

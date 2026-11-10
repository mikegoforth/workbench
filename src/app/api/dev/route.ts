import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { isSelf, resolveProjectDir } from "@/lib/paths";
import { DevError, getStatus, install, start, stop } from "@/lib/devenv";

// Workbench can't start or stop itself.
const resolveTarget = (name: unknown) => {
  const dir = resolveProjectDir(name);
  return dir && !isSelf(dir) ? dir : null;
};

// GET /api/dev?project=<name> — dev environment status and recent output.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;

  const name = request.nextUrl.searchParams.get("project");
  const dir = resolveTarget(name);
  if (!name || !dir) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(await getStatus(name, dir));
}

// POST /api/dev { projectName, action: "start" | "stop" | "install" } — returns the new status.
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
  if (action !== "start" && action !== "stop" && action !== "install") {
    return NextResponse.json(
      { error: 'action must be "start", "stop" or "install"' },
      { status: 400 }
    );
  }
  const dir = resolveTarget(projectName);
  if (typeof projectName !== "string" || !dir) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const run = { start, stop, install }[action];
    await run(projectName, dir);
    return NextResponse.json(await getStatus(projectName, dir));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: error instanceof DevError ? error.status : 500 }
    );
  }
}

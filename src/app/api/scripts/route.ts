import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { isSelf, resolveProjectDir } from "@/lib/paths";
import { DevError, runScript, scriptStatus, stopScript } from "@/lib/devenv";

const resolveTarget = (name: unknown) => {
  const dir = resolveProjectDir(name);
  return dir && !isSelf(dir) ? dir : null;
};

// GET /api/scripts?project=<name> — package.json scripts and the last run's output.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;

  const name = request.nextUrl.searchParams.get("project");
  const dir = resolveTarget(name);
  if (!name || !dir) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(await scriptStatus(name, dir));
}

// POST /api/scripts { projectName, action: "run", script } | { projectName, action: "stop" }
export async function POST(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { projectName?: unknown; action?: unknown; script?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectName, action, script } = body ?? {};
  const dir = resolveTarget(projectName);
  if (typeof projectName !== "string" || !dir) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    if (action === "run" && typeof script === "string") await runScript(projectName, dir, script);
    else if (action === "stop") await stopScript(projectName);
    else {
      return NextResponse.json(
        { error: 'Send action "run" with a script name, or action "stop"' },
        { status: 400 }
      );
    }
    return NextResponse.json(await scriptStatus(projectName, dir));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: error instanceof DevError ? error.status : 500 }
    );
  }
}

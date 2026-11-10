import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { isSelf, resolveProjectDir } from "@/lib/paths";
import { DevError, getStatus, stackAction, type StackAction } from "@/lib/devenv";
import { dockerSnapshot, invalidateDocker, startDaemon } from "@/lib/docker";

const STACK_ACTIONS: StackAction[] = ["start", "stop", "restart"];

/**
 * POST /api/docker
 *   { action: "start-daemon" }                        — launch Docker Desktop; returns the daemon state
 *   { projectName, stack, dir, action: "start" | "stop" | "restart" } — one compose stack (by name and
 *     folder relative to the project); returns the dev status
 */
export async function POST(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { projectName?: unknown; stack?: unknown; dir?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectName, stack, dir: stackDir, action } = body ?? {};

  if (action === "start-daemon") {
    try {
      await startDaemon();
      invalidateDocker();
      return NextResponse.json({ docker: (await dockerSnapshot()).daemon });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  if (!STACK_ACTIONS.includes(action as StackAction)) {
    return NextResponse.json({ error: 'action must be "start-daemon", "start", "stop" or "restart"' }, { status: 400 });
  }
  const resolved = resolveProjectDir(projectName);
  const dir = resolved && !isSelf(resolved) ? resolved : null;
  if (typeof projectName !== "string" || !dir) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (typeof stack !== "string" || !stack || typeof stackDir !== "string") {
    return NextResponse.json({ error: "stack and dir are required" }, { status: 400 });
  }

  try {
    await stackAction(projectName, dir, stack, stackDir, action as StackAction);
    return NextResponse.json(await getStatus(projectName, dir));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: error instanceof DevError ? error.status : 500 }
    );
  }
}

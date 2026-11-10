import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { isSelf, resolveProjectDir } from "@/lib/paths";
import { DevError, stackAction, type StackAction } from "@/lib/devenv";
import { ContainerError, listContainers, otherContainerAction } from "@/lib/containers";

const STACK_ACTIONS: StackAction[] = ["start", "stop", "restart"];

/** GET /api/containers — every container on this machine, grouped by project and compose stack. */
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  return NextResponse.json(await listContainers());
}

/**
 * POST /api/containers — returns the updated list.
 *   { project, stack, dir, action: "start" | "stop" | "restart" } — one compose stack of a project,
 *     by name and folder relative to the project (the same path as /api/docker)
 *   { id, action: "stop" | "remove" } — one container that belongs to no project (full id)
 */
export async function POST(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { project?: unknown; stack?: unknown; dir?: unknown; id?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { project, stack, dir: stackDir, id, action } = body ?? {};

  try {
    if (project !== undefined) {
      if (!STACK_ACTIONS.includes(action as StackAction)) {
        return NextResponse.json({ error: 'action must be "start", "stop" or "restart"' }, { status: 400 });
      }
      const resolved = resolveProjectDir(project);
      const dir = resolved && !isSelf(resolved) ? resolved : null;
      if (typeof project !== "string" || !dir) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      if (typeof stack !== "string" || !stack || typeof stackDir !== "string") {
        return NextResponse.json({ error: "stack and dir are required" }, { status: 400 });
      }
      await stackAction(project, dir, stack, stackDir, action as StackAction);
    } else {
      await otherContainerAction(id, action);
    }
    return NextResponse.json(await listContainers());
  } catch (error) {
    const status = error instanceof DevError || error instanceof ContainerError ? error.status : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

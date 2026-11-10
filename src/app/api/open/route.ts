import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { resolveFileIn } from "@/lib/files";

const run = promisify(execFile);

// POST /api/open { projectName, file?, app? } — opens the project in VS Code
// (optionally one of its files, in that project's window), or with
// app: "terminal" opens a Terminal window there. Names are resolved inside
// the projects folder and passed via execFile (no shell), so callers can't open
// arbitrary paths or inject commands.
export async function POST(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { projectName?: unknown; file?: unknown; app?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectDir = resolveProjectDir(body?.projectName);
  if (!projectDir) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (body.app === "terminal") {
    if (process.platform !== "darwin") {
      return NextResponse.json({ error: "Open in Terminal only works on macOS" }, { status: 501 });
    }
    try {
      await run("open", ["-a", "Terminal", projectDir], { timeout: 10_000 });
      return NextResponse.json({ success: true });
    } catch (error) {
      return NextResponse.json(
        { error: "Couldn't open Terminal: " + (error as Error).message },
        { status: 500 }
      );
    }
  }

  let file: string | null = null;
  if (body.file !== undefined) {
    file = resolveFileIn(projectDir, body.file);
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    try {
      // Passing the folder too makes VS Code use (or open) that project's window.
      await run("code", file ? [projectDir, file] : [projectDir], { timeout: 10_000 });
    } catch (e) {
      // `code` CLI not on PATH: launch the app directly on macOS instead.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || process.platform !== "darwin") {
        throw e;
      }
      await run("open", ["-a", "Visual Studio Code", file ?? projectDir], { timeout: 10_000 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Couldn't open VS Code: " + (error as Error).message },
      { status: 500 }
    );
  }
}

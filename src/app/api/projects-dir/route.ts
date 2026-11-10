import fs from "fs";
import { connection, NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { DEFAULT_PROJECTS_DIR, projectsDirInfo, tildify, validateProjectsDir } from "@/lib/paths";
import { readSettings, writeSettings } from "@/lib/settings";
import type { ProjectsDirInfo } from "@/lib/types";

function describe(): ProjectsDirInfo {
  const { dir, source } = projectsDirInfo();
  let exists = false;
  try {
    exists = fs.statSync(dir).isDirectory();
  } catch {}
  return { dir, display: tildify(dir), source, exists, defaultDisplay: tildify(DEFAULT_PROJECTS_DIR) };
}

// GET /api/projects-dir — the folder scanned for projects, and where that setting came from.
export async function GET(request: NextRequest) {
  await connection();
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  return NextResponse.json(describe());
}

// PUT /api/projects-dir { dir: string | null } — save a projects folder, or null to go back
// to WORKBENCH_PROJECTS_DIR / ~/Projects. Persisted in data/settings.json.
export async function PUT(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { dir?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let dir: string | undefined;
  if (body?.dir !== null) {
    const checked = validateProjectsDir(body?.dir);
    if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
    dir = checked.dir;
  }

  try {
    const settings = readSettings();
    if (dir) settings.projectsDir = dir;
    else delete settings.projectsDir;
    writeSettings(settings);
    return NextResponse.json(describe());
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save settings: " + (error as Error).message },
      { status: 500 }
    );
  }
}

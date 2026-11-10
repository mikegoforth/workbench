import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { readSettings, writeSettings } from "@/lib/settings";

// Hide or unhide a project in the dashboard. Persisted in data/settings.json.
export async function PUT(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { projectName?: unknown; hidden?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectName, hidden } = body ?? {};
  if (typeof projectName !== "string" || !resolveProjectDir(projectName) || typeof hidden !== "boolean") {
    return NextResponse.json(
      { error: "projectName (string) and hidden (boolean) are required" },
      { status: 400 }
    );
  }

  try {
    const settings = readSettings();
    const names = new Set(settings.hiddenProjects);
    if (hidden) names.add(projectName);
    else names.delete(projectName);
    settings.hiddenProjects = [...names].sort();
    writeSettings(settings);
    return NextResponse.json({ hiddenProjects: settings.hiddenProjects });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save settings: " + (error as Error).message },
      { status: 500 }
    );
  }
}

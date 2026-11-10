import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { readSettings, writeSettings } from "@/lib/settings";

// PUT /api/park { projectName, fingerprint: string | null }
// Park a strip's current conditions (it stays in Quiet until they change), or unpark it.
export async function PUT(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { projectName?: unknown; fingerprint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectName, fingerprint } = body ?? {};
  if (
    typeof projectName !== "string" ||
    !resolveProjectDir(projectName) ||
    !(fingerprint === null || (typeof fingerprint === "string" && fingerprint.length < 500))
  ) {
    return NextResponse.json(
      { error: "projectName (string) and fingerprint (string or null) are required" },
      { status: 400 }
    );
  }

  try {
    const settings = readSettings();
    if (fingerprint === null) delete settings.parked[projectName];
    else settings.parked[projectName] = fingerprint;
    writeSettings(settings);
    return NextResponse.json({ parked: settings.parked });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save settings: " + (error as Error).message },
      { status: 500 }
    );
  }
}

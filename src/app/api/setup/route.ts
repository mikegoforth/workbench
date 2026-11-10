import { connection, NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { readSettings, writeSettings } from "@/lib/settings";

// GET /api/setup — has first-run setup been finished?
export async function GET(request: NextRequest) {
  await connection();
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  return NextResponse.json({ completedAt: readSettings().setupCompletedAt ?? null });
}

// PUT /api/setup { completed: boolean } — finish setup, or reset it so it shows again.
export async function PUT(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { completed?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body?.completed !== "boolean") {
    return NextResponse.json({ error: "completed (boolean) is required" }, { status: 400 });
  }

  try {
    const settings = readSettings();
    if (body.completed) settings.setupCompletedAt = new Date().toISOString();
    else delete settings.setupCompletedAt;
    writeSettings(settings);
    return NextResponse.json({ completedAt: settings.setupCompletedAt ?? null });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save settings: " + (error as Error).message }, { status: 500 });
  }
}

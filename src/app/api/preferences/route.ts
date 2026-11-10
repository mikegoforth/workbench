import { connection, NextRequest, NextResponse } from "next/server";
import { editorChoices, terminalChoices } from "@/lib/apps";
import { rejectNonLocal } from "@/lib/guard";
import { platform } from "@/lib/platform";
import { isEditorId, isRescanId, isTerminalFor, resolvePreferences, type StoredPreferences } from "@/lib/preferences";
import { readSettings, writeSettings } from "@/lib/settings";
import type { PreferencesInfo } from "@/lib/types";

function describe(): PreferencesInfo {
  const os = platform();
  const preferences = resolvePreferences(readSettings().preferences, os);
  return {
    platform: os,
    preferences,
    editors: editorChoices(preferences.editor),
    terminals: terminalChoices(preferences.terminal, os),
  };
}

// GET /api/preferences — the editor, terminal and rescan interval in effect,
// and the editors and terminals installed on this machine to choose from.
export async function GET(request: NextRequest) {
  await connection();
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  return NextResponse.json(describe());
}

// PUT /api/preferences { editor?, terminal?, rescan? } — save any of them.
// Each must be an id from the fixed lists in lib/preferences.ts (a terminal
// one this system offers); anything else is refused, and nothing is saved.
export async function PUT(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected an object" }, { status: 400 });
  }

  const unknown = Object.keys(body).filter((k) => k !== "editor" && k !== "terminal" && k !== "rescan");
  if (unknown.length > 0) {
    return NextResponse.json({ error: `Unknown preference: ${unknown[0]}` }, { status: 400 });
  }
  const patch: StoredPreferences = {};
  if (body.editor !== undefined) {
    if (!isEditorId(body.editor)) return NextResponse.json({ error: "Unknown editor" }, { status: 400 });
    patch.editor = body.editor;
  }
  if (body.terminal !== undefined) {
    if (!isTerminalFor(platform(), body.terminal)) return NextResponse.json({ error: "Unknown terminal" }, { status: 400 });
    patch.terminal = body.terminal;
  }
  if (body.rescan !== undefined) {
    if (!isRescanId(body.rescan)) return NextResponse.json({ error: "Unknown rescan interval" }, { status: 400 });
    patch.rescan = body.rescan;
  }

  try {
    const settings = readSettings();
    settings.preferences = { ...settings.preferences, ...patch };
    writeSettings(settings);
    return NextResponse.json(describe());
  } catch (error) {
    return NextResponse.json({ error: "Failed to save settings: " + (error as Error).message }, { status: 500 });
  }
}

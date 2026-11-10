import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { findReadme, resolveFileIn } from "@/lib/files";

const MAX_BYTES = 256 * 1024;

// GET /api/readme?project=<name> — { file, content, truncated } or 404.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;

  const dir = resolveProjectDir(request.nextUrl.searchParams.get("project"));
  if (!dir) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const file = findReadme(dir);
  // Same containment as /api/file: a cloned repo could ship
  // README.md -> ~/.ssh/id_ed25519, or a folder named README.
  const full = file ? resolveFileIn(dir, file) : null;
  if (!file || !full) return NextResponse.json({ error: "No README" }, { status: 404 });

  const buf = fs.readFileSync(full);
  return NextResponse.json({
    file,
    content: buf.subarray(0, MAX_BYTES).toString("utf-8"),
    truncated: buf.length > MAX_BYTES,
  });
}

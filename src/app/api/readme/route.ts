import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { findReadme } from "@/lib/files";

const MAX_BYTES = 256 * 1024;

// GET /api/readme?project=<name> — { file, content, truncated } or 404.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;

  const dir = resolveProjectDir(request.nextUrl.searchParams.get("project"));
  if (!dir) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const file = findReadme(dir);
  if (!file) return NextResponse.json({ error: "No README" }, { status: 404 });

  const buf = fs.readFileSync(path.join(dir, file));
  return NextResponse.json({
    file,
    content: buf.subarray(0, MAX_BYTES).toString("utf-8"),
    truncated: buf.length > MAX_BYTES,
  });
}

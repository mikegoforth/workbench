import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { rejectNonLocal } from "@/lib/guard";
import { resolveProjectDir } from "@/lib/paths";
import { resolveFileIn } from "@/lib/files";

// Images only: this exists so README previews can show their screenshots.
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const MAX_BYTES = 10 * 1024 * 1024;

// GET /api/file?project=<name>&path=<relative path> — an image from the project.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;

  const params = request.nextUrl.searchParams;
  const dir = resolveProjectDir(params.get("project"));
  const file = dir ? resolveFileIn(dir, params.get("path")) : null;
  const type = file ? IMAGE_TYPES[path.extname(file).toLowerCase()] : undefined;
  if (!file || !type) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  if (fs.statSync(file).size > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 });
  }

  return new NextResponse(fs.readFileSync(file), {
    headers: {
      "Content-Type": type,
      // An SVG opened directly could otherwise run script on localhost.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    },
  });
}

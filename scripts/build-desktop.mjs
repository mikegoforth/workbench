// Prepares the desktop app after `next build`:
//  1. copies the static assets into the standalone server (Next leaves that to you)
//  2. bundles the Electron main and preload scripts (with electron-updater) into dist-electron/
//  3. records a SHA-256 of every server file, checked by the app at launch
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("No .next/standalone/server.js. Run `next build` first (next.config.ts sets output: \"standalone\").");
  process.exit(1);
}

// If a file access in src/ can't be traced statically, Next copies the whole
// project (source, docs, .git, .env files) into the standalone server. Only
// these belong there; refuse to ship anything else.
const EXPECTED = new Set([".next", "node_modules", "package.json", "package-lock.json", "server.js", "tsconfig.json"]);
const unexpected = fs.readdirSync(standalone).filter((name) => !EXPECTED.has(name));
if (unexpected.length > 0) {
  console.error(
    `.next/standalone contains ${unexpected.join(", ")}: the build traced files that don't belong in the app.\n` +
      "Look for the \"Static analysis determined that this filesystem access\" warning in the next build output and fix that file access."
  );
  process.exit(1);
}

fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}
// Never ship local state, in case the build traced it in.
fs.rmSync(path.join(standalone, "data"), { recursive: true, force: true });
// sharp is Next's native image library, traced in by Next's own server. Images
// are unoptimized (next.config.ts), so it's never loaded. Without it the server
// is plain JavaScript and the same copy works on Apple Silicon and Intel.
for (const dir of ["sharp", "@img"]) {
  fs.rmSync(path.join(standalone, "node_modules", dir), { recursive: true, force: true });
}

fs.rmSync(path.join(root, "dist-electron"), { recursive: true, force: true });
await build({
  entryPoints: {
    main: path.join(root, "electron", "main.ts"),
    preload: path.join(root, "electron", "preload.ts"),
  },
  outdir: path.join(root, "dist-electron"),
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});

// 3. A SHA-256 of every server file. It goes into app.asar (whose own hash
//    Electron checks), and the app compares its copy of the server against it
//    at every launch, so edited server files are never run.
function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, base);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in the server: ${path.relative(base, full)}`);
    return [path.relative(base, full)];
  });
}
const files = {};
for (const rel of listFiles(standalone).sort()) {
  files[rel] = createHash("sha256").update(fs.readFileSync(path.join(standalone, rel))).digest("hex");
}
const buildId = fs.readFileSync(path.join(standalone, ".next", "BUILD_ID"), "utf-8").trim();
fs.writeFileSync(path.join(root, "dist-electron", "server-manifest.json"), JSON.stringify({ buildId, files }));
console.log(`server manifest: ${Object.keys(files).length} files, build ${buildId}`);

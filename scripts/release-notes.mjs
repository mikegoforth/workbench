// Prints the GitHub release description for a version tag, from the same notes
// What's new shows in the app (src/lib/releaseNotes.ts), plus which file to
// download. Used by the release workflow:
//   node scripts/release-notes.mjs v0.1.2 > release-notes.md
// Node 22.18+ / 24 runs the TypeScript module directly (type stripping).
import { RELEASES } from "../src/lib/releaseNotes.ts";

const tag = process.argv[2] ?? "";
const version = tag.replace(/^v/, "");
const release = RELEASES.find((r) => r.version === version);
if (!release) {
  console.error(`No release notes for ${version || "(no version given)"} in src/lib/releaseNotes.ts`);
  process.exit(1);
}

const HEADINGS = { new: "New", changed: "Changed", fixed: "Fixed", security: "Security" };
const lines = [];
if (release.summary) lines.push(release.summary, "");
for (const [kind, heading] of Object.entries(HEADINGS)) {
  const changes = release.changes.filter((c) => c.kind === kind);
  if (!changes.length) continue;
  lines.push(`### ${heading}`, "", ...changes.map((c) => `- ${c.text}`), "");
}
lines.push(
  "### Download",
  "",
  "| System | File |",
  "| --- | --- |",
  `| macOS, Apple silicon | \`workbench-${version}-arm64.dmg\` |`,
  `| macOS, Intel | \`workbench-${version}-x64.dmg\` |`,
  `| Windows | \`workbench-${version}-x64-setup.exe\` |`,
  `| Linux, Intel/AMD | \`workbench-${version}-x86_64.AppImage\` |`,
  `| Linux, ARM | \`workbench-${version}-arm64.AppImage\` |`,
  "",
  "Installed copies update from here. Check a download with `gh attestation verify <file> --repo <owner>/<repo>`, or against `SHA256SUMS`.",
);
console.log(lines.join("\n"));

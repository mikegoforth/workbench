// Turns coverage/coverage-summary.json (from `npm run test:coverage`) into a
// Markdown table: the totals, then each file. In CI it's appended to the run's
// summary page; locally it prints.
import fs from "node:fs";
import path from "node:path";

const summary = JSON.parse(fs.readFileSync("coverage/coverage-summary.json", "utf8"));
const metrics = ["lines", "statements", "branches", "functions"];
const cell = (m) => `${m.pct}% (${m.covered}/${m.total})`;

const rows = Object.entries(summary)
  .filter(([file]) => file !== "total")
  .map(([file, m]) => [path.relative(process.cwd(), file), m])
  .sort(([, a], [, b]) => b.lines.pct - a.lines.pct);

const out = [
  "## Test coverage",
  "",
  `| | ${metrics.join(" | ")} |`,
  `| --- | ${metrics.map(() => "---").join(" | ")} |`,
  `| **All server code** | ${metrics.map((k) => `**${cell(summary.total[k])}**`).join(" | ")} |`,
  "",
  "<details><summary>By file</summary>",
  "",
  `| File | ${metrics.join(" | ")} |`,
  `| --- | ${metrics.map(() => "---").join(" | ")} |`,
  ...rows.map(([file, m]) => `| \`${file}\` | ${metrics.map((k) => `${m[k].pct}%`).join(" | ")} |`),
  "",
  "</details>",
  "",
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
else process.stdout.write(out);

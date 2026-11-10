// Launches the packaged app from `electron-builder --dir` on this OS and waits
// for its log to say the window loaded, i.e. the bundled server started and
// the page came up. Used by CI's "Desktop app" jobs:
//   npm run desktop:build && npx electron-builder --config electron-builder.config.mjs --dir
//   node scripts/smoke-desktop.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TIMEOUT_MS = 120_000;
const release = path.resolve("release");

function executable() {
  if (process.platform === "darwin") {
    const dir = fs.readdirSync(release).find((d) => /^mac/.test(d) && fs.existsSync(path.join(release, d, "workbench.app")));
    return dir && path.join(release, dir, "workbench.app", "Contents", "MacOS", "workbench");
  }
  if (process.platform === "win32") return path.join(release, "win-unpacked", "workbench.exe");
  const dir = fs.readdirSync(release).find((d) => /^linux.*unpacked$/.test(d));
  return dir && path.join(release, dir, "workbench");
}

// Electron's app.getPath("logs") for an app named "workbench".
function logFile() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Logs", "workbench", "main.log");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "workbench", "logs", "main.log");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "workbench", "logs", "main.log");
}

const exe = executable();
if (!exe || !fs.existsSync(exe)) {
  console.error(`No packaged app found in ${release}`);
  process.exit(1);
}
const log = logFile();
fs.rmSync(log, { force: true });

// Linux CI has no display (xvfb-run provides one) and no setuid sandbox helper.
const [command, args] =
  process.platform === "linux" ? ["xvfb-run", ["-a", exe, "--no-sandbox"]] : [exe, []];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
console.log(`Starting ${exe}`);
const child = spawn(command, args, { env, stdio: "inherit", detached: process.platform !== "win32" });

function stop() {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

const started = Date.now();
let text = "";
while (Date.now() - started < TIMEOUT_MS) {
  text = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
  if (text.includes("window loaded") || text.includes("startup failed") || child.exitCode !== null) break;
  await new Promise((r) => setTimeout(r, 500));
}
stop();

console.log(`--- ${log}\n${text || "(empty)"}`);
if (!text.includes("window loaded")) {
  console.error(text.includes("startup failed") ? "The app failed to start." : `The window didn't load within ${TIMEOUT_MS / 1000}s.`);
  process.exit(1);
}
console.log(`The app started and loaded its window in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
process.exit(0);

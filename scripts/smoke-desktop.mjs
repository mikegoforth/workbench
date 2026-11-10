// Launches the packaged app (as electron-builder left it unpacked, or an installed copy) and waits
// for its log to say the window loaded, i.e. the bundled server started and
// the page came up. Used by CI's "Desktop app" jobs:
//   npm run desktop:build && npx electron-builder --config electron-builder.config.mjs --publish never
//   node scripts/smoke-desktop.mjs [path to an installed copy]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TIMEOUT_MS = 120_000;
const release = path.resolve("release");

// The unpacked app for this machine's CPU: electron-builder leaves one per
// architecture it built (mac and mac-arm64, linux-unpacked and linux-arm64-unpacked).
function executable() {
  const arm = process.arch === "arm64";
  if (process.platform === "darwin") return path.join(release, arm ? "mac-arm64" : "mac", "workbench.app", "Contents", "MacOS", "workbench");
  if (process.platform === "win32") return path.join(release, arm ? "win-arm64-unpacked" : "win-unpacked", "workbench.exe");
  return path.join(release, arm ? "linux-arm64-unpacked" : "linux-unpacked", "workbench");
}

// Electron's app.getPath("logs") for an app named "workbench".
function logFile() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Logs", "workbench", "main.log");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "workbench", "logs", "main.log");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "workbench", "logs", "main.log");
}

// An explicit path (e.g. the copy the Windows installer put in place) wins.
const exe = process.argv[2] ? path.resolve(process.argv[2]) : executable();
if (!exe || !fs.existsSync(exe)) {
  console.error(`No packaged app at ${exe}`);
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

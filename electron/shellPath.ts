import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const MARKER = "__WORKBENCH_PATH__";

/** Always searched, after whatever the login shell reports: Homebrew (macOS and Linux), snaps, ~/.local/bin, system dirs. */
const FALLBACK = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/home/linuxbrew/.linuxbrew/bin",
  path.join(os.homedir(), ".local", "bin"),
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/snap/bin",
  "/usr/sbin",
  "/sbin",
];

/**
 * The PATH a terminal window would have. Apps opened from Finder, the Dock or
 * a Linux app launcher get a minimal PATH, so without this the server couldn't
 * find gh, docker, code, or node and npm for starting dev servers.
 *
 * Runs the user's shell as an interactive login shell. If nvm is set up
 * (including lazy-loaded nvm, where node and npm are shell functions until first
 * use), its default version is activated first so its node lands on PATH.
 * Startup files can print anything, so PATH is read from between markers.
 */
export function loginShellPath(): Promise<string> {
  // Windows: apps started from the Start menu get the user's full PATH already.
  if (process.platform === "win32") return Promise.resolve(process.env.PATH ?? "");
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  const script = `command -v nvm >/dev/null 2>&1 && nvm use default >/dev/null 2>&1; printf '${MARKER}%s${MARKER}' "$PATH"`;
  return new Promise((resolve) => {
    execFile(shell, ["-ilc", script], { timeout: 10_000, maxBuffer: 1024 * 1024 }, (_error, stdout) => {
      const match = String(stdout ?? "").match(new RegExp(`${MARKER}(.*?)${MARKER}`, "s"));
      const fromShell = match ? match[1].split(":") : [];
      const inherited = (process.env.PATH ?? "").split(":");
      const dirs = [...fromShell, ...inherited, ...FALLBACK].filter(Boolean);
      resolve([...new Set(dirs)].join(":"));
    });
  });
}

import fs from "fs";
import os from "os";
import path from "path";
import { platform } from "./platform";
import { readSettings } from "./settings";

/** Used when nothing else names a projects folder. */
export const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), "Projects");

/**
 * workbench's own checkout, when it runs with `npm run dev` (the server's
 * working folder). It's left out of the project list and can't start or stop
 * itself. Matched by path, not name, so a clone under any name is recognized
 * and an unrelated project that happens to be called "workbench" isn't hidden.
 * The desktop app's server runs from Application Support, so nothing matches.
 */
// process.cwd() is already absolute. Wrapping it in path.resolve() makes the
// build's file tracer copy the whole project into the server bundle.
const SELF_DIR = process.cwd();
export const isSelf = (dir: string): boolean => path.resolve(dir) === SELF_DIR;

/** Where the projects folder came from: saved in settings, the env var, or the default. */
export type ProjectsDirSource = "settings" | "env" | "default";

/** `~` or `~/x` (also `~\\x` on Windows) → an absolute path under the home folder. Anything else is returned as is. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || (platform() === "windows" && p.startsWith("~\\"))) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * An absolute path with the home folder shortened to `~`, for display. The
 * rest keeps the platform's separators (`~\\code` on Windows, where paths
 * also match whatever their case).
 */
export function tildify(p: string): string {
  const home = os.homedir();
  const fold = platform() === "windows" ? (s: string) => s.toLowerCase() : (s: string) => s;
  if (fold(p) === fold(home)) return "~";
  return fold(p).startsWith(fold(home + path.sep)) ? "~" + p.slice(home.length) : p;
}

/**
 * The folder scanned for projects; each direct subfolder is one project.
 * Settings (chosen in the app) win over WORKBENCH_PROJECTS_DIR, which wins over ~/Projects.
 */
export function projectsDirInfo(): { dir: string; source: ProjectsDirSource } {
  const saved = readSettings().projectsDir;
  if (saved) return { dir: saved, source: "settings" };
  const env = process.env.WORKBENCH_PROJECTS_DIR?.trim();
  if (env) return { dir: path.resolve(expandHome(env)), source: "env" };
  return { dir: DEFAULT_PROJECTS_DIR, source: "default" };
}

export function projectsDir(): string {
  return projectsDirInfo().dir;
}

const FULL_PATH_EXAMPLE: Partial<Record<ReturnType<typeof platform>, string>> = {
  mac: "~/Projects or /Users/you/code",
  linux: "~/Projects or /home/you/code",
  windows: "~\\Projects or C:\\Users\\you\\code",
};

/**
 * Check a folder someone asked to use as the projects folder. Accepts `~`
 * paths; must be absolute, an existing directory, and not the filesystem root.
 */
export function validateProjectsDir(input: unknown): { dir: string } | { error: string } {
  if (typeof input !== "string" || !input.trim() || input.length > 1024) {
    return { error: "Enter a folder path" };
  }
  const expanded = expandHome(input.trim());
  if (!path.isAbsolute(expanded)) {
    return { error: `Use a full path, like ${FULL_PATH_EXAMPLE[platform()] ?? FULL_PATH_EXAMPLE.mac}` };
  }
  const dir = path.resolve(expanded);
  if (dir === path.parse(dir).root) {
    return { error: "Pick a folder that holds your projects, not the whole disk" };
  }
  try {
    if (!fs.statSync(dir).isDirectory()) return { error: `${tildify(dir)} isn't a folder` };
  } catch {
    return { error: `${tildify(dir)} doesn't exist` };
  }
  return { dir };
}

/**
 * Names Windows treats specially in any folder: characters it doesn't allow
 * (":" would name an alternate data stream), a trailing dot or space (dropped,
 * so " .." would mean the folder itself), and device names such as NUL or COM1.
 */
const WINDOWS_UNSAFE_NAME = /[<>:"|?*\x00-\x1f]|[. ]$|^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\.|$)/i;

/**
 * Resolve a project name from a request to its folder inside the projects
 * folder. Only bare folder names are accepted (no separators, no dot-folders;
 * on Windows also no backslashes, drive letters or names Windows rewrites),
 * so a caller can never reach a path outside it. Returns null if invalid or
 * missing.
 */
export function resolveProjectDir(name: unknown): string | null {
  const windows = platform() === "windows";
  if (
    typeof name !== "string" ||
    !name ||
    name.startsWith(".") ||
    name !== (windows ? path.win32 : path).basename(name) ||
    (windows && WINDOWS_UNSAFE_NAME.test(name)) ||
    // Names are used as keys in saved settings and notes.
    name === "__proto__"
  ) {
    return null;
  }
  const dir = path.join(projectsDir(), name);
  try {
    return fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

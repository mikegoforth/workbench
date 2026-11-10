import fs from "fs";
import path from "path";
import { userDataDir } from "./platform";

/**
 * Where workbench keeps its settings, notes and dev-process state. Shared by
 * `npm run dev` and the desktop app, so both see the same hidden projects and
 * the same running dev servers. The desktop app sets WORKBENCH_DATA_DIR to
 * this same folder: Electron's userData folder plus data/, which is
 * ~/Library/Application Support/workbench/data on macOS and
 * ~/.config/workbench/data (or under $XDG_CONFIG_HOME) on Linux.
 */
const defaultDataDir = () => path.join(userDataDir("workbench"), "data");

/** Where data lived before it moved: the repo's gitignored data/ folder. */
const LEGACY_DATA_DIR = path.join(process.cwd(), "data");

let resolved: string | null = null;

export function dataDir(): string {
  if (resolved) return resolved;
  const dir = process.env.WORKBENCH_DATA_DIR?.trim() || defaultDataDir();
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    // First `npm run dev` with the new location: bring the repo's data/ across once, leaving
    // the old folder as is. Only in development: a production build has no repo folder (and a
    // runtime check on it would make the build bundle the whole project).
    if (process.env.NODE_ENV === "development" && fs.existsSync(LEGACY_DATA_DIR) && LEGACY_DATA_DIR !== dir) {
      fs.cpSync(LEGACY_DATA_DIR, /*turbopackIgnore: true*/ dir, { recursive: true });
    } else {
      fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    }
  }
  resolved = dir;
  return dir;
}

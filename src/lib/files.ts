import fs from "fs";
import path from "path";

/**
 * Resolve a relative path from a request to an existing regular file inside
 * `dir`. Absolute paths and anything escaping `dir` give null, including
 * through symlinks: a cloned repo could ship `logo.png -> ~/.ssh/id_ed25519`.
 */
export function resolveFileIn(dir: string, file: unknown): string | null {
  if (typeof file !== "string" || !file || path.isAbsolute(file)) return null;
  const full = path.resolve(dir, file);
  if (!full.startsWith(dir + path.sep)) return null;
  try {
    const realDir = fs.realpathSync(dir);
    const real = fs.realpathSync(full);
    if (!real.startsWith(realDir + path.sep)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** The project's README file name (README.md, readme.markdown, README…), if any. */
export function findReadme(dir: string): string | null {
  try {
    const names = fs.readdirSync(dir).filter((f) => /^readme(\.md|\.markdown)?$/i.test(f));
    // Prefer markdown over a plain README.
    return names.sort((a, b) => Number(!/\./.test(a)) - Number(!/\./.test(b)))[0] ?? null;
  } catch {
    return null;
  }
}

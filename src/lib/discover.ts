import fs from "fs/promises";
import os from "os";
import path from "path";
import type { DiscoveredRoot, DiscoveryResult } from "./types";
import { tildify } from "./paths";
import { toWebUrl } from "./repoUrl";

// Every path read here is somewhere in the home folder, chosen at runtime, so the
// turbopackIgnore comments keep the build from bundling the whole project to cover them.

// ~/a/b/c/repo is as deep as it looks. Deeper repos are rare and cost a lot of walking.
const MAX_DEPTH = 4;
const MAX_DIRS = 25_000;
const TIME_BUDGET_MS = 8_000;
const BATCH = 64;
const MAX_ROOTS = 15;

/** Never descended into, at any depth: build output, dependencies, caches. */
const SKIP_NAMES = new Set([
  "node_modules", "vendor", "Pods", "venv", "target", "dist", "build", "out", "__pycache__", "DerivedData",
]);

/**
 * Top-level home folders that are skipped, on every platform. Library and the
 * media folders are huge and hold no projects; Desktop and Downloads are left
 * out so a scan never triggers a macOS privacy prompt. ~/go/pkg is the Go
 * module cache. On Linux: snap (each snap's data, per revision), Videos, and
 * the Android SDK.
 */
const SKIP_IN_HOME = new Set([
  "Library", "Applications", "Pictures", "Music", "Movies", "Public", "Desktop", "Downloads", path.join("go", "pkg"),
  "snap", "Videos", path.join("Android", "Sdk"),
]);

/** Remote URLs from a git config file, origin first. */
function remoteUrls(config: string): string[] {
  const urls = new Map<string, string>();
  let remote: string | null = null;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    const section = line.match(/^\[\s*remote\s+"([^"]+)"\s*\]$/);
    if (section) {
      remote = section[1];
      continue;
    }
    if (line.startsWith("[")) {
      remote = null;
      continue;
    }
    const url = remote ? line.match(/^url\s*=\s*(.+)$/) : null;
    if (remote && url && !urls.has(remote)) urls.set(remote, url[1].trim());
  }
  const origin = urls.get("origin");
  return origin ? [origin, ...[...urls.values()].filter((u) => u !== origin)] : [...urls.values()];
}

/** The repo's git config, following a `.git` file (worktree or submodule) to its real git dir. */
async function readGitConfig(repo: string, dotGitIsDir: boolean): Promise<string | null> {
  try {
    let gitDir = path.join(repo, ".git");
    if (!dotGitIsDir) {
      const pointer = (await fs.readFile(/*turbopackIgnore: true*/ gitDir, "utf-8")).match(/^gitdir:\s*(.+)$/m);
      if (!pointer) return null;
      gitDir = path.resolve(repo, pointer[1].trim());
      const common = await fs.readFile(/*turbopackIgnore: true*/ path.join(gitDir, "commondir"), "utf-8").catch(() => null);
      if (common) gitDir = path.resolve(gitDir, common.trim());
    }
    return await fs.readFile(/*turbopackIgnore: true*/ path.join(gitDir, "config"), "utf-8");
  } catch {
    return null;
  }
}

/**
 * owner/repo if a remote points at GitHub, else null. SSH host aliases such
 * as `github.com-work` (used to pick between accounts) count as GitHub.
 */
function githubSlug(urls: string[]): string | null {
  for (const url of urls) {
    const web = toWebUrl(url);
    if (!web) continue;
    const { hostname, pathname } = new URL(web);
    if (!/^(www\.)?github\.com([-.].+)?$/i.test(hostname)) continue;
    const [owner, repo] = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (owner && repo) return `${owner}/${repo}`;
  }
  return null;
}

/**
 * Walk the home folder for git repos and group them by the folder they sit
 * in. Each group is a candidate projects folder, ranked by how many of its
 * repos are on GitHub. Stops descending at each repo it finds, and gives up
 * after MAX_DIRS folders or TIME_BUDGET_MS.
 */
export async function discoverProjectRoots(home = os.homedir()): Promise<DiscoveryResult> {
  const started = Date.now();
  const byParent = new Map<string, { repos: string[]; github: string[] }>();
  let level: string[] = [home];
  let scannedDirs = 0;
  let truncated = false;

  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += BATCH) {
      if (scannedDirs >= MAX_DIRS || Date.now() - started > TIME_BUDGET_MS) {
        truncated = true;
        break;
      }
      const batch = level.slice(i, i + BATCH);
      scannedDirs += batch.length;
      await Promise.all(
        batch.map(async (dir) => {
          let entries;
          try {
            entries = await fs.readdir(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
          } catch {
            return; // unreadable (permissions, vanished): skip it
          }
          const dotGit = entries.find((e) => e.name === ".git");
          if (dotGit && dir !== home) {
            const config = await readGitConfig(dir, dotGit.isDirectory());
            const slug = config ? githubSlug(remoteUrls(config)) : null;
            const parent = path.dirname(dir);
            const group = byParent.get(parent) ?? { repos: [], github: [] };
            group.repos.push(path.basename(dir));
            if (slug) group.github.push(slug);
            byParent.set(parent, group);
            return; // a repo's subfolders are its own business
          }
          if (depth === MAX_DEPTH) return;
          for (const e of entries) {
            // Symlinks are skipped too (isDirectory() is false for them), which avoids loops.
            if (!e.isDirectory() || e.name.startsWith(".") || SKIP_NAMES.has(e.name)) continue;
            const child = path.join(dir, e.name);
            if (SKIP_IN_HOME.has(path.relative(home, child))) continue;
            next.push(child);
          }
        })
      );
    }
    if (truncated) break;
    level = next;
  }

  const roots: DiscoveredRoot[] = [...byParent.entries()]
    .map(([dir, g]) => ({
      dir,
      display: tildify(dir),
      repos: g.repos.sort((a, b) => a.localeCompare(b)),
      github: g.github.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.github.length - a.github.length || b.repos.length - a.repos.length || a.dir.localeCompare(b.dir))
    .slice(0, MAX_ROOTS);

  return { roots, scannedDirs, truncated, elapsedMs: Date.now() - started };
}

import fs from "fs";
import path from "path";
import { simpleGit } from "simple-git";
import { NotesData, ProjectInfo } from "./types";
import { readNotes } from "./notes";
import { isSelf, projectsDir } from "./paths";
import { readSettings } from "./settings";
import { toWebUrl } from "./repoUrl";

// Per project, so a repo with thousands of untracked files can't bloat the response.
const MAX_FILES = 200;

interface ScanContext {
  root: string;
  notes: NotesData;
  hidden: Set<string>;
  parked: Record<string, string>;
}

const loadContext = (): ScanContext => {
  const settings = readSettings();
  return { root: projectsDir(), notes: readNotes(), hidden: new Set(settings.hiddenProjects), parked: settings.parked };
};

/** When this repo last fetched, from .git/FETCH_HEAD's mtime. */
function lastFetchedAt(dir: string): string | null {
  try {
    return fs.statSync(path.join(dir, ".git", "FETCH_HEAD")).mtime.toISOString();
  } catch {
    return null;
  }
}

/** Everything the dashboard shows for one project folder. */
export async function scanProject(
  name: string,
  ctx: ScanContext = loadContext()
): Promise<ProjectInfo> {
  const fullPath = path.join(ctx.root, name);
  const isGitRepo = fs.existsSync(path.join(fullPath, ".git"));

  const project: ProjectInfo = {
    name,
    path: fullPath,
    isGitRepo,
    notes: ctx.notes[name]?.notes || "",
    todos: ctx.notes[name]?.todos || [],
    hidden: ctx.hidden.has(name),
    parkedFingerprint: ctx.parked[name],
  };

  if (isGitRepo) {
    try {
      const git = simpleGit(fullPath);
      const [status, log, remotes] = await Promise.all([
        git.status(),
        git.log({ maxCount: 1 }),
        git.getRemotes(true),
      ]);

      const remote = remotes.find((r) => r.name === "origin") ?? remotes[0];
      const repoUrl = remote ? toWebUrl(remote.refs.fetch) : null;
      if (repoUrl) project.repoUrl = repoUrl;
      project.hasRemote = remotes.length > 0;
      project.lastFetchedAt = lastFetchedAt(fullPath);

      project.branch = status.current || undefined;
      // Count files, not states, so a file that's both staged and
      // modified counts once and the totals match the file list.
      const untracked = status.files.filter((f) => f.index === "?").length;
      project.untrackedFiles = untracked;
      project.uncommittedChanges = status.files.length - untracked;
      project.files = status.files.slice(0, MAX_FILES).map((f) => ({
        path: f.path,
        from: f.from,
        index: f.index,
        workingDir: f.working_dir,
      }));
      project.filesTruncated = Math.max(0, status.files.length - MAX_FILES);

      if (log.latest) {
        project.lastCommitMessage = log.latest.message;
        project.lastCommitDate = log.latest.date;
        project.lastCommitAuthor = log.latest.author_name;
      }

      project.aheadBehind = {
        ahead: status.ahead,
        behind: status.behind,
      };
    } catch {
      // Git operations failed, leave fields undefined
    }
  }

  return project;
}

/** Every project in the projects folder, most recently committed first. */
export async function scanAll(): Promise<ProjectInfo[]> {
  const ctx = loadContext();
  const dirs = fs
    .readdirSync(ctx.root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !isSelf(path.join(ctx.root, e.name)));

  const projects = await Promise.all(dirs.map((dir) => scanProject(dir.name, ctx)));

  // Sort by last commit date (most recent first), non-git repos at end
  projects.sort((a, b) => {
    if (!a.lastCommitDate && !b.lastCommitDate) return a.name.localeCompare(b.name);
    if (!a.lastCommitDate) return 1;
    if (!b.lastCommitDate) return -1;
    return new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime();
  });
  return projects;
}

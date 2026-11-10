import { execFile } from "child_process";
import { promisify } from "util";
import { BranchSummary, GitHistory } from "./types";

const run = promisify(execFile);
const COMMITS = 10;

export class GitError extends Error {}

/**
 * Run git in `dir`. GIT_TERMINAL_PROMPT=0 makes git fail instead of waiting
 * forever for credentials it can't ask for (there's no terminal here).
 */
async function git(dir: string, args: string[], timeout: number) {
  try {
    return await run("git", args, {
      cwd: dir,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (err.killed) throw new GitError(`git ${args[0]} timed out`);
    const lines = err.stderr?.trim().split("\n").filter(Boolean) ?? [];
    throw new GitError(lines.slice(-2).join(" ") || err.message);
  }
}

/** Last meaningful line of git's output, for a one-line status message. */
function summary(stdout: string, stderr: string): string {
  const lines = `${stdout}\n${stderr}`.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

export async function fetchRemotes(dir: string): Promise<string> {
  const { stdout, stderr } = await git(dir, ["fetch", "--all", "--prune"], 60_000);
  return summary(stdout, stderr) || "Up to date";
}

/** Pull only if it fast-forwards: never creates a merge commit or conflicts. */
export async function pullFastForward(dir: string): Promise<string> {
  const { stdout, stderr } = await git(dir, ["pull", "--ff-only"], 120_000);
  return summary(stdout, stderr) || "Up to date";
}

const FIELD = "\x1f"; // unit separator: can't appear in refs or subjects
const RECORD = "\x1e";

function parseTrack(track: string): Pick<BranchSummary, "ahead" | "behind" | "gone"> {
  return {
    ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0),
    gone: track === "gone",
  };
}

export async function gitHistory(dir: string): Promise<GitHistory> {
  const [log, branches, stashes, unpushed] = await Promise.all([
    git(dir, ["log", `-${COMMITS}`, `--format=%H${FIELD}%s${FIELD}%an${FIELD}%aI${RECORD}`], 10_000)
      .then((r) => r.stdout)
      .catch(() => ""), // a repo with no commits yet
    git(
      dir,
      [
        "for-each-ref",
        "--sort=-committerdate",
        `--format=%(refname:short)${FIELD}%(upstream:short)${FIELD}%(upstream:track,nobracket)${FIELD}%(committerdate:iso-strict)${FIELD}%(HEAD)`,
        "refs/heads",
      ],
      10_000
    ).then((r) => r.stdout),
    git(dir, ["stash", "list", `--format=%gs${FIELD}%cI`], 10_000)
      .then((r) => r.stdout)
      .catch(() => ""),
    // Commits on HEAD that its upstream doesn't have. Fails when there's no upstream.
    git(dir, ["rev-list", "@{upstream}..HEAD"], 10_000)
      .then((r) => new Set(r.stdout.split("\n").filter(Boolean)))
      .catch(() => null),
  ]);

  return {
    commits: log
      .split(RECORD)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, subject, author, date] = record.split(FIELD);
        return { hash, subject, author, date, pushed: unpushed ? !unpushed.has(hash) : null };
      }),
    branches: branches
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, upstream, track, date, head] = line.split(FIELD);
        return {
          name,
          current: head === "*",
          upstream: upstream || null,
          ...parseTrack(track),
          lastCommitDate: date,
        };
      }),
    stashes: stashes
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        const [message, date] = line.split(FIELD);
        return { index, message, date };
      }),
  };
}

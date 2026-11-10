import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// gitinfo runs the real git binary on throwaway repos in a temp folder. A
// pass-through mock of execFile lets single tests fake what real git can't do
// on demand (time out, fail without stderr) and check the options it was given.
const { runGit } = vi.hoisted(() => ({ runGit: vi.fn() }));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const util = await import("util");
  const real = util.promisify(actual.execFile);
  runGit.mockImplementation(real);
  const execFile = Object.assign(
    () => {
      throw new Error("gitinfo only uses the promise form of execFile");
    },
    { [util.promisify.custom]: (...args: unknown[]) => runGit(...args) }
  );
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import { execFileSync } from "child_process";
import { fetchRemotes, GitError, gitHistory, pullFastForward } from "./gitinfo";

let root: string;
let home: string;
let counter = 0;

/** Git's environment for these tests: no system or user config, a fixed identity. */
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    // Never inherit GIT_DIR and friends (e.g. when run from a git hook).
    if (key.startsWith("GIT_")) delete env[key];
  }
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    LANGUAGE: "C",
  };
}

/** Run git for test setup; commits get increasing, fixed dates. */
function git(cwd: string, ...args: string[]): string {
  counter++;
  const date = new Date(Date.UTC(2024, 0, 1, 0, counter)).toISOString();
  return execFileSync("git", args, {
    cwd,
    env: { ...gitEnv(), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(dir: string, file: string, content: string, message: string): string {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, "add", file);
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

/** A bare "remote", a clone to push from elsewhere, and the local clone under test. */
function setup(name: string) {
  const base = path.join(root, name);
  const remote = path.join(base, "remote.git");
  const other = path.join(base, "other");
  const local = path.join(base, "local");
  fs.mkdirSync(base, { recursive: true });
  git(base, "init", "-q", "--bare", remote);
  git(base, "clone", "-q", remote, other);
  const first = commit(other, "README.md", "hello\n", "First commit");
  git(other, "push", "-q", "origin", "main");
  git(base, "clone", "-q", remote, local);
  return { base, remote, other, local, first };
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-gitinfo-")));
  home = path.join(root, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(
    path.join(home, ".gitconfig"),
    [
      "[user]",
      "  name = Test Author",
      "  email = test@example.com",
      "[init]",
      "  defaultBranch = main",
      "[commit]",
      "  gpgsign = false",
      "[advice]",
      "  detachedHead = false",
      // Git for Windows' own config turns this on; files must keep their LF endings.
      "[core]",
      "  autocrlf = false",
      "",
    ].join("\n")
  );
});

beforeEach(() => {
  // gitinfo passes process.env to git: point it at the same isolated config.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  }
  const env = gitEnv();
  for (const key of ["HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL"]) {
    vi.stubEnv(key, env[key]);
  }
  // Tests match git's English messages.
  vi.stubEnv("LC_ALL", "C");
  vi.stubEnv("LANGUAGE", "C");
  runGit.mockClear();
});

afterAll(() => {
  // Git makes its object files read-only, which Windows can refuse to delete.
  // A leftover temp folder there is harmless; anywhere else it's a bug.
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (e) {
    if (process.platform !== "win32") throw e;
  }
});

describe("gitHistory", () => {
  it("lists commits (pushed or not), branches with tracking, and stashes", async () => {
    const { local, first } = setup("history");
    const second = commit(local, "a.txt", "a\n", "Second commit");
    git(local, "branch", "feature");
    fs.writeFileSync(path.join(local, "README.md"), "changed\n");
    git(local, "stash", "push", "-q", "-m", "half done");

    const history = await gitHistory(local);

    expect(history.commits).toEqual([
      { hash: second, subject: "Second commit", author: "Test Author", date: expect.any(String), pushed: false },
      { hash: first, subject: "First commit", author: "Test Author", date: expect.any(String), pushed: true },
    ]);
    expect(new Date(history.commits[0].date).toISOString()).toMatch(/^2024-01-01T/);

    const main = history.branches.find((b) => b.name === "main");
    const feature = history.branches.find((b) => b.name === "feature");
    expect(main).toEqual({
      name: "main",
      current: true,
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      gone: false,
      lastCommitDate: expect.any(String),
    });
    expect(feature).toEqual({
      name: "feature",
      current: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      gone: false,
      lastCommitDate: main!.lastCommitDate,
    });

    expect(history.stashes).toEqual([{ index: 0, message: "On main: half done", date: expect.any(String) }]);
    expect(fs.readFileSync(path.join(local, "README.md"), "utf-8")).toBe("hello\n");
  });

  it("caps the log at 10 commits, newest first", async () => {
    const { local } = setup("many");
    for (let i = 1; i <= 12; i++) commit(local, "n.txt", `${i}\n`, `Commit ${i}`);
    const { commits } = await gitHistory(local);
    expect(commits).toHaveLength(10);
    expect(commits[0].subject).toBe("Commit 12");
    expect(commits[9].subject).toBe("Commit 3");
  });

  it("keeps a subject with separators-like text intact", async () => {
    const { local } = setup("subject");
    commit(local, "s.txt", "s\n", "fix: a | b ; c \"quoted\"");
    const { commits } = await gitHistory(local);
    expect(commits[0].subject).toBe("fix: a | b ; c \"quoted\"");
  });

  it("reports ahead and behind together, and branches whose upstream is gone", async () => {
    const { local, other } = setup("diverged");
    git(local, "checkout", "-q", "-b", "feature");
    commit(local, "f.txt", "f\n", "Feature work");
    git(local, "push", "-q", "-u", "origin", "feature");
    git(local, "checkout", "-q", "main");
    commit(local, "mine.txt", "mine\n", "Local work");
    commit(other, "theirs.txt", "theirs\n", "Remote work");
    git(other, "push", "-q", "origin", "main");
    git(other, "push", "-q", "origin", "--delete", "feature");
    await fetchRemotes(local);

    const { branches } = await gitHistory(local);
    expect(branches.find((b) => b.name === "main")).toMatchObject({
      current: true,
      upstream: "origin/main",
      ahead: 1,
      behind: 1,
      gone: false,
    });
    expect(branches.find((b) => b.name === "feature")).toMatchObject({
      current: false,
      upstream: "origin/feature",
      ahead: 0,
      behind: 0,
      gone: true,
    });
  });

  it("marks commits as unknown (null) when the branch has no upstream", async () => {
    const dir = path.join(root, "no-upstream");
    git(root, "init", "-q", dir);
    commit(dir, "x.txt", "x\n", "Only commit");
    const history = await gitHistory(dir);
    expect(history.commits).toHaveLength(1);
    expect(history.commits[0]).toMatchObject({ subject: "Only commit", pushed: null });
    expect(history.branches).toEqual([
      expect.objectContaining({ name: "main", current: true, upstream: null, ahead: 0, behind: 0, gone: false }),
    ]);
    expect(history.stashes).toEqual([]);
  });

  it("returns empty lists for a repo with no commits yet", async () => {
    const dir = path.join(root, "empty");
    git(root, "init", "-q", dir);
    expect(await gitHistory(dir)).toEqual({ commits: [], branches: [], stashes: [] });
  });

  it("throws a GitError outside a repository", async () => {
    const dir = path.join(root, "not-a-repo");
    fs.mkdirSync(dir);
    const error = await gitHistory(dir).catch((e) => e);
    expect(error).toBeInstanceOf(GitError);
    expect(error.message).toMatch(/not a git repository/i);
  });
});

describe("fetchRemotes", () => {
  it("says Up to date when git prints nothing", async () => {
    const dir = path.join(root, "fetch-no-remotes");
    git(root, "init", "-q", dir);
    await expect(fetchRemotes(dir)).resolves.toBe("Up to date");
  });

  it("returns git's last line and updates the remote-tracking branch", async () => {
    const { local, other } = setup("fetch");
    const remoteHead = commit(other, "new.txt", "new\n", "New upstream commit");
    git(other, "push", "-q", "origin", "main");

    const message = await fetchRemotes(local);
    expect(message).toMatch(/main\s+->\s+origin\/main/);
    expect(git(local, "rev-parse", "origin/main")).toBe(remoteHead);
    expect(fs.existsSync(path.join(local, ".git", "FETCH_HEAD"))).toBe(true);

    expect(runGit).toHaveBeenCalledWith(
      "git",
      ["fetch", "--all", "--prune"],
      expect.objectContaining({
        cwd: local,
        timeout: 60_000,
        env: expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" }),
      })
    );
  });

  it("turns a missing remote into a GitError with git's message", async () => {
    const { local, remote } = setup("fetch-gone");
    // Moved rather than deleted: Windows can refuse to delete git's read-only object files.
    fs.renameSync(remote, `${remote}-gone`);
    const error = await fetchRemotes(local).catch((e) => e);
    expect(error).toBeInstanceOf(GitError);
    // Only the last two stderr lines survive, joined on one line: here that's
    // git's generic advice rather than the "does not appear to be a git repository" line.
    expect(error.message).toMatch(/repository exists/i);
    expect(error.message).not.toContain("\n");
  });

  it("reports a timeout by the git subcommand", async () => {
    runGit.mockRejectedValueOnce(Object.assign(new Error("Command failed"), { killed: true, stderr: "" }));
    const error = await fetchRemotes(root).catch((e) => e);
    expect(error).toBeInstanceOf(GitError);
    expect(error.message).toBe("git fetch timed out");
  });

  it("falls back to the error message when git wrote nothing to stderr", async () => {
    runGit.mockRejectedValueOnce(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }));
    const error = await fetchRemotes(root).catch((e) => e);
    expect(error).toBeInstanceOf(GitError);
    expect(error.message).toBe("spawn git ENOENT");
  });

  it("keeps only the last two stderr lines", async () => {
    runGit.mockRejectedValueOnce(
      Object.assign(new Error("Command failed"), { stderr: "one\n\ntwo\nthree\n" })
    );
    const error = await fetchRemotes(root).catch((e) => e);
    expect(error.message).toBe("two three");
  });
});

describe("pullFastForward", () => {
  it("fast-forwards to the remote, then says it's up to date", async () => {
    const { local, other } = setup("pull");
    const remoteHead = commit(other, "pulled.txt", "pulled\n", "Upstream change");
    git(other, "push", "-q", "origin", "main");

    const message = await pullFastForward(local);
    expect(message).not.toBe("");
    expect(git(local, "rev-parse", "HEAD")).toBe(remoteHead);
    expect(fs.readFileSync(path.join(local, "pulled.txt"), "utf-8")).toBe("pulled\n");
    expect(runGit).toHaveBeenCalledWith(
      "git",
      ["pull", "--ff-only"],
      expect.objectContaining({ cwd: local, timeout: 120_000 })
    );

    await expect(pullFastForward(local)).resolves.toMatch(/up to date/i);
  });

  it("refuses to merge diverged branches and leaves HEAD alone", async () => {
    const { local, other } = setup("pull-diverged");
    const localHead = commit(local, "mine.txt", "mine\n", "Local work");
    commit(other, "theirs.txt", "theirs\n", "Remote work");
    git(other, "push", "-q", "origin", "main");

    const error = await pullFastForward(local).catch((e) => e);
    expect(error).toBeInstanceOf(GitError);
    expect(error.message).toMatch(/fast-forward/i);
    expect(git(local, "rev-parse", "HEAD")).toBe(localHead);
    expect(git(local, "status", "--porcelain")).toBe("");
  });

  it("reports a timeout as a pull timeout", async () => {
    runGit.mockRejectedValueOnce(Object.assign(new Error("Command failed"), { killed: true }));
    await expect(pullFastForward(root)).rejects.toThrow("git pull timed out");
  });

  it("says Up to date when git prints nothing", async () => {
    runGit.mockResolvedValueOnce({ stdout: "\n  \n", stderr: "" });
    await expect(pullFastForward(root)).resolves.toBe("Up to date");
  });
});


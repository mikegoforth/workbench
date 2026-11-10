import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// scan.ts reads real git repos (through simple-git) in the projects folder.
// Each test builds repos in a temp projects folder and imports fresh modules,
// because dataDir() caches its folder per module instance.
let root: string;
let home: string;
let projects: string;
let dataDir: string;
let counter = 0;

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
  };
}

/** Run git for test setup. Commits get the given date, or increasing fixed ones. */
function git(cwd: string, args: string[], date?: string): string {
  counter++;
  const when = date ?? new Date(Date.UTC(2024, 0, 1, 0, counter)).toISOString();
  return execFileSync("git", args, {
    cwd,
    env: { ...gitEnv(), GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initRepo(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
}

function commit(dir: string, message: string, date?: string, file = "README.md") {
  fs.writeFileSync(path.join(dir, file), `${message}\n`);
  git(dir, ["add", file]);
  git(dir, ["commit", "-q", "-m", message], date);
}

async function load() {
  vi.resetModules();
  return import("./scan");
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-scan-")));
  home = path.join(root, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(
    path.join(home, ".gitconfig"),
    "[user]\n  name = Test Author\n  email = test@example.com\n[init]\n  defaultBranch = main\n[commit]\n  gpgsign = false\n[advice]\n  detachedHead = false\n"
  );
});

beforeEach((ctx) => {
  const base = path.join(root, ctx.task.id);
  projects = path.join(base, "projects");
  dataDir = path.join(base, "data");
  fs.mkdirSync(projects, { recursive: true });
  vi.stubEnv("WORKBENCH_DATA_DIR", dataDir);
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  // simple-git drops GIT_* variables but keeps HOME: that isolates it from
  // the developer's own git config.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  }
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("scanProject", () => {
  it("describes a plain folder that isn't a git repo", async () => {
    fs.mkdirSync(path.join(projects, "plain"));
    const { scanProject } = await load();
    expect(await scanProject("plain")).toEqual({
      name: "plain",
      path: path.join(projects, "plain"),
      isGitRepo: false,
      notes: "",
      todos: [],
      hidden: false,
      parkedFingerprint: undefined,
    });
  });

  it("reads branch, last commit, changed files and the GitHub remote", async () => {
    const dir = path.join(projects, "app");
    initRepo(dir);
    commit(dir, "Initial commit", "2024-03-04T05:06:07Z");
    fs.writeFileSync(path.join(dir, "tracked.txt"), "one\n");
    git(dir, ["add", "tracked.txt"]);
    git(dir, ["commit", "-q", "-m", "Add tracked file"], "2024-03-05T00:00:00Z");
    // Staged AND modified: one file, counted once.
    fs.writeFileSync(path.join(dir, "tracked.txt"), "two\n");
    git(dir, ["add", "tracked.txt"]);
    fs.writeFileSync(path.join(dir, "tracked.txt"), "three\n");
    // Modified only.
    fs.writeFileSync(path.join(dir, "README.md"), "changed\n");
    // Renamed.
    git(dir, ["mv", "README.md", "README.txt"]);
    // Untracked.
    fs.writeFileSync(path.join(dir, "new.txt"), "new\n");
    git(dir, ["remote", "add", "origin", "git@github.com:acme/app.git"]);

    const { scanProject } = await load();
    const project = await scanProject("app");

    expect(project).toMatchObject({
      name: "app",
      path: dir,
      isGitRepo: true,
      branch: "main",
      repoUrl: "https://github.com/acme/app",
      hasRemote: true,
      lastFetchedAt: null,
      lastCommitMessage: "Add tracked file",
      lastCommitAuthor: "Test Author",
      untrackedFiles: 1,
      uncommittedChanges: 2,
      filesTruncated: 0,
      aheadBehind: { ahead: 0, behind: 0 },
    });
    expect(new Date(project.lastCommitDate!).toISOString()).toBe("2024-03-05T00:00:00.000Z");
    expect(project.files).toHaveLength(3);
    expect(project.files).toEqual(
      expect.arrayContaining([
        { path: "tracked.txt", from: undefined, index: "M", workingDir: "M" },
        { path: "new.txt", from: undefined, index: "?", workingDir: "?" },
        expect.objectContaining({ path: "README.txt", from: "README.md", index: "R" }),
      ])
    );
  });

  it("caps the file list and says how many were left out", async () => {
    const dir = path.join(projects, "busy");
    initRepo(dir);
    commit(dir, "Initial commit");
    for (let i = 0; i < 205; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), "");

    const { scanProject } = await load();
    const project = await scanProject("busy");
    expect(project.untrackedFiles).toBe(205);
    expect(project.uncommittedChanges).toBe(0);
    expect(project.files).toHaveLength(200);
    expect(project.filesTruncated).toBe(5);
  });

  it("counts commits ahead of the upstream and records the last fetch", async () => {
    const remote = path.join(root, "remotes", "ahead.git");
    fs.mkdirSync(path.dirname(remote), { recursive: true });
    git(root, ["init", "-q", "--bare", remote]);
    const dir = path.join(projects, "ahead");
    initRepo(dir);
    commit(dir, "Shared commit");
    git(dir, ["remote", "add", "origin", remote]);
    git(dir, ["push", "-q", "-u", "origin", "main"]);
    git(dir, ["fetch", "-q", "origin"]);
    commit(dir, "Local commit one");
    commit(dir, "Local commit two");

    const { scanProject } = await load();
    const project = await scanProject("ahead");
    expect(project.aheadBehind).toEqual({ ahead: 2, behind: 0 });
    expect(project.hasRemote).toBe(true);
    // A local-path remote has no web page.
    expect(project.repoUrl).toBeUndefined();
    const fetchHead = fs.statSync(path.join(dir, ".git", "FETCH_HEAD")).mtime.toISOString();
    expect(project.lastFetchedAt).toBe(fetchHead);
  });

  it("uses the first remote when there's no origin", async () => {
    const dir = path.join(projects, "fork");
    initRepo(dir);
    commit(dir, "Initial commit");
    git(dir, ["remote", "add", "upstream", "https://gitlab.com/group/fork.git"]);

    const { scanProject } = await load();
    const project = await scanProject("fork");
    expect(project.repoUrl).toBe("https://gitlab.com/group/fork");
    expect(project.hasRemote).toBe(true);
  });

  it("prefers origin over other remotes", async () => {
    const dir = path.join(projects, "two-remotes");
    initRepo(dir);
    commit(dir, "Initial commit");
    git(dir, ["remote", "add", "aaa", "https://github.com/someone-else/two-remotes.git"]);
    git(dir, ["remote", "add", "origin", "https://github.com/me/two-remotes.git"]);

    const { scanProject } = await load();
    expect((await scanProject("two-remotes")).repoUrl).toBe("https://github.com/me/two-remotes");
  });

  it("reports a repo without remotes", async () => {
    const dir = path.join(projects, "local-only");
    initRepo(dir);
    commit(dir, "Initial commit");
    const { scanProject } = await load();
    const project = await scanProject("local-only");
    expect(project.hasRemote).toBe(false);
    expect(project.repoUrl).toBeUndefined();
    expect(project.lastFetchedAt).toBeNull();
  });

  it("reports a detached HEAD as the branch HEAD", async () => {
    const dir = path.join(projects, "detached");
    initRepo(dir);
    commit(dir, "One");
    commit(dir, "Two");
    git(dir, ["checkout", "-q", "HEAD~1"]);
    const { scanProject } = await load();
    const project = await scanProject("detached");
    expect(project.branch).toBe("HEAD");
    expect(project.lastCommitMessage).toBe("One");
  });

  it("leaves git fields unset when git fails", async () => {
    const dir = path.join(projects, "broken");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, ".git"), "not a gitfile");
    const { scanProject } = await load();
    const project = await scanProject("broken");
    expect(project.isGitRepo).toBe(true);
    expect(project.branch).toBeUndefined();
    expect(project.files).toBeUndefined();
    expect(project.hasRemote).toBeUndefined();
    expect(project.aheadBehind).toBeUndefined();
  });

  it("also leaves git fields unset for a repo with no commits yet", async () => {
    // git log fails before the first commit, which discards status too.
    const dir = path.join(projects, "fresh");
    initRepo(dir);
    fs.writeFileSync(path.join(dir, "draft.txt"), "");
    const { scanProject } = await load();
    const project = await scanProject("fresh");
    expect(project.isGitRepo).toBe(true);
    expect(project.branch).toBeUndefined();
    expect(project.untrackedFiles).toBeUndefined();
  });

  it("adds notes, todos, hidden and parked state from the data folder", async () => {
    fs.mkdirSync(path.join(projects, "noted"));
    fs.mkdirSync(dataDir, { recursive: true });
    const todos = [{ id: "t1", text: "Ship it", done: false, createdAt: "2024-01-01T00:00:00.000Z" }];
    fs.writeFileSync(path.join(dataDir, "notes.json"), JSON.stringify({ noted: { notes: "Remember this", todos } }));
    fs.writeFileSync(
      path.join(dataDir, "settings.json"),
      JSON.stringify({ hiddenProjects: ["noted"], parked: { noted: "fp-123" } })
    );

    const { scanProject } = await load();
    expect(await scanProject("noted")).toMatchObject({
      notes: "Remember this",
      todos,
      hidden: true,
      parkedFingerprint: "fp-123",
    });
  });

  it("uses the context it's given instead of reading settings", async () => {
    fs.mkdirSync(path.join(projects, "ctx"));
    const { scanProject } = await load();
    const project = await scanProject("ctx", {
      root: projects,
      notes: { ctx: { notes: "From context", todos: [] } },
      hidden: new Set(["ctx"]),
      parked: { ctx: "fp" },
    });
    expect(project).toMatchObject({ notes: "From context", hidden: true, parkedFingerprint: "fp" });
  });
});

describe("scanAll", () => {
  it("lists project folders, most recently committed first, non-git last by name", async () => {
    const older = path.join(projects, "older");
    const newer = path.join(projects, "newer");
    const middle = path.join(projects, "middle");
    initRepo(older);
    commit(older, "Old", "2023-01-01T00:00:00Z");
    initRepo(newer);
    commit(newer, "New", "2025-01-01T00:00:00Z");
    initRepo(middle);
    commit(middle, "Mid", "2024-01-01T00:00:00Z");
    fs.mkdirSync(path.join(projects, "zeta-plain"));
    fs.mkdirSync(path.join(projects, "alpha-plain"));
    // Skipped: dot-folders and files.
    fs.mkdirSync(path.join(projects, ".cache"));
    fs.writeFileSync(path.join(projects, "notes.txt"), "");

    const { scanAll } = await load();
    const result = await scanAll();
    expect(result.map((p) => p.name)).toEqual(["newer", "middle", "older", "alpha-plain", "zeta-plain"]);
    expect(result[0].lastCommitMessage).toBe("New");
  });

  it("leaves out workbench's own folder", async () => {
    const self = path.join(projects, "workbench-self");
    fs.mkdirSync(self);
    fs.mkdirSync(path.join(projects, "other"));
    vi.spyOn(process, "cwd").mockReturnValue(self);

    const { scanAll } = await load();
    expect((await scanAll()).map((p) => p.name)).toEqual(["other"]);
  });

  it("returns an empty list for an empty projects folder", async () => {
    const { scanAll } = await load();
    expect(await scanAll()).toEqual([]);
  });
});

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverProjectRoots } from "./discover";

// Every scan runs over a fake home folder built in a temp directory, and
// os.homedir() points there too, so the real home folder is never walked.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-discover-")));
let home: string;
let n = 0;

/** How a folder under home is shown: ~/code, or ~\\code on Windows. */
const tilde = (...parts: string[]) => path.join("~", ...parts);

const realPlatform = process.platform;
const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });

function mkdir(...parts: string[]) {
  const dir = path.join(home, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A git repo at home/<rel>, with these remotes in .git/config. */
function repo(rel: string, remotes: Record<string, string> = {}) {
  const dir = mkdir(rel);
  fs.mkdirSync(path.join(dir, ".git"));
  const config = ["[core]", "\tbare = false"];
  for (const [name, url] of Object.entries(remotes)) config.push(`[remote "${name}"]`, `\turl = ${url}`, "\tfetch = +refs/heads/*:refs/remotes/origin/*");
  fs.writeFileSync(path.join(dir, ".git", "config"), config.join("\n") + "\n");
  return dir;
}

/** A repo whose .git/config is exactly this text. */
function repoWithConfig(rel: string, config: string) {
  const dir = mkdir(rel);
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "config"), config);
  return dir;
}

beforeEach(() => {
  home = path.join(root, `home${n++}`);
  fs.mkdirSync(home);
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(realPlatform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("discoverProjectRoots", () => {
  it("groups repos by the folder they sit in", async () => {
    repo("code/alpha", { origin: "https://github.com/me/alpha.git" });
    repo("code/beta");
    repo("work/gamma", { origin: "git@github.com:acme/gamma.git" });

    const result = await discoverProjectRoots(home);
    expect(result.truncated).toBe(false);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    // home, code, work, and the three repos.
    expect(result.scannedDirs).toBe(6);
    expect(result.roots).toEqual([
      { dir: path.join(home, "code"), display: tilde("code"), repos: ["alpha", "beta"], github: ["me/alpha"] },
      { dir: path.join(home, "work"), display: tilde("work"), repos: ["gamma"], github: ["acme/gamma"] },
    ]);
  });

  it("scans the home folder by default", async () => {
    repo("code/alpha");
    const { roots } = await discoverProjectRoots();
    expect(roots.map((r) => r.display)).toEqual([tilde("code")]);
  });

  it("ranks by GitHub repos, then repos, then path", async () => {
    repo("a/one");
    repo("a/two");
    repo("a/three");
    repo("b/one", { origin: "https://github.com/x/one" });
    repo("c/one", { origin: "https://github.com/x/one" });
    repo("c/two");
    repo("d/one");
    repo("e/one");
    const { roots } = await discoverProjectRoots(home);
    expect(roots.map((r) => path.basename(r.dir))).toEqual(["c", "b", "a", "d", "e"]);
    expect(roots[2].repos).toEqual(["one", "three", "two"]);
  });

  it("suggests at most 15 folders", async () => {
    for (let i = 0; i < 17; i++) repo(`group${String(i).padStart(2, "0")}/repo`);
    const { roots } = await discoverProjectRoots(home);
    expect(roots).toHaveLength(15);
    expect(roots[0].display).toBe(tilde("group00"));
    expect(roots[14].display).toBe(tilde("group14"));
  });

  it("stops at a repo instead of looking inside it", async () => {
    repo("code/app");
    repo("code/app/packages/inner");
    const { roots } = await discoverProjectRoots(home);
    expect(roots).toEqual([expect.objectContaining({ dir: path.join(home, "code"), repos: ["app"] })]);
  });

  it("doesn't count the home folder itself as a repo", async () => {
    fs.mkdirSync(path.join(home, ".git"));
    repo("code/app");
    const { roots } = await discoverProjectRoots(home);
    expect(roots.map((r) => r.dir)).toEqual([path.join(home, "code")]);
  });

  it("finds repos four levels down, but not five", async () => {
    repo("a/b/c/four");
    repo("a/b/c/d/five");
    const { roots } = await discoverProjectRoots(home);
    expect(roots).toEqual([expect.objectContaining({ dir: path.join(home, "a/b/c"), repos: ["four"] })]);
  });

  it("skips dependencies, build output and hidden folders at any depth", async () => {
    for (const skipped of ["node_modules", "vendor", "Pods", "venv", "target", "dist", "build", "out", "__pycache__", "DerivedData", ".cache"]) {
      repo(`code/${skipped}/pkg`);
    }
    repo("code/.hidden-repo");
    repo("code/real");
    const { roots } = await discoverProjectRoots(home);
    expect(roots).toEqual([expect.objectContaining({ dir: path.join(home, "code"), repos: ["real"] })]);
  });

  it("skips Library, media, Desktop, Downloads and the Go module cache, only at the top", async () => {
    for (const skipped of [
      "Library", "Applications", "Pictures", "Music", "Movies", "Public", "Desktop", "Downloads", "go/pkg/mod",
      // Linux
      "snap", "Videos", "Android/Sdk",
    ]) {
      repo(`${skipped}/repo`);
    }
    repo("go/src/tool");
    repo("code/Library/repo");
    const { roots } = await discoverProjectRoots(home);
    expect(roots.map((r) => r.display).sort()).toEqual([tilde("code", "Library"), tilde("go", "src")]);
  });

  // Making a symlink on Windows needs admin rights or Developer Mode.
  it.skipIf(realPlatform === "win32")("doesn't follow symlinks", async () => {
    repo("code/app");
    fs.symlinkSync(path.join(home, "code"), path.join(home, "link"));
    const { roots } = await discoverProjectRoots(home);
    expect(roots.map((r) => r.dir)).toEqual([path.join(home, "code")]);
  });

  it("also skips AppData, scoop and the shell folders at the top of a Windows home folder, whatever their case", async () => {
    setPlatform("win32");
    for (const skipped of ["AppData/Local/proj", "scoop/buckets/main", "saved games/x", "Favorites/x", "3D Objects/x", "Library/x"]) {
      repo(skipped);
    }
    repo("code/AppData/repo");
    repo("source/repos/app");
    const { roots } = await discoverProjectRoots(home);
    expect(roots.map((r) => r.display).sort()).toEqual([tilde("code", "AppData"), tilde("source", "repos")]);
  });

  it("only skips the Windows folders on Windows", async () => {
    setPlatform("darwin");
    repo("AppData/proj");
    repo("scoop/main");
    const { roots } = await discoverProjectRoots(home);
    expect(roots.map((r) => r.display).sort()).toEqual([tilde("AppData"), tilde("scoop")]);
  });

  it("returns nothing for a folder it can't read", async () => {
    const result = await discoverProjectRoots(path.join(home, "missing"));
    expect(result).toMatchObject({ roots: [], scannedDirs: 1, truncated: false });
  });

  it("counts a repo whose git config can't be read, without a GitHub slug", async () => {
    mkdir("code/broken/.git");
    const { roots } = await discoverProjectRoots(home);
    expect(roots).toEqual([expect.objectContaining({ repos: ["broken"], github: [] })]);
  });
});

describe("GitHub remotes", () => {
  async function slugs(config: string) {
    repoWithConfig("code/r", config);
    const { roots } = await discoverProjectRoots(home);
    return roots[0].github;
  }
  const remote = (url: string, name = "origin") => `[remote "${name}"]\n\turl = ${url}\n`;

  it.each([
    ["https", "https://github.com/me/app.git", ["me/app"]],
    ["scp-style ssh", "git@github.com:me/app.git", ["me/app"]],
    ["an ssh host alias", "git@github.com-work:acme/app.git", ["acme/app"]],
    ["ssh:// with www", "ssh://git@www.github.com/me/app", ["me/app"]],
    ["mixed case", "https://GitHub.com/Me/App", ["Me/App"]],
    ["an escaped name", "https://github.com/me/my%20app", ["me/my app"]],
    ["GitLab", "git@gitlab.com:me/app.git", []],
    ["a local path", "/srv/git/app.git", []],
    ["a profile, not a repo", "https://github.com/me", []],
    ["a lookalike host", "https://notgithub.com/me/app", []],
  ])("reads %s", async (_label, url, expected) => {
    expect(await slugs(remote(url))).toEqual(expected);
  });

  it("prefers origin over other remotes", async () => {
    expect(await slugs(remote("https://github.com/upstream/app", "upstream") + remote("https://github.com/me/app"))).toEqual(["me/app"]);
  });

  it("uses another remote when origin isn't on GitHub", async () => {
    expect(await slugs(remote("https://gitlab.com/me/app") + remote("git@github.com:up/app.git", "upstream"))).toEqual(["up/app"]);
  });

  it("uses the first remote when there's no origin", async () => {
    expect(await slugs(remote("https://github.com/a/app", "fork") + remote("https://github.com/b/app", "upstream"))).toEqual(["a/app"]);
  });

  it("keeps a remote's first url", async () => {
    expect(await slugs('[remote "origin"]\n\turl = https://gitlab.com/me/app\n\turl = https://github.com/me/app\n')).toEqual([]);
  });

  it("ignores url lines outside a remote section", async () => {
    expect(
      await slugs(
        'url = https://github.com/top/level\n[url "git@github.com:"]\n\tinsteadOf = gh:\n[branch "main"]\n\turl = https://github.com/me/branch\n'
      )
    ).toEqual([]);
  });

  it("stops reading a remote at the next section", async () => {
    expect(await slugs('[remote "origin"]\n\tfetch = +refs/heads/*\n[core]\n\turl = https://github.com/me/app\n')).toEqual([]);
  });

  it("reads Windows line endings and spaced section headers", async () => {
    expect(await slugs('[core]\r\n[ remote "origin" ]\r\n\turl=https://github.com/me/app\r\n')).toEqual(["me/app"]);
  });

  it("follows a worktree's .git file to the main repo's config", async () => {
    repo("code/main", { origin: "https://github.com/me/main" });
    const gitDir = path.join(home, "code/main/.git/worktrees/wt");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "commondir"), "../..\n");
    mkdir("code/wt");
    fs.writeFileSync(path.join(home, "code/wt/.git"), "gitdir: ../main/.git/worktrees/wt\n");
    const { roots } = await discoverProjectRoots(home);
    expect(roots[0]).toMatchObject({ repos: ["main", "wt"], github: ["me/main", "me/main"] });
  });

  it("follows a submodule's .git file to its own git dir", async () => {
    const gitDir = path.join(home, ".git-modules", "lib");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "config"), remote("git@github.com:me/lib.git"));
    mkdir("code/lib");
    fs.writeFileSync(path.join(home, "code/lib/.git"), `gitdir: ${gitDir}\n`);
    const { roots } = await discoverProjectRoots(home);
    expect(roots[0]).toMatchObject({ repos: ["lib"], github: ["me/lib"] });
  });

  it("counts a repo whose .git file doesn't point anywhere", async () => {
    mkdir("code/odd");
    fs.writeFileSync(path.join(home, "code/odd/.git"), "not a pointer\n");
    const { roots } = await discoverProjectRoots(home);
    expect(roots[0]).toMatchObject({ repos: ["odd"], github: [] });
  });
});

describe("limits", () => {
  it("gives up when the time budget runs out", async () => {
    repo("code/app");
    // Start, then the first batch check, are on time; everything after is 10s later.
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10_000);
    const result = await discoverProjectRoots(home);
    expect(result).toEqual({ roots: [], scannedDirs: 1, truncated: true, elapsedMs: 10_000 });
  });

  it("gives up after 25,000 folders", async () => {
    const children = Array.from({ length: 30_000 }, (_, i) => ({ name: `d${i}`, isDirectory: () => true }));
    const readdir = vi.spyOn(fsp, "readdir").mockImplementation((async (dir: string) => (dir === home ? children : [])) as never);
    const result = await discoverProjectRoots(home);
    expect(result.truncated).toBe(true);
    // The home folder, then whole batches of 64 until the count reaches 25,000.
    expect(result.scannedDirs).toBe(1 + 64 * Math.ceil((25_000 - 1) / 64));
    expect(readdir).toHaveBeenCalledTimes(result.scannedDirs);
    expect(result.roots).toEqual([]);
  });
});

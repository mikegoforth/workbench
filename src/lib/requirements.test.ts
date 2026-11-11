import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atLeast, checkRequirements, MIN_NODE } from "./requirements";

// Every command is mocked, every file check goes through a spy, and the
// platform is pinned (macOS unless a test says otherwise), so the results never
// depend on what's installed on the machine running the tests.
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, default: { ...actual, execFile }, execFile };
});

type Callback = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

/** Output per command line ("gh auth status"), or null for "not installed / fails". */
let outputs: Record<string, string | null>;
/** Paths that exist, as far as requirements.ts can tell. */
let existing: Set<string>;

const HOME = "/Users/tester";
const NVM = path.join(HOME, ".nvm");
const DOCKER_APP = "/Applications/Docker.app";
const ORBSTACK_APP = "/Applications/OrbStack.app";
const VSCODE_APP = "/Applications/Visual Studio Code.app";
const LINUX_DOCKER_DESKTOP = "/opt/docker-desktop";
const LINUX_VSCODE = ["/usr/share/code", "/usr/bin/code", "/snap/bin/code"];
// Windows install locations, with %ProgramFiles% and %LOCALAPPDATA% pointed at a Q: drive in those tests.
const WINDOWS_DOCKER = "Q:\\Programs\\Docker\\Docker\\Docker Desktop.exe";
const WINDOWS_VSCODE = "Q:\\Local\\Programs\\Microsoft VS Code\\Code.exe";
const WATCHED = new Set([NVM, DOCKER_APP, ORBSTACK_APP, VSCODE_APP, LINUX_DOCKER_DESKTOP, ...LINUX_VSCODE, WINDOWS_DOCKER, WINDOWS_VSCODE]);

const realPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

beforeEach(() => {
  outputs = {
    "node --version": "v22.12.0\n",
    "docker --version": "Docker version 27.3.1, build ce12230\n",
    "git --version": "git version 2.47.0\n",
    "gh --version": "gh version 2.62.0 (2024-11-14)\nhttps://github.com/cli/cli/releases/tag/v2.62.0\n",
    "gh auth status": "Logged in to github.com\n",
    "code --version": "1.95.3\nf1a4fb101478ce6ec82fe9627c43efbf9e98c813\narm64\n",
  };
  existing = new Set();
  execFile.mockImplementation((cmd: string, args: string[], _opts: unknown, cb: Callback) => {
    const out = outputs[[cmd, ...args].join(" ")];
    if (out == null) cb(Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" }));
    else cb(null, { stdout: out, stderr: "" });
  });
  vi.spyOn(os, "homedir").mockReturnValue(HOME);
  const realExists = fs.existsSync;
  vi.spyOn(fs, "existsSync").mockImplementation((p) => (WATCHED.has(String(p)) ? existing.has(String(p)) : realExists(p)));
  setPlatform("darwin");
});

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(realPlatform);
});

async function requirement(id: string) {
  const { requirements } = await checkRequirements();
  return requirements.find((r) => r.id === id);
}

describe("atLeast", () => {
  it.each([
    ["22.12.0", "22.12.0", true],
    ["22.12.1", "22.12.0", true],
    ["22.13.0", "22.12.0", true],
    ["24.0.0", "22.12.0", true],
    // Numeric, not string, comparison: 22.9 is older than 22.12.
    ["22.9.0", "22.12.0", false],
    ["22.11.9", "22.12.0", false],
    ["20.19.5", "22.12.0", false],
    ["100.0.0", "22.12.0", true],
    // Missing parts count as 0.
    ["22.12", "22.12.0", true],
    ["23", "22.12.0", true],
    ["22", "22.12.0", false],
    ["22.12.0", "22", true],
    ["22.11.0", "22.12", false],
    ["22.12.1", "22.12", true],
  ])("%s >= %s is %s", (a, b, expected) => {
    expect(atLeast(a, b)).toBe(expected);
  });

  it("reads a prerelease by its numeric parts", () => {
    expect(atLeast("23.0.0-nightly2026", "22.12.0")).toBe(true);
  });
});

describe("MIN_NODE", () => {
  it("is a supported Node line", () => {
    expect(atLeast(MIN_NODE, "22.0.0")).toBe(true);
  });
});

describe("checkRequirements", () => {
  it("is ok when everything is installed", async () => {
    const result = await checkRequirements();
    expect(result.ok).toBe(true);
    expect(result.requirements.map((r) => [r.id, r.ok, r.found])).toEqual([
      ["node", true, "22.12.0"],
      ["docker", true, "27.3.1"],
      ["git", true, "2.47.0"],
      ["gh", true, "2.62.0"],
      ["vscode", true, "1.95.3"],
    ]);
    expect(execFile).toHaveBeenCalledWith("gh", ["auth", "status"], { timeout: 10_000, windowsHide: true }, expect.any(Function));
  });

  it("is still ok without the optional ones", async () => {
    outputs["gh --version"] = null;
    outputs["code --version"] = null;
    const result = await checkRequirements();
    expect(result.ok).toBe(true);
    expect(result.requirements.filter((r) => !r.ok).map((r) => [r.id, r.optional])).toEqual([
      ["gh", true],
      ["vscode", true],
    ]);
  });

  it.each(["node", "docker", "git"])("is not ok without %s", async (cmd) => {
    outputs[`${cmd} --version`] = null;
    const result = await checkRequirements();
    expect(result.ok).toBe(false);
    expect(result.requirements.filter((r) => !r.ok).map((r) => r.id)).toEqual([cmd]);
  });
});

describe("node requirement", () => {
  it("accepts the minimum version", async () => {
    expect(await requirement("node")).toEqual({
      id: "node",
      name: "Node.js",
      need: "22.12 or later",
      help: [{ label: "Download Node.js", url: "https://nodejs.org/en/download" }],
      ok: true,
      found: "22.12.0",
      detail: "Version 22.12.0",
    });
  });

  it("refuses an older Node", async () => {
    outputs["node --version"] = "v20.19.5\n";
    expect(await requirement("node")).toMatchObject({
      ok: false,
      found: "20.19.5",
      detail: "Version 20.19.5 is too old. Projects need 22.12 or later.",
      hint: undefined,
    });
  });

  it("suggests nvm to people who have it", async () => {
    outputs["node --version"] = "v18.20.0\n";
    existing.add(NVM);
    expect((await requirement("node"))?.hint).toBe("You have nvm: run nvm install --lts, then nvm alias default lts/*");
  });

  it("explains a missing Node", async () => {
    outputs["node --version"] = null;
    existing.add(NVM);
    expect(await requirement("node")).toMatchObject({
      ok: false,
      found: null,
      detail: "Not found. It's needed to install dependencies and run dev servers.",
      hint: expect.stringContaining("nvm install --lts"),
    });
  });
});

describe("docker requirement", () => {
  it("reads the version out of docker --version", async () => {
    expect(await requirement("docker")).toMatchObject({ ok: true, found: "27.3.1", detail: "Version 27.3.1", need: "Docker Desktop or OrbStack" });
  });

  it("shows the raw output when there's no version number in it", async () => {
    outputs["docker --version"] = "OrbStack docker shim\n";
    expect(await requirement("docker")).toMatchObject({ ok: true, found: "OrbStack docker shim" });
  });

  it.each([
    [DOCKER_APP, "Docker"],
    [ORBSTACK_APP, "OrbStack"],
  ])("notices %s installed without its command", async (app, name) => {
    outputs["docker --version"] = null;
    existing.add(app);
    expect(await requirement("docker")).toMatchObject({
      ok: false,
      found: null,
      detail: `${name} is installed, but the docker command isn't available.`,
      hint: `Open ${name} once so it can finish installing its command-line tools.`,
    });
  });

  it("prefers Docker Desktop when both apps are installed", async () => {
    outputs["docker --version"] = null;
    existing.add(DOCKER_APP).add(ORBSTACK_APP);
    expect((await requirement("docker"))?.detail).toMatch(/^Docker is installed/);
  });

  it("explains a missing Docker", async () => {
    outputs["docker --version"] = null;
    const docker = await requirement("docker");
    expect(docker).toMatchObject({ ok: false, found: null, detail: "Not found. It's needed for projects with a compose file." });
    expect(docker).not.toHaveProperty("hint");
    expect(docker?.help.map((h) => h.label)).toEqual(["Get Docker Desktop", "or OrbStack"]);
  });

  it("doesn't count the Linux app on macOS", async () => {
    outputs["docker --version"] = null;
    existing.add(LINUX_DOCKER_DESKTOP);
    expect((await requirement("docker"))?.detail).toBe("Not found. It's needed for projects with a compose file.");
  });
});

describe("git requirement", () => {
  it("reads the version out of git --version", async () => {
    outputs["git --version"] = "git version 2.39.5 (Apple Git-154)\n";
    expect(await requirement("git")).toMatchObject({ ok: true, found: "2.39.5", detail: "Version 2.39.5" });
  });

  it("shows the raw output when there's no version number in it", async () => {
    outputs["git --version"] = "git (custom build)";
    expect((await requirement("git"))?.found).toBe("git (custom build)");
  });

  it("suggests the command-line tools when git is missing", async () => {
    outputs["git --version"] = null;
    expect(await requirement("git")).toMatchObject({
      ok: false,
      found: null,
      hint: "Or install Apple's command-line tools: xcode-select --install",
    });
  });
});

describe("GitHub CLI requirement", () => {
  it("is ok when installed and signed in", async () => {
    expect(await requirement("gh")).toMatchObject({ ok: true, optional: true, found: "2.62.0", detail: "Version 2.62.0, signed in" });
  });

  it("asks to sign in when gh auth status fails", async () => {
    outputs["gh auth status"] = null;
    expect(await requirement("gh")).toMatchObject({
      ok: false,
      found: "2.62.0",
      detail: "Version 2.62.0 is installed, but not signed in.",
      hint: "Run gh auth login in a terminal.",
    });
  });

  it("falls back to the first line when there's no version number", async () => {
    outputs["gh --version"] = "gh dev build\nmore\n";
    expect((await requirement("gh"))?.found).toBe("gh dev build");
  });

  it("explains a missing gh, without checking sign-in", async () => {
    outputs["gh --version"] = null;
    expect(await requirement("gh")).toMatchObject({ ok: false, found: null, detail: expect.stringContaining("no CI status") });
    expect(execFile.mock.calls.some(([cmd, args]) => cmd === "gh" && args[0] === "auth")).toBe(false);
  });
});

describe("VS Code requirement", () => {
  it("reads the version from the first line of code --version", async () => {
    expect(await requirement("vscode")).toMatchObject({ ok: true, optional: true, found: "1.95.3", detail: "Version 1.95.3" });
  });

  it("is ok when the app is installed without the code command", async () => {
    outputs["code --version"] = null;
    existing.add(VSCODE_APP);
    expect(await requirement("vscode")).toMatchObject({ ok: true, found: null, detail: "Installed" });
  });

  it("explains a missing VS Code", async () => {
    outputs["code --version"] = null;
    expect(await requirement("vscode")).toMatchObject({ ok: false, found: null, detail: "Not found. Workbench opens projects and files in it." });
  });
});

describe("on Linux", () => {
  beforeEach(() => {
    setPlatform("linux");
  });

  it("is ok when everything is installed, with the same checks", async () => {
    const result = await checkRequirements();
    expect(result.ok).toBe(true);
    expect(result.requirements.map((r) => [r.id, r.ok, r.found])).toEqual([
      ["node", true, "22.12.0"],
      ["docker", true, "27.3.1"],
      ["git", true, "2.47.0"],
      ["gh", true, "2.62.0"],
      ["vscode", true, "1.95.3"],
    ]);
  });

  it("links to Docker Engine and Docker Desktop for Linux", async () => {
    expect(await requirement("docker")).toMatchObject({
      ok: true,
      need: "Docker Engine or Docker Desktop",
      help: [
        { label: "Install Docker Engine", url: "https://docs.docker.com/engine/install/" },
        { label: "or Docker Desktop for Linux", url: "https://docs.docker.com/desktop/setup/install/linux/" },
      ],
    });
  });

  it("notices Docker Desktop for Linux installed without its command", async () => {
    outputs["docker --version"] = null;
    existing.add(LINUX_DOCKER_DESKTOP);
    expect(await requirement("docker")).toMatchObject({
      ok: false,
      found: null,
      detail: "Docker Desktop is installed, but the docker command isn't available.",
      hint: expect.stringContaining("docker-ce-cli"),
    });
  });

  it("doesn't look for macOS apps", async () => {
    outputs["docker --version"] = null;
    outputs["code --version"] = null;
    existing.add(DOCKER_APP).add(ORBSTACK_APP).add(VSCODE_APP);
    expect(await requirement("docker")).toMatchObject({ ok: false, detail: "Not found. It's needed for projects with a compose file." });
    expect(await requirement("vscode")).toMatchObject({ ok: false });
  });

  it("links to Git for Linux and suggests the package manager", async () => {
    outputs["git --version"] = null;
    expect(await requirement("git")).toMatchObject({
      ok: false,
      help: [{ label: "Download Git", url: "https://git-scm.com/downloads/linux" }],
      hint: expect.stringContaining("sudo apt install git"),
    });
  });

  it.each(LINUX_VSCODE)("counts VS Code installed at %s without code on PATH", async (where) => {
    outputs["code --version"] = null;
    existing.add(where);
    expect(await requirement("vscode")).toMatchObject({ ok: true, found: null, detail: "Installed" });
  });
});

describe("on Windows", () => {
  beforeEach(() => {
    setPlatform("win32");
    vi.stubEnv("ProgramFiles", "Q:\\Programs");
    vi.stubEnv("LOCALAPPDATA", "Q:\\Local");
    vi.stubEnv("PATH", "");
    vi.stubEnv("NVM_HOME", "");
  });

  it("is ok when everything is installed, finding VS Code by its Code.exe without running code.cmd", async () => {
    existing.add(WINDOWS_VSCODE);
    const result = await checkRequirements();
    expect(result.ok).toBe(true);
    expect(result.requirements.map((r) => [r.id, r.ok, r.found])).toEqual([
      ["node", true, "22.12.0"],
      ["docker", true, "27.3.1"],
      ["git", true, "2.47.0"],
      ["gh", true, "2.62.0"],
      ["vscode", true, null],
    ]);
    expect(execFile.mock.calls.some(([cmd]) => cmd === "code")).toBe(false);
  });

  it("explains a missing VS Code, ignoring macOS and Linux locations", async () => {
    existing.add(VSCODE_APP).add("/usr/bin/code");
    expect(await requirement("vscode")).toMatchObject({ ok: false, detail: "Not found. Workbench opens projects and files in it." });
  });

  it("links to Docker Desktop for Windows", async () => {
    outputs["docker --version"] = null;
    expect(await requirement("docker")).toMatchObject({
      ok: false,
      need: "Docker Desktop",
      detail: "Not found. It's needed for projects with a compose file.",
      help: [{ label: "Get Docker Desktop for Windows", url: "https://docs.docker.com/desktop/setup/install/windows-install/" }],
    });
  });

  it("notices Docker Desktop installed without its command on PATH", async () => {
    outputs["docker --version"] = null;
    existing.add(DOCKER_APP).add(WINDOWS_DOCKER);
    expect(await requirement("docker")).toMatchObject({
      ok: false,
      detail: "Docker Desktop is installed, but the docker command isn't available.",
      hint: expect.stringContaining("restart Workbench"),
    });
  });

  it("links to Git for Windows and suggests winget", async () => {
    outputs["git --version"] = null;
    expect(await requirement("git")).toMatchObject({
      ok: false,
      help: [{ label: "Download Git", url: "https://git-scm.com/download/win" }],
      hint: expect.stringContaining("winget install --id Git.Git -e"),
    });
  });

  it("suggests nvm-windows when NVM_HOME is set, and ignores ~/.nvm", async () => {
    outputs["node --version"] = "v20.0.0\n";
    existing.add(NVM);
    expect((await requirement("node"))?.hint).toBeUndefined();
    vi.stubEnv("NVM_HOME", "Q:\\nvm");
    expect((await requirement("node"))?.hint).toBe("You have nvm-windows: run nvm install lts, then nvm use lts");
  });
});

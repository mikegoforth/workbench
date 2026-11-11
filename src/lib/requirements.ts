import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { dockerApps, platform, vsCodePaths } from "./platform";
import type { Requirement, RequirementsResult } from "./types";

// What has to be installed on this machine before workbench is useful. Checked on
// every call (no caching) so "Check again" sees something installed a moment ago.
// Where to look and where to get things differ between macOS, Linux and Windows.
// On Windows node, docker, git and gh are .exe files, which execFile finds on
// PATH as is; VS Code's `code` is a batch file, so Code.exe is looked for instead.

const run = promisify(execFile);

/**
 * Oldest Node that runs current Next.js and Vite dev servers and is still
 * supported (Node 20 reached end-of-life in April 2026). Keep in step with
 * docs/install.md, docs/development.md, REQUIREMENTS.md and `engines` in
 * package.json.
 */
export const MIN_NODE = "22.12.0";

/** Exit code 0? (e.g. `gh auth status`) */
async function succeeds(cmd: string, args: string[]): Promise<boolean> {
  try {
    await run(cmd, args, { timeout: 10_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function version(cmd: string, args = ["--version"]): Promise<string | null> {
  try {
    const { stdout } = await run(cmd, args, { timeout: 5_000, windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** a >= b for dotted numeric versions like "22.12.0". */
export function atLeast(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return true;
}

async function checkNode(): Promise<Requirement> {
  const raw = await version("node");
  const found = raw?.replace(/^v/, "") ?? null;
  // nvm-windows sets NVM_HOME; nvm itself lives in ~/.nvm.
  const windows = platform() === "windows";
  const usesNvm = windows ? !!process.env.NVM_HOME : fs.existsSync(path.join(os.homedir(), ".nvm"));
  const help = [{ label: "Download Node.js", url: "https://nodejs.org/en/download" }];
  const minLabel = MIN_NODE.replace(/\.0$/, "");
  const base = { id: "node" as const, name: "Node.js", need: `${minLabel} or later`, help };

  if (found && atLeast(found, MIN_NODE)) {
    return { ...base, ok: true, found, detail: `Version ${found}` };
  }
  const nvmHint = windows ? "You have nvm-windows: run nvm install lts, then nvm use lts" : "You have nvm: run nvm install --lts, then nvm alias default lts/*";
  const hint = usesNvm ? nvmHint : undefined;
  if (found) {
    return { ...base, ok: false, found, detail: `Version ${found} is too old. Projects need ${minLabel} or later.`, hint };
  }
  return { ...base, ok: false, found: null, detail: "Not found. It's needed to install dependencies and run dev servers.", hint };
}

async function checkDocker(): Promise<Requirement> {
  const raw = await version("docker");
  const os = platform();
  const linux = os === "linux";
  const help = linux
    ? [
        { label: "Install Docker Engine", url: "https://docs.docker.com/engine/install/" },
        { label: "or Docker Desktop for Linux", url: "https://docs.docker.com/desktop/setup/install/linux/" },
      ]
    : os === "windows"
      ? [{ label: "Get Docker Desktop for Windows", url: "https://docs.docker.com/desktop/setup/install/windows-install/" }]
      : [
          { label: "Get Docker Desktop", url: "https://www.docker.com/products/docker-desktop/" },
          { label: "or OrbStack", url: "https://orbstack.dev/download" },
        ];
  const need = linux ? "Docker Engine or Docker Desktop" : os === "windows" ? "Docker Desktop" : "Docker Desktop or OrbStack";
  const base = { id: "docker" as const, name: "Docker", need, help };

  if (raw) {
    const found = raw.match(/version\s+([\d.]+)/i)?.[1] ?? raw;
    return { ...base, ok: true, found, detail: `Version ${found}` };
  }
  const app = dockerApps().find((a) => fs.existsSync(a.path));
  if (app) {
    return {
      ...base,
      ok: false,
      found: null,
      detail: `${app.label} is installed, but the docker command isn't available.`,
      hint: linux
        ? "Install the docker-ce-cli package from Docker's repository, or reinstall Docker Desktop."
        : os === "windows"
          ? "Open Docker Desktop once so it can finish setting up, then restart Workbench so it sees the new PATH."
          : `Open ${app.label} once so it can finish installing its command-line tools.`,
    };
  }
  return { ...base, ok: false, found: null, detail: "Not found. It's needed for projects with a compose file." };
}

const GIT_DOWNLOAD: Partial<Record<ReturnType<typeof platform>, string>> = {
  linux: "https://git-scm.com/downloads/linux",
  windows: "https://git-scm.com/download/win",
};

const GIT_HINT: Partial<Record<ReturnType<typeof platform>, string>> = {
  linux: "Install it with your distribution's package manager, e.g. sudo apt install git or sudo dnf install git",
  windows: "Or install it with winget: winget install --id Git.Git -e. Then restart Workbench so it sees the new PATH.",
};

async function checkGit(): Promise<Requirement> {
  const raw = await version("git");
  const os = platform();
  const base = {
    id: "git" as const,
    name: "Git",
    need: "any recent version",
    help: [{ label: "Download Git", url: GIT_DOWNLOAD[os] ?? "https://git-scm.com/downloads/mac" }],
  };
  if (raw) {
    const found = raw.match(/version\s+([\d.]+)/i)?.[1] ?? raw;
    return { ...base, ok: true, found, detail: `Version ${found}` };
  }
  return {
    ...base,
    ok: false,
    found: null,
    detail: "Not found. Workbench reads every project's branch, changes and history with it.",
    hint: GIT_HINT[os] ?? "Or install Apple's command-line tools: xcode-select --install",
  };
}

// ---- Optional: workbench works without these, with less in it ----

async function checkGitHubCli(): Promise<Requirement> {
  const raw = await version("gh");
  const base = {
    id: "gh" as const,
    name: "GitHub CLI",
    need: "to be signed in",
    optional: true,
    help: [{ label: "Get GitHub CLI", url: "https://cli.github.com/" }],
  };
  if (!raw) {
    return { ...base, ok: false, found: null, detail: "Not found. Without it there's no CI status, pull requests or review requests." };
  }
  const found = raw.match(/version\s+([\d.]+)/i)?.[1] ?? raw.split("\n")[0];
  if (!(await succeeds("gh", ["auth", "status"]))) {
    return { ...base, ok: false, found, detail: `Version ${found} is installed, but not signed in.`, hint: "Run gh auth login in a terminal." };
  }
  return { ...base, ok: true, found, detail: `Version ${found}, signed in` };
}

async function checkVsCode(): Promise<Requirement> {
  const base = {
    id: "vscode" as const,
    name: "VS Code",
    need: "any version",
    optional: true,
    help: [{ label: "Download VS Code", url: "https://code.visualstudio.com/download" }],
  };
  // On Windows `code` is code.cmd, which execFile can't run without cmd.exe: only Code.exe is looked for.
  const raw = platform() === "windows" ? null : await version("code");
  if (raw) {
    const found = raw.split("\n")[0];
    return { ...base, ok: true, found, detail: `Version ${found}` };
  }
  // Installed, but its command isn't on PATH (e.g. never added on macOS), or on Windows.
  if (vsCodePaths().some((p) => fs.existsSync(p))) {
    return { ...base, ok: true, found: null, detail: "Installed" };
  }
  return { ...base, ok: false, found: null, detail: "Not found. Workbench opens projects and files in it." };
}

export async function checkRequirements(): Promise<RequirementsResult> {
  const requirements = await Promise.all([checkNode(), checkDocker(), checkGit(), checkGitHubCli(), checkVsCode()]);
  // Only the required ones decide whether workbench is ready.
  return { ok: requirements.every((r) => r.ok || r.optional), requirements };
}

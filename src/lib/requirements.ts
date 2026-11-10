import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { Requirement, RequirementsResult } from "./types";

// What has to be installed on this Mac before workbench is useful. Checked on
// every call (no caching) so "Check again" sees something installed a moment ago.

const run = promisify(execFile);

/**
 * Oldest Node that runs current Next.js and Vite dev servers and is still
 * supported (Node 20 reached end-of-life in April 2026). Keep in step with the
 * README, REQUIREMENTS.md and `engines` in package.json.
 */
export const MIN_NODE = "22.12.0";

const DOCKER_APPS = ["/Applications/Docker.app", "/Applications/OrbStack.app"];

/** Exit code 0? (e.g. `gh auth status`) */
async function succeeds(cmd: string, args: string[]): Promise<boolean> {
  try {
    await run(cmd, args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function version(cmd: string, args = ["--version"]): Promise<string | null> {
  try {
    const { stdout } = await run(cmd, args, { timeout: 5_000 });
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
  const usesNvm = fs.existsSync(path.join(os.homedir(), ".nvm"));
  const help = [{ label: "Download Node.js", url: "https://nodejs.org/en/download" }];
  const minLabel = MIN_NODE.replace(/\.0$/, "");
  const base = { id: "node" as const, name: "Node.js", need: `${minLabel} or later`, help };

  if (found && atLeast(found, MIN_NODE)) {
    return { ...base, ok: true, found, detail: `Version ${found}` };
  }
  const hint = usesNvm ? "You have nvm: run nvm install --lts, then nvm alias default lts/*" : undefined;
  if (found) {
    return { ...base, ok: false, found, detail: `Version ${found} is too old. Projects need ${minLabel} or later.`, hint };
  }
  return { ...base, ok: false, found: null, detail: "Not found. It's needed to install dependencies and run dev servers.", hint };
}

async function checkDocker(): Promise<Requirement> {
  const raw = await version("docker");
  const help = [
    { label: "Get Docker Desktop", url: "https://www.docker.com/products/docker-desktop/" },
    { label: "or OrbStack", url: "https://orbstack.dev/download" },
  ];
  const base = { id: "docker" as const, name: "Docker", need: "Docker Desktop or OrbStack", help };

  if (raw) {
    const found = raw.match(/version\s+([\d.]+)/i)?.[1] ?? raw;
    return { ...base, ok: true, found, detail: `Version ${found}` };
  }
  const app = DOCKER_APPS.find((p) => fs.existsSync(p));
  if (app) {
    return {
      ...base,
      ok: false,
      found: null,
      detail: `${path.basename(app, ".app")} is installed, but the docker command isn't available.`,
      hint: `Open ${path.basename(app, ".app")} once so it can finish installing its command-line tools.`,
    };
  }
  return { ...base, ok: false, found: null, detail: "Not found. It's needed for projects with a compose file." };
}

async function checkGit(): Promise<Requirement> {
  const raw = await version("git");
  const base = {
    id: "git" as const,
    name: "Git",
    need: "any recent version",
    help: [{ label: "Download Git", url: "https://git-scm.com/downloads/mac" }],
  };
  if (raw) {
    const found = raw.match(/version\s+([\d.]+)/i)?.[1] ?? raw;
    return { ...base, ok: true, found, detail: `Version ${found}` };
  }
  return {
    ...base,
    ok: false,
    found: null,
    detail: "Not found. workbench reads every project's branch, changes and history with it.",
    hint: "Or install Apple's command-line tools: xcode-select --install",
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
    return { ...base, ok: false, found, detail: `Version ${found} is installed, but not signed in.`, hint: "Run gh auth login in Terminal." };
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
  const raw = await version("code");
  if (raw) {
    const found = raw.split("\n")[0];
    return { ...base, ok: true, found, detail: `Version ${found}` };
  }
  if (fs.existsSync("/Applications/Visual Studio Code.app")) {
    return { ...base, ok: true, found: null, detail: "Installed" };
  }
  return { ...base, ok: false, found: null, detail: "Not found. workbench opens projects and files in it." };
}

export async function checkRequirements(): Promise<RequirementsResult> {
  const requirements = await Promise.all([checkNode(), checkDocker(), checkGit(), checkGitHubCli(), checkVsCode()]);
  // Only the required ones decide whether workbench is ready.
  return { ok: requirements.every((r) => r.ok || r.optional), requirements };
}

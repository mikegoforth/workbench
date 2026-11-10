import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { SetupCheck } from "./types";

// Readiness checks shown above Start: will the dev environment actually come up?

const run = promisify(execFile);

const ENV_EXAMPLES = [".env.example", ".env.sample", ".env.template"];
// Files dev servers commonly read variables from (Next.js, Vite, dotenv).
const ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"];
const NODE_VERSION_FILES = [".nvmrc", ".node-version"];
const MAX_KEYS_SHOWN = 8;

const exists = (dir: string, file: string) => fs.existsSync(path.join(dir, file));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Variable names defined in a dotenv file. Values are never read out. */
function envKeys(file: string): Set<string> {
  const keys = new Set<string>();
  try {
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=/);
      if (match) keys.add(match[1]);
    }
  } catch {
    // Unreadable: treat as empty.
  }
  return keys;
}

function listKeys(keys: string[]): string {
  if (keys.length <= MAX_KEYS_SHOWN) return keys.join(", ");
  return `${keys.slice(0, MAX_KEYS_SHOWN).join(", ")} and ${keys.length - MAX_KEYS_SHOWN} more`;
}

// The Node on workbench's PATH is the one Start will use. Looked up once.
let installedNode: Promise<string | null> | null = null;
function nodeOnPath(): Promise<string | null> {
  installedNode ??= run("node", ["--version"], { timeout: 5_000, windowsHide: true })
    .then(({ stdout }) => stdout.trim().replace(/^v/, ""))
    .catch(() => null);
  return installedNode;
}

function checkDependencies(dir: string, pm: string): SetupCheck | null {
  if (!exists(dir, "package.json")) return null;
  if (exists(dir, "node_modules")) {
    return { id: "deps", level: "ok", title: "Dependencies installed" };
  }
  return {
    id: "deps",
    level: "warn",
    title: "Dependencies not installed",
    detail: "There's no node_modules folder, so the dev script will fail.",
    action: { kind: "install", label: `Run ${pm} install` },
  };
}

function checkEnv(dir: string): SetupCheck | null {
  const example = ENV_EXAMPLES.find((f) => exists(dir, f));
  if (!example) return null;
  const wanted = [...envKeys(path.join(dir, example))];
  const envFiles = ENV_FILES.filter((f) => exists(dir, f));

  if (envFiles.length === 0) {
    return {
      id: "env",
      level: "warn",
      title: "No .env file",
      detail: wanted.length
        ? `${example} lists ${plural(wanted.length, "variable")}: ${listKeys(wanted)}`
        : `There's a ${example} but no .env.`,
      action: { kind: "open", label: `Open ${example}`, file: example },
    };
  }

  const have = new Set(envFiles.flatMap((f) => [...envKeys(path.join(dir, f))]));
  const missing = wanted.filter((key) => !have.has(key));
  if (missing.length > 0) {
    return {
      id: "env",
      level: "warn",
      title: `${plural(missing.length, "variable")} from ${example} not set`,
      detail: `Missing from ${envFiles.join(", ")}: ${listKeys(missing)}`,
      action: { kind: "open", label: `Open ${envFiles[0]}`, file: envFiles[0] },
    };
  }
  return { id: "env", level: "ok", title: `Every variable in ${example} is set` };
}

async function checkNode(dir: string): Promise<SetupCheck | null> {
  const file = NODE_VERSION_FILES.find((f) => exists(dir, f));
  if (!file) return null;
  const wanted = fs.readFileSync(path.join(dir, file), "utf-8").trim().split(/\s/)[0].replace(/^v/, "");
  const installed = await nodeOnPath();

  if (!installed) {
    return { id: "node", level: "warn", title: "Node isn't on PATH", detail: `${file} asks for ${wanted}.` };
  }
  // Aliases like "lts/*" or "lts/iron" need nvm to resolve.
  if (!/^\d+(\.\d+){0,2}$/.test(wanted)) {
    return {
      id: "node",
      level: "info",
      title: `${file} asks for "${wanted}"`,
      detail: `Can't check aliases here. Start will use Node ${installed}.`,
    };
  }
  if (installed === wanted || installed.startsWith(`${wanted}.`)) {
    return { id: "node", level: "ok", title: `Node ${installed} matches ${file} (${wanted})` };
  }
  return {
    id: "node",
    level: "warn",
    title: `${file} wants Node ${wanted}`,
    detail: `Start will use Node ${installed}, the version on PATH.`,
  };
}

function checkCompose(composeFile: string | null, composeError: string | null): SetupCheck | null {
  if (!composeFile || !composeError) return null;
  return {
    id: "compose",
    level: "warn",
    title: `${composeFile} doesn't load`,
    detail: composeError,
    action: { kind: "open", label: `Open ${composeFile}`, file: composeFile },
  };
}

export async function runChecks(
  dir: string,
  opts: { pm: string; composeFile: string | null; composeError: string | null }
): Promise<SetupCheck[]> {
  const checks = [
    checkDependencies(dir, opts.pm),
    checkEnv(dir),
    await checkNode(dir),
    checkCompose(opts.composeFile, opts.composeError),
  ];
  return checks.filter((c): c is SetupCheck => c !== null);
}

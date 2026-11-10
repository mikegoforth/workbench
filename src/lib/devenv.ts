import { execFile, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { dataDir } from "./dataDir";
import { runChecks } from "./checks";
import {
  COMPOSE_FILES,
  composeConfig,
  containerProblems,
  dockerMessage,
  dockerSnapshot,
  invalidateDocker,
  isUp,
  projectStacks,
  publicStack,
} from "./docker";
import { exeSearchHardenedByUs, linuxProcessStart, platform, powershellExe, system32, which } from "./platform";
import { ContainerProblem, DevStatus, DockerDaemon, ScriptStatus } from "./types";

/*
 * Runs things for a project: its dev environment (Start/Stop), a dependency
 * install, and package.json scripts.
 *
 * Start runs `docker compose up -d` when the project has a compose file, then
 * its package.json `dev` (or `start`) script, unless the compose file builds
 * the project folder itself: then compose *is* the app, and running the script
 * too would clash on the same port. Stop stops that process and every
 * container of the project's compose stacks, however they were started (see
 * docker.ts). Each stack can also be started, stopped or restarted on its own.
 *
 * Each project has two slots, each holding one process at a time:
 *   "dev"    – the dev environment or a dependency install
 *   "script" – a package.json script (lint, test, build…)
 * so you can run tests while the dev server is up.
 *
 * Processes run detached in their own process group, with output going to a
 * log under the data folder's dev/, so they outlive workbench restarts. The pid and start
 * time are saved next to the log. Stop checks that start time before
 * signalling, so a pid later reused by an unrelated process is never killed.
 * The start time is `ps -o lstart` on macOS and the boot id plus start ticks
 * from /proc on Linux (see linuxProcessStart).
 *
 * Windows has no /bin/sh and no process groups, and npm, pnpm and yarn are
 * .cmd batch files there, which only cmd.exe can run. So a small Node script
 * (WINDOWS_LAUNCHER, run by the node.exe on PATH) is started detached instead:
 * it runs each step with a hidden console, writes the "›" lines to the log
 * itself, and stays alive until the last step ends, so its pid stands for the
 * whole run. Package-manager steps go through `cmd.exe /d /s /c "npm run x"`,
 * built only from fixed words and a script name that has passed a strict
 * allowlist (WINDOWS_SCRIPT_NAME); the project folder is only ever the working
 * folder. Stop is `taskkill /T` (the whole tree), then `/F`. The start time is
 * the process's creation time, read with PowerShell (pids are the only thing
 * put into that command line).
 */

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const devDir = () => path.join(dataDir(), "dev");
const LOCKFILE_PM: [string, string][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
];
const LOG_TAIL_BYTES = 64 * 1024;
const LOG_TAIL_LINES = 200;
// CSI (colours, cursor moves) and OSC (titles, hyperlinks) escape sequences.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s"'<>]*/;
const EXIT_LINE = /^› exited with code (\d+)$/;
/**
 * The script names that can be run on Windows, where the name ends up in a
 * cmd.exe command line: nothing cmd.exe gives a meaning to (spaces, quotes,
 * & | < > ^ % ! and the like) can get through.
 */
const WINDOWS_SCRIPT_NAME = /^[A-Za-z0-9:._@/+-]+$/;
/** A whole step on Windows (`npm run test:unit`): fixed words and an allowed script name. */
const WINDOWS_STEP = /^[A-Za-z0-9:._@/+ -]+$/;

export class DevError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Slot = "dev" | "script";
type TaskKind = "dev" | "install" | "script";

interface Plan {
  compose: boolean;
  composeFile: string | null;
  /** Why `docker compose config` failed, if it did (e.g. a missing env file). */
  composeError: string | null;
  script: { pm: string; name: "dev" | "start" } | null;
  note: string | null;
}

interface RunState {
  pid: number;
  /** The pid's start time when we started it (see startTimeOf); guards against pid reuse. */
  lstart: string;
  startedAt: string;
  /** Older state files have no kind; those are dev runs. */
  kind?: TaskKind;
  /** For kind "script": which package.json script. */
  script?: string;
  url?: string;
}

// ---- Detection -------------------------------------------------------------

/** Package manager implied by the project's lockfile (npm if none). */
function detectPm(dir: string): string {
  return LOCKFILE_PM.find(([file]) => fs.existsSync(path.join(dir, file)))?.[1] ?? "npm";
}

function readScripts(dir: string): Record<string, string> {
  try {
    const scripts = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"))?.scripts;
    if (!scripts || typeof scripts !== "object") return {};
    return Object.fromEntries(
      Object.entries(scripts).filter((e): e is [string, string] => typeof e[1] === "string")
    );
  } catch {
    return {};
  }
}

function detectScript(dir: string): Plan["script"] {
  const scripts = readScripts(dir);
  const name = scripts.dev ? "dev" : scripts.start ? "start" : null;
  return name ? { pm: detectPm(dir), name } : null;
}

async function detectPlan(dir: string): Promise<Plan> {
  const composeFile = COMPOSE_FILES.find((f) => fs.existsSync(path.join(dir, f))) ?? null;
  const config = composeFile ? await composeConfig(dir, composeFile) : null;
  const script = detectScript(dir);
  const base = {
    compose: composeFile !== null,
    composeFile,
    composeError: config?.error ?? null,
  };
  if (script && config?.buildsDir) {
    return {
      ...base,
      script: null,
      note: `${composeFile} builds this project itself, so "${script.pm} run ${script.name}" isn't run as well (both would use the same port).`,
    };
  }
  return { ...base, script, note: null };
}

/** The commands Start runs. Only fixed strings: nothing from a request reaches the shell. */
function planSteps(plan: Plan): string[] {
  const steps: string[] = [];
  if (plan.compose) steps.push("docker compose up -d");
  if (plan.script) steps.push(`${plan.script.pm} run ${plan.script.name}`);
  return steps;
}

// ---- State & logs ----------------------------------------------------------

// dev slot: data/dev/<name>.{json,log}; script slot: data/dev/scripts/<name>.{json,log}
const slotDir = (slot: Slot) => (slot === "dev" ? devDir() : path.join(devDir(), "scripts"));
const statePath = (name: string, slot: Slot) => path.join(slotDir(slot), `${name}.json`);
const logPath = (name: string, slot: Slot) => path.join(slotDir(slot), `${name}.log`);

function readState(name: string, slot: Slot): RunState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath(name, slot), "utf-8"));
  } catch {
    return null;
  }
}

function writeState(name: string, slot: Slot, state: RunState) {
  fs.mkdirSync(slotDir(slot), { recursive: true });
  fs.writeFileSync(statePath(name, slot), JSON.stringify(state, null, 2));
}

function clearState(name: string, slot: Slot) {
  fs.rmSync(statePath(name, slot), { force: true });
}

function appendLog(name: string, slot: Slot, text: string) {
  fs.mkdirSync(slotDir(slot), { recursive: true });
  fs.appendFileSync(logPath(name, slot), text.endsWith("\n") ? text : text + "\n");
}

function readLogTail(name: string, slot: Slot): string[] {
  let fd: number;
  try {
    fd = fs.openSync(logPath(name, slot), "r");
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    const lines = buf
      .toString("utf-8")
      .replace(ANSI, "")
      .split("\n")
      // Progress bars redraw with \r: keep only what's visible after the last one.
      .map((l) => {
        const line = l.replace(/\r$/, "");
        return line.slice(line.lastIndexOf("\r") + 1);
      });
    if (size > length) lines.shift(); // first line is likely cut mid-way
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-LOG_TAIL_LINES);
  } finally {
    fs.closeSync(fd);
  }
}

/** The dev server's local URL from its startup banner ("Local: http://..."). */
function findUrl(lines: string[]): string | null {
  const banner = lines.find((l) => /local/i.test(l) && LOCAL_URL.test(l));
  const match = (banner ?? lines.find((l) => LOCAL_URL.test(l)))?.match(LOCAL_URL);
  if (!match) return null;
  return match[0]
    .replace(/\/\/(?:0\.0\.0\.0|\[::1?\])/, "//localhost")
    .replace(/[).,;]+$/, "");
}

// ---- Processes -------------------------------------------------------------

/** What identifies the process with this pid, as long as it runs; null if there's none. */
async function startTimeOf(pid: number): Promise<string | null> {
  if (platform() === "linux") return linuxProcessStart(pid);
  if (platform() === "windows") return (await windowsStartTimes([pid])).get(pid) ?? null;
  try {
    const { stdout } = await run("ps", ["-o", "lstart=", "-p", String(pid)]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Is the pid in `state` still the process we started? */
async function isOurs(state: RunState): Promise<boolean> {
  return !!state.lstart && (await startTimeOf(state.pid)) === state.lstart;
}

/** Is the process (Windows) or process group (elsewhere) still there? */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(platform() === "windows" ? pgid : -pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows: each live pid's creation time (UTC ticks), from one PowerShell
 * call. Pids already gone are left out without asking. Only integers are put
 * into the command.
 */
async function windowsStartTimes(pids: number[]): Promise<Map<number, string>> {
  const live = [...new Set(pids)].filter((pid) => Number.isSafeInteger(pid) && pid > 0 && groupAlive(pid));
  const times = new Map<number, string>();
  if (live.length === 0) return times;
  const script =
    `Get-Process -Id ${live.join(",")} -ErrorAction SilentlyContinue | ` +
    "ForEach-Object { try { '{0} {1}' -f $_.Id, $_.StartTime.ToUniversalTime().Ticks } catch {} }";
  // A pid that's gone by now makes PowerShell exit non-zero; the others are still printed.
  const stdout = await run(powershellExe(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 15_000,
    windowsHide: true,
  })
    .then((r) => r.stdout)
    .catch((e: { stdout?: string }) => e.stdout ?? "");
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+) (\d+)$/);
    if (match) times.set(Number(match[1]), match[2]);
  }
  return times;
}

/** Windows: taskkill the process and everything it started; /F kills instead of asking. */
async function taskkill(pid: number, force: boolean) {
  try {
    await run(system32("taskkill.exe"), ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])], { timeout: 15_000, windowsHide: true });
  } catch {
    // Already gone, or (console programs, without /F) refused: the next step deals with it.
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pgid, signal);
  } catch {
    // Already gone.
  }
}

/** SIGTERM the whole process tree, then SIGKILL whatever is left after 5s (on Windows: taskkill /T, then /F). */
async function killGroup(pgid: number) {
  const windows = platform() === "windows";
  if (windows) await taskkill(pgid, false);
  else signalGroup(pgid, "SIGTERM");
  for (let i = 0; i < 25 && groupAlive(pgid); i++) await sleep(200);
  if (!groupAlive(pgid)) return;
  if (windows) await taskkill(pgid, true);
  else signalGroup(pgid, "SIGKILL");
}

/**
 * Workbench's own env, minus its Next.js/npm/Electron settings, so the
 * project's tooling picks its own. Also drops every WORKBENCH_ variable, so a
 * project's scripts never see the desktop app's API token.
 */
export function devEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(__NEXT|NEXT_|TURBOPACK|npm_|ELECTRON_|WORKBENCH_)/i.test(key)) continue;
    // PORT and HOSTNAME are where workbench itself listens; a project must pick its own.
    if (key === "PORT" || key === "HOSTNAME" || key === "NODE_ENV" || key === "INIT_CWD") continue;
    // Set by the AppImage runtime on Linux: they describe workbench's own bundle, and
    // an Electron project started from here would think it was that AppImage.
    if (key === "APPIMAGE" || key === "APPDIR" || key === "ARGV0" || key === "OWD") continue;
    // Set by workbench itself on Windows (see hardenExeSearch); a project's own scripts may run things from their folder.
    if (key === "NoDefaultCurrentDirectoryInExePath" && exeSearchHardenedByUs()) continue;
    env[key] = value;
  }
  // Drop library folders inside workbench's AppImage; keep the user's own.
  const appDir = process.env.APPDIR;
  if (appDir && env.LD_LIBRARY_PATH) {
    const kept = env.LD_LIBRARY_PATH.split(":").filter((dir) => dir && dir !== appDir && !dir.startsWith(appDir + "/"));
    if (kept.length) env.LD_LIBRARY_PATH = kept.join(":");
    else delete env.LD_LIBRARY_PATH;
  }
  // NODE_ENV is deliberately absent (Next's types mark it required).
  return env as NodeJS.ProcessEnv;
}

/**
 * What to run: the steps (each a fixed command line such as "npm run dev",
 * shown in the log as it starts), and whether to log the exit code at the end.
 * On macOS and Linux the steps become a /bin/sh script (see sequence); a
 * script slot run is given as a fixed script with its variable parts in `args`
 * (as $0, $1, …) so the shell never parses them. On Windows WINDOWS_LAUNCHER
 * runs the steps.
 */
interface Run {
  steps: string[];
  exitLine: boolean;
  sh: { script: string; args: string[] };
}

/** One step for WINDOWS_LAUNCHER: a program by full path and its arguments. */
interface WindowsStep {
  label: string;
  command: string;
  args: string[];
  /** args is a fixed cmd.exe command line, passed as is. */
  verbatim?: boolean;
}

/**
 * Runs the steps it's given (as JSON in its one argument) one after another,
 * stopping at the first that fails, each with a hidden console of its own that
 * everything it starts shares, and output to this process's stdout and
 * stderr (the log). Writes the "›" lines itself, so they're UTF-8 whatever
 * cmd.exe's code page is. Exits with the last step's exit code.
 */
export const WINDOWS_LAUNCHER = [
  'const { spawn } = require("child_process");',
  'const fs = require("fs");',
  "const { steps, exitLine } = JSON.parse(process.argv[1]);",
  'const say = (text) => fs.writeSync(1, text + "\\n");',
  "const run = (step) => new Promise((resolve) => {",
  "  let child;",
  "  try {",
  '    child = spawn(step.command, step.args, { stdio: ["ignore", 1, 2], windowsHide: true, windowsVerbatimArguments: !!step.verbatim });',
  "  } catch (e) { say(String(e.message)); return resolve(1); }",
  '  child.on("error", (e) => { say(e.message); resolve(1); });',
  '  child.on("exit", (code) => resolve(code === null ? 1 : code));',
  "});",
  "(async () => {",
  "  let code = 0;",
  "  for (const step of steps) {",
  '    say("\\u203a " + step.label);',
  "    code = await run(step);",
  "    if (code !== 0) break;",
  "  }",
  '  if (exitLine) say("\\u203a exited with code " + code);',
  "  process.exitCode = code;",
  "})();",
].join("\n");

/** A step ("docker compose up -d", "pnpm run lint") as WINDOWS_LAUNCHER runs it. */
function windowsStep(label: string): WindowsStep {
  if (label === "docker compose up -d") {
    const docker = which("docker");
    if (!docker) throw new DevError(500, "Docker CLI not found on PATH");
    return { label, command: docker, args: ["compose", "up", "-d"] };
  }
  // Checked again here, so nothing cmd.exe would act on can reach it whatever the caller did.
  if (!WINDOWS_STEP.test(label)) throw new DevError(400, `Can't run "${label}" on Windows`);
  // /d: no AutoRun commands; /s /c "…": run exactly what's between the outer quotes.
  return { label, command: system32("cmd.exe"), args: ["/d", "/s", "/c", `"${label}"`], verbatim: true };
}

/** Start `what` detached in `dir`, output to the slot's log, and save its state. */
async function launch(name: string, dir: string, slot: Slot, extra: Pick<RunState, "kind" | "script">, what: Run) {
  let command: string;
  let args: string[];
  if (platform() === "windows") {
    const node = which("node");
    if (!node) throw new DevError(500, "Node.js isn't on PATH; workbench runs things with it on Windows");
    command = node;
    args = ["-e", WINDOWS_LAUNCHER, JSON.stringify({ steps: what.steps.map(windowsStep), exitLine: what.exitLine })];
  } else {
    command = "/bin/sh";
    args = ["-c", what.sh.script, ...what.sh.args];
  }
  fs.mkdirSync(slotDir(slot), { recursive: true });
  const out = fs.openSync(logPath(name, slot), "w");
  let child;
  try {
    child = spawn(command, args, {
      cwd: dir,
      // Own process group: survives workbench, and Stop can signal the whole tree. On
      // Windows it's out of workbench's job (which would end it with workbench), and
      // windowsHide keeps the launcher from flashing a window.
      detached: true,
      windowsHide: true,
      stdio: ["ignore", out, out],
      env: devEnv(),
    });
  } finally {
    fs.closeSync(out);
  }
  child.on("error", (e) => appendLog(name, slot, `Failed to start: ${e.message}`));
  child.unref();
  if (!child.pid) throw new DevError(500, "Failed to start the process");

  writeState(name, slot, {
    pid: child.pid,
    lstart: (await startTimeOf(child.pid)) ?? "",
    startedAt: new Date().toISOString(),
    ...extra,
  });
}

/** Shell script running `commands` in order; the last is exec'd so it keeps the shell's pid. */
function sequence(commands: string[]): string {
  return commands
    .flatMap((cmd, i) => [`echo '› ${cmd}'`, i === commands.length - 1 ? `exec ${cmd}` : cmd])
    .join(" && ");
}

/** Run `commands` in order (see Run). */
const steps = (commands: string[]): Run => ({ steps: commands, exitLine: false, sh: { script: sequence(commands), args: [] } });

// ---- Locking ---------------------------------------------------------------

// Guards against a double-click starting two copies.
const busy = new Set<string>();

async function exclusive(name: string, slot: Slot, fn: () => Promise<void>): Promise<void> {
  const key = `${slot}/${name}`; // "/" can't appear in a project name
  if (busy.has(key)) throw new DevError(409, "Already starting or stopping");
  busy.add(key);
  try {
    await fn();
  } finally {
    busy.delete(key);
  }
}

/** Throws a 409 if a process we started in this slot is still running. */
async function ensureIdle(name: string, slot: Slot, message: (running: RunState) => string) {
  const state = readState(name, slot);
  if (state && (await isOurs(state))) throw new DevError(409, message(state));
}

// ---- Dev environment -------------------------------------------------------

/** Setup checks alone (no process or Docker state), for the board overview. */
export async function setupChecks(dir: string) {
  const plan = await detectPlan(dir);
  return runChecks(dir, {
    pm: detectPm(dir),
    composeFile: plan.composeFile,
    composeError: plan.composeError,
  });
}

export async function getStatus(name: string, dir: string): Promise<DevStatus> {
  const plan = await detectPlan(dir);
  const state = readState(name, "dev");
  const processRunning = state ? await isOurs(state) : false;
  const task = processRunning ? (state?.kind === "install" ? "install" : "dev") : null;
  const snap = await dockerSnapshot();
  const [stacks, checks] = await Promise.all([
    projectStacks(name, dir, snap),
    runChecks(dir, {
      pm: detectPm(dir),
      composeFile: plan.composeFile,
      composeError: plan.composeError,
    }),
  ]);
  const log = readLogTail(name, "dev");

  // Remember the URL once seen, since the banner scrolls out of the log tail.
  let url = task === "dev" ? (state?.url ?? null) : null;
  if (task === "dev" && state && !url) {
    url = findUrl(log);
    if (url) writeState(name, "dev", { ...state, url });
  }

  return {
    steps: planSteps(plan),
    note: plan.note,
    running: processRunning || stacks.some((s) => s.services.some(isUp)),
    processRunning,
    task,
    checks,
    startedAt: state?.startedAt ?? null,
    stacks: stacks.map(publicStack),
    docker: snap.daemon,
    // Only worth saying when the project uses Docker.
    dockerError: stacks.length > 0 && snap.daemon.state !== "running" ? snap.daemon.message : null,
    url,
    log,
  };
}

export function start(name: string, dir: string): Promise<void> {
  return exclusive(name, "dev", async () => {
    const planned = planSteps(await detectPlan(dir));
    if (planned.length === 0) {
      throw new DevError(400, "Nothing to run: no compose file or dev/start script found");
    }
    await ensureIdle(name, "dev", (s) =>
      s.kind === "install" ? "Dependencies are still installing" : "Already running"
    );
    const primary = (await projectStacks(name, dir)).find((s) => s.primary);
    if (primary?.conflict) {
      throw new DevError(
        409,
        `"${primary.name}" is also the compose project name of ${primary.conflict}; starting this would take over its containers. Give one of them a different \`name:\` in its compose file.`
      );
    }
    await launch(name, dir, "dev", { kind: "dev" }, steps(planned));
  });
}

export function install(name: string, dir: string): Promise<void> {
  return exclusive(name, "dev", async () => {
    if (!fs.existsSync(path.join(dir, "package.json"))) {
      throw new DevError(400, "No package.json to install from");
    }
    await ensureIdle(name, "dev", (s) =>
      s.kind === "install" ? "Already installing" : "Stop the dev environment before installing"
    );
    await launch(name, dir, "dev", { kind: "install" }, steps([`${detectPm(dir)} install`]));
  });
}

/** `docker stop` the given containers, logging to the dev log. */
async function stopContainers(name: string, ids: string[], label: string) {
  if (ids.length === 0) return;
  appendLog(name, "dev", `› docker stop (${label})`);
  try {
    await run("docker", ["stop", ...ids], { timeout: 120_000, windowsHide: true });
  } catch (e) {
    appendLog(name, "dev", dockerMessage(e));
    throw new DevError(500, `docker stop failed: ${dockerMessage(e)}`);
  } finally {
    invalidateDocker();
  }
}

export function stop(name: string, dir: string): Promise<void> {
  return exclusive(name, "dev", async () => {
    const state = readState(name, "dev");

    if (state && (await isOurs(state))) {
      appendLog(name, "dev", `› stopping ${state.kind === "install" ? "install" : "dev process"}`);
      await killGroup(state.pid);
    }

    // Every running container of every stack in the project, however it was started.
    const stacks = await projectStacks(name, dir);
    for (const stack of stacks) {
      const up = stack.containers.filter(isUp);
      await stopContainers(name, up.map((c) => c.id), stack.name);
    }

    clearState(name, "dev");
  });
}

export type StackAction = "start" | "stop" | "restart";

/**
 * Start, stop or restart one compose stack of a project. The stack is looked
 * up by name among the project's own stacks; nothing from the request is used
 * as a path or command.
 */
export function stackAction(name: string, dir: string, stackName: string, stackDir: string, action: StackAction): Promise<void> {
  return exclusive(name, "dev", async () => {
    const stack = (await projectStacks(name, dir)).find((s) => s.name === stackName && s.dir === stackDir);
    if (!stack) throw new DevError(404, `No compose stack named "${stackName}" in this project`);
    const up = stack.containers.filter(isUp);
    const label = stack.dir ? `${stack.name} in ${stack.dir}` : stack.name;
    try {
      if (action === "stop") {
        await stopContainers(name, up.map((c) => c.id), label);
      } else if (action === "restart" && up.length > 0) {
        appendLog(name, "dev", `› docker restart (${label})`);
        await run("docker", ["restart", ...up.map((c) => c.id)], { timeout: 180_000, windowsHide: true });
      } else if (stack.fromFiles) {
        if (stack.conflict) {
          throw new DevError(
            409,
            `"${stack.name}" is also the compose project name of ${stack.conflict}; starting this would take over its containers. Give one of them a different \`name:\` in its compose file.`
          );
        }
        // `up -d` (re)creates from the compose files and brings up anything missing.
        const files = stack.explicitFiles ? stack.files.flatMap((f) => ["-f", f]) : [];
        const args = ["compose", "-p", stack.name, ...files, "up", "-d"];
        appendLog(name, "dev", `› docker compose up -d (${label})`);
        const { stdout, stderr } = await run("docker", args, { cwd: stack.absDir, timeout: 600_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
        if (stdout || stderr) appendLog(name, "dev", (stdout + stderr).replace(/\s+$/, ""));
      } else {
        // No compose files left on disk: start the containers that already exist.
        const ids = stack.containers.map((c) => c.id);
        if (ids.length === 0) throw new DevError(400, "This stack has no compose file and no containers to start");
        appendLog(name, "dev", `› docker start (${label})`);
        await run("docker", ["start", ...ids], { timeout: 180_000, windowsHide: true });
      }
    } catch (e) {
      if (e instanceof DevError) throw e;
      appendLog(name, "dev", dockerMessage(e));
      throw new DevError(500, `${action} failed: ${dockerMessage(e)}`);
    } finally {
      invalidateDocker();
    }
  });
}

// ---- Scripts ---------------------------------------------------------------

export async function scriptStatus(name: string, dir: string): Promise<ScriptStatus> {
  const scripts = readScripts(dir);
  const state = readState(name, "script");
  const running = state ? await isOurs(state) : false;
  const log = readLogTail(name, "script");
  const exitLine = running ? null : [...log].reverse().find((l) => EXIT_LINE.test(l));
  return {
    pm: detectPm(dir),
    scripts: Object.entries(scripts).map(([scriptName, command]) => ({ name: scriptName, command })),
    devScript: detectScript(dir)?.name ?? null,
    current: state?.script ?? null,
    running,
    exitCode: exitLine ? Number(exitLine.match(EXIT_LINE)![1]) : null,
    log,
  };
}

export function runScript(name: string, dir: string, script: string): Promise<void> {
  return exclusive(name, "script", async () => {
    const scripts = readScripts(dir);
    // A leading "-" would be read as a flag by the package manager.
    if (!Object.hasOwn(scripts, script) || script.startsWith("-")) {
      throw new DevError(400, `No script named "${script}" in package.json`);
    }
    if (script === detectScript(dir)?.name) {
      throw new DevError(400, `Use Start for "${script}"; it's what the dev environment runs`);
    }
    if (platform() === "windows" && !WINDOWS_SCRIPT_NAME.test(script)) {
      throw new DevError(
        400,
        `"${script}" can't be run from workbench on Windows: there a script's name goes through cmd.exe, so it may only use letters, digits and : . _ @ / + -. Run it in a terminal instead.`
      );
    }
    await ensureIdle(name, "script", (s) => `"${s.script}" is still running`);
    const pm = detectPm(dir);
    // $0 is the package manager and $1 the script name: passed as arguments, never parsed.
    const shell = 'echo "› $0 run $1"; "$0" run "$1"; code=$?; echo "› exited with code $code"; exit $code';
    await launch(name, dir, "script", { kind: "script", script }, {
      steps: [`${pm} run ${script}`],
      exitLine: true,
      sh: { script: shell, args: [pm, script] },
    });
  });
}

export function stopScript(name: string): Promise<void> {
  return exclusive(name, "script", async () => {
    const state = readState(name, "script");
    if (state && (await isOurs(state))) {
      await killGroup(state.pid);
      appendLog(name, "script", "› stopped");
    }
  });
}

// ---- Everything running ----------------------------------------------------

/**
 * Projects with something running: a process we started in either slot, or a
 * compose container whose working dir is in a project folder (however it was
 * started). Also each project's container problems and the daemon state. One
 * `ps` (one PowerShell call on Windows; /proc on Linux) and one shared Docker
 * snapshot for all projects.
 */
export async function runningProjects(): Promise<{
  projects: { name: string; ports: number[] }[];
  problems: Record<string, ContainerProblem[]>;
  docker: DockerDaemon;
}> {
  const names = new Set<string>();

  const states: { name: string; state: RunState }[] = [];
  for (const slot of ["dev", "script"] as const) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(slotDir(slot)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      const name = file.slice(0, -".json".length);
      const state = readState(name, slot);
      if (state?.pid && state.lstart) states.push({ name, state });
    }
  }
  if (states.length > 0 && platform() === "linux") {
    for (const { name, state } of states) {
      if (linuxProcessStart(state.pid) === state.lstart) names.add(name);
    }
  } else if (states.length > 0 && platform() === "windows") {
    const live = await windowsStartTimes(states.map((s) => s.state.pid));
    for (const { name, state } of states) {
      if (live.get(state.pid) === state.lstart) names.add(name);
    }
  } else if (states.length > 0) {
    // ps exits non-zero when some pids are gone, but still prints the live ones.
    const stdout = await run("ps", ["-o", "pid=,lstart=", "-p", states.map((s) => s.state.pid).join(",")])
      .then((r) => r.stdout)
      .catch((e: { stdout?: string }) => e.stdout ?? "");
    const live = new Map<number, string>();
    for (const line of stdout.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match) live.set(Number(match[1]), match[2].trim());
    }
    for (const { name, state } of states) {
      if (live.get(state.pid) === state.lstart) names.add(name);
    }
  }

  const ports = new Map<string, Set<number>>();
  // A container started from a project's subfolder (portland/api) counts for that project.
  const snap = await dockerSnapshot();
  for (const c of snap.containers) {
    if (!c.project || !isUp(c)) continue;
    names.add(c.project);
    if (!ports.has(c.project)) ports.set(c.project, new Set());
    for (const port of c.ports) ports.get(c.project)!.add(port);
  }

  const problems = containerProblems(snap.containers);
  return {
    projects: [...names].sort().map((name) => ({
      name,
      ports: [...(ports.get(name) ?? [])].sort((a, b) => a - b),
    })),
    problems: Object.fromEntries(problems),
    docker: snap.daemon,
  };
}

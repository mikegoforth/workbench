import { execFile, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { projectsDir } from "./paths";
import { dockerApp, dockerManualStart, platform } from "./platform";
import type {
  ComposeStack,
  ContainerLogLine,
  ContainerLogs,
  ContainerProblem,
  DevService,
  DockerDaemon,
} from "./types";

/*
 * Docker, as workbench sees it:
 *
 * - One snapshot of every container (`docker ps -a` + `docker inspect`),
 *   cached for a moment so the many polls share it.
 * - Each container belongs to the project whose folder its compose working
 *   dir is in (portland/api counts for portland), via Compose's labels. That
 *   works however the stack was started.
 * - A project's stacks are those containers plus any compose files in the
 *   project folder or two levels below it.
 *
 * Every command is execFile with fixed verbs; names, ids and paths travel as
 * separate arguments and never reach a shell. docker is a real .exe on
 * Windows, so the same calls work there; windowsHide keeps each one from
 * flashing a console window when workbench runs without one.
 */

const run = promisify(execFile);

export const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "vendor",
  "target",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  "tmp",
]);
const STACK_DEPTH = 2;
const SNAPSHOT_TTL_MS = 1500;
const DISK_TTL_MS = 10_000;
const FAILED_CONFIG_TTL_MS = 30_000;
const RECENT_CRASH_MS = 24 * 60 * 60_000;
// Exits from Ctrl-C, SIGKILL and SIGTERM: what a normal stop looks like.
const SIGNAL_EXITS = new Set([130, 137, 143]);
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const NEVER = "0001-01-01T00:00:00Z";

export function dockerMessage(e: unknown): string {
  const err = e as NodeJS.ErrnoException & { stderr?: string };
  if (err.code === "ENOENT") return "Docker CLI not found on PATH";
  const lastLine = err.stderr?.trim().split("\n").pop();
  return lastLine || err.message;
}

// ---- Daemon ----------------------------------------------------------------

/** Turn a failed docker call into what the UI should say about the daemon. */
export function daemonFromError(e: unknown): DockerDaemon {
  const err = e as NodeJS.ErrnoException;
  // Which app can start Docker is checked each time, so installing one is noticed without a restart.
  const app = dockerApp()?.name ?? null;
  if (err.code === "ENOENT") return { state: "missing", message: "The Docker CLI isn't installed (or isn't on PATH).", app };
  const message = dockerMessage(e);
  // Linux: the daemon is up, but this user isn't allowed to use its socket.
  if (platform() === "linux" && /permission denied/i.test(message) && /docker\.sock/i.test(message)) {
    return {
      state: "error",
      message: "Docker is running, but you don't have permission to use it. Add yourself to the docker group (sudo usermod -aG docker $USER), then log out and back in.",
      app,
    };
  }
  if (/cannot connect to the docker daemon|is the docker daemon running|docker\.sock|error during connect|connection refused/i.test(message)) {
    // Docker Engine on Linux has no app to launch: say how to start it instead.
    const manual = app ? null : dockerManualStart();
    return manual
      ? { state: "stopped", message: `Docker isn't running. Start it in a terminal: ${manual}`, app, startCommand: manual }
      : { state: "stopped", message: "Docker isn't running.", app };
  }
  return { state: "error", message, app };
}

/** Launch Docker Desktop (or OrbStack); the daemon comes up a little later. */
export async function startDaemon(): Promise<void> {
  const app = dockerApp();
  if (!app) {
    const manual = dockerManualStart();
    if (manual) throw new Error(`Docker Desktop isn't installed. Start Docker in a terminal: ${manual}`);
    throw new Error(platform() === "windows" ? "Docker Desktop isn't installed" : "No Docker app found in /Applications");
  }
  if (app.detached) {
    // Docker Desktop.exe on Windows keeps running: start it and let it go, like `open -a` does.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(app.command, app.args, { detached: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    return;
  }
  await run(app.command, app.args, { timeout: 10_000 });
}

// ---- Containers ------------------------------------------------------------

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  health: DevService["health"];
  exitCode: number | null;
  oomKilled: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ports: number[];
  /** Published TCP ports with the host address each is bound to ("0.0.0.0", "::", "127.0.0.1"). */
  bindings?: { address: string; port: number }[];
  /** Compose project and service, if Compose created it. */
  stack: string | null;
  service: string | null;
  workingDir: string | null;
  configFiles: string[];
  /** The workbench project it belongs to. */
  project: string | null;
}

interface Snapshot {
  daemon: DockerDaemon;
  containers: Container[];
}

/** The workbench project a folder is in (its first path segment under the projects folder). */
export function projectOf(dir: string | null): string | null {
  if (!dir) return null;
  const rel = path.relative(projectsDir(), dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep)[0];
}

// `docker ps` with exact label values, tab-separated. (`docker inspect` can
// take seconds for a single busy container; `ps` answers from Docker's cache.)
const PS_FORMAT = [
  "{{.ID}}",
  "{{.Names}}",
  "{{.Image}}",
  "{{.State}}",
  "{{.Status}}",
  "{{.Ports}}",
  '{{.Label "com.docker.compose.project"}}',
  '{{.Label "com.docker.compose.service"}}',
  '{{.Label "com.docker.compose.project.working_dir"}}',
  '{{.Label "com.docker.compose.project.config_files"}}',
].join("\t");

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

/** Docker's human durations ("9 hours", "About a minute", "Less than a second") in ms. */
export function durationMs(text: string): number | null {
  const t = text.trim();
  if (/^less than a second$/i.test(t)) return 0;
  const about = t.match(/^about an? (minute|hour)$/i);
  if (about) return UNIT_MS[about[1].toLowerCase()];
  const m = t.match(/^(\d+) (second|minute|hour|day|week|month|year)s?$/i);
  return m ? Number(m[1]) * UNIT_MS[m[2].toLowerCase()] : null;
}

/**
 * Health, exit code and (approximate) start / finish times from `docker ps`'s
 * Status column: "Up 9 hours (healthy)", "Exited (137) 9 months ago",
 * "Restarting (1) 19 seconds ago", "Up 2 days (Paused)", "Created".
 */
export function parseStatus(
  status: string,
  state: string,
  now = Date.now()
): { health: DevService["health"]; exitCode: number | null; startedAt: string | null; finishedAt: string | null } {
  const at = (ms: number | null) => (ms === null ? null : new Date(now - ms).toISOString());
  const health = status.match(/\((healthy|unhealthy|health: starting)\)/)?.[1];
  const up = status.match(/^Up (.+?)(?: \([^)]*\))*$/);
  const ended = status.match(/^(?:Exited|Restarting) \((-?\d+)\) (.+) ago$/);
  return {
    health: state === "running" && health ? (health === "health: starting" ? "starting" : health === "healthy" ? "healthy" : "unhealthy") : null,
    exitCode: (state === "exited" || state === "dead") && ended ? Number(ended[1]) : null,
    startedAt: up ? at(durationMs(up[1])) : null,
    finishedAt: ended ? at(durationMs(ended[2])) : null,
  };
}

function parsePs(line: string, now: number): Container | null {
  const f = line.split("\t");
  if (f.length < 10) return null;
  const [id, name, image, state, status, published, stack, service, workingDir, configFiles] = f;
  const ports = new Set<number>();
  // "0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp": the host side is before "->".
  for (const m of published.matchAll(/:(\d+)->/g)) ports.add(Number(m[1]));
  const bindings: { address: string; port: number }[] = [];
  for (const m of published.matchAll(/([^\s,]+):(\d+)->\d+\/tcp/g)) bindings.push({ address: m[1].replace(/^\[(.*)\]$/, "$1"), port: Number(m[2]) });
  return {
    id,
    name,
    image,
    state,
    ...parseStatus(status, state, now),
    oomKilled: false,
    ports: [...ports].sort((a, b) => a - b),
    bindings,
    stack: stack || null,
    service: service || null,
    workingDir: workingDir || null,
    configFiles: configFiles.split(",").filter(Boolean),
    project: projectOf(workingDir || null),
  };
}

async function loadSnapshot(): Promise<Snapshot> {
  let stdout: string;
  try {
    ({ stdout } = await run("docker", ["ps", "-a", "--no-trunc", "--format", PS_FORMAT], { timeout: 8_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }));
  } catch (e) {
    return { daemon: daemonFromError(e), containers: [] };
  }
  const now = Date.now();
  const containers = stdout
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => parsePs(l, now))
    .filter((c): c is Container => c !== null);

  // SIGKILL (137) can mean out of memory; only inspect says. Ask, briefly, for recent ones in projects.
  await Promise.all(
    containers
      .filter((c) => c.project && c.exitCode === 137 && c.finishedAt && now - Date.parse(c.finishedAt) < RECENT_CRASH_MS)
      .map(async (c) => {
        try {
          const { stdout: out } = await run("docker", ["inspect", "--format", "{{.State.OOMKilled}} {{.State.FinishedAt}}", c.id], { timeout: 2_000, windowsHide: true });
          const [oom, finished] = out.trim().split(" ");
          c.oomKilled = oom === "true";
          if (finished && finished !== NEVER) c.finishedAt = finished;
        } catch {
          // Slow or gone: leave it as a plain exit.
        }
      })
  );
  return { daemon: { state: "running", message: null, app: dockerApp()?.name ?? null }, containers };
}

let snapshot: { at: number; promise: Promise<Snapshot> } | null = null;

/** Every container and the daemon state; shared by concurrent callers for a moment. */
export function dockerSnapshot(): Promise<Snapshot> {
  if (snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return snapshot.promise;
  const promise = loadSnapshot();
  snapshot = { at: Date.now(), promise };
  return promise;
}

/** Forget the snapshot after changing something, so the next read is current. */
export function invalidateDocker() {
  snapshot = null;
}

export const isUp = (c: { state: string }) => c.state === "running" || c.state === "restarting" || c.state === "paused";

// ---- Problems --------------------------------------------------------------

/**
 * Containers that need a look, per project: failing health checks, restart
 * loops, and error exits that happened during the stack's current run or in
 * the last day. Old exits and normal stops (SIGTERM / SIGKILL) don't count.
 */
export function containerProblems(containers: Container[], now = Date.now()): Map<string, ContainerProblem[]> {
  const out = new Map<string, ContainerProblem[]>();
  // When each stack's running containers came up: an exit after that happened during this run.
  const upSince = new Map<string, number>();
  for (const c of containers) {
    if (!c.project || !c.stack || !isUp(c) || !c.startedAt) continue;
    const key = `${c.project}\0${c.stack}`;
    upSince.set(key, Math.min(upSince.get(key) ?? Infinity, Date.parse(c.startedAt)));
  }
  for (const c of containers) {
    if (!c.project) continue;
    const base = { stack: c.stack ?? c.name, service: c.service ?? c.name };
    let problem: ContainerProblem | null = null;
    if (c.state === "restarting") problem = { ...base, kind: "restarting", exitCode: null };
    else if (c.state === "running" && c.health === "unhealthy") problem = { ...base, kind: "unhealthy", exitCode: null };
    else if (c.exitCode && (c.oomKilled || !SIGNAL_EXITS.has(c.exitCode)) && c.finishedAt) {
      const ended = Date.parse(c.finishedAt);
      const since = c.stack ? upSince.get(`${c.project}\0${c.stack}`) : undefined;
      if ((since !== undefined && ended > since) || now - ended < RECENT_CRASH_MS) {
        problem = { ...base, kind: c.oomKilled ? "oom" : "exited", exitCode: c.exitCode };
      }
    }
    if (problem) {
      if (!out.has(c.project)) out.set(c.project, []);
      out.get(c.project)!.push(problem);
    }
  }
  return out;
}

// ---- Compose files on disk -------------------------------------------------

export interface ComposeConfig {
  mtimeMs: number;
  /** Compose's project name for this folder. */
  name: string;
  services: string[];
  /** A service builds the folder itself, i.e. compose runs the app. */
  buildsDir: boolean;
  error: string | null;
  at: number;
}

const configCache = new Map<string, ComposeConfig>();

/** Compose's default project name: the folder name, lowercased, invalid characters dropped. */
const defaultStackName = (dir: string) => path.basename(dir).toLowerCase().replace(/[^a-z0-9_-]/g, "");

/** `docker compose config` for a folder, cached until its compose file changes (failures for 30s). */
export async function composeConfig(dir: string, file: string): Promise<ComposeConfig> {
  const full = path.join(dir, file);
  const { mtimeMs } = fs.statSync(full);
  const hit = configCache.get(full);
  if (hit && hit.mtimeMs === mtimeMs && (!hit.error || Date.now() - hit.at < FAILED_CONFIG_TTL_MS)) return hit;
  let result: ComposeConfig;
  try {
    // No -f: resolve files (and overrides) exactly as `docker compose up` will.
    const { stdout } = await run("docker", ["compose", "config", "--format", "json"], { cwd: dir, timeout: 15_000, windowsHide: true });
    const config = JSON.parse(stdout) as { name?: string; services?: Record<string, { build?: { context?: string } }> };
    const services = config.services ?? {};
    result = {
      mtimeMs,
      name: config.name || defaultStackName(dir),
      services: Object.keys(services),
      buildsDir: Object.values(services).some((s) => !!s.build?.context && path.resolve(dir, s.build.context) === dir),
      error: null,
      at: Date.now(),
    };
  } catch (e) {
    result = { mtimeMs, name: defaultStackName(dir), services: [], buildsDir: false, error: dockerMessage(e).replaceAll(dir, "."), at: Date.now() };
  }
  configCache.set(full, result);
  return result;
}

const composeFileIn = (dir: string) => COMPOSE_FILES.find((f) => fs.existsSync(path.join(dir, f))) ?? null;

const diskCache = new Map<string, { at: number; dirs: { dir: string; file: string }[] }>();

/** Folders with a compose file: the project root and up to two levels below it. */
function composeDirs(projectDir: string): { dir: string; file: string }[] {
  const hit = diskCache.get(projectDir);
  if (hit && Date.now() - hit.at < DISK_TTL_MS) return hit.dirs;
  const dirs: { dir: string; file: string }[] = [];
  const walk = (dir: string, depth: number) => {
    const file = composeFileIn(dir);
    if (file) dirs.push({ dir, file });
    if (depth >= STACK_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(projectDir, 0);
  diskCache.set(projectDir, { at: Date.now(), dirs });
  return dirs;
}

// ---- Stacks ----------------------------------------------------------------

export interface StackDetail extends ComposeStack {
  /** Absolute folder it runs from. */
  absDir: string;
  containers: Container[];
  /**
   * `files` came from container labels and must be passed with -f. A folder's
   * own default compose file isn't, so Compose still merges its override file.
   */
  explicitFiles: boolean;
}

function toService(c: Container): DevService {
  return {
    name: c.service ?? c.name,
    container: c.name,
    state: c.state,
    health: c.health,
    exitCode: c.exitCode,
    oomKilled: c.oomKilled,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    ports: c.ports,
    image: c.image,
  };
}

const notCreated = (name: string): DevService => ({
  name,
  container: null,
  state: "not created",
  health: null,
  exitCode: null,
  oomKilled: false,
  startedAt: null,
  finishedAt: null,
  ports: [],
  image: null,
});

/**
 * A project's compose stacks: those with compose files in its folder (root or
 * subfolders) and those with containers whose working dir is inside it.
 */
export async function projectStacks(project: string, projectDir: string, snap?: Snapshot): Promise<StackDetail[]> {
  const [{ containers }, configs] = await Promise.all([
    snap ? Promise.resolve(snap) : dockerSnapshot(),
    Promise.all(composeDirs(projectDir).map(async ({ dir, file }) => ({ dir, file, config: await composeConfig(dir, file) }))),
  ]);

  const stacks = new Map<string, StackDetail>();
  const key = (name: string, dir: string) => `${name}\0${dir}`;

  for (const { dir, file, config } of configs) {
    stacks.set(key(config.name, dir), {
      name: config.name,
      dir: path.relative(projectDir, dir),
      absDir: dir,
      files: [file],
      services: [],
      primary: dir === projectDir,
      fromFiles: true,
      error: config.error,
      conflict: null,
      containers: [],
      explicitFiles: false,
    });
  }

  for (const c of containers) {
    if (c.project !== project || !c.stack || !c.workingDir) continue;
    const k = key(c.stack, c.workingDir);
    let stack = stacks.get(k);
    if (!stack) {
      stack = {
        name: c.stack,
        dir: path.relative(projectDir, c.workingDir),
        absDir: c.workingDir,
        files: [],
        services: [],
        primary: false,
        fromFiles: false,
        error: null,
        conflict: null,
        containers: [],
        explicitFiles: true,
      };
      stacks.set(k, stack);
    }
    stack.containers.push(c);
    // Compose files from the labels, if they're still there (inside the project).
    if (!stack.fromFiles) {
      for (const f of c.configFiles) {
        const rel = path.relative(c.workingDir, f);
        if (!rel.startsWith("..") && !path.isAbsolute(rel) && fs.existsSync(f) && !stack.files.includes(rel)) stack.files.push(rel);
      }
    }
  }

  for (const stack of stacks.values()) {
    const config = configs.find((c) => c.dir === stack.absDir && c.config.name === stack.name)?.config;
    const byService = new Map(stack.containers.map((c) => [c.service ?? c.name, c]));
    const names = [...new Set([...(config?.services ?? []), ...byService.keys()])];
    stack.services = names.map((n) => (byService.has(n) ? toService(byService.get(n)!) : notCreated(n)));
    if (!stack.fromFiles && stack.files.length > 0) stack.fromFiles = true;
    // Same compose project name, different folder: Compose would treat them as one project.
    const other = containers.find((c) => c.stack === stack.name && c.workingDir && c.workingDir !== stack.absDir);
    if (other) stack.conflict = path.relative(projectsDir(), other.workingDir!) || other.workingDir;
  }

  return [...stacks.values()].sort((a, b) => Number(b.primary) - Number(a.primary) || a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name));
}

/** The client-facing shape (no absolute paths or container internals). */
export const publicStack = (s: StackDetail): ComposeStack => ({
  name: s.name,
  dir: s.dir,
  files: s.files,
  services: s.services,
  primary: s.primary,
  fromFiles: s.fromFiles,
  error: s.error,
  conflict: s.conflict,
});

// ---- Logs ------------------------------------------------------------------

const LOG_TAIL = 300;
const MAX_LINES = 2000;
const MAX_CONTAINERS = 12;
// [^\n], not ".": "." stops at \r, which would drop every line from a tty
// container (CRLF endings) and every progress-bar redraw.
const TS_LINE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?([^\n]*)$/;
const SINCE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

function parseLog(text: string, c: Container, stream: "out" | "err", into: ContainerLogLine[]) {
  for (const raw of text.split("\n")) {
    const m = raw.match(TS_LINE);
    if (!m) continue;
    const line = m[2].replace(ANSI, "").replace(/\r$/, "");
    into.push({ ts: m[1], container: c.name, service: c.service ?? c.name, stream, text: line.slice(line.lastIndexOf("\r") + 1) });
  }
}

/** Recent output from a project's containers, merged in time order; `since` returns only newer lines. */
export async function projectLogs(project: string, since: string | null): Promise<ContainerLogs> {
  const snap = await dockerSnapshot();
  const mine = snap.containers
    .filter((c) => c.project === project && c.state !== "created")
    .sort((a, b) => Number(isUp(b)) - Number(isUp(a)) || (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
    .slice(0, MAX_CONTAINERS);
  const lines: ContainerLogLine[] = [];
  await Promise.all(
    mine.map(async (c) => {
      const args = ["logs", "--timestamps", "--tail", String(LOG_TAIL)];
      if (since && SINCE.test(since)) args.push("--since", since);
      args.push(c.id);
      try {
        const { stdout, stderr } = await run("docker", args, { timeout: 10_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
        parseLog(stdout, c, "out", lines);
        parseLog(stderr, c, "err", lines);
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string };
        if (err.stdout) parseLog(err.stdout, c, "out", lines);
      }
    })
  );
  // Docker pads timestamps to nanoseconds, so they sort as strings.
  lines.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return {
    containers: mine.map((c) => ({ name: c.name, service: c.service ?? c.name, stack: c.stack ?? c.name, state: c.state, health: c.health })),
    lines: lines.slice(-MAX_LINES),
    docker: snap.daemon,
  };
}

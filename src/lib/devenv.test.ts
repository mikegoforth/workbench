import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Container, StackDetail } from "./docker";
import type { DevService, DockerDaemon } from "./types";

// devenv shells out (ps, docker) and spawns detached shells. Every one of
// those is faked here: execFile answers from the tables below, spawn hands back
// a fake child, and process.kill only knows the fake process groups. Nothing
// real is started or signalled, and state/logs go to a temp data folder.
const mocks = vi.hoisted(() => ({
  dataDir: "",
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const overrides = { execFile: mocks.execFile, spawn: mocks.spawn };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock("./dataDir", () => ({ dataDir: () => mocks.dataDir }));

vi.mock("./checks", () => ({ runChecks: vi.fn(async () => []) }));

vi.mock("./docker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./docker")>();
  return {
    ...actual,
    composeConfig: vi.fn(),
    dockerSnapshot: vi.fn(),
    projectStacks: vi.fn(),
    invalidateDocker: vi.fn(),
  };
});

import { runChecks } from "./checks";
import { composeConfig, dockerSnapshot, invalidateDocker, projectStacks } from "./docker";
import {
  DevError,
  devEnv,
  getStatus,
  install,
  runningProjects,
  runScript,
  scriptStatus,
  setupChecks,
  stackAction,
  start,
  stop,
  stopScript,
} from "./devenv";

const LSTART = "Mon Nov  9 10:00:00 2026";
const RUNNING: DockerDaemon = { state: "running", message: null, app: null };

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-devenv-")));
let dir: string; // the project folder of the current test
let testNo = 0;

// ---- Fakes -------------------------------------------------------------------

type ExecResult = { stdout?: string; stderr?: string } | Error;

/** Processes `ps` reports: pid → lstart. */
const procs = new Map<number, string>();
/** Process groups process.kill can signal. */
const groups = new Set<number>();
/** When set, a group ignores SIGTERM and only SIGKILL ends it. */
let ignoresTerm = false;
/** What `docker …` returns. */
let dockerReply: (args: string[]) => ExecResult = () => ({ stdout: "" });
/** The pid the next spawned child gets. */
let nextPid: number | undefined;
const children: (EventEmitter & { pid?: number; unref: () => void })[] = [];

function ps(args: string[]): ExecResult {
  const pids = args[3].split(",").map(Number);
  if (args[1] === "lstart=") {
    const lstart = procs.get(pids[0]);
    return lstart ? { stdout: `${lstart}\n` } : Object.assign(new Error("ps failed"), { stdout: "" });
  }
  // "pid=,lstart=": one line per live pid, non-zero exit if any are gone.
  const stdout = pids
    .filter((p) => procs.has(p))
    .map((p) => `${String(p).padStart(6)} ${procs.get(p)}\n`)
    .join("");
  return pids.every((p) => procs.has(p)) ? { stdout } : Object.assign(new Error("ps: some pids gone"), { stdout });
}

function fakeExecFile(cmd: string, args: string[], ...rest: unknown[]) {
  const callback = rest.find((a) => typeof a === "function") as (
    err: Error | null,
    res?: { stdout: string; stderr: string }
  ) => void;
  const result = cmd === "ps" ? ps(args) : cmd === "docker" ? dockerReply(args) : new Error(`unexpected ${cmd}`);
  if (result instanceof Error) callback(result);
  else callback(null, { stdout: "", stderr: "", ...result });
}

function fakeSpawn() {
  const child = Object.assign(new EventEmitter(), { pid: nextPid, unref: vi.fn() });
  if (nextPid) procs.set(nextPid, LSTART);
  children.push(child);
  return child;
}

function fakeKill(pid: number, signal?: string | number) {
  if (pid >= 0 || !groups.has(-pid)) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
  if (signal === "SIGKILL" || (signal === "SIGTERM" && !ignoresTerm)) {
    groups.delete(-pid);
    procs.delete(-pid);
  }
  return true;
}

// ---- Helpers -----------------------------------------------------------------

const devFile = (...parts: string[]) => path.join(mocks.dataDir, "dev", ...parts);
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf-8"));

function writeFiles(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

const packageJson = (scripts: unknown) => JSON.stringify({ name: "alpha", scripts });

/** A process we started earlier: its state file, and (if `alive`) the process itself. */
function startedEarlier(
  slot: "dev" | "script",
  state: { pid: number; kind?: string; script?: string; url?: string; lstart?: string },
  alive = true
) {
  const file = slot === "dev" ? devFile("alpha.json") : devFile("scripts", "alpha.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ lstart: LSTART, startedAt: "2026-11-09T10:00:00.000Z", ...state }));
  if (alive) {
    procs.set(state.pid, LSTART);
    groups.add(state.pid);
  }
}

function writeLog(slot: "dev" | "script", text: string) {
  const file = slot === "dev" ? devFile("alpha.log") : devFile("scripts", "alpha.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const readLog = (slot: "dev" | "script") =>
  fs.readFileSync(slot === "dev" ? devFile("alpha.log") : devFile("scripts", "alpha.log"), "utf-8");

function container(over: Partial<Container> = {}): Container {
  return {
    id: "c1",
    name: "alpha-web-1",
    image: "nginx",
    state: "running",
    health: null,
    exitCode: null,
    oomKilled: false,
    startedAt: null,
    finishedAt: null,
    ports: [],
    stack: "alpha",
    service: "web",
    workingDir: null,
    configFiles: [],
    project: "alpha",
    ...over,
  };
}

function stack(over: Partial<StackDetail> = {}): StackDetail {
  const containers = over.containers ?? [];
  return {
    name: "alpha",
    dir: "",
    files: ["compose.yaml"],
    services: containers.map((c) => ({ name: c.service, state: c.state }) as DevService),
    primary: true,
    fromFiles: true,
    error: null,
    conflict: null,
    absDir: dir,
    containers,
    explicitFiles: false,
    ...over,
  };
}

/** The script passed to `/bin/sh -c` by the last spawn. */
const spawnedScript = () => mocks.spawn.mock.lastCall?.[1][1];

async function devError(promise: Promise<unknown>): Promise<DevError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(DevError);
  return err as DevError;
}

beforeEach(() => {
  testNo++;
  mocks.dataDir = path.join(root, `data-${testNo}`);
  dir = path.join(root, `alpha-${testNo}`);
  fs.mkdirSync(dir, { recursive: true });

  procs.clear();
  groups.clear();
  children.length = 0;
  ignoresTerm = false;
  nextPid = 4242;
  dockerReply = () => ({ stdout: "" });

  mocks.execFile.mockReset().mockImplementation(fakeExecFile);
  mocks.spawn.mockReset().mockImplementation(fakeSpawn);
  vi.spyOn(process, "kill").mockImplementation(fakeKill as typeof process.kill);

  vi.mocked(composeConfig).mockReset().mockResolvedValue({
    mtimeMs: 0,
    name: "alpha",
    services: ["web"],
    buildsDir: false,
    error: null,
    at: 0,
  });
  vi.mocked(projectStacks).mockReset().mockResolvedValue([]);
  vi.mocked(dockerSnapshot).mockReset().mockResolvedValue({ daemon: RUNNING, containers: [] });
  vi.mocked(invalidateDocker).mockReset();
  vi.mocked(runChecks).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- Tests -------------------------------------------------------------------

describe("devEnv", () => {
  it("never passes the desktop app's API token to a project", () => {
    vi.stubEnv("WORKBENCH_API_TOKEN", "secret-token");
    vi.stubEnv("WORKBENCH_DATA_DIR", "/data");
    const env = devEnv();
    expect(env).not.toHaveProperty("WORKBENCH_API_TOKEN");
    expect(env).not.toHaveProperty("WORKBENCH_DATA_DIR");
    expect(Object.values(env)).not.toContain("secret-token");
  });

  it("drops workbench's own Next.js, npm and Electron settings", () => {
    for (const key of [
      "__NEXT_PRIVATE_X",
      "NEXT_RUNTIME",
      "TURBOPACK",
      "npm_lifecycle_event",
      "ELECTRON_RUN_AS_NODE",
      "PORT",
      "HOSTNAME",
      "NODE_ENV",
      "INIT_CWD",
    ]) {
      vi.stubEnv(key, "x");
    }
    const env = devEnv();
    for (const key of ["__NEXT_PRIVATE_X", "NEXT_RUNTIME", "TURBOPACK", "npm_lifecycle_event", "ELECTRON_RUN_AS_NODE", "PORT", "HOSTNAME", "NODE_ENV", "INIT_CWD"]) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it("keeps the rest of the environment", () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    vi.stubEnv("HOME", "/Users/me");
    vi.stubEnv("MY_PROJECT_SETTING", "1");
    expect(devEnv()).toMatchObject({ PATH: "/usr/bin:/bin", HOME: "/Users/me", MY_PROJECT_SETTING: "1" });
  });
});

describe("getStatus: the plan", () => {
  it("runs the dev script with npm when there's no lockfile or compose file", async () => {
    writeFiles({ "package.json": packageJson({ dev: "next dev", start: "next start" }) });
    const status = await getStatus("alpha", dir);
    expect(status.steps).toEqual(["npm run dev"]);
    expect(status.note).toBeNull();
    expect(composeConfig).not.toHaveBeenCalled();
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
  ])("falls back to the start script, using the package manager of %s", async (lockfile, pm) => {
    writeFiles({ "package.json": packageJson({ start: "node server.js" }), [lockfile]: "" });
    expect((await getStatus("alpha", dir)).steps).toEqual([`${pm} run start`]);
  });

  it("finds nothing to run without a compose file or a dev/start script", async () => {
    writeFiles({ "package.json": packageJson({ build: "tsc" }) });
    expect((await getStatus("alpha", dir)).steps).toEqual([]);
  });

  it("brings compose up before the dev script", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite" }), "docker-compose.yml": "services: {}" });
    const status = await getStatus("alpha", dir);
    expect(composeConfig).toHaveBeenCalledWith(dir, "docker-compose.yml");
    expect(status.steps).toEqual(["docker compose up -d", "npm run dev"]);
  });

  it("skips the dev script when compose builds the project itself", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite" }), "compose.yaml": "services: {}" });
    vi.mocked(composeConfig).mockResolvedValue({ mtimeMs: 0, name: "alpha", services: ["app"], buildsDir: true, error: null, at: 0 });
    const status = await getStatus("alpha", dir);
    expect(status.steps).toEqual(["docker compose up -d"]);
    expect(status.note).toBe(
      'compose.yaml builds this project itself, so "npm run dev" isn\'t run as well (both would use the same port).'
    );
  });

  it("passes a compose error on to the setup checks", async () => {
    writeFiles({ "compose.yml": "services: {}", "yarn.lock": "" });
    vi.mocked(composeConfig).mockResolvedValue({
      mtimeMs: 0,
      name: "alpha",
      services: [],
      buildsDir: false,
      error: "env file .env not found",
      at: 0,
    });
    vi.mocked(runChecks).mockResolvedValueOnce([{ id: "compose", level: "warn", title: "x" } as never]);
    const status = await getStatus("alpha", dir);
    expect(runChecks).toHaveBeenCalledWith(dir, { pm: "yarn", composeFile: "compose.yml", composeError: "env file .env not found" });
    expect(status.checks).toEqual([{ id: "compose", level: "warn", title: "x" }]);
  });
});

describe("setupChecks", () => {
  it("runs the checks with the detected package manager and compose file", async () => {
    writeFiles({ "compose.yaml": "services: {}", "pnpm-lock.yaml": "" });
    await setupChecks(dir);
    expect(runChecks).toHaveBeenCalledWith(dir, { pm: "pnpm", composeFile: "compose.yaml", composeError: null });
  });

  it("reports no compose file when there is none", async () => {
    await setupChecks(dir);
    expect(runChecks).toHaveBeenCalledWith(dir, { pm: "npm", composeFile: null, composeError: null });
  });
});

describe("getStatus: process and Docker state", () => {
  it("reports nothing running when nothing was started", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite" }) });
    const status = await getStatus("alpha", dir);
    expect(status).toMatchObject({
      running: false,
      processRunning: false,
      task: null,
      startedAt: null,
      url: null,
      log: [],
      stacks: [],
      docker: RUNNING,
      dockerError: null,
    });
  });

  it("reports a running dev process and remembers the URL from its banner", async () => {
    startedEarlier("dev", { pid: 501, kind: "dev" });
    writeLog("dev", "› npm run dev\n  ➜  Network: http://192.168.1.5:5173/\n  ➜  Local:   http://0.0.0.0:5173/\n");
    const status = await getStatus("alpha", dir);
    expect(status).toMatchObject({
      running: true,
      processRunning: true,
      task: "dev",
      startedAt: "2026-11-09T10:00:00.000Z",
      url: "http://localhost:5173/",
    });
    expect(readJson(devFile("alpha.json")).url).toBe("http://localhost:5173/");
  });

  it("keeps a URL it already saved, even once the banner has scrolled away", async () => {
    startedEarlier("dev", { pid: 501, kind: "dev", url: "http://localhost:3000" });
    writeLog("dev", "GET / 200\n");
    expect((await getStatus("alpha", dir)).url).toBe("http://localhost:3000");
  });

  it("treats a state file without a kind as a dev run", async () => {
    startedEarlier("dev", { pid: 501 });
    writeLog("dev", "ready on [::1]:3000, see http://[::1]:3000).\n");
    const status = await getStatus("alpha", dir);
    expect(status.task).toBe("dev");
    expect(status.url).toBe("http://localhost:3000");
  });

  it("takes the first local URL when no line says Local", async () => {
    startedEarlier("dev", { pid: 501, kind: "dev" });
    writeLog("dev", "docs: https://example.com/start\nproxy (http://127.0.0.1:9229/debug),\n");
    expect((await getStatus("alpha", dir)).url).toBe("http://127.0.0.1:9229/debug");
  });

  it("has no URL (and saves none) until the server prints one", async () => {
    startedEarlier("dev", { pid: 501, kind: "dev" });
    writeLog("dev", "compiling…\n");
    expect((await getStatus("alpha", dir)).url).toBeNull();
    expect(readJson(devFile("alpha.json"))).not.toHaveProperty("url");
  });

  it("reports an install as the install task, without a URL", async () => {
    startedEarlier("dev", { pid: 501, kind: "install" });
    writeLog("dev", "› npm install\nhttp://localhost:3000\n");
    const status = await getStatus("alpha", dir);
    expect(status).toMatchObject({ processRunning: true, task: "install", url: null });
  });

  it("ignores a saved pid that now belongs to another process", async () => {
    startedEarlier("dev", { pid: 501, kind: "dev" }, false);
    procs.set(501, "Tue Nov 10 08:00:00 2026");
    const status = await getStatus("alpha", dir);
    expect(status).toMatchObject({ running: false, processRunning: false, task: null, url: null });
  });

  it("ignores an old state file without a start time, without asking ps", async () => {
    startedEarlier("dev", { pid: 501, kind: "dev", lstart: "" });
    expect((await getStatus("alpha", dir)).processRunning).toBe(false);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("counts running compose containers as running, and returns the public stack shape", async () => {
    const snap = { daemon: RUNNING, containers: [] };
    vi.mocked(dockerSnapshot).mockResolvedValue(snap);
    vi.mocked(projectStacks).mockResolvedValue([stack({ containers: [container()] })]);
    const status = await getStatus("alpha", dir);
    expect(projectStacks).toHaveBeenCalledWith("alpha", dir, snap);
    expect(status.running).toBe(true);
    expect(status.processRunning).toBe(false);
    expect(status.stacks).toEqual([
      {
        name: "alpha",
        dir: "",
        files: ["compose.yaml"],
        services: [{ name: "web", state: "running" }],
        primary: true,
        fromFiles: true,
        error: null,
        conflict: null,
      },
    ]);
  });

  it("is not running when the project's containers are all stopped", async () => {
    vi.mocked(projectStacks).mockResolvedValue([stack({ containers: [container({ state: "exited" })] })]);
    expect((await getStatus("alpha", dir)).running).toBe(false);
  });

  it("explains a Docker problem only when the project uses Docker", async () => {
    const stopped: DockerDaemon = { state: "stopped", message: "Docker isn't running.", app: "Docker" };
    vi.mocked(dockerSnapshot).mockResolvedValue({ daemon: stopped, containers: [] });
    expect((await getStatus("alpha", dir)).dockerError).toBeNull();

    vi.mocked(projectStacks).mockResolvedValue([stack()]);
    const status = await getStatus("alpha", dir);
    expect(status.dockerError).toBe("Docker isn't running.");
    expect(status.docker).toEqual(stopped);
  });
});

describe("the log tail", () => {
  it("strips colours, keeps what a progress bar shows last, and drops trailing blank lines", async () => {
    writeLog("dev", "\x1b[32mready\x1b[0m\r\n\x1b]0;title\x07[1/3]\r[2/3]\r[3/3] done\nlast\n\n\n");
    expect((await getStatus("alpha", dir)).log).toEqual(["ready", "[3/3] done", "last"]);
  });

  it("keeps only the last 200 lines", async () => {
    writeLog("dev", Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n"));
    const { log } = await getStatus("alpha", dir);
    expect(log).toHaveLength(200);
    expect(log[0]).toBe("line 50");
    expect(log[199]).toBe("line 249");
  });

  it("reads only the last 64 KiB and drops the line cut in half", async () => {
    writeLog("dev", "start\n" + "x".repeat(70 * 1024) + "\nend\n");
    expect((await getStatus("alpha", dir)).log).toEqual(["end"]);
  });
});

describe("start", () => {
  it("launches compose and the dev script detached, in one shell, logging to the dev log", async () => {
    vi.stubEnv("WORKBENCH_API_TOKEN", "secret");
    writeFiles({ "package.json": packageJson({ dev: "vite" }), "compose.yaml": "services: {}" });
    writeLog("dev", "output of the previous run\n");

    await start("alpha", dir);

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mocks.spawn.mock.lastCall!;
    expect(cmd).toBe("/bin/sh");
    expect(args).toEqual([
      "-c",
      "echo '› docker compose up -d' && docker compose up -d && echo '› npm run dev' && exec npm run dev",
    ]);
    expect(opts).toMatchObject({ cwd: dir, detached: true });
    expect(opts.stdio[0]).toBe("ignore");
    expect(opts.stdio[1]).toBe(opts.stdio[2]);
    expect(opts.env).not.toHaveProperty("WORKBENCH_API_TOKEN");
    expect(children[0].unref).toHaveBeenCalled();
    // The log is truncated for the new run.
    expect(readLog("dev")).toBe("");

    const state = readJson(devFile("alpha.json"));
    expect(state).toEqual({ pid: 4242, lstart: LSTART, startedAt: expect.any(String), kind: "dev" });
    expect(new Date(state.startedAt).toString()).not.toBe("Invalid Date");
  });

  it("execs the only step directly", async () => {
    writeFiles({ "package.json": packageJson({ start: "node ." }), "bun.lock": "" });
    await start("alpha", dir);
    expect(spawnedScript()).toBe("echo '› bun run start' && exec bun run start");
  });

  it("refuses when there is nothing to run", async () => {
    const err = await devError(start("alpha", dir));
    expect(err.status).toBe(400);
    expect(err.message).toBe("Nothing to run: no compose file or dev/start script found");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["dev", "Already running"],
    ["install", "Dependencies are still installing"],
  ])("refuses while a %s run is still going", async (kind, message) => {
    writeFiles({ "package.json": packageJson({ dev: "vite" }) });
    startedEarlier("dev", { pid: 501, kind });
    const err = await devError(start("alpha", dir));
    expect(err.status).toBe(409);
    expect(err.message).toBe(message);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("starts again when the previous run's process is gone", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite" }) });
    startedEarlier("dev", { pid: 501, kind: "dev" }, false);
    await start("alpha", dir);
    expect(readJson(devFile("alpha.json")).pid).toBe(4242);
  });

  it("refuses to take over another folder's compose project", async () => {
    writeFiles({ "compose.yaml": "services: {}" });
    vi.mocked(projectStacks).mockResolvedValue([
      stack({ name: "api", dir: "api", primary: false, conflict: "beta" }),
      stack({ name: "web", conflict: "other/web" }),
    ]);
    const err = await devError(start("alpha", dir));
    expect(err.status).toBe(409);
    expect(err.message).toBe(
      '"web" is also the compose project name of other/web; starting this would take over its containers. Give one of them a different `name:` in its compose file.'
    );
    expect(projectStacks).toHaveBeenCalledWith("alpha", dir);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("refuses a second start while the first is still starting", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite" }) });
    const first = start("alpha", dir);
    const err = await devError(start("alpha", dir));
    expect(err.status).toBe(409);
    expect(err.message).toBe("Already starting or stopping");
    await first;
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    // The lock is released afterwards, even when the run fails.
    await expect(start("alpha", dir)).rejects.toThrow("Already running");
    procs.clear();
    await start("alpha", dir);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  it("fails cleanly when the shell couldn't be spawned", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite" }) });
    nextPid = undefined;
    const err = await devError(start("alpha", dir));
    expect(err.status).toBe(500);
    expect(err.message).toBe("Failed to start the process");
    expect(fs.existsSync(devFile("alpha.json"))).toBe(false);
    // The spawn error arrives later as an event, and goes to the log.
    children[0].emit("error", new Error("spawn /bin/sh ENOENT"));
    expect(readLog("dev")).toBe("Failed to start: spawn /bin/sh ENOENT\n");
  });

  it("saves an empty start time when ps can't see the new process", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite" }) });
    mocks.spawn.mockImplementation(() => Object.assign(new EventEmitter(), { pid: 777, unref: vi.fn() }));
    await start("alpha", dir);
    expect(readJson(devFile("alpha.json"))).toMatchObject({ pid: 777, lstart: "" });
  });

  it("treats empty ps output as no start time", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite" }) });
    procs.set(4242, "");
    mocks.spawn.mockImplementation(() => Object.assign(new EventEmitter(), { pid: 4242, unref: vi.fn() }));
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], cb: (e: null, r: object) => void) =>
      cb(null, { stdout: "  \n", stderr: "" })
    );
    await start("alpha", dir);
    expect(readJson(devFile("alpha.json")).lstart).toBe("");
  });
});

describe("install", () => {
  it("runs the project's package manager install in the dev slot", async () => {
    writeFiles({ "package.json": packageJson({}), "yarn.lock": "" });
    await install("alpha", dir);
    expect(spawnedScript()).toBe("echo '› yarn install' && exec yarn install");
    expect(readJson(devFile("alpha.json"))).toMatchObject({ pid: 4242, kind: "install" });
  });

  it("refuses without a package.json", async () => {
    const err = await devError(install("alpha", dir));
    expect(err.status).toBe(400);
    expect(err.message).toBe("No package.json to install from");
  });

  it.each([
    ["install", "Already installing"],
    ["dev", "Stop the dev environment before installing"],
  ])("refuses while a %s run is going", async (kind, message) => {
    writeFiles({ "package.json": packageJson({}) });
    startedEarlier("dev", { pid: 501, kind });
    const err = await devError(install("alpha", dir));
    expect(err.status).toBe(409);
    expect(err.message).toBe(message);
  });
});

describe("stop", () => {
  it("terminates the dev process group, stops running containers and clears the state", async () => {
    startedEarlier("dev", { pid: 501, kind: "dev" });
    vi.mocked(projectStacks).mockResolvedValue([
      stack({ containers: [container({ id: "a" }), container({ id: "b", state: "exited" }), container({ id: "c", state: "paused" })] }),
      stack({ name: "idle", containers: [container({ id: "d", state: "exited" })] }),
    ]);

    await stop("alpha", dir);

    expect(process.kill).toHaveBeenCalledWith(-501, "SIGTERM");
    expect(process.kill).not.toHaveBeenCalledWith(-501, "SIGKILL");
    const dockerCalls = mocks.execFile.mock.calls.filter((c) => c[0] === "docker");
    expect(dockerCalls).toHaveLength(1);
    expect(dockerCalls[0][1]).toEqual(["stop", "a", "c"]);
    expect(dockerCalls[0][2]).toEqual({ timeout: 120_000 });
    expect(invalidateDocker).toHaveBeenCalled();
    expect(readLog("dev")).toBe("› stopping dev process\n› docker stop (alpha)\n");
    expect(fs.existsSync(devFile("alpha.json"))).toBe(false);
  });

  it("says it's stopping an install", async () => {
    startedEarlier("dev", { pid: 501, kind: "install" });
    await stop("alpha", dir);
    expect(readLog("dev")).toBe("› stopping install\n");
  });

  it("SIGKILLs a process group that is still alive 5 seconds after SIGTERM", async () => {
    vi.useFakeTimers();
    ignoresTerm = true;
    startedEarlier("dev", { pid: 501, kind: "dev" });

    let done = false;
    const stopping = stop("alpha", dir).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(4800);
    expect(done).toBe(false);
    expect(process.kill).not.toHaveBeenCalledWith(-501, "SIGKILL");

    await vi.advanceTimersByTimeAsync(400);
    await stopping;
    expect(process.kill).toHaveBeenCalledWith(-501, "SIGKILL");
    expect(groups.has(501)).toBe(false);
  });

  it("stops polling as soon as the group has exited", async () => {
    vi.useFakeTimers();
    ignoresTerm = true;
    startedEarlier("dev", { pid: 501, kind: "dev" });
    const stopping = stop("alpha", dir);
    await vi.advanceTimersByTimeAsync(600);
    groups.delete(501); // exits on its own after a moment
    await vi.advanceTimersByTimeAsync(200);
    await stopping;
    expect(process.kill).not.toHaveBeenCalledWith(-501, "SIGKILL");
  });

  it("copes with a group that is already gone", async () => {
    startedEarlier("dev", { pid: 501, kind: "dev" });
    groups.delete(501); // ps still lists the leader, but the group can't be signalled
    await stop("alpha", dir);
    expect(process.kill).toHaveBeenCalledWith(-501, "SIGTERM");
    expect(fs.existsSync(devFile("alpha.json"))).toBe(false);
  });

  it("never signals a pid that now belongs to another process", async () => {
    startedEarlier("dev", { pid: 501, kind: "dev" }, false);
    procs.set(501, "Tue Nov 10 08:00:00 2026");
    await stop("alpha", dir);
    expect(process.kill).not.toHaveBeenCalled();
    expect(fs.existsSync(devFile("alpha.json"))).toBe(false);
  });

  it("does nothing to Docker when no container is up", async () => {
    vi.mocked(projectStacks).mockResolvedValue([stack({ containers: [container({ state: "exited" })] })]);
    await stop("alpha", dir);
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(invalidateDocker).not.toHaveBeenCalled();
  });

  it("reports a failed docker stop with docker's last error line", async () => {
    vi.mocked(projectStacks).mockResolvedValue([stack({ containers: [container({ id: "a" })] })]);
    dockerReply = () => Object.assign(new Error("Command failed"), { stderr: "warning\nError: permission denied\n" });
    const err = await devError(stop("alpha", dir));
    expect(err.status).toBe(500);
    expect(err.message).toBe("docker stop failed: Error: permission denied");
    expect(readLog("dev")).toBe("› docker stop (alpha)\nError: permission denied\n");
    expect(invalidateDocker).toHaveBeenCalled();
  });
});

describe("stackAction", () => {
  const api = () =>
    stack({
      name: "alpha-api",
      dir: "api",
      absDir: path.join(dir, "api"),
      primary: false,
      containers: [container({ id: "a" }), container({ id: "b", state: "exited" })],
    });

  it("refuses a stack that isn't in the project", async () => {
    vi.mocked(projectStacks).mockResolvedValue([api()]);
    const err = await devError(stackAction("alpha", dir, "alpha-api", "", "stop"));
    expect(err.status).toBe(404);
    expect(err.message).toBe('No compose stack named "alpha-api" in this project');
    expect(projectStacks).toHaveBeenCalledWith("alpha", dir);
  });

  it("stops the stack's running containers", async () => {
    vi.mocked(projectStacks).mockResolvedValue([api()]);
    await stackAction("alpha", dir, "alpha-api", "api", "stop");
    expect(mocks.execFile).toHaveBeenCalledWith("docker", ["stop", "a"], { timeout: 120_000 }, expect.any(Function));
    expect(readLog("dev")).toBe("› docker stop (alpha-api in api)\n");
    expect(invalidateDocker).toHaveBeenCalled();
  });

  it("restarts the running containers", async () => {
    vi.mocked(projectStacks).mockResolvedValue([stack({ containers: [container({ id: "a" }), container({ id: "c" })] })]);
    await stackAction("alpha", dir, "alpha", "", "restart");
    expect(mocks.execFile).toHaveBeenCalledWith("docker", ["restart", "a", "c"], { timeout: 180_000 }, expect.any(Function));
    expect(readLog("dev")).toBe("› docker restart (alpha)\n");
  });

  it("brings the stack up from its compose files, passing label-derived files with -f", async () => {
    vi.mocked(projectStacks).mockResolvedValue([
      stack({ ...api(), files: ["compose.yaml", "compose.dev.yaml"], explicitFiles: true, containers: [] }),
    ]);
    dockerReply = () => ({ stdout: "Container alpha-api-1  Started\n", stderr: "warning: obsolete version\n\n" });
    await stackAction("alpha", dir, "alpha-api", "api", "start");
    expect(mocks.execFile).toHaveBeenCalledWith(
      "docker",
      ["compose", "-p", "alpha-api", "-f", "compose.yaml", "-f", "compose.dev.yaml", "up", "-d"],
      { cwd: path.join(dir, "api"), timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
      expect.any(Function)
    );
    expect(readLog("dev")).toBe(
      "› docker compose up -d (alpha-api in api)\nContainer alpha-api-1  Started\nwarning: obsolete version\n"
    );
  });

  it("restarting a stack with nothing up brings it up instead, using the folder's own compose file", async () => {
    vi.mocked(projectStacks).mockResolvedValue([stack({ containers: [container({ state: "exited" })] })]);
    await stackAction("alpha", dir, "alpha", "", "restart");
    const [, args] = mocks.execFile.mock.lastCall!;
    expect(args).toEqual(["compose", "-p", "alpha", "up", "-d"]);
    // No output, nothing more logged.
    expect(readLog("dev")).toBe("› docker compose up -d (alpha)\n");
  });

  it("refuses to bring up a stack whose name another folder uses", async () => {
    vi.mocked(projectStacks).mockResolvedValue([stack({ conflict: "beta" })]);
    const err = await devError(stackAction("alpha", dir, "alpha", "", "start"));
    expect(err.status).toBe(409);
    expect(err.message).toContain('"alpha" is also the compose project name of beta');
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(invalidateDocker).toHaveBeenCalled();
  });

  it("starts the existing containers of a stack whose compose files are gone", async () => {
    vi.mocked(projectStacks).mockResolvedValue([
      stack({ fromFiles: false, containers: [container({ id: "a", state: "exited" }), container({ id: "b", state: "created" })] }),
    ]);
    await stackAction("alpha", dir, "alpha", "", "start");
    expect(mocks.execFile).toHaveBeenCalledWith("docker", ["start", "a", "b"], { timeout: 180_000 }, expect.any(Function));
    expect(readLog("dev")).toBe("› docker start (alpha)\n");
  });

  it("refuses to start a stack with no compose file and no containers", async () => {
    vi.mocked(projectStacks).mockResolvedValue([stack({ fromFiles: false })]);
    const err = await devError(stackAction("alpha", dir, "alpha", "", "start"));
    expect(err.status).toBe(400);
    expect(err.message).toBe("This stack has no compose file and no containers to start");
  });

  it("reports a failed docker command", async () => {
    vi.mocked(projectStacks).mockResolvedValue([stack({ containers: [container({ id: "a" })] })]);
    dockerReply = () => Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    const err = await devError(stackAction("alpha", dir, "alpha", "", "restart"));
    expect(err.status).toBe(500);
    expect(err.message).toBe("restart failed: Docker CLI not found on PATH");
    expect(readLog("dev")).toBe("› docker restart (alpha)\nDocker CLI not found on PATH\n");
    expect(invalidateDocker).toHaveBeenCalled();
  });

  it("passes a failed docker stop through unchanged", async () => {
    vi.mocked(projectStacks).mockResolvedValue([stack({ containers: [container({ id: "a" })] })]);
    dockerReply = () => new Error("boom");
    const err = await devError(stackAction("alpha", dir, "alpha", "", "stop"));
    expect(err.message).toBe("docker stop failed: boom");
  });
});

describe("scriptStatus", () => {
  it("lists the package.json scripts, skipping non-string entries", async () => {
    writeFiles({
      "package.json": packageJson({ dev: "vite", lint: "eslint .", test: "vitest", weird: 42 }),
      "pnpm-lock.yaml": "",
    });
    expect(await scriptStatus("alpha", dir)).toEqual({
      pm: "pnpm",
      scripts: [
        { name: "dev", command: "vite" },
        { name: "lint", command: "eslint ." },
        { name: "test", command: "vitest" },
      ],
      devScript: "dev",
      current: null,
      running: false,
      exitCode: null,
      log: [],
    });
  });

  it.each([
    ["no package.json", null],
    ["a broken package.json", "{ not json"],
    ["no scripts", JSON.stringify({ name: "alpha" })],
    ["scripts that aren't an object", JSON.stringify({ scripts: "dev" })],
  ])("has no scripts with %s", async (_label, content) => {
    if (content !== null) writeFiles({ "package.json": content });
    const status = await scriptStatus("alpha", dir);
    expect(status.scripts).toEqual([]);
    expect(status.devScript).toBeNull();
  });

  it("reports the exit code of the last finished run", async () => {
    writeFiles({ "package.json": packageJson({ test: "vitest" }) });
    startedEarlier("script", { pid: 601, kind: "script", script: "test" }, false);
    writeLog("script", "› npm run test\n› exited with code 0\nnoise\n› exited with code 2\ntrailing\n");
    expect(await scriptStatus("alpha", dir)).toMatchObject({ current: "test", running: false, exitCode: 2 });
  });

  it("has no exit code while running, or after a stop", async () => {
    writeFiles({ "package.json": packageJson({ test: "vitest" }) });
    startedEarlier("script", { pid: 601, kind: "script", script: "test" });
    writeLog("script", "› exited with code 1\n");
    expect(await scriptStatus("alpha", dir)).toMatchObject({ current: "test", running: true, exitCode: null });

    procs.clear();
    writeLog("script", "› npm run test\n› stopped\n");
    expect(await scriptStatus("alpha", dir)).toMatchObject({ running: false, exitCode: null });
  });
});

describe("runScript", () => {
  it("runs the script in the script slot, passing the package manager and name as arguments", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite", lint: "eslint ." }), "pnpm-lock.yaml": "" });
    await runScript("alpha", dir, "lint");
    const [cmd, args, opts] = mocks.spawn.mock.lastCall!;
    expect(cmd).toBe("/bin/sh");
    expect(args.slice(2)).toEqual(["pnpm", "lint"]);
    expect(args[1]).not.toContain("lint");
    expect(opts).toMatchObject({ cwd: dir, detached: true });
    expect(readJson(devFile("scripts", "alpha.json"))).toMatchObject({ pid: 4242, kind: "script", script: "lint" });
    expect(fs.existsSync(devFile("alpha.json"))).toBe(false);
  });

  it("runs while the dev environment is up", async () => {
    writeFiles({ "package.json": packageJson({ dev: "vite", test: "vitest" }) });
    startedEarlier("dev", { pid: 501, kind: "dev" });
    await runScript("alpha", dir, "test");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("logs the command and its exit code, and never lets the shell parse the name", async () => {
    writeFiles({ "package.json": packageJson({ "lint; touch pwned": "eslint ." }) });
    await runScript("alpha", dir, "lint; touch pwned");
    const [, args] = mocks.spawn.mock.lastCall!;

    // Run the real script with a stand-in package manager that exits 3.
    const pm = path.join(dir, "fake-pm");
    fs.writeFileSync(pm, '#!/bin/sh\necho "args: $*"\nexit 3\n', { mode: 0o755 });
    const { execFile } = await vi.importActual<typeof import("child_process")>("child_process");
    const err = await promisify(execFile)("/bin/sh", [args[0], args[1], pm, args[3]], { cwd: dir }).then(
      () => null,
      (e: { code: number; stdout: string }) => e
    );
    expect(err?.code).toBe(3);
    expect(err?.stdout).toBe(`› ${pm} run lint; touch pwned\nargs: run lint; touch pwned\n› exited with code 3\n`);
    expect(fs.existsSync(path.join(dir, "pwned"))).toBe(false);
  });

  it.each([
    ["an unknown script", "deploy"],
    ["an inherited property", "constructor"],
    ["a name that looks like a flag", "-v"],
  ])("refuses %s", async (_label, script) => {
    writeFiles({ "package.json": packageJson({ lint: "eslint .", "-v": "echo" }) });
    const err = await devError(runScript("alpha", dir, script));
    expect(err.status).toBe(400);
    expect(err.message).toBe(`No script named "${script}" in package.json`);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("refuses the script Start runs", async () => {
    writeFiles({ "package.json": packageJson({ start: "node .", lint: "eslint ." }) });
    const err = await devError(runScript("alpha", dir, "start"));
    expect(err.status).toBe(400);
    expect(err.message).toBe(`Use Start for "start"; it's what the dev environment runs`);
  });

  it("refuses while another script is running", async () => {
    writeFiles({ "package.json": packageJson({ lint: "eslint .", test: "vitest" }) });
    startedEarlier("script", { pid: 601, kind: "script", script: "test" });
    const err = await devError(runScript("alpha", dir, "lint"));
    expect(err.status).toBe(409);
    expect(err.message).toBe('"test" is still running');
  });
});

describe("stopScript", () => {
  it("terminates a running script and notes it in the log", async () => {
    startedEarlier("script", { pid: 601, kind: "script", script: "test" });
    writeLog("script", "› npm run test\n");
    await stopScript("alpha");
    expect(process.kill).toHaveBeenCalledWith(-601, "SIGTERM");
    expect(readLog("script")).toBe("› npm run test\n› stopped\n");
  });

  it("does nothing when no script is running", async () => {
    startedEarlier("script", { pid: 601, kind: "script", script: "test" }, false);
    await stopScript("alpha");
    await stopScript("beta");
    expect(process.kill).not.toHaveBeenCalled();
    expect(fs.existsSync(devFile("scripts", "alpha.log"))).toBe(false);
  });
});

describe("runningProjects", () => {
  function state(slot: "dev" | "script", name: string, content: object | string) {
    const folder = slot === "dev" ? devFile() : devFile("scripts");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${name}.json`), typeof content === "string" ? content : JSON.stringify(content));
  }

  it("is empty with nothing started and no containers", async () => {
    expect(await runningProjects()).toEqual({ projects: [], problems: {}, docker: RUNNING });
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("lists projects whose processes are still ours, with one ps for all of them", async () => {
    state("dev", "alpha", { pid: 11, lstart: LSTART });
    state("script", "beta", { pid: 12, lstart: LSTART });
    state("dev", "gamma", { pid: 13, lstart: LSTART }); // gone
    state("dev", "delta", { pid: 14, lstart: LSTART }); // pid reused
    state("dev", "epsilon", { pid: 15, lstart: "" }); // no start time: never ours
    state("dev", "zeta", "not json");
    fs.writeFileSync(devFile("alpha.log"), "");
    fs.mkdirSync(devFile("theta.json")); // unreadable as a file
    procs.set(11, LSTART);
    procs.set(12, LSTART);
    procs.set(14, "Tue Nov 10 08:00:00 2026");

    const result = await runningProjects();

    const psCalls = mocks.execFile.mock.calls.filter((c) => c[0] === "ps");
    expect(psCalls).toHaveLength(1);
    expect(psCalls[0][1][0]).toBe("-o");
    expect(psCalls[0][1][1]).toBe("pid=,lstart=");
    expect(psCalls[0][1][3].split(",").sort()).toEqual(["11", "12", "13", "14"]);
    expect(result.projects).toEqual([
      { name: "alpha", ports: [] },
      { name: "beta", ports: [] },
    ]);
  });

  it("finds nothing when ps fails without output", async () => {
    state("dev", "alpha", { pid: 11, lstart: LSTART });
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], cb: (e: Error) => void) => cb(new Error("no ps")));
    expect((await runningProjects()).projects).toEqual([]);
  });

  it("adds projects with running containers, their ports, and container problems", async () => {
    state("dev", "alpha", { pid: 11, lstart: LSTART });
    procs.set(11, LSTART);
    const crashedAt = new Date(Date.now() - 60_000).toISOString();
    const stopped: DockerDaemon = { state: "running", message: null, app: "OrbStack" };
    vi.mocked(dockerSnapshot).mockResolvedValue({
      daemon: stopped,
      containers: [
        container({ id: "1", project: "portland", ports: [8080, 3000] }),
        container({ id: "2", project: "portland", ports: [3000, 5432], state: "restarting", stack: "api", service: "db" }),
        container({ id: "3", project: "alpha", ports: [5173] }),
        container({ id: "4", project: "beta", state: "exited", exitCode: 1, finishedAt: crashedAt, service: "worker", stack: "beta" }),
        container({ id: "5", project: null, ports: [9999] }),
      ],
    });

    const result = await runningProjects();

    expect(result.projects).toEqual([
      { name: "alpha", ports: [5173] },
      { name: "portland", ports: [3000, 5432, 8080] },
    ]);
    expect(result.problems).toEqual({
      portland: [{ stack: "api", service: "db", kind: "restarting", exitCode: null }],
      beta: [{ stack: "beta", service: "worker", kind: "exited", exitCode: 1 }],
    });
    expect(result.docker).toEqual(stopped);
  });
});

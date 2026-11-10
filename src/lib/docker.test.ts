import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Container, StackDetail } from "./docker";

// docker.ts runs everything through promisify(execFile). The mock answers
// promisify's custom hook, so each call resolves to { stdout, stderr } (or
// rejects with the error a real docker failure would carry) without ever
// touching the real CLI.
type Exec = (cmd: string, args: string[], opts: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }>;
const exec = vi.hoisted(() => vi.fn<Exec>());
// spawn (Docker Desktop on Windows) hands back a fake child that reports "spawn", or `spawnError`.
const spawner = await vi.hoisted(async () => {
  const { EventEmitter } = await import("events");
  const state = { error: null as Error | null, unref: vi.fn() };
  const spawn = vi.fn<(cmd: string, args: string[], opts: object) => InstanceType<typeof EventEmitter>>(() => {
    const child = Object.assign(new EventEmitter(), { unref: state.unref });
    const error = state.error;
    process.nextTick(() => (error ? child.emit("error", error) : child.emit("spawn")));
    return child;
  });
  return { spawn, state };
});
vi.mock("child_process", async () => {
  const { promisify: p } = await import("util");
  const execFile = Object.assign(() => {
    throw new Error("execFile called without promisify");
  }, { [p.custom]: exec });
  return { execFile, spawn: spawner.spawn, default: { execFile, spawn: spawner.spawn } };
});

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-docker-")));
const dataDir = path.join(root, "data");
const projects = path.join(root, "projects");
fs.mkdirSync(projects, { recursive: true });

const NOW = new Date("2026-06-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const realExists = fs.existsSync;
/** Docker Desktop on Windows, with %ProgramFiles% pointed at a drive no machine has. */
const WINDOWS_DOCKER = "Q:\\Programs\\Docker\\Docker\\Docker Desktop.exe";
let apps: string[] = ["Docker"];

const realPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

// docker.ts caches snapshots and compose configs per module instance: each
// test gets a fresh copy. Which Docker app is installed (`apps`) is answered by
// the existsSync spy below, and the platform is pinned to macOS unless a test
// says otherwise, so nothing depends on the machine running the tests.
async function load(installed: string[] = ["Docker"]) {
  apps = installed;
  vi.resetModules();
  return import("./docker");
}

function ok(stdout: string, stderr = "") {
  return Promise.resolve({ stdout, stderr });
}

function fail(props: Record<string, unknown>, message = "Command failed") {
  return Promise.reject(Object.assign(new Error(message), props));
}

interface PsRow {
  id?: string;
  name?: string;
  image?: string;
  state?: string;
  status?: string;
  ports?: string;
  stack?: string;
  service?: string;
  dir?: string;
  files?: string;
}

function psLine(r: PsRow): string {
  return [
    r.id ?? "abc123",
    r.name ?? "web-1",
    r.image ?? "nginx:latest",
    r.state ?? "running",
    r.status ?? "Up 2 hours",
    r.ports ?? "",
    r.stack ?? "",
    r.service ?? "",
    r.dir ?? "",
    r.files ?? "",
  ].join("\t");
}

function container(c: Partial<Container>): Container {
  return {
    id: "id",
    name: "c",
    image: "img",
    state: "running",
    health: null,
    exitCode: null,
    oomKilled: false,
    startedAt: ago(HOUR),
    finishedAt: null,
    ports: [],
    stack: "app",
    service: "web",
    workingDir: path.join(projects, "alpha"),
    configFiles: [],
    project: "alpha",
    ...c,
  };
}

const running = { state: "running" as const, message: null, app: "Docker" as const };

beforeEach(() => {
  vi.stubEnv("WORKBENCH_DATA_DIR", dataDir);
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  exec.mockReset();
  exec.mockImplementation(() => fail({}, "unexpected docker call"));
  vi.spyOn(fs, "existsSync").mockImplementation((p) => {
    if (p === "/Applications/Docker.app") return apps.includes("Docker");
    if (p === "/Applications/OrbStack.app") return apps.includes("OrbStack");
    if (p === "/opt/docker-desktop") return apps.includes("Docker Desktop for Linux");
    if (p === WINDOWS_DOCKER) return apps.includes("Docker Desktop for Windows");
    return realExists(p);
  });
  setPlatform("darwin");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setPlatform(realPlatform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("dockerMessage", () => {
  it("explains a missing CLI", async () => {
    const { dockerMessage } = await load();
    expect(dockerMessage(Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }))).toBe("Docker CLI not found on PATH");
  });

  it("uses the last line of stderr, else the error message", async () => {
    const { dockerMessage } = await load();
    expect(dockerMessage(Object.assign(new Error("Command failed"), { stderr: "warning: x\nError: no such container\n" }))).toBe(
      "Error: no such container"
    );
    expect(dockerMessage(Object.assign(new Error("Command failed"), { stderr: "  \n" }))).toBe("Command failed");
    expect(dockerMessage(new Error("timed out"))).toBe("timed out");
  });
});

describe("daemonFromError", () => {
  it("reports a missing CLI", async () => {
    const { daemonFromError } = await load();
    expect(daemonFromError(Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }))).toEqual({
      state: "missing",
      message: "The Docker CLI isn't installed (or isn't on PATH).",
      app: "Docker",
    });
  });

  it.each([
    "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
    "error during connect: Get http://...: open //./pipe/docker_engine",
    "dial unix /Users/me/.docker/run/docker.sock: connect: no such file",
    "dial tcp 127.0.0.1:2375: connect: connection refused",
  ])("reports a stopped daemon for %s", async (stderr) => {
    const { daemonFromError } = await load(["OrbStack"]);
    expect(daemonFromError(Object.assign(new Error("Command failed"), { stderr }))).toEqual({
      state: "stopped",
      message: "Docker isn't running.",
      app: "OrbStack",
    });
  });

  it("passes other failures through", async () => {
    const { daemonFromError } = await load([]);
    expect(daemonFromError(Object.assign(new Error("Command failed"), { stderr: "permission denied while trying to connect" }))).toEqual({
      state: "error",
      message: "permission denied while trying to connect",
      app: null,
    });
  });
});

describe("startDaemon", () => {
  it("opens Docker Desktop when it's installed", async () => {
    exec.mockImplementation(() => ok(""));
    const { startDaemon } = await load(["Docker", "OrbStack"]);
    await startDaemon();
    expect(exec).toHaveBeenCalledWith("open", ["-a", "Docker"], { timeout: 10_000 });
  });

  it("falls back to OrbStack", async () => {
    exec.mockImplementation(() => ok(""));
    const { startDaemon } = await load(["OrbStack"]);
    await startDaemon();
    expect(exec).toHaveBeenCalledWith("open", ["-a", "OrbStack"], { timeout: 10_000 });
  });

  it("refuses when no Docker app is installed", async () => {
    const { startDaemon } = await load([]);
    await expect(startDaemon()).rejects.toThrow("No Docker app found in /Applications");
    expect(exec).not.toHaveBeenCalled();
  });

  it("notices an app installed after it loaded", async () => {
    exec.mockImplementation(() => ok(""));
    const { startDaemon } = await load([]);
    apps = ["OrbStack"];
    await startDaemon();
    expect(exec).toHaveBeenCalledWith("open", ["-a", "OrbStack"], { timeout: 10_000 });
  });

});

describe("Docker on Windows", () => {
  beforeEach(() => {
    setPlatform("win32");
    vi.stubEnv("ProgramFiles", "Q:\\Programs");
    spawner.spawn.mockClear();
    spawner.state.unref.mockClear();
    spawner.state.error = null;
  });

  it("starts Docker Desktop.exe and lets it run, without waiting for it", async () => {
    const { startDaemon } = await load(["Docker Desktop for Windows"]);
    await startDaemon();
    expect(spawner.spawn).toHaveBeenCalledWith(WINDOWS_DOCKER, [], { detached: true, stdio: "ignore" });
    expect(spawner.state.unref).toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("reports Docker Desktop failing to start", async () => {
    spawner.state.error = new Error("spawn EACCES");
    const { startDaemon } = await load(["Docker Desktop for Windows"]);
    await expect(startDaemon()).rejects.toThrow("spawn EACCES");
    expect(spawner.state.unref).not.toHaveBeenCalled();
  });

  it("says Docker Desktop isn't installed, ignoring the macOS and Linux apps", async () => {
    const { startDaemon } = await load(["Docker", "OrbStack", "Docker Desktop for Linux"]);
    await expect(startDaemon()).rejects.toThrow("Docker Desktop isn't installed");
    expect(spawner.spawn).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("reads Docker Desktop's named-pipe error as not running", async () => {
    const { daemonFromError } = await load(["Docker Desktop for Windows"]);
    const err = Object.assign(new Error("Command failed"), {
      stderr:
        'error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/containers/json": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.\r\n',
    });
    expect(daemonFromError(err)).toEqual({ state: "stopped", message: "Docker isn't running.", app: "Docker" });
  });
});

describe("Docker on Linux", () => {
  const stopped = Object.assign(new Error("Command failed"), {
    stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
  });

  beforeEach(() => {
    setPlatform("linux");
    vi.stubEnv("DOCKER_HOST", "");
  });

  it("starts Docker Desktop for Linux through systemd", async () => {
    exec.mockImplementation(() => ok(""));
    const { startDaemon, daemonFromError } = await load(["Docker Desktop for Linux"]);
    await startDaemon();
    expect(exec).toHaveBeenCalledWith("systemctl", ["--user", "start", "docker-desktop"], { timeout: 10_000 });
    expect(daemonFromError(stopped)).toEqual({ state: "stopped", message: "Docker isn't running.", app: "Docker" });
  });

  it("ignores the macOS apps", async () => {
    const { daemonFromError } = await load(["Docker", "OrbStack"]);
    expect(daemonFromError(stopped).app).toBeNull();
  });

  it("says how to start Docker Engine, which has no app", async () => {
    const { daemonFromError, startDaemon } = await load([]);
    expect(daemonFromError(stopped)).toEqual({
      state: "stopped",
      message: "Docker isn't running. Start it in a terminal: sudo systemctl start docker",
      app: null,
      startCommand: "sudo systemctl start docker",
    });
    await expect(startDaemon()).rejects.toThrow(
      "Docker Desktop isn't installed. Start Docker in a terminal: sudo systemctl start docker"
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("says how to start rootless Docker", async () => {
    vi.stubEnv("DOCKER_HOST", "unix:///run/user/1000/docker.sock");
    const { daemonFromError } = await load([]);
    expect(daemonFromError(stopped).startCommand).toBe("systemctl --user start docker");
  });

  it.each([
    "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get \"http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/json\": dial unix /var/run/docker.sock: connect: permission denied",
    "permission denied while trying to connect to the docker API at unix:///var/run/docker.sock",
  ])("explains a socket it may not use, rather than calling Docker stopped: %s", async (stderr) => {
    const { daemonFromError } = await load([]);
    expect(daemonFromError(Object.assign(new Error("Command failed"), { stderr }))).toEqual({
      state: "error",
      message: expect.stringContaining("sudo usermod -aG docker $USER"),
      app: null,
    });
  });

  it("reports a running daemon without an app to launch", async () => {
    exec.mockImplementation(() => ok(""));
    const { dockerSnapshot } = await load([]);
    expect((await dockerSnapshot()).daemon).toEqual({ state: "running", message: null, app: null });
  });

  it("reports the daemon's app in a snapshot", async () => {
    exec.mockImplementation(() => ok(""));
    const { dockerSnapshot } = await load(["Docker Desktop for Linux"]);
    expect((await dockerSnapshot()).daemon).toEqual({ state: "running", message: null, app: "Docker" });
  });
});

describe("projectOf", () => {
  it("names the project a folder is in", async () => {
    const { projectOf } = await load();
    expect(projectOf(path.join(projects, "alpha"))).toBe("alpha");
    expect(projectOf(path.join(projects, "alpha", "api", "db"))).toBe("alpha");
  });

  it("is null outside a project", async () => {
    const { projectOf } = await load();
    expect(projectOf(null)).toBeNull();
    expect(projectOf("")).toBeNull();
    expect(projectOf(projects)).toBeNull();
    expect(projectOf(root)).toBeNull();
    expect(projectOf(projects + "-old/alpha")).toBeNull();
  });
});

describe("durationMs", () => {
  it.each([
    ["Less than a second", 0],
    ["About a minute", 60_000],
    ["about an hour", HOUR],
    ["1 second", 1000],
    ["45 seconds", 45_000],
    ["9 hours", 9 * HOUR],
    ["2 days", 2 * DAY],
    ["3 weeks", 3 * 7 * DAY],
    ["9 months", 9 * 30 * DAY],
    ["2 years", 2 * 365 * DAY],
    ["  5 minutes ", 300_000],
  ])("reads %j", async (text, ms) => {
    const { durationMs } = await load();
    expect(durationMs(text)).toBe(ms);
  });

  it.each(["", "forever", "About a day", "5 fortnights", "-3 hours"])("is null for %j", async (text) => {
    const { durationMs } = await load();
    expect(durationMs(text)).toBeNull();
  });
});

describe("parseStatus", () => {
  it("reads a healthy running container", async () => {
    const { parseStatus } = await load();
    expect(parseStatus("Up 9 hours (healthy)", "running")).toEqual({
      health: "healthy",
      exitCode: null,
      startedAt: ago(9 * HOUR),
      finishedAt: null,
    });
  });

  it("reads unhealthy and starting health checks", async () => {
    const { parseStatus } = await load();
    expect(parseStatus("Up About a minute (unhealthy)", "running").health).toBe("unhealthy");
    expect(parseStatus("Up 3 seconds (health: starting)", "running")).toMatchObject({ health: "starting", startedAt: ago(3000) });
  });

  it("ignores health unless the container is running", async () => {
    const { parseStatus } = await load();
    expect(parseStatus("Up 2 days (Paused)", "paused")).toEqual({ health: null, exitCode: null, startedAt: ago(2 * DAY), finishedAt: null });
    expect(parseStatus("Up 2 days (unhealthy) (Paused)", "paused").health).toBeNull();
  });

  it("reads an exit code and when it happened", async () => {
    const { parseStatus } = await load();
    expect(parseStatus("Exited (137) 9 months ago", "exited")).toEqual({
      health: null,
      exitCode: 137,
      startedAt: null,
      finishedAt: ago(9 * 30 * DAY),
    });
    expect(parseStatus("Exited (-1) Less than a second ago", "dead")).toMatchObject({ exitCode: -1, finishedAt: NOW.toISOString() });
  });

  it("keeps a restart loop's last exit time but not its code", async () => {
    const { parseStatus } = await load();
    expect(parseStatus("Restarting (1) 19 seconds ago", "restarting")).toEqual({
      health: null,
      exitCode: null,
      startedAt: null,
      finishedAt: ago(19_000),
    });
  });

  it("knows nothing about created or oddly worded containers", async () => {
    const { parseStatus } = await load();
    expect(parseStatus("Created", "created")).toEqual({ health: null, exitCode: null, startedAt: null, finishedAt: null });
    expect(parseStatus("Up forever", "running").startedAt).toBeNull();
    expect(parseStatus("Exited (2) a while ago", "exited")).toEqual({ health: null, exitCode: 2, startedAt: null, finishedAt: null });
  });

  it("uses the given clock", async () => {
    const { parseStatus } = await load();
    expect(parseStatus("Up 1 hour", "running", Date.parse("2020-01-01T01:00:00Z")).startedAt).toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("dockerSnapshot", () => {
  const alphaApi = path.join(projects, "alpha", "api");

  it("lists containers from docker ps", async () => {
    exec.mockImplementation(() =>
      ok(
        [
          psLine({
            id: "c1",
            name: "api-db-1",
            image: "postgres:16",
            state: "running",
            status: "Up 9 hours (healthy)",
            ports: "0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp, 0.0.0.0:80->8080/tcp, 9000/tcp",
            stack: "api",
            service: "db",
            dir: alphaApi,
            files: `${alphaApi}/compose.yaml,${alphaApi}/compose.override.yaml`,
          }),
          "",
          "   ",
          "short\tline",
          psLine({ id: "c2", name: "loose", state: "exited", status: "Exited (0) 2 days ago", dir: "/elsewhere" }),
        ].join("\n") + "\n"
      )
    );
    const { dockerSnapshot } = await load();
    const snap = await dockerSnapshot();

    expect(exec).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = exec.mock.calls[0];
    expect(cmd).toBe("docker");
    expect(args.slice(0, 4)).toEqual(["ps", "-a", "--no-trunc", "--format"]);
    expect(args[4].split("\t")).toHaveLength(10);
    expect(args[4]).toContain('{{.Label "com.docker.compose.project.working_dir"}}');
    expect(opts).toMatchObject({ timeout: 8_000 });

    expect(snap.daemon).toEqual(running);
    expect(snap.containers).toEqual([
      {
        id: "c1",
        name: "api-db-1",
        image: "postgres:16",
        state: "running",
        health: "healthy",
        exitCode: null,
        oomKilled: false,
        startedAt: ago(9 * HOUR),
        finishedAt: null,
        ports: [80, 5433],
        bindings: [
          { address: "0.0.0.0", port: 5433 },
          { address: "::", port: 5433 },
          { address: "0.0.0.0", port: 80 },
        ],
        stack: "api",
        service: "db",
        workingDir: alphaApi,
        configFiles: [`${alphaApi}/compose.yaml`, `${alphaApi}/compose.override.yaml`],
        project: "alpha",
      },
      {
        id: "c2",
        name: "loose",
        image: "nginx:latest",
        state: "exited",
        health: null,
        exitCode: 0,
        oomKilled: false,
        startedAt: null,
        finishedAt: ago(2 * DAY),
        ports: [],
        bindings: [],
        stack: null,
        service: null,
        workingDir: "/elsewhere",
        configFiles: [],
        project: null,
      },
    ]);
  });

  it("reports the daemon state when docker ps fails", async () => {
    exec.mockImplementation(() =>
      fail({ stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n" })
    );
    const { dockerSnapshot } = await load();
    expect(await dockerSnapshot()).toEqual({ daemon: { state: "stopped", message: "Docker isn't running.", app: "Docker" }, containers: [] });
  });

  it("reports a missing CLI", async () => {
    exec.mockImplementation(() => fail({ code: "ENOENT" }, "spawn docker ENOENT"));
    const { dockerSnapshot } = await load([]);
    expect((await dockerSnapshot()).daemon).toEqual({ state: "missing", message: "The Docker CLI isn't installed (or isn't on PATH).", app: null });
  });

  it("reports a timeout as an error", async () => {
    exec.mockImplementation(() => fail({ killed: true, signal: "SIGTERM" }, "Command failed: docker ps -a"));
    const { dockerSnapshot } = await load();
    expect((await dockerSnapshot()).daemon).toEqual({ state: "error", message: "Command failed: docker ps -a", app: "Docker" });
  });

  it("shares one snapshot for a moment, then reloads", async () => {
    exec.mockImplementation(() => ok(psLine({}) + "\n"));
    const { dockerSnapshot, invalidateDocker } = await load();
    const first = dockerSnapshot();
    expect(dockerSnapshot()).toBe(first);
    await first;
    vi.setSystemTime(NOW.getTime() + 1_499);
    expect(dockerSnapshot()).toBe(first);
    expect(exec).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW.getTime() + 1_500);
    const second = dockerSnapshot();
    expect(second).not.toBe(first);
    expect(exec).toHaveBeenCalledTimes(2);

    invalidateDocker();
    const third = dockerSnapshot();
    expect(third).not.toBe(second);
    expect(exec).toHaveBeenCalledTimes(3);
    await third;
  });

  it("asks inspect whether recent SIGKILLs in projects were out of memory", async () => {
    const lines = [
      psLine({ id: "oom", name: "api-worker-1", state: "exited", status: "Exited (137) 2 hours ago", stack: "api", service: "worker", dir: alphaApi }),
      psLine({ id: "kill", name: "api-web-1", state: "exited", status: "Exited (137) 3 hours ago", stack: "api", service: "web", dir: alphaApi }),
      psLine({ id: "slow", name: "api-job-1", state: "exited", status: "Exited (137) 4 hours ago", stack: "api", service: "job", dir: alphaApi }),
      // Not inspected: too old, not in a project, or a different exit.
      psLine({ id: "old", name: "api-old-1", state: "exited", status: "Exited (137) 2 days ago", stack: "api", service: "old", dir: alphaApi }),
      psLine({ id: "outside", name: "x-1", state: "exited", status: "Exited (137) 1 hour ago", dir: "/elsewhere" }),
      psLine({ id: "err", name: "api-err-1", state: "exited", status: "Exited (1) 1 hour ago", stack: "api", service: "err", dir: alphaApi }),
    ];
    exec.mockImplementation((_cmd, args) => {
      if (args[0] === "ps") return ok(lines.join("\n"));
      const id = args[args.length - 1];
      if (id === "oom") return ok("true 2026-06-01T10:01:02.123456789Z\n");
      if (id === "kill") return ok("false 0001-01-01T00:00:00Z\n");
      return fail({ killed: true }, "timed out");
    });
    const { dockerSnapshot } = await load();
    const snap = await dockerSnapshot();

    const inspected = exec.mock.calls.filter(([, args]) => args[0] === "inspect");
    expect(inspected.map(([, args]) => args[args.length - 1]).sort()).toEqual(["kill", "oom", "slow"]);
    expect(inspected[0][1]).toEqual(["inspect", "--format", "{{.State.OOMKilled}} {{.State.FinishedAt}}", expect.any(String)]);
    expect(inspected[0][2]).toEqual({ timeout: 2_000, windowsHide: true });

    const byId = new Map(snap.containers.map((c) => [c.id, c]));
    expect(byId.get("oom")).toMatchObject({ oomKilled: true, finishedAt: "2026-06-01T10:01:02.123456789Z" });
    expect(byId.get("kill")).toMatchObject({ oomKilled: false, finishedAt: ago(3 * HOUR) });
    expect(byId.get("slow")).toMatchObject({ oomKilled: false, finishedAt: ago(4 * HOUR) });
    expect(byId.get("old")).toMatchObject({ oomKilled: false });
  });

  it("keeps the estimated finish time when inspect gives none", async () => {
    exec.mockImplementation((_cmd, args) =>
      args[0] === "ps"
        ? ok(psLine({ id: "w", state: "exited", status: "Exited (137) 5 minutes ago", stack: "api", dir: alphaApi }))
        : ok("true\n")
    );
    const { dockerSnapshot } = await load();
    expect((await dockerSnapshot()).containers[0]).toMatchObject({ oomKilled: true, finishedAt: ago(300_000) });
  });
});

describe("isUp", () => {
  it.each([
    ["running", true],
    ["restarting", true],
    ["paused", true],
    ["exited", false],
    ["created", false],
    ["dead", false],
  ])("%s → %s", async (state, up) => {
    const { isUp } = await load();
    expect(isUp({ state })).toBe(up);
  });
});

describe("containerProblems", () => {
  it("flags restart loops and failing health checks", async () => {
    const { containerProblems } = await load();
    const problems = containerProblems([
      container({ name: "app-web-1", state: "restarting", startedAt: null }),
      container({ name: "app-db-1", service: "db", health: "unhealthy" }),
      container({ name: "app-cache-1", service: "cache", health: "healthy" }),
    ]);
    expect(problems).toEqual(
      new Map([
        [
          "alpha",
          [
            { stack: "app", service: "web", kind: "restarting", exitCode: null },
            { stack: "app", service: "db", kind: "unhealthy", exitCode: null },
          ],
        ],
      ])
    );
  });

  it("flags error exits from the last day", async () => {
    const { containerProblems } = await load();
    const problems = containerProblems([
      container({ name: "solo", stack: null, service: null, state: "exited", exitCode: 1, finishedAt: ago(23 * HOUR), startedAt: null }),
      container({ name: "gone", stack: null, service: null, state: "exited", exitCode: 1, finishedAt: ago(25 * HOUR), startedAt: null }),
    ]);
    expect(problems.get("alpha")).toEqual([{ stack: "solo", service: "solo", kind: "exited", exitCode: 1 }]);
  });

  it("flags older exits that happened while the rest of the stack is up", async () => {
    const { containerProblems } = await load();
    const problems = containerProblems([
      container({ name: "api-1", service: "api", startedAt: ago(5 * DAY) }),
      container({ name: "db-1", service: "db", state: "paused", startedAt: ago(3 * DAY) }),
      container({ name: "job-1", service: "job", state: "exited", exitCode: 2, startedAt: null, finishedAt: ago(4 * DAY) }),
      // Before the stack came up: an earlier run.
      container({ name: "old-1", service: "old", state: "exited", exitCode: 2, startedAt: null, finishedAt: ago(6 * DAY) }),
      // A different stack in the same project isn't up.
      container({ name: "other-1", stack: "other", service: "x", state: "exited", exitCode: 2, startedAt: null, finishedAt: ago(4 * DAY) }),
    ]);
    expect(problems.get("alpha")).toEqual([{ stack: "app", service: "job", kind: "exited", exitCode: 2 }]);
  });

  it("ignores normal stops unless the kernel killed it for memory", async () => {
    const { containerProblems } = await load();
    const exited = { state: "exited", startedAt: null, finishedAt: ago(HOUR) };
    const problems = containerProblems([
      container({ ...exited, service: "a", exitCode: 0 }),
      container({ ...exited, service: "b", exitCode: 130 }),
      container({ ...exited, service: "c", exitCode: 137 }),
      container({ ...exited, service: "d", exitCode: 143 }),
      container({ ...exited, service: "e", exitCode: 137, oomKilled: true }),
      container({ ...exited, service: "f", exitCode: 1, finishedAt: null }),
    ]);
    expect(problems.get("alpha")).toEqual([{ stack: "app", service: "e", kind: "oom", exitCode: 137 }]);
  });

  it("only looks at containers in projects, grouped by project", async () => {
    const { containerProblems } = await load();
    const problems = containerProblems(
      [
        container({ project: null, state: "restarting" }),
        container({ project: "beta", state: "restarting", service: "b" }),
        container({ project: "alpha", state: "restarting", service: "a" }),
        container({ project: "beta", state: "exited", exitCode: 1, finishedAt: ago(HOUR), service: "c" }),
      ],
      NOW.getTime()
    );
    expect([...problems.keys()]).toEqual(["beta", "alpha"]);
    expect(problems.get("beta")!.map((p) => p.service)).toEqual(["b", "c"]);
  });

  it("uses the given clock", async () => {
    const { containerProblems } = await load();
    const c = container({ state: "exited", exitCode: 1, startedAt: null, finishedAt: ago(HOUR) });
    expect(containerProblems([c], NOW.getTime() + 2 * DAY).size).toBe(0);
  });
});

describe("problemKinds", () => {
  it("judges containers outside projects by the same rules, a stack per folder", async () => {
    const { problemKinds } = await load();
    const other = { project: null, stack: "tools", workingDir: "/elsewhere/tools" };
    const loop = container({ ...other, name: "tools-loop-1", state: "restarting", startedAt: null });
    const up = container({ ...other, name: "tools-api-1", startedAt: ago(5 * DAY) });
    // Exited during the stack's current run, days ago: still a problem.
    const job = container({ ...other, name: "tools-job-1", state: "exited", exitCode: 2, startedAt: null, finishedAt: ago(4 * DAY) });
    // Same compose name in another folder that isn't up: an old exit there is history.
    const elsewhere = container({ ...other, workingDir: "/other/tools", name: "tools-job-2", state: "exited", exitCode: 2, startedAt: null, finishedAt: ago(4 * DAY) });
    const loose = container({ project: null, stack: null, service: null, workingDir: null, name: "qdrant", state: "exited", exitCode: 1, startedAt: null, finishedAt: ago(HOUR) });
    const kinds = problemKinds([loop, up, job, elsewhere, loose]);
    expect(kinds.get(loop)).toEqual({ kind: "restarting", exitCode: null });
    expect(kinds.get(job)).toEqual({ kind: "exited", exitCode: 2 });
    expect(kinds.get(loose)).toEqual({ kind: "exited", exitCode: 1 });
    expect(kinds.has(up)).toBe(false);
    expect(kinds.has(elsewhere)).toBe(false);
  });
});

describe("composeConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(projects, "Cfg Proj."));
    fs.writeFileSync(path.join(dir, "compose.yaml"), "services: {}\n");
  });

  it("reads services and whether one builds the folder", async () => {
    exec.mockImplementation(() =>
      ok(JSON.stringify({ name: "shop", services: { web: { build: { context: dir } }, db: { image: "postgres" } } }))
    );
    const { composeConfig } = await load();
    const config = await composeConfig(dir, "compose.yaml");
    expect(exec).toHaveBeenCalledWith("docker", ["compose", "config", "--format", "json"], { cwd: dir, timeout: 15_000, windowsHide: true });
    expect(config).toEqual({
      mtimeMs: fs.statSync(path.join(dir, "compose.yaml")).mtimeMs,
      name: "shop",
      services: ["web", "db"],
      buildsDir: true,
      error: null,
      at: NOW.getTime(),
    });
  });

  it("resolves relative build contexts", async () => {
    exec.mockImplementation(() => ok(JSON.stringify({ name: "x", services: { web: { build: { context: "." } } } })));
    const { composeConfig } = await load();
    expect((await composeConfig(dir, "compose.yaml")).buildsDir).toBe(true);
  });

  it("doesn't count builds of other folders or image-only services", async () => {
    exec.mockImplementation(() =>
      ok(JSON.stringify({ name: "x", services: { api: { build: { context: "./api" } }, b: { build: {} }, c: {} } }))
    );
    const { composeConfig } = await load();
    expect(await composeConfig(dir, "compose.yaml")).toMatchObject({ services: ["api", "b", "c"], buildsDir: false });
  });

  it("falls back to Compose's default name and no services", async () => {
    exec.mockImplementation(() => ok("{}"));
    const { composeConfig } = await load();
    const expected = path.basename(dir).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    expect(expected.startsWith("cfgproj")).toBe(true);
    expect(await composeConfig(dir, "compose.yaml")).toMatchObject({ name: expected, services: [], buildsDir: false, error: null });
  });

  it("caches until the compose file changes", async () => {
    exec.mockImplementation(() => ok(JSON.stringify({ name: "one", services: {} })));
    const { composeConfig } = await load();
    const first = await composeConfig(dir, "compose.yaml");
    vi.setSystemTime(NOW.getTime() + DAY);
    expect(await composeConfig(dir, "compose.yaml")).toBe(first);
    expect(exec).toHaveBeenCalledTimes(1);

    exec.mockImplementation(() => ok(JSON.stringify({ name: "two", services: {} })));
    const file = path.join(dir, "compose.yaml");
    fs.utimesSync(file, new Date("2025-01-01"), new Date("2025-01-01"));
    expect((await composeConfig(dir, "compose.yaml")).name).toBe("two");
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("reports failures with the folder shortened, and retries them after 30s", async () => {
    exec.mockImplementation(() =>
      fail({ stderr: `validating ${dir}/compose.yaml: services.web.ports must be a list\n` })
    );
    const { composeConfig } = await load();
    const failed = await composeConfig(dir, "compose.yaml");
    expect(failed).toMatchObject({
      services: [],
      buildsDir: false,
      error: "validating ./compose.yaml: services.web.ports must be a list",
    });
    expect(failed.name).toBe(path.basename(dir).toLowerCase().replace(/[^a-z0-9_-]/g, ""));

    vi.setSystemTime(NOW.getTime() + 29_999);
    expect(await composeConfig(dir, "compose.yaml")).toBe(failed);
    expect(exec).toHaveBeenCalledTimes(1);

    exec.mockImplementation(() => ok(JSON.stringify({ name: "fixed", services: { web: {} } })));
    vi.setSystemTime(NOW.getTime() + 30_000);
    expect(await composeConfig(dir, "compose.yaml")).toMatchObject({ name: "fixed", error: null });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("reports malformed JSON", async () => {
    exec.mockImplementation(() => ok("not json"));
    const { composeConfig } = await load();
    expect((await composeConfig(dir, "compose.yaml")).error).toMatch(/JSON/);
  });

  it("throws when the compose file is gone", async () => {
    const { composeConfig } = await load();
    await expect(composeConfig(dir, "missing.yaml")).rejects.toThrow(/ENOENT/);
  });
});

describe("projectStacks", () => {
  let n = 0;
  let project: string;
  let projectDir: string;

  const write = (rel: string, text = "services: {}\n") => {
    const full = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
  };

  // `docker compose config` answers by folder: the stack is named after it.
  const composeByDir = (services: Record<string, string[]> = {}) =>
    exec.mockImplementation((_cmd, args, opts) => {
      if (args[0] !== "compose") return fail({}, "unexpected");
      const dir = opts.cwd as string;
      const name = path.basename(dir);
      return ok(JSON.stringify({ name, services: Object.fromEntries((services[name] ?? []).map((s) => [s, {}])) }));
    });

  beforeEach(() => {
    project = `proj${++n}`;
    projectDir = path.join(projects, project);
    fs.mkdirSync(projectDir, { recursive: true });
  });

  const snap = (containers: Container[]) => ({ daemon: running, containers });

  it("finds compose files in the project and two levels below, skipping build and hidden folders", async () => {
    write("compose.yaml");
    write("api/docker-compose.yml");
    write("services/db/compose.yml");
    write("services/db/deep/compose.yaml"); // three levels: too deep
    write("node_modules/pkg/compose.yaml");
    write(".devcontainer/compose.yaml");
    write("vendor/compose.yaml");
    write("web/README.md", "");
    composeByDir({ [project]: ["app"], api: ["api", "db"] });

    const { projectStacks } = await load();
    const stacks = await projectStacks(project, projectDir, snap([]));

    expect(stacks.map((s) => [s.dir, s.name, s.files, s.primary, s.fromFiles])).toEqual([
      ["", project, ["compose.yaml"], true, true],
      ["api", "api", ["docker-compose.yml"], false, true],
      [path.join("services", "db"), "db", ["compose.yml"], false, true],
    ]);
    expect(stacks[1].services.map((s) => [s.name, s.state, s.container])).toEqual([
      ["api", "not created", null],
      ["db", "not created", null],
    ]);
    expect(stacks[1]).toMatchObject({ absDir: path.join(projectDir, "api"), explicitFiles: false, error: null, conflict: null });
    const cwds = exec.mock.calls.map(([, , opts]) => opts.cwd);
    expect(cwds).not.toContain(path.join(projectDir, "services", "db", "deep"));
  });

  it("prefers compose.yaml when a folder has several", async () => {
    write("docker-compose.yml");
    write("compose.yml");
    composeByDir();
    const { projectStacks } = await load();
    expect((await projectStacks(project, projectDir, snap([])))[0].files).toEqual(["compose.yml"]);
  });

  it("matches running containers to their compose files' stacks", async () => {
    write("compose.yaml");
    composeByDir({ [project]: ["web", "db", "worker"] });
    const web = container({
      id: "w",
      name: `${project}-web-1`,
      stack: project,
      service: "web",
      workingDir: projectDir,
      project,
      ports: [3000],
      image: "app:dev",
      health: "healthy",
    });
    const db = container({ id: "d", name: `${project}-db-1`, stack: project, service: "db", workingDir: projectDir, project, state: "exited", exitCode: 0, startedAt: null, finishedAt: ago(HOUR) });
    const { projectStacks } = await load();
    const [stack] = await projectStacks(project, projectDir, snap([web, db]));
    expect(stack.containers).toEqual([web, db]);
    expect(stack.services).toEqual([
      {
        name: "web",
        container: `${project}-web-1`,
        state: "running",
        health: "healthy",
        exitCode: null,
        oomKilled: false,
        startedAt: web.startedAt,
        finishedAt: null,
        ports: [3000],
        image: "app:dev",
      },
      expect.objectContaining({ name: "db", container: `${project}-db-1`, state: "exited", exitCode: 0 }),
      {
        name: "worker",
        container: null,
        state: "not created",
        health: null,
        exitCode: null,
        oomKilled: false,
        startedAt: null,
        finishedAt: null,
        ports: [],
        image: null,
      },
    ]);
  });

  it("adds stacks that only exist as containers, with their label files", async () => {
    const sub = path.join(projectDir, "infra");
    fs.mkdirSync(sub, { recursive: true });
    // Compose files named by the labels: kept if they still exist inside the folder.
    const kept = path.join(sub, "stack.yml");
    fs.writeFileSync(kept, "services: {}\n");
    const outside = path.join(root, "shared.yml");
    fs.writeFileSync(outside, "");
    const containers = [
      container({ id: "1", name: "infra-cache-1", stack: "infra", service: "cache", workingDir: sub, project, configFiles: [kept, path.join(sub, "gone.yml"), outside] }),
      container({ id: "2", name: "infra-queue-1", stack: "infra", service: "queue", workingDir: sub, project, configFiles: [kept] }),
      container({ id: "3", name: "loner", stack: "loner", service: null, workingDir: projectDir, project, configFiles: [] }),
      // Not this project's, or not Compose's.
      container({ id: "4", stack: "infra", workingDir: path.join(projects, "other"), project: "other" }),
      container({ id: "5", stack: null, workingDir: projectDir, project }),
      container({ id: "6", stack: "x", workingDir: null, project }),
    ];
    const { projectStacks } = await load();
    const stacks = await projectStacks(project, projectDir, snap(containers));
    expect(exec).not.toHaveBeenCalled();

    expect(stacks.map((s) => s.name)).toEqual(["loner", "infra"]);
    const [loner, infra] = stacks;
    expect(loner).toMatchObject({ dir: "", absDir: projectDir, files: [], fromFiles: false, explicitFiles: true, primary: false });
    expect(loner.services.map((s) => s.name)).toEqual(["loner"]);
    expect(infra).toMatchObject({ dir: "infra", files: ["stack.yml"], fromFiles: true, explicitFiles: true, error: null });
    expect(infra.services.map((s) => s.name)).toEqual(["cache", "queue"]);
    // Another project's containers use the same Compose project name.
    expect(infra.conflict).toBe("other");
  });

  it("reports a conflict outside the projects folder by its full path", async () => {
    const containers = [
      container({ stack: "dup", workingDir: projectDir, project }),
      container({ id: "x", stack: "dup", workingDir: projects, project: null }),
      container({ id: "y", stack: "dup", workingDir: "/srv/dup", project: null }),
    ];
    const { projectStacks } = await load();
    const [stack] = await projectStacks(project, projectDir, snap(containers));
    // projects itself is relative "" → falls back to the full path.
    expect(stack.conflict).toBe(projects);
  });

  it("keeps two stacks with one name in different folders apart, sorted by folder", async () => {
    write("b/compose.yaml");
    write("a/compose.yaml");
    exec.mockImplementation((_cmd, _args, opts) =>
      ok(JSON.stringify({ name: "same", services: { [path.basename(opts.cwd as string)]: {} } }))
    );
    const { projectStacks } = await load();
    const stacks = await projectStacks(project, projectDir, snap([]));
    expect(stacks.map((s) => [s.dir, s.name, s.services.map((x) => x.name)])).toEqual([
      ["a", "same", ["a"]],
      ["b", "same", ["b"]],
    ]);
  });

  it("sorts stacks in one folder by name", async () => {
    const containers = [
      container({ id: "1", stack: "zeta", workingDir: projectDir, project }),
      container({ id: "2", stack: "alpha", workingDir: projectDir, project }),
    ];
    const { projectStacks } = await load();
    expect((await projectStacks(project, projectDir, snap(containers))).map((s) => s.name)).toEqual(["alpha", "zeta"]);
  });

  it("carries compose errors through", async () => {
    write("compose.yaml");
    exec.mockImplementation(() => fail({ stderr: "yaml: line 3: did not find expected key" }));
    const { projectStacks } = await load();
    const [stack] = await projectStacks(project, projectDir, snap([]));
    expect(stack).toMatchObject({ name: project, error: "yaml: line 3: did not find expected key", services: [] });
  });

  it("loads the snapshot itself when none is given", async () => {
    write("compose.yaml");
    exec.mockImplementation((_cmd, args, opts) => {
      if (args[0] === "ps") {
        return ok(psLine({ id: "p", name: "web-1", stack: project, service: "web", dir: projectDir }) + "\n");
      }
      return ok(JSON.stringify({ name: path.basename(opts.cwd as string), services: { web: {} } }));
    });
    const { projectStacks } = await load();
    const [stack] = await projectStacks(project, projectDir);
    expect(stack.services).toEqual([expect.objectContaining({ name: "web", container: "web-1", state: "running" })]);
  });

  it("rescans the folder only every 10s", async () => {
    write("compose.yaml");
    composeByDir();
    const { projectStacks } = await load();
    expect(await projectStacks(project, projectDir, snap([]))).toHaveLength(1);

    write("api/compose.yaml");
    vi.setSystemTime(NOW.getTime() + 9_999);
    expect(await projectStacks(project, projectDir, snap([]))).toHaveLength(1);
    vi.setSystemTime(NOW.getTime() + 10_000);
    expect(await projectStacks(project, projectDir, snap([]))).toHaveLength(2);
  });

  it("skips folders it can't read", async () => {
    write("compose.yaml");
    write("locked/compose.yaml");
    composeByDir();
    const realReaddir = fs.readdirSync;
    vi.spyOn(fs, "readdirSync").mockImplementation(((p: fs.PathLike, opts: never) => {
      if (String(p) === projectDir) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return realReaddir(p, opts);
    }) as typeof fs.readdirSync);
    const { projectStacks } = await load();
    expect((await projectStacks(project, projectDir, snap([]))).map((s) => s.dir)).toEqual([""]);
  });

  it("is empty for a project with neither files nor containers", async () => {
    const { projectStacks } = await load();
    expect(await projectStacks(project, path.join(projectDir, "missing"), snap([]))).toEqual([]);
  });
});

describe("publicStack", () => {
  it("drops absolute paths and containers", async () => {
    const { publicStack } = await load();
    const detail: StackDetail = {
      name: "app",
      dir: "api",
      absDir: "/abs/api",
      files: ["compose.yaml"],
      services: [],
      primary: false,
      fromFiles: true,
      error: null,
      conflict: "other",
      containers: [container({})],
      explicitFiles: false,
    };
    expect(publicStack(detail)).toEqual({
      name: "app",
      dir: "api",
      files: ["compose.yaml"],
      services: [],
      primary: false,
      fromFiles: true,
      error: null,
      conflict: "other",
    });
  });
});

describe("projectLogs", () => {
  const alpha = path.join(projects, "alpha");

  it("merges recent output from a project's containers in time order", async () => {
    const lines = [
      psLine({ id: "web", name: "alpha-web-1", status: "Up 1 hour (unhealthy)", stack: "alpha", service: "web", dir: alpha }),
      psLine({ id: "db", name: "alpha-db-1", status: "Up 2 hours", stack: "alpha", service: "db", dir: alpha }),
      psLine({ id: "new", name: "alpha-new-1", state: "created", status: "Created", stack: "alpha", service: "new", dir: alpha }),
      psLine({ id: "solo", name: "solo", state: "exited", status: "Exited (1) 5 minutes ago", dir: alpha }),
      psLine({ id: "beta", name: "beta-1", dir: path.join(projects, "beta") }),
    ];
    exec.mockImplementation((_cmd, args) => {
      if (args[0] === "ps") return ok(lines.join("\n"));
      const id = args[args.length - 1];
      if (id === "web") {
        return ok(
          [
            "2026-06-01T11:00:02.000000000Z \x1b[32mGET /\x1b[0m 200",
            "2026-06-01T11:00:04.000000000Z done",
            "not a log line",
            "",
          ].join("\n"),
          "2026-06-01T11:00:03.000000000Z \x1b]0;title\x07warning: slow\n"
        );
      }
      if (id === "db") return ok("2026-06-01T11:00:01.000000000Z ready\n2026-06-01T11:00:05Z\n");
      // Exited container whose logs call fails partway.
      return fail({ stdout: "2026-06-01T10:00:00.5Z boom\n", stderr: "" });
    });
    const { projectLogs } = await load();
    const logs = await projectLogs("alpha", null);

    const logCalls = exec.mock.calls.filter(([, args]) => args[0] === "logs");
    expect(logCalls.map(([, args]) => args)).toEqual(
      expect.arrayContaining([["logs", "--timestamps", "--tail", "300", "web"]])
    );
    expect(logCalls).toHaveLength(3);
    expect(logCalls[0][2]).toMatchObject({ timeout: 10_000 });

    expect(logs.docker).toEqual(running);
    // Up first, most recently started first; created containers have no logs.
    expect(logs.containers).toEqual([
      { name: "alpha-web-1", service: "web", stack: "alpha", state: "running", health: "unhealthy" },
      { name: "alpha-db-1", service: "db", stack: "alpha", state: "running", health: null },
      { name: "solo", service: "solo", stack: "solo", state: "exited", health: null },
    ]);
    expect(logs.lines).toEqual([
      { ts: "2026-06-01T10:00:00.5Z", container: "solo", service: "solo", stream: "out", text: "boom" },
      { ts: "2026-06-01T11:00:01.000000000Z", container: "alpha-db-1", service: "db", stream: "out", text: "ready" },
      { ts: "2026-06-01T11:00:02.000000000Z", container: "alpha-web-1", service: "web", stream: "out", text: "GET / 200" },
      { ts: "2026-06-01T11:00:03.000000000Z", container: "alpha-web-1", service: "web", stream: "err", text: "warning: slow" },
      { ts: "2026-06-01T11:00:04.000000000Z", container: "alpha-web-1", service: "web", stream: "out", text: "done" },
      { ts: "2026-06-01T11:00:05Z", container: "alpha-db-1", service: "db", stream: "out", text: "" },
    ]);
  });

  // Lines with "\r" (CRLF output from tty containers, progress bars) used to be
  // dropped: TS_LINE's `.*$` couldn't match past a carriage return.
  it("keeps lines with carriage returns, showing the last redraw", async () => {
    exec.mockImplementation((_cmd, args) =>
      args[0] === "ps"
        ? ok(psLine({ id: "w", stack: "alpha", service: "web", dir: alpha }))
        : ok("2026-06-01T11:00:04Z progress 10%\rprogress 100%\r\n2026-06-01T11:00:05Z crlf line\r\n")
    );
    const { projectLogs } = await load();
    const logs = await projectLogs("alpha", null);
    expect(logs.lines.map((l) => l.text)).toEqual(["progress 100%", "crlf line"]);
  });

  it("passes a valid since and ignores anything else", async () => {
    exec.mockImplementation((_cmd, args) =>
      args[0] === "ps" ? ok(psLine({ id: "w", stack: "alpha", service: "web", dir: alpha })) : ok("")
    );
    const { projectLogs, invalidateDocker } = await load();
    await projectLogs("alpha", "2026-06-01T11:00:00.123456789Z");
    expect(exec.mock.calls.at(-1)![1]).toEqual(["logs", "--timestamps", "--tail", "300", "--since", "2026-06-01T11:00:00.123456789Z", "w"]);

    invalidateDocker();
    await projectLogs("alpha", "5m; rm -rf /");
    expect(exec.mock.calls.at(-1)![1]).toEqual(["logs", "--timestamps", "--tail", "300", "w"]);
  });

  it("orders containers without a known start last and keeps same-time lines", async () => {
    const lines = [
      psLine({ id: "a", name: "a", status: "Up for a bit", stack: "alpha", service: "a", dir: alpha }),
      psLine({ id: "b", name: "b", status: "Up 5 minutes", stack: "alpha", service: "b", dir: alpha }),
      psLine({ id: "c", name: "c", status: "Up for a while", stack: "alpha", service: "c", dir: alpha }),
    ];
    exec.mockImplementation((_cmd, args) => {
      if (args[0] === "ps") return ok(lines.join("\n"));
      const id = args[args.length - 1];
      return ok(`2026-06-01T11:00:00.000000000Z from ${id}\n`);
    });
    const { projectLogs } = await load();
    const logs = await projectLogs("alpha", null);
    expect(logs.containers.map((c) => c.name)).toEqual(["b", "a", "c"]);
    expect(logs.lines.map((l) => l.text).sort()).toEqual(["from a", "from b", "from c"]);
  });

  it("drops output from a failed logs call with nothing on stdout", async () => {
    exec.mockImplementation((_cmd, args) =>
      args[0] === "ps" ? ok(psLine({ id: "w", stack: "alpha", service: "web", dir: alpha })) : fail({ stderr: "Error: No such container: w" })
    );
    const { projectLogs } = await load();
    const logs = await projectLogs("alpha", null);
    expect(logs.lines).toEqual([]);
    expect(logs.containers).toHaveLength(1);
  });

  it("caps containers at 12 and lines at the newest 2000", async () => {
    const ps = Array.from({ length: 14 }, (_, i) =>
      psLine({ id: `c${i}`, name: `c${i}`, status: `Up ${i + 1} minutes`, stack: "alpha", service: `s${i}`, dir: alpha })
    );
    const ts = (i: number) => new Date(Date.UTC(2026, 5, 1, 0, 0, 0) + i * 1000).toISOString().replace(".000Z", ".000000000Z");
    exec.mockImplementation((_cmd, args) => {
      if (args[0] === "ps") return ok(ps.join("\n"));
      const k = Number(args[args.length - 1].slice(1));
      return ok(Array.from({ length: 200 }, (_, j) => `${ts(k * 200 + j)} line ${k}-${j}`).join("\n"));
    });
    const { projectLogs } = await load();
    const logs = await projectLogs("alpha", null);
    // Most recently started first: c0 (1 minute) … c11; c12 and c13 dropped.
    expect(logs.containers.map((c) => c.name)).toEqual(Array.from({ length: 12 }, (_, i) => `c${i}`));
    expect(logs.lines).toHaveLength(2000);
    // 12 × 200 lines: the oldest 400 (c0 and c1) are dropped.
    expect(logs.lines[0].text).toBe("line 2-0");
    expect(logs.lines.at(-1)!.text).toBe("line 11-199");
  });

  it("reports the daemon when Docker is down", async () => {
    exec.mockImplementation(() => fail({ code: "ENOENT" }));
    const { projectLogs } = await load();
    expect(await projectLogs("alpha", null)).toEqual({
      containers: [],
      lines: [],
      docker: { state: "missing", message: "The Docker CLI isn't installed (or isn't on PATH).", app: "Docker" },
    });
  });
});

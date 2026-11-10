import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every docker call goes through promisify(execFile), mocked here as in
// docker.test.ts: `docker ps`, `docker stats` and friends answer from the
// fixtures below, and nothing reaches the real CLI. docker.ts itself is real,
// so the snapshot, problems and project matching are exercised end to end.
type Exec = (cmd: string, args: string[], opts: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }>;
const exec = vi.hoisted(() => vi.fn<Exec>());
vi.mock("child_process", async () => {
  const { promisify: p } = await import("util");
  const execFile = Object.assign(() => {
    throw new Error("execFile called without promisify");
  }, { [p.custom]: exec });
  return { execFile, spawn: vi.fn(), default: { execFile, spawn: vi.fn() } };
});

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-containers-")));
const dataDir = path.join(root, "data");
const projects = path.join(root, "projects");
for (const p of ["amplen-rebrand/amplen-dev", "chat"]) fs.mkdirSync(path.join(projects, p), { recursive: true });

const NOW = new Date("2026-11-09T12:00:00.000Z");
const realPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: platform, configurable: true });

const id = (n: number) => `${n.toString(16).padStart(2, "0")}cf`.repeat(16);
const ok = (stdout: string, stderr = "") => Promise.resolve({ stdout, stderr });
const fail = (props: Record<string, unknown>, message = "Command failed") => Promise.reject(Object.assign(new Error(message), props));

interface PsRow {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports?: string;
  stack?: string;
  service?: string;
  dir?: string;
}

/** One `docker ps` line, in docker.ts's tab-separated format. */
const psLine = (r: PsRow) => [r.id, r.name, r.image, r.state, r.status, r.ports ?? "", r.stack ?? "", r.service ?? "", r.dir ?? "", r.dir ? path.join(r.dir, "compose.yaml") : ""].join("\t");

const amplenDir = path.join(projects, "amplen-rebrand", "amplen-dev");
const semaphoreDir = path.join(os.homedir(), "IdeaProjects", "semaphore");
const PS: Record<string, PsRow> = {
  api: { id: id(1), name: "amplen-api-1", image: "amplen-api", state: "running", status: "Up 6 hours (healthy)", ports: "0.0.0.0:3002->3002/tcp, [::]:3002->3002/tcp", stack: "amplen", service: "api", dir: amplenDir },
  db: { id: id(2), name: "amplen-db-1", image: "postgres:17", state: "running", status: "Up 6 hours (unhealthy)", ports: "0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp", stack: "amplen", service: "db", dir: amplenDir },
  migrate: { id: id(3), name: "amplen-migrate-1", image: "amplen-migrate", state: "exited", status: "Exited (0) 16 hours ago", stack: "amplen", service: "migrate", dir: amplenDir },
  chat: { id: id(4), name: "chat-db-1", image: "postgres:17", state: "exited", status: "Exited (0) 4 weeks ago", stack: "chat", service: "db", dir: path.join(projects, "chat") },
  // In the projects folder, but "web" isn't a project (any more): no project owns it.
  portland: { id: id(5), name: "portland-api-db-1", image: "postgres:17", state: "exited", status: "Exited (0) 4 weeks ago", stack: "portland-api", service: "db", dir: path.join(projects, "web", "api") },
  semaphore: { id: id(6), name: "semaphore-postgres-1", image: "postgres:16-alpine", state: "running", status: "Up 2 days", ports: "0.0.0.0:5432->5432/tcp", stack: "semaphore", service: "postgres", dir: semaphoreDir },
  qdrant: { id: id(7), name: "unruffled_agnesi", image: "qdrant/qdrant", state: "exited", status: "Exited (143) 6 weeks ago" },
  loop: { id: id(8), name: "crashy", image: "busybox", state: "restarting", status: "Restarting (1) 5 seconds ago" },
};

const STATS = [
  `{"BlockIO":"78.1MB / 0B","CPUPerc":"9.87%","Container":"${id(1)}","ID":"${id(1).slice(0, 12)}","MemPerc":"1.62%","MemUsage":"128.2MiB / 7.745GiB","Name":"amplen-api-1","NetIO":"988kB / 1.09MB","PIDs":"11"}`,
  `{"BlockIO":"1.7MB / 0B","CPUPerc":"0.00%","Container":"${id(2)}","ID":"${id(2).slice(0, 12)}","MemPerc":"0.19%","MemUsage":"14.75MiB / 7.745GiB","Name":"amplen-db-1","NetIO":"15.1kB / 13.3kB","PIDs":"13"}`,
  `{"BlockIO":"--","CPUPerc":"--","Container":"${id(8)}","ID":"${id(8).slice(0, 12)}","MemPerc":"--","MemUsage":"-- / --","Name":"crashy","NetIO":"--","PIDs":"0"}`,
  // Docker leaving fields out: nothing to report for it.
  `{"ID":"${id(6).slice(0, 12)}"}`,
  // Started since the snapshot: not in it, so left out.
  `{"CPUPerc":"1.00%","ID":"ffffffffffff","MemUsage":"1MiB / 1GiB"}`,
  "not json",
  `{"CPUPerc":"1.00%"}`,
  "",
].join("\n");

let rows: PsRow[];

/** Answer docker calls from the fixtures; `extra` handles anything else (stop, rm, stats). */
function dockerAnswers(extra: (args: string[]) => Promise<{ stdout: string; stderr: string }> = () => fail({}, "unexpected docker call")) {
  exec.mockImplementation((cmd, args) => {
    if (cmd !== "docker") return fail({}, `unexpected ${cmd}`);
    if (args[0] === "ps") return ok(rows.map(psLine).join("\n") + "\n");
    if (args[0] === "stats") return ok(STATS);
    return extra(args);
  });
}

async function load() {
  vi.resetModules();
  return import("./containers");
}

beforeEach(() => {
  vi.stubEnv("WORKBENCH_DATA_DIR", dataDir);
  vi.stubEnv("WORKBENCH_PROJECTS_DIR", projects);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setPlatform("darwin");
  rows = Object.values(PS);
  exec.mockReset();
  dockerAnswers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setPlatform(realPlatform);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const names = (g: { stacks: { containers: { name: string }[] }[] }) => g.stacks.flatMap((s) => s.containers.map((c) => c.name));

describe("listContainers", () => {
  it("groups by project, then stack, with containers outside projects in a group of their own", async () => {
    const { listContainers } = await load();
    const { docker, groups } = await listContainers();
    expect(docker.state).toBe("running");
    // Problems first (amplen's db is unhealthy; crashy is restarting), "no project" after equals; chat is only stopped.
    expect(groups.map((g) => g.project)).toEqual(["amplen-rebrand", null, "chat"]);

    const [amplen, other, chat] = groups;
    expect(amplen.stacks).toHaveLength(1);
    expect(amplen.stacks[0]).toMatchObject({ name: "amplen", dir: "amplen-dev" });
    // The unhealthy one first, then what's up, then stopped.
    expect(names(amplen)).toEqual(["amplen-db-1", "amplen-api-1", "amplen-migrate-1"]);
    expect(amplen.stacks[0].containers[0]).toEqual({
      id: id(2),
      name: "amplen-db-1",
      image: "postgres:17",
      state: "running",
      health: "unhealthy",
      exitCode: null,
      oomKilled: false,
      startedAt: new Date(NOW.getTime() - 6 * 3_600_000).toISOString(),
      finishedAt: null,
      ports: [5433],
      service: "db",
      problem: "unhealthy",
    });
    expect(amplen.stacks[0].containers[1]).toMatchObject({ health: "healthy", ports: [3002], problem: null });
    expect(amplen.stacks[0].containers[2]).toMatchObject({ state: "exited", exitCode: 0, problem: null });

    expect(chat.stacks).toEqual([expect.objectContaining({ name: "chat", dir: "" })]);

    // Others: compose stacks by name with the folder they ran from (~ for home), loose containers last.
    expect(other.stacks.map((s) => [s.name, s.dir])).toEqual([
      [null, null],
      ["semaphore", `~${path.sep}${path.join("IdeaProjects", "semaphore")}`],
      ["portland-api", path.join(projects, "web", "api")],
    ]);
    expect(names(other)).toEqual(["crashy", "unruffled_agnesi", "semaphore-postgres-1", "portland-api-db-1"]);
    expect(other.stacks[0].containers[0]).toMatchObject({ state: "restarting", problem: "restarting" });
    // A SIGTERM exit weeks ago is history, not a problem.
    expect(other.stacks[0].containers[1]).toMatchObject({ exitCode: 143, problem: null });
  });

  it("orders groups with nothing wrong by what's running, then name", async () => {
    rows = [PS.chat, PS.semaphore, PS.migrate, PS.portland];
    const { listContainers } = await load();
    const { groups } = await listContainers();
    expect(groups.map((g) => g.project)).toEqual([null, "amplen-rebrand", "chat"]);
    expect(names(groups[0])).toEqual(["semaphore-postgres-1", "portland-api-db-1"]);
  });

  it("breaks ties by name: stacks by name and folder, loose containers after them", async () => {
    const stopped = { state: "exited", status: "Exited (0) 3 weeks ago" };
    rows = [
      { ...stopped, id: id(20), name: "zeta", image: "busybox" },
      { ...stopped, id: id(21), name: "tools-b-1", image: "x", stack: "tools", service: "b", dir: "/srv/two" },
      { ...stopped, id: id(22), name: "alpha", image: "busybox" },
      { ...stopped, id: id(23), name: "tools-a-1", image: "x", stack: "tools", service: "a", dir: "/srv/one" },
      { ...stopped, id: id(24), name: "api-z-1", image: "x", stack: "api", service: "z", dir: "/srv/api" },
      { ...stopped, id: id(25), name: "api-a-1", image: "x", stack: "api", service: "a", dir: "/srv/api" },
    ];
    const { listContainers } = await load();
    const [other] = (await listContainers()).groups;
    expect(other.stacks.map((s) => [s.name, s.dir])).toEqual([
      ["api", "/srv/api"],
      ["tools", "/srv/one"],
      ["tools", "/srv/two"],
      [null, null],
    ]);
    expect(names(other)).toEqual(["api-a-1", "api-z-1", "tools-a-1", "tools-b-1", "alpha", "zeta"]);
  });

  it("puts workbench's own checkout with the others: it isn't a project", async () => {
    vi.stubEnv("WORKBENCH_PROJECTS_DIR", path.dirname(process.cwd()));
    rows = [{ ...PS.api, dir: process.cwd() }];
    const { listContainers } = await load();
    const { groups } = await listContainers();
    expect(groups).toHaveLength(1);
    expect(groups[0].project).toBeNull();
  });

  it("reports the daemon and no containers when Docker isn't running", async () => {
    exec.mockImplementation(() => fail({ stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" }));
    const { listContainers } = await load();
    const { docker, groups } = await listContainers();
    expect(docker.state).toBe("stopped");
    expect(groups).toEqual([]);
  });

  it("is empty when Docker has no containers", async () => {
    rows = [];
    const { listContainers } = await load();
    expect((await listContainers()).groups).toEqual([]);
  });
});

describe("parseSize and parsePercent", () => {
  it.each([
    ["128.2MiB", Math.round(128.2 * 1024 ** 2)],
    ["7.745GiB", Math.round(7.745 * 1024 ** 3)],
    ["1.5kB", 1500],
    ["0B", 0],
    [" 2 MB ", 2_000_000],
    ["1TiB", 1024 ** 4],
    ["--", null],
    ["", null],
    ["12 parsecs", null],
  ])("parseSize(%j) is %j", async (text, bytes) => {
    const { parseSize } = await load();
    expect(parseSize(text)).toBe(bytes);
  });

  it.each([
    ["9.87%", 9.87],
    ["0.00%", 0],
    ["212.5%", 212.5],
    ["--", null],
    ["", null],
  ])("parsePercent(%j) is %j", async (text, value) => {
    const { parsePercent } = await load();
    expect(parsePercent(text)).toBe(value);
  });
});

describe("containerUsage", () => {
  it("samples docker stats once and matches each row to a container by its short id", async () => {
    const { containerUsage } = await load();
    const result = await containerUsage();
    expect(result).toEqual({
      at: NOW.toISOString(),
      error: null,
      usage: {
        [id(1)]: { cpu: 9.87, memory: Math.round(128.2 * 1024 ** 2), memoryLimit: Math.round(7.745 * 1024 ** 3) },
        [id(2)]: { cpu: 0, memory: Math.round(14.75 * 1024 ** 2), memoryLimit: Math.round(7.745 * 1024 ** 3) },
        [id(6)]: { cpu: null, memory: null, memoryLimit: null },
        [id(8)]: { cpu: null, memory: null, memoryLimit: null },
      },
    });
    const stats = exec.mock.calls.filter(([, args]) => args[0] === "stats");
    expect(stats).toEqual([["docker", ["stats", "--no-stream", "--format", "{{json .}}"], expect.objectContaining({ windowsHide: true, timeout: 20_000 })]]);
  });

  it("shares one sample between callers for a few seconds", async () => {
    const { containerUsage } = await load();
    const [a, b] = await Promise.all([containerUsage(), containerUsage()]);
    expect(a).toBe(b);
    vi.setSystemTime(NOW.getTime() + 4_000);
    await containerUsage();
    expect(exec.mock.calls.filter(([, args]) => args[0] === "stats")).toHaveLength(1);
    vi.setSystemTime(NOW.getTime() + 6_000);
    await containerUsage();
    expect(exec.mock.calls.filter(([, args]) => args[0] === "stats")).toHaveLength(2);
  });

  it("skips stats when nothing is running", async () => {
    rows = [PS.chat, PS.qdrant];
    const { containerUsage } = await load();
    expect(await containerUsage()).toEqual({ at: NOW.toISOString(), usage: {}, error: null });
    expect(exec.mock.calls.some(([, args]) => args[0] === "stats")).toBe(false);
  });

  it("says why when Docker is down or stats fails", async () => {
    exec.mockImplementation(() => fail({ code: "ENOENT" }, "spawn docker ENOENT"));
    let { containerUsage } = await load();
    expect(await containerUsage()).toEqual({ at: NOW.toISOString(), usage: {}, error: "The Docker CLI isn't installed (or isn't on PATH)." });

    exec.mockReset();
    dockerAnswers();
    exec.mockImplementation((cmd, args) => (args[0] === "ps" ? ok(rows.map(psLine).join("\n")) : fail({ stderr: "Error response from daemon: stats timed out\n" })));
    ({ containerUsage } = await load());
    expect((await containerUsage()).error).toBe("Error response from daemon: stats timed out");
  });
});

describe("otherContainerAction", () => {
  const calls = (verb: string) => exec.mock.calls.filter(([, args]) => args[0] === verb);

  it.each([
    [id(7), "kill", 'action must be "stop" or "remove"'],
    [id(7), undefined, 'action must be "stop" or "remove"'],
    [id(7).slice(0, 12), "remove", "id must be a full container id"],
    [id(7).toUpperCase(), "remove", "id must be a full container id"],
    [`${id(7)}; rm -rf /`, "remove", "id must be a full container id"],
    ["unruffled_agnesi", "remove", "id must be a full container id"],
    [42, "remove", "id must be a full container id"],
  ])("rejects %j / %j before calling docker", async (target, action, message) => {
    const { otherContainerAction } = await load();
    await expect(otherContainerAction(target, action)).rejects.toMatchObject({ status: 400, message });
    expect(exec).not.toHaveBeenCalled();
  });

  it("removes a stopped container from a fresh snapshot, keeping its volumes", async () => {
    dockerAnswers(() => ok(""));
    const { otherContainerAction, listContainers } = await load();
    await listContainers();
    await otherContainerAction(id(7), "remove");
    // The snapshot was re-read before acting, and is dropped after.
    expect(calls("ps")).toHaveLength(2);
    expect(calls("rm")).toEqual([["docker", ["rm", id(7)], expect.objectContaining({ windowsHide: true })]]);
    await listContainers();
    expect(calls("ps")).toHaveLength(3);
  });

  it("stops a running container outside any project", async () => {
    dockerAnswers(() => ok(""));
    const { otherContainerAction } = await load();
    await otherContainerAction(id(6), "stop");
    expect(calls("stop")).toEqual([["docker", ["stop", id(6)], expect.objectContaining({ windowsHide: true, timeout: 60_000 })]]);
  });

  it("drops the usage sample after acting", async () => {
    dockerAnswers(() => ok(""));
    const { otherContainerAction, containerUsage } = await load();
    await containerUsage();
    await otherContainerAction(id(6), "stop");
    await containerUsage();
    expect(calls("stats")).toHaveLength(2);
  });

  it("refuses containers in a project, gone ones, and the wrong state", async () => {
    const { otherContainerAction } = await load();
    await expect(otherContainerAction(id(1), "stop")).rejects.toMatchObject({ status: 403, message: "amplen-api-1 belongs to amplen-rebrand; use its stack's actions" });
    await expect(otherContainerAction(id(99), "stop")).rejects.toMatchObject({ status: 404 });
    await expect(otherContainerAction(id(7), "stop")).rejects.toMatchObject({ status: 409, message: "unruffled_agnesi isn't running" });
    await expect(otherContainerAction(id(6), "remove")).rejects.toMatchObject({ status: 409, message: "Stop semaphore-postgres-1 before removing it" });
    expect(calls("stop")).toHaveLength(0);
    expect(calls("rm")).toHaveLength(0);
  });

  it("still acts on a container whose project folder is gone", async () => {
    dockerAnswers(() => ok(""));
    const { otherContainerAction } = await load();
    await otherContainerAction(id(5), "remove");
    expect(calls("rm")).toEqual([["docker", ["rm", id(5)], expect.anything()]]);
  });

  it("is unavailable while Docker is down", async () => {
    exec.mockImplementation(() => fail({ stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" }));
    const { otherContainerAction } = await load();
    await expect(otherContainerAction(id(7), "remove")).rejects.toMatchObject({ status: 503, message: "Docker isn't running." });
  });

  it("reports docker's own error", async () => {
    dockerAnswers((args) => fail({ stderr: `Error response from daemon: cannot ${args[0]} container\n` }));
    const { otherContainerAction } = await load();
    await expect(otherContainerAction(id(7), "remove")).rejects.toMatchObject({ status: 500, message: "docker rm failed: Error response from daemon: cannot rm container" });
    await expect(otherContainerAction(id(6), "stop")).rejects.toMatchObject({ status: 500, message: "docker stop failed: Error response from daemon: cannot stop container" });
  });

  it("refuses a second action on the same container while one runs", async () => {
    let finish!: () => void;
    dockerAnswers(() => new Promise((resolve) => (finish = () => resolve({ stdout: "", stderr: "" }))));
    const { otherContainerAction } = await load();
    const first = otherContainerAction(id(6), "stop");
    await vi.waitFor(() => expect(calls("stop")).toHaveLength(1));
    await expect(otherContainerAction(id(6), "stop")).rejects.toMatchObject({ status: 409, message: "Already changing semaphore-postgres-1" });
    finish();
    await first;
  });
});

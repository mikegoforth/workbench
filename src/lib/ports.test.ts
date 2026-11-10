import fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Container } from "./docker";
import type { LiveRun } from "./devenv";
import type { DockerDaemon, ListeningPort } from "./types";

// ports.ts runs lsof / ss / ps on macOS and Linux and netstat / PowerShell /
// tasklist on Windows. Every one is faked here: execFile answers from the
// fixtures below (real output of each tool, trimmed), so nothing is run.
const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  which: vi.fn(),
  liveRuns: vi.fn(),
  dockerSnapshot: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: mocks.execFile, default: { ...actual, execFile: mocks.execFile } };
});
vi.mock("./platform", async (importOriginal) => ({ ...(await importOriginal<typeof import("./platform")>()), which: mocks.which }));
vi.mock("./devenv", () => ({ liveRuns: mocks.liveRuns }));
vi.mock("./docker", async (importOriginal) => ({ ...(await importOriginal<typeof import("./docker")>()), dockerSnapshot: mocks.dockerSnapshot }));
vi.mock("./paths", () => ({ projectsDir: () => "/home/me/Projects" }));

import {
  etimeSeconds,
  isLoopback,
  likelyWeb,
  listPorts,
  LSOF_ARGS,
  parseLsof,
  parseLsofCwd,
  parseNetstat,
  parsePs,
  parseSs,
  parseTasklist,
  parseWindowsProcesses,
  PS_FIELDS,
  splitAddress,
  WINDOWS_PROCESSES_SCRIPT,
} from "./ports";

const realPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: platform, configurable: true });

const RUNNING: DockerDaemon = { state: "running", message: null, app: "Docker" };
const SELF = process.pid;
const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

type Reply = { stdout: string } | Error;
let reply: (cmd: string, args: string[]) => Reply;

function fakeExecFile(cmd: string, args: string[], ...rest: unknown[]) {
  const callback = rest.find((a) => typeof a === "function") as (err: Error | null, res?: { stdout: string; stderr: string }) => void;
  const result = reply(cmd, args);
  if (result instanceof Error) callback(result);
  else callback(null, { stdout: result.stdout, stderr: "" });
}

const exited = (stdout: string) => Object.assign(new Error("exited 1"), { stdout });
const missing = (cmd: string) => Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
const callsOf = (cmd: string) => mocks.execFile.mock.calls.filter((c) => c[0] === cmd);

function container(over: Partial<Container> = {}): Container {
  return {
    id: "c1",
    name: "amplen-api-1",
    image: "amplen/api:dev",
    state: "running",
    health: null,
    exitCode: null,
    oomKilled: false,
    startedAt: ago(7200),
    finishedAt: null,
    ports: [3002],
    bindings: [
      { address: "0.0.0.0", port: 3002 },
      { address: "::", port: 3002 },
    ],
    stack: "amplen",
    service: "api",
    workingDir: "/home/me/Projects/amplen/dev",
    configFiles: [],
    project: "amplen",
    ...over,
  };
}

const run = (over: Partial<LiveRun>): LiveRun => ({
  project: "alpha",
  slot: "dev",
  kind: "dev",
  script: null,
  pid: 480,
  startedAt: "2026-11-09T09:00:00.000Z",
  ...over,
});

const row = (ports: ListeningPort[], port: number) => ports.find((p) => p.port === port);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.execFile.mockImplementation(fakeExecFile);
  mocks.liveRuns.mockResolvedValue([]);
  mocks.dockerSnapshot.mockResolvedValue({ daemon: RUNNING, containers: [] });
  mocks.which.mockImplementation((name: string) => `/usr/bin/${name}`);
  reply = (cmd) => new Error(`unexpected ${cmd}`);
  vi.spyOn(process, "getuid").mockReturnValue(501);
  setPlatform("darwin");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setPlatform(realPlatform);
});

// ---- Parsers -----------------------------------------------------------------

describe("splitAddress", () => {
  it("reads IPv4, IPv6, wildcards and interface suffixes", () => {
    expect(splitAddress("127.0.0.1:3000")).toEqual({ address: "127.0.0.1", port: 3000 });
    expect(splitAddress("*:7000")).toEqual({ address: "*", port: 7000 });
    expect(splitAddress("[::1]:5173")).toEqual({ address: "::1", port: 5173 });
    expect(splitAddress("[::]:22")).toEqual({ address: "::", port: 22 });
    expect(splitAddress("127.0.0.53%lo:53")).toEqual({ address: "127.0.0.53", port: 53 });
    expect(splitAddress("[fe80::1%en0]:8080")).toEqual({ address: "fe80::1", port: 8080 });
    expect(splitAddress(":80")).toEqual({ address: "*", port: 80 });
  });

  it("rejects what isn't an address and port", () => {
    expect(splitAddress("bogus")).toBeNull();
    expect(splitAddress("*:0")).toBeNull();
    expect(splitAddress("*:70000")).toBeNull();
  });
});

describe("isLoopback", () => {
  it("knows this machine's own addresses", () => {
    for (const a of ["127.0.0.1", "127.0.0.53", "::1", "::ffff:127.0.0.1", "localhost"]) expect(isLoopback(a)).toBe(true);
    for (const a of ["*", "0.0.0.0", "::", "192.168.1.20", "fe80::1"]) expect(isLoopback(a)).toBe(false);
  });
});

describe("parseLsof", () => {
  it("reads -F pcn output: one listener per socket, under its process", () => {
    const stdout = [
      "p24438",
      "cControlCenter",
      "f9",
      "n*:7000",
      "f10",
      "n*:7000",
      "p50863",
      "cnode",
      "f22",
      "n127.0.0.1:3000",
      "f23",
      "n[::1]:3000",
      "f24",
      "n127.0.0.1:44000->127.0.0.1:5000",
      "f25",
      "nbogus",
      "pnot-a-pid",
      "c",
      "n*:9000",
      "",
    ].join("\n");
    expect(parseLsof(stdout)).toEqual([
      { port: 7000, address: "*", pid: 24438, command: "ControlCenter" },
      { port: 7000, address: "*", pid: 24438, command: "ControlCenter" },
      { port: 3000, address: "127.0.0.1", pid: 50863, command: "node" },
      { port: 3000, address: "::1", pid: 50863, command: "node" },
      { port: 9000, address: "*", pid: null, command: null },
    ]);
  });
});

describe("parseSs", () => {
  it("reads ss -ltnpH, with and without the process", () => {
    const stdout = [
      "LISTEN 0      4096   127.0.0.53%lo:53        0.0.0.0:*",
      'LISTEN 0      511          0.0.0.0:3000      0.0.0.0:*    users:(("node",pid=1234,fd=21))',
      "LISTEN 0      128             [::]:22           [::]:*",
      'LISTEN 0      511                *:5173            *:*    users:(("node",pid=99,fd=30),("node",pid=100,fd=30))',
      'LISTEN 0      50   [::ffff:127.0.0.1]:8080         *:*    users:(("java",pid=77,fd=5))',
      "ESTAB  0      0      127.0.0.1:3000  127.0.0.1:50000",
      "LISTEN 0 1 nonsense *:*",
      "",
    ].join("\n");
    expect(parseSs(stdout)).toEqual([
      { port: 53, address: "127.0.0.53", pid: null, command: null },
      { port: 3000, address: "0.0.0.0", pid: 1234, command: "node" },
      { port: 22, address: "::", pid: null, command: null },
      { port: 5173, address: "*", pid: 99, command: "node" },
      { port: 8080, address: "::ffff:127.0.0.1", pid: 77, command: "java" },
    ]);
  });
});

const NETSTAT = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012",
  "  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       4321",
  "  TCP    127.0.0.1:49678        127.0.0.1:49679        ESTABLISHED     5000",
  "  TCP    [::]:135               [::]:0                 LISTENING       1012",
  "  TCP    [::1]:5173             [::]:0                 ABHÖREN         7777",
  "  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4",
  "  UDP    0.0.0.0:500            *:*                                    3456",
  "",
].join("\r\n");

describe("parseNetstat", () => {
  it("picks TCP listeners (peer port 0) out of netstat -ano, whatever the language", () => {
    expect(parseNetstat(NETSTAT)).toEqual([
      { port: 135, address: "0.0.0.0", pid: 1012, command: null },
      { port: 3000, address: "127.0.0.1", pid: 4321, command: null },
      { port: 135, address: "::", pid: 1012, command: null },
      { port: 5173, address: "::1", pid: 7777, command: null },
      { port: 445, address: "0.0.0.0", pid: 4, command: null },
    ]);
  });
});

describe("etimeSeconds", () => {
  it("reads ps elapsed times", () => {
    expect(etimeSeconds("05:12")).toBe(312);
    expect(etimeSeconds("01:02:03")).toBe(3723);
    expect(etimeSeconds("3-01:02:03")).toBe(3 * 86400 + 3723);
    expect(etimeSeconds("-")).toBeNull();
  });
});

describe("parsePs", () => {
  it("reads pid, parent, group, age and the program's name", () => {
    const stdout = [
      "  501   480   480    01:02:03 /usr/local/bin/node",
      "77868     1 77868 2-00:00:00 /Applications/Docker.app/Contents/MacOS/com.docker.backend",
      "24814 24700 24700      00:10 /Applications/GitHub Desktop.app/Contents/Frameworks/GitHub Desktop Helper (Renderer).app/Contents/MacOS/GitHub Desktop Helper (Renderer)",
      "  600   599   599        ??? node",
      "garbage",
      "",
    ].join("\n");
    const procs = parsePs(stdout, NOW);
    expect(procs.get(501)).toEqual({ ppid: 480, pgid: 480, startedAt: ago(3723), name: "node" });
    expect(procs.get(77868)).toEqual({ ppid: 1, pgid: 77868, startedAt: ago(2 * 86400), name: "com.docker.backend" });
    expect(procs.get(24814)?.name).toBe("GitHub Desktop Helper (Renderer)");
    expect(procs.get(600)?.startedAt).toBeNull();
    expect(procs.size).toBe(4);
  });
});

describe("parseWindowsProcesses", () => {
  it("reads pid|ppid|start|name lines", () => {
    const procs = parseWindowsProcesses("4321|4300|1762682400|node.exe\r\n4|0||System\r\n0|0||System Idle Process\r\nnoise\r\n");
    expect(procs.get(4321)).toEqual({ ppid: 4300, pgid: null, startedAt: "2025-11-09T10:00:00.000Z", name: "node.exe" });
    expect(procs.get(4)).toEqual({ ppid: null, pgid: null, startedAt: null, name: "System" });
    expect(procs.size).toBe(2);
  });
});

describe("parseTasklist", () => {
  it("reads names from tasklist /fo csv /nh", () => {
    const procs = parseTasklist('"System Idle Process","0","Services","0","8 K"\r\n"node.exe","4321","Console","1","45,120 K"\r\n"","9","Console","1","1 K"\r\n');
    expect(procs.get(4321)).toEqual({ ppid: null, pgid: null, startedAt: null, name: "node.exe" });
    expect(procs.get(9)?.name).toBeNull();
    expect(procs.has(0)).toBe(false);
  });
});

describe("parseLsofCwd", () => {
  it("reads each pid's working folder", () => {
    expect(parseLsofCwd("p920\nfcwd\nn/home/me/Projects/beta/web\np930\nfcwd\nn/\nn/extra\n")).toEqual(
      new Map([
        [920, "/home/me/Projects/beta/web"],
        [930, "/"],
      ])
    );
  });
});

describe("likelyWeb", () => {
  const other = { kind: "process", project: null } as const;
  it("guesses from the port, the owner and the process", () => {
    expect(likelyWeb(3000, other, "node")).toBe(true);
    expect(likelyWeb(5173, other, null)).toBe(true);
    expect(likelyWeb(8080, other, null)).toBe(true);
    expect(likelyWeb(5432, other, "postgres")).toBe(false);
    expect(likelyWeb(5000, other, "ControlCenter")).toBe(false);
    expect(likelyWeb(41234, { kind: "run", project: "a", slot: "dev", task: "dev", script: null }, "node")).toBe(true);
    expect(likelyWeb(41234, { kind: "run", project: "a", slot: "script", task: "script", script: "test" }, "node")).toBe(false);
    expect(likelyWeb(9229, { kind: "run", project: "a", slot: "dev", task: "dev", script: null }, "node")).toBe(false);
  });
});

// ---- listPorts ---------------------------------------------------------------

const MAC_LSOF = [
  "p501",
  "cnode",
  "f22",
  "n127.0.0.1:3000",
  "f23",
  "n[::1]:3000",
  "p24438",
  "cControlCenter",
  "f9",
  "n*:7000",
  "f10",
  "n*:7000",
  "f11",
  "n*:5000",
  "p77868",
  "ccom.docke",
  "f100",
  "n*:3002",
  "f101",
  "n*:5433",
  "p900",
  "cpostgres",
  "f5",
  "n127.0.0.1:5432",
  "p910",
  "cPython",
  "f3",
  "n192.168.1.20:8000",
  "p920",
  "cnode",
  "f40",
  "n127.0.0.1:5173",
  "p601",
  "cnode",
  "f12",
  "n*:6006",
  `p${SELF}`,
  "cnode",
  "f30",
  "n*:3101",
  "",
].join("\n");

const MAC_PS = [
  "  501   480   480    01:02:03 /usr/local/bin/node",
  "24438     1 24438 9-00:00:00 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
  "77868     1 77868 2-00:00:00 /Applications/Docker.app/Contents/MacOS/com.docker.backend",
  "  900     1   900 5-00:00:00 /opt/homebrew/opt/postgresql@16/bin/postgres",
  "  910   800   910      10:00 /usr/bin/python3",
  "  920   919   919      00:30 /usr/local/bin/node",
  "  601   600   600      05:00 /usr/local/bin/node",
].join("\n");

function macReplies(over: Partial<Record<"lsof" | "ps" | "cwd", Reply>> = {}) {
  reply = (cmd, args) => {
    if (cmd === "/usr/bin/lsof" && args.includes("cwd")) return over.cwd ?? { stdout: "p920\nfcwd\nn/home/me/Projects/beta/web\np910\nfcwd\nn/Users/me\n" };
    if (cmd === "/usr/bin/lsof") return over.lsof ?? { stdout: MAC_LSOF };
    if (cmd === "ps") return over.ps ?? { stdout: MAC_PS };
    return new Error(`unexpected ${cmd}`);
  };
}

describe("listPorts on macOS", () => {
  beforeEach(() => {
    mocks.liveRuns.mockResolvedValue([run({}), run({ project: "gamma", slot: "script", kind: "script", script: "storybook", pid: 600, startedAt: "2026-11-09T11:00:00.000Z" })]);
    mocks.dockerSnapshot.mockResolvedValue({
      daemon: RUNNING,
      containers: [
        container(),
        container({ id: "c2", name: "amplen-db-1", service: "db", image: "postgres:16", ports: [5433], bindings: [{ address: "0.0.0.0", port: 5433 }] }),
        container({ id: "c3", name: "redis", stack: null, service: null, project: null, workingDir: null, image: "redis:7", ports: [6380], bindings: [{ address: "127.0.0.1", port: 6380 }] }),
        container({ id: "c4", name: "old", state: "exited", ports: [8080], bindings: [{ address: "0.0.0.0", port: 8080 }] }),
        container({ id: "c5", name: "legacy", bindings: undefined, ports: [8081], startedAt: null }),
      ],
    });
    macReplies();
  });

  it("runs lsof, ps and a cwd lookup with fixed arguments, and no shell", async () => {
    await listPorts();
    const [lsof, cwd] = callsOf("/usr/bin/lsof");
    expect(lsof[1]).toEqual(LSOF_ARGS);
    expect(LSOF_ARGS).toEqual(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
    expect(lsof[2]).toMatchObject({ windowsHide: true, timeout: 10_000 });
    expect(lsof[2]).not.toHaveProperty("shell");
    const ps = callsOf("ps")[0];
    expect(ps[1].slice(0, 3)).toEqual(["-o", PS_FIELDS, "-p"]);
    expect(ps[1][3].split(",").map(Number).sort((a: number, b: number) => a - b)).toEqual([501, 601, 900, 910, 920, 24438, 77868, SELF].sort((a, b) => a - b));
    // Only processes no one else claimed are asked about.
    expect(cwd[1].slice(0, 5)).toEqual(["-a", "-nP", "-d", "cwd", "-p"]);
    expect(cwd[1][5].split(",").map(Number).sort((a: number, b: number) => a - b)).toEqual([900, 910, 920, 24438]);
  });

  it("lists every port, by port, with its owner", async () => {
    const result = await listPorts();
    expect(result.source).toBe("lsof");
    expect(result.error).toBeNull();
    expect(result.scannedAt).toBe(new Date(NOW).toISOString());
    expect(result.ports.map((p) => p.port)).toEqual([3000, 3002, 3101, 5000, 5173, 5432, 5433, 6006, 6380, 7000, 8000, 8081]);
    const { ports } = result;

    // A dev server workbench started: a child in the run's process group.
    expect(row(ports, 3000)).toEqual({
      port: 3000,
      addresses: ["127.0.0.1", "::1"],
      scope: "loopback",
      pid: 501,
      process: "node",
      startedAt: ago(3723),
      owner: { kind: "run", project: "alpha", slot: "dev", task: "dev", script: null },
      url: "http://localhost:3000",
    });
    // A script workbench started.
    expect(row(ports, 6006)?.owner).toEqual({ kind: "run", project: "gamma", slot: "script", task: "script", script: "storybook" });
    expect(row(ports, 6006)?.url).toBe("http://localhost:6006");
    // Published by a container; Docker's own process holds it.
    expect(row(ports, 3002)).toEqual({
      port: 3002,
      addresses: ["*"],
      scope: "network",
      pid: 77868,
      process: "com.docker.backend",
      startedAt: ago(7200),
      owner: { kind: "container", project: "amplen", container: "amplen-api-1", image: "amplen/api:dev", stack: "amplen", service: "api", stackDir: "dev" },
      url: "http://localhost:3002",
    });
    expect(row(ports, 5433)?.owner).toMatchObject({ kind: "container", container: "amplen-db-1", service: "db" });
    expect(row(ports, 5433)?.url).toBeNull();
    // workbench itself.
    expect(row(ports, 3101)?.owner).toEqual({ kind: "self" });
    // Other processes; one started in a project's folder.
    expect(row(ports, 5173)?.owner).toEqual({ kind: "process", project: "beta" });
    expect(row(ports, 5432)).toMatchObject({ owner: { kind: "process", project: null }, process: "postgres", scope: "loopback", url: null });
    expect(row(ports, 7000)).toMatchObject({ addresses: ["*"], scope: "network", process: "ControlCenter", url: null });
    expect(row(ports, 5000)?.url).toBeNull();
    // Bound to a LAN address only: open beyond this machine, and not at localhost.
    expect(row(ports, 8000)).toMatchObject({ addresses: ["192.168.1.20"], scope: "network", process: "python3", url: null, owner: { kind: "process", project: null } });
  });

  it("adds container ports no listener showed, from Docker", async () => {
    const { ports } = await listPorts();
    expect(row(ports, 6380)).toEqual({
      port: 6380,
      addresses: ["127.0.0.1"],
      scope: "loopback",
      pid: null,
      process: null,
      startedAt: ago(7200),
      owner: { kind: "container", project: null, container: "redis", image: "redis:7", stack: null, service: null, stackDir: null },
      url: null,
    });
    // An older snapshot without bindings: the port alone, address unknown.
    expect(row(ports, 8081)).toMatchObject({ addresses: [], scope: null, startedAt: null, url: "http://localhost:8081" });
    // Stopped containers publish nothing.
    expect(row(ports, 8080)).toBeUndefined();
  });

  it("leaves stackDir unset for a container whose folder is outside its project", async () => {
    mocks.dockerSnapshot.mockResolvedValue({ daemon: RUNNING, containers: [container({ workingDir: "/elsewhere" })] });
    expect(row((await listPorts()).ports, 3002)?.owner).toMatchObject({ project: "amplen", stackDir: null });
  });

  it("says only your own processes are listed, unless running as root", async () => {
    expect((await listPorts()).note).toMatch(/Only your own processes/);
    vi.mocked(process.getuid!).mockReturnValue(0);
    expect((await listPorts()).note).toBeNull();
  });

  it("falls back to /usr/sbin/lsof when it isn't on PATH", async () => {
    mocks.which.mockReturnValue(null);
    reply = (cmd, args) => (cmd === "/usr/sbin/lsof" && !args.includes("cwd") ? { stdout: "p920\ncnode\nn*:4000\n" } : cmd === "ps" ? exited("") : { stdout: "" });
    const { ports } = await listPorts();
    expect(callsOf("/usr/sbin/lsof")).toHaveLength(2);
    expect(ports.map((p) => [p.port, p.process])).toEqual([
      [4000, "node"],
      [3002, null],
      [5433, null],
      [6380, null],
      [8081, null],
    ].sort((a, b) => (a[0] as number) - (b[0] as number)));
  });

  it("is empty, not an error, when nothing listens (lsof exits 1)", async () => {
    mocks.dockerSnapshot.mockResolvedValue({ daemon: RUNNING, containers: [] });
    macReplies({ lsof: exited("") });
    expect(await listPorts()).toMatchObject({ ports: [], source: "lsof", error: null });
    expect(callsOf("ps")).toHaveLength(0);
  });

  it("still lists ports when ps and the cwd lookup fail", async () => {
    macReplies({ ps: missing("ps"), cwd: missing("lsof") });
    const { ports } = await listPorts();
    // Without ps there's no process group: only the recorded pid itself could match.
    expect(row(ports, 3000)).toMatchObject({ process: "node", startedAt: null, owner: { kind: "process", project: null } });
    expect(row(ports, 5173)?.owner).toEqual({ kind: "process", project: null });
  });

  it("matches the recorded pid itself, and keeps the run's start when ps can't say", async () => {
    mocks.liveRuns.mockResolvedValue([run({ pid: 501 })]);
    macReplies({ ps: { stdout: "" } });
    expect(row((await listPorts()).ports, 3000)).toMatchObject({ startedAt: "2026-11-09T09:00:00.000Z", owner: { kind: "run", project: "alpha" } });
  });

  it("says what went wrong when lsof can't run, and still shows Docker's ports", async () => {
    macReplies({ lsof: missing("lsof") });
    const result = await listPorts();
    expect(result.error).toBe("The tool that lists ports isn't installed");
    expect(result.source).toBeNull();
    expect(result.ports.map((p) => p.port)).toEqual([3002, 5433, 6380, 8081]);
  });

  it("reports other failures as they are", async () => {
    macReplies({ lsof: new Error("lsof: timed out") });
    expect((await listPorts()).error).toBe("lsof: timed out");
  });

  it("carries on when the live runs can't be read", async () => {
    mocks.liveRuns.mockRejectedValue(new Error("unreadable"));
    expect(row((await listPorts()).ports, 3000)?.owner).toEqual({ kind: "process", project: null });
  });

  it("shares one scan between concurrent callers", async () => {
    const [a, b] = await Promise.all([listPorts(), listPorts()]);
    expect(a).toBe(b);
    expect(callsOf("/usr/bin/lsof").filter((c) => !c[1].includes("cwd"))).toHaveLength(1);
    await listPorts();
    expect(callsOf("/usr/bin/lsof").filter((c) => !c[1].includes("cwd"))).toHaveLength(2);
  });
});

describe("listPorts on Linux", () => {
  const SS = [
    "LISTEN 0      4096   127.0.0.53%lo:53        0.0.0.0:*",
    'LISTEN 0      511          0.0.0.0:3000      0.0.0.0:*    users:(("node",pid=1234,fd=21))',
    'LISTEN 0      511                *:5173            *:*    users:(("node",pid=99,fd=30))',
  ].join("\n");

  beforeEach(() => {
    setPlatform("linux");
    mocks.liveRuns.mockResolvedValue([run({ pid: 1200 })]);
  });

  it("uses lsof when it's installed, and reads working folders from /proc", async () => {
    reply = (cmd) =>
      cmd === "/usr/bin/lsof"
        ? { stdout: "p1234\ncnode\nn*:3000\np99\ncnode\nn127.0.0.1:5173\n" }
        : cmd === "ps"
          ? { stdout: " 1234  1200  1200   00:10 node\n   99    98    98   00:20 node\n" }
          : new Error(`unexpected ${cmd}`);
    const readlink = vi.spyOn(fs, "readlinkSync").mockImplementation(((p: string) => {
      if (p === "/proc/99/cwd") return "/home/me/Projects/delta";
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    }) as typeof fs.readlinkSync);
    const result = await listPorts();
    expect(result.source).toBe("lsof");
    expect(row(result.ports, 3000)?.owner).toMatchObject({ kind: "run", project: "alpha" });
    expect(row(result.ports, 5173)?.owner).toEqual({ kind: "process", project: "delta" });
    expect(readlink).toHaveBeenCalledWith("/proc/99/cwd");
    expect(readlink).toHaveBeenCalledTimes(1);
  });

  it("falls back to ss -ltnpH without lsof", async () => {
    mocks.which.mockImplementation((name: string) => (name === "ss" ? "/usr/sbin/ss" : null));
    reply = (cmd, args) =>
      cmd === "/usr/sbin/ss" ? { stdout: SS } : cmd === "ps" ? { stdout: ` 1234  1200  1200   00:10 node\n` } : new Error(`unexpected ${cmd} ${args}`);
    vi.spyOn(fs, "readlinkSync").mockImplementation(() => {
      throw new Error("gone");
    });
    const result = await listPorts();
    expect(callsOf("/usr/sbin/ss")[0][1]).toEqual(["-ltnpH"]);
    expect(result.source).toBe("ss");
    expect(result.note).toMatch(/without their process/);
    expect(result.ports.map((p) => [p.port, p.pid, p.scope])).toEqual([
      [53, null, "loopback"],
      [3000, 1234, "network"],
      [5173, 99, "network"],
    ]);
    expect(row(result.ports, 3000)?.owner).toMatchObject({ kind: "run", project: "alpha" });
    expect(row(result.ports, 53)?.owner).toEqual({ kind: "process", project: null });
  });

  it("says so when neither lsof nor ss is installed", async () => {
    mocks.which.mockReturnValue(null);
    vi.mocked(process.getuid!).mockReturnValue(0);
    const result = await listPorts();
    expect(result).toMatchObject({ ports: [], source: null, note: null, error: "Neither lsof nor ss is installed, so listening ports can't be listed" });
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});

describe("listPorts on Windows", () => {
  const POWERSHELL = "Q:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const NETSTAT_EXE = "Q:\\Windows\\System32\\netstat.exe";
  const TASKLIST = "Q:\\Windows\\System32\\tasklist.exe";
  // node next dev (4321) ← cmd.exe (4300) ← npm's node (4200) ← workbench's launcher (4100).
  // 7777's parent pid 9999 started after it: a reused pid, not its real parent.
  const PROCESSES = [
    "4321|4300|1762682400|node.exe",
    "4300|4200|1762682390|cmd.exe",
    "4200|4100|1762682380|node.exe",
    "4100|3000|1762682370|node.exe",
    "3000|0||explorer.exe",
    "7777|9999|1762682400|node.exe",
    "9999|4100|1762690000|node.exe",
    "1012|700|1762600000|svchost.exe",
    "4|0||System",
    "",
  ].join("\r\n");

  beforeEach(() => {
    setPlatform("win32");
    vi.stubEnv("SystemRoot", "Q:\\Windows");
    mocks.liveRuns.mockResolvedValue([run({ pid: 4100 })]);
  });

  it("lists with netstat -ano and finds owners up the process tree", async () => {
    reply = (cmd) => (cmd === NETSTAT_EXE ? { stdout: NETSTAT } : cmd === POWERSHELL ? { stdout: PROCESSES } : new Error(`unexpected ${cmd}`));
    const result = await listPorts();

    expect(callsOf(NETSTAT_EXE)[0][1]).toEqual(["-ano"]);
    const ps = callsOf(POWERSHELL)[0];
    expect(ps[1]).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESSES_SCRIPT]);
    expect(ps[2]).toMatchObject({ windowsHide: true });
    // No pid or anything else is put into the script.
    expect(WINDOWS_PROCESSES_SCRIPT).not.toMatch(/\d{3,}/);

    expect(result).toMatchObject({ source: "netstat", note: null, error: null });
    expect(result.ports.map((p) => [p.port, p.pid])).toEqual([
      [135, 1012],
      [445, 4],
      [3000, 4321],
      [5173, 7777],
    ]);
    expect(row(result.ports, 135)).toMatchObject({ addresses: ["0.0.0.0", "::"], scope: "network", process: "svchost.exe", url: null });
    expect(row(result.ports, 3000)).toMatchObject({
      process: "node.exe",
      startedAt: "2025-11-09T10:00:00.000Z",
      owner: { kind: "run", project: "alpha", slot: "dev" },
      url: "http://localhost:3000",
    });
    expect(row(result.ports, 5173)).toMatchObject({ scope: "loopback", owner: { kind: "process", project: null } });
  });

  it("stops at a loop in the process tree", async () => {
    reply = (cmd) => (cmd === NETSTAT_EXE ? { stdout: NETSTAT } : { stdout: "4321|4321||node.exe\r\n7777|7778||a.exe\r\n7778|7777||b.exe\r\n" });
    const { ports } = await listPorts();
    expect(row(ports, 3000)?.owner).toEqual({ kind: "process", project: null });
    expect(row(ports, 5173)?.owner).toEqual({ kind: "process", project: null });
  });

  it("names processes with tasklist when PowerShell fails", async () => {
    reply = (cmd) =>
      cmd === NETSTAT_EXE
        ? { stdout: NETSTAT }
        : cmd === POWERSHELL
          ? missing("powershell")
          : cmd === TASKLIST
            ? { stdout: '"node.exe","4321","Console","1","45,120 K"\r\n' }
            : new Error(`unexpected ${cmd}`);
    const { ports } = await listPorts();
    expect(callsOf(TASKLIST)[0][1]).toEqual(["/fo", "csv", "/nh"]);
    expect(row(ports, 3000)).toMatchObject({ process: "node.exe", startedAt: null, owner: { kind: "process" } });
  });

  it("names processes with tasklist when PowerShell prints nothing, and goes without when that fails too", async () => {
    reply = (cmd) => (cmd === NETSTAT_EXE ? { stdout: NETSTAT } : cmd === POWERSHELL ? { stdout: "" } : new Error("tasklist failed"));
    const { ports } = await listPorts();
    expect(callsOf(TASKLIST)).toHaveLength(1);
    expect(row(ports, 3000)).toMatchObject({ process: null, pid: 4321 });
  });
});

describe("listPorts elsewhere", () => {
  it("says listing isn't supported", async () => {
    setPlatform("freebsd");
    expect(await listPorts()).toMatchObject({ ports: [], source: null, error: "Listing ports isn't supported on this system" });
  });
});

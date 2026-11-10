import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { liveRuns, type LiveRun } from "./devenv";
import { dockerSnapshot, isUp, projectOf, type Container } from "./docker";
import { projectsDir } from "./paths";
import { platform, powershellExe, system32, which } from "./platform";
import type { ListeningPort, PortOwner, PortsResult } from "./types";

/*
 * Every TCP port listening on this machine, and what holds it.
 *
 * Listing (each a fixed command line; nothing from a request reaches it, and
 * only integer pids are ever added to one):
 *   macOS, Linux  lsof -nP -iTCP -sTCP:LISTEN -F pcn
 *   Linux         ss -ltnpH, when lsof isn't installed
 *   Windows       netstat -ano (TCP rows bound to a port with no peer, IPv4 and IPv6)
 * Then, for the pids found:
 *   macOS, Linux  ps -o pid=,ppid=,pgid=,etime=,comm= -p <pids>: parent, process group, age, name
 *   Windows       one PowerShell Get-CimInstance Win32_Process (fixed script): parent, start, name;
 *                 tasklist /fo csv /nh for names if PowerShell fails
 *
 * Owners, first match wins:
 *   1. workbench's own server (this process's pid)
 *   2. a running container publishing the port (from the shared Docker snapshot)
 *   3. a process workbench started (devenv's live runs): the recorded pid, or
 *      anything in its process group (macOS, Linux: runs start in a group of
 *      their own) or below it in the process tree (Windows)
 *   4. any other process; its project when its working folder is in one
 *      (lsof -a -d cwd on macOS, /proc/<pid>/cwd on Linux)
 *
 * Container ports Docker publishes that no listener showed (docker-proxy is
 * root's, so lsof can't see it on Linux) are added from the snapshot.
 */

const run = promisify(execFile);

export const LSOF_ARGS = ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"];
export const SS_ARGS = ["-ltnpH"];
export const NETSTAT_ARGS = ["-ano"];
export const PS_FIELDS = "pid=,ppid=,pgid=,etime=,comm=";
/** Each process's id, parent, start (Unix seconds, or empty) and name, one per line. */
export const WINDOWS_PROCESSES_SCRIPT =
  "Get-CimInstance Win32_Process | ForEach-Object { " +
  "$s = ''; if ($_.CreationDate) { $s = ([DateTimeOffset]$_.CreationDate).ToUnixTimeSeconds() }; " +
  "'{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.ParentProcessId, $s, $_.Name }";

/** One listening socket, as a tool reported it. */
export interface Listener {
  port: number;
  address: string;
  pid: number | null;
  /** The process name the tool gave, if any. */
  command: string | null;
}

/** What's known about one process. */
export interface ProcInfo {
  ppid: number | null;
  pgid: number | null;
  startedAt: string | null;
  name: string | null;
}

// ---- Parsing ---------------------------------------------------------------

const toPid = (s: string | undefined): number | null => {
  const n = Number(s);
  return s && /^\d+$/.test(s) && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** "127.0.0.1:3000", "*:3000", "[::1]:5173", "127.0.0.53%lo:53" → address and port. */
export function splitAddress(text: string): { address: string; port: number } | null {
  const m = text.trim().match(/^(.*):(\d+)$/);
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return null;
  const address = m[1].replace(/^\[(.*)\]$/, "$1").replace(/%[^%]*$/, "");
  return { address: address || "*", port };
}

/** lsof -F pcn: "p<pid>", "c<command>", then "f<fd>" / "n<address:port>" per socket. */
export function parseLsof(stdout: string): Listener[] {
  const out: Listener[] = [];
  let pid: number | null = null;
  let command: string | null = null;
  for (const line of stdout.split("\n")) {
    const value = line.slice(1).replace(/\r$/, "");
    switch (line[0]) {
      case "p":
        pid = toPid(value);
        command = null;
        break;
      case "c":
        command = value || null;
        break;
      case "n": {
        if (value.includes("->")) break; // a connection, not a listener
        const at = splitAddress(value);
        if (at) out.push({ ...at, pid, command });
        break;
      }
    }
  }
  return out;
}

/**
 * ss -ltnpH: "LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=12,fd=21))".
 * The users column is missing for other users' sockets without root.
 */
export function parseSs(stdout: string): Listener[] {
  const out: Listener[] = [];
  for (const line of stdout.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0] !== "LISTEN") continue;
    const at = splitAddress(fields[3]);
    if (!at) continue;
    const user = fields.slice(5).join(" ").match(/\("((?:[^"\\]|\\.)*)",pid=(\d+)/);
    out.push({ ...at, pid: toPid(user?.[2]), command: user ? user[1] : null });
  }
  return out;
}

/**
 * netstat -ano: "  TCP    127.0.0.1:3000    0.0.0.0:0    LISTENING    4321". A
 * listener is a TCP row whose peer is port 0; that holds in every language,
 * unlike the state column (LISTENING, ABHÖREN…).
 */
export function parseNetstat(stdout: string): Listener[] {
  const out: Listener[] = [];
  for (const line of stdout.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 5 || fields[0].toUpperCase() !== "TCP" || !/:0$/.test(fields[2])) continue;
    const at = splitAddress(fields[1]);
    if (at) out.push({ ...at, pid: toPid(fields[4]), command: null });
  }
  return out;
}

/** ps's elapsed time, "[[dd-]hh:]mm:ss", in seconds. */
export function etimeSeconds(text: string): number | null {
  const m = text.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4]);
}

/** ps -o pid=,ppid=,pgid=,etime=,comm= (comm is last: on macOS it's a full path and may hold spaces). */
export function parsePs(stdout: string, now = Date.now()): Map<number, ProcInfo> {
  const out = new Map<number, ProcInfo>();
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/);
    const pid = toPid(m?.[1]);
    if (!m || !pid) continue;
    const age = etimeSeconds(m[4]);
    out.set(pid, {
      ppid: toPid(m[2]),
      pgid: toPid(m[3]),
      startedAt: age === null ? null : new Date(now - age * 1000).toISOString(),
      name: path.posix.basename(m[5]) || null,
    });
  }
  return out;
}

/** WINDOWS_PROCESSES_SCRIPT's "pid|ppid|start|name" lines. */
export function parseWindowsProcesses(stdout: string): Map<number, ProcInfo> {
  const out = new Map<number, ProcInfo>();
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^(\d+)\|(\d*)\|(\d*)\|(.*)$/);
    const pid = toPid(m?.[1]);
    if (!m || !pid) continue;
    out.set(pid, {
      ppid: toPid(m[2]),
      pgid: null,
      startedAt: m[3] ? new Date(Number(m[3]) * 1000).toISOString() : null,
      name: m[4].trim() || null,
    });
  }
  return out;
}

/** tasklist /fo csv /nh: "node.exe","4321","Console","1","45,120 K". */
export function parseTasklist(stdout: string): Map<number, ProcInfo> {
  const out = new Map<number, ProcInfo>();
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^"([^"]*)","(\d+)"/);
    const pid = toPid(m?.[2]);
    if (m && pid) out.set(pid, { ppid: null, pgid: null, startedAt: null, name: m[1] || null });
  }
  return out;
}

/** lsof -F pn for cwd: "p<pid>", "fcwd", "n<folder>". */
export function parseLsofCwd(stdout: string): Map<number, string> {
  const out = new Map<number, string>();
  let pid: number | null = null;
  for (const line of stdout.split("\n")) {
    if (line[0] === "p") pid = toPid(line.slice(1));
    else if (line[0] === "n" && pid && !out.has(pid)) out.set(pid, line.slice(1));
  }
  return out;
}

// ---- Classifying -----------------------------------------------------------

const WILDCARD = new Set(["*", "0.0.0.0", "::"]);
export const isWildcard = (address: string) => WILDCARD.has(address);
export const isLoopback = (address: string) => /^127\./.test(address) || /^::ffff:127\./i.test(address) || address === "::1" || address === "localhost";

/** Ports a dev web server usually picks. A guess: what the Open link is offered for. */
const WEB_PORTS = new Set([80, 443, 1313, 4173, 4200, 4321, 5000, 5001, 6006, 8443, 8787, 8888, 9000, 9090]);
const WEB_RANGES: [number, number][] = [
  [3000, 3099],
  [4000, 4099],
  [5173, 5179],
  [8000, 8099],
  [19000, 19006],
];
/** Ports that aren't pages even when a dev server opens them: the Node inspector, Vite's old HMR socket. */
const NOT_WEB_PORTS = new Set([9229, 9230, 24678]);
/** macOS's AirPlay receiver holds 5000 and 7000. */
const NOT_WEB_PROCESSES = new Set(["ControlCenter", "AirPlayXPCHelper"]);

export function likelyWeb(port: number, owner: PortOwner, processName: string | null): boolean {
  if (NOT_WEB_PORTS.has(port) || (processName && NOT_WEB_PROCESSES.has(processName))) return false;
  if (owner.kind === "run" && owner.task === "dev") return true;
  return WEB_PORTS.has(port) || WEB_RANGES.some(([lo, hi]) => port >= lo && port <= hi);
}

// ---- Commands --------------------------------------------------------------

const MAX_BUFFER = 16 * 1024 * 1024;

/** stdout, even when the program exits non-zero (lsof does when it finds nothing); throws if it couldn't run. */
async function output(command: string, args: string[], timeout: number): Promise<string> {
  try {
    return (await run(command, args, { timeout, maxBuffer: MAX_BUFFER, windowsHide: true })).stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string };
    if (err.code === "ENOENT" || typeof err.stdout !== "string") throw e;
    return err.stdout;
  }
}

const notRoot = () => typeof process.getuid === "function" && process.getuid() !== 0;

async function listListeners(): Promise<{ listeners: Listener[]; source: PortsResult["source"]; note: string | null }> {
  const os = platform();
  if (os === "windows") {
    // -p TCP would leave out IPv6 listeners (a dev server on [::1]); the TCP rows of both are picked out instead.
    const stdout = await output(system32("netstat.exe"), NETSTAT_ARGS, 15_000);
    return { listeners: parseNetstat(stdout), source: "netstat", note: null };
  }
  if (os !== "mac" && os !== "linux") throw new Error("Listing ports isn't supported on this system");
  const lsof = which("lsof") ?? (os === "mac" ? "/usr/sbin/lsof" : null);
  if (lsof) {
    const note = notRoot() ? "Only your own processes are listed: ports held by system services or other users need admin rights to see." : null;
    return { listeners: parseLsof(await output(lsof, LSOF_ARGS, 10_000)), source: "lsof", note };
  }
  const ss = which("ss");
  if (!ss) throw new Error("Neither lsof nor ss is installed, so listening ports can't be listed");
  const note = notRoot() ? "Ports held by system services or other users are listed without their process: naming those needs admin rights." : null;
  return { listeners: parseSs(await output(ss, SS_ARGS, 10_000)), source: "ss", note };
}

/** Parent, group, start and name of each pid (on Windows: of every process, for walking up the tree). */
async function processInfo(pids: number[]): Promise<Map<number, ProcInfo>> {
  if (platform() === "windows") {
    try {
      const stdout = await output(powershellExe(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESSES_SCRIPT], 15_000);
      const procs = parseWindowsProcesses(stdout);
      if (procs.size > 0) return procs;
    } catch {
      // No PowerShell: names alone, below.
    }
    try {
      return parseTasklist(await output(system32("tasklist.exe"), ["/fo", "csv", "/nh"], 15_000));
    } catch {
      return new Map();
    }
  }
  if (pids.length === 0) return new Map();
  try {
    return parsePs(await output("ps", ["-o", PS_FIELDS, "-p", pids.join(",")], 5_000));
  } catch {
    return new Map();
  }
}

/** The working folder of each pid that has one we can read (not on Windows). */
async function workingDirs(pids: number[]): Promise<Map<number, string>> {
  if (pids.length === 0) return new Map();
  if (platform() === "linux") {
    const out = new Map<number, string>();
    for (const pid of pids) {
      try {
        out.set(pid, fs.readlinkSync(/*turbopackIgnore: true*/ `/proc/${pid}/cwd`));
      } catch {
        // Another user's process, or gone.
      }
    }
    return out;
  }
  if (platform() !== "mac") return new Map();
  try {
    const lsof = which("lsof") ?? "/usr/sbin/lsof";
    return parseLsofCwd(await output(lsof, ["-a", "-nP", "-d", "cwd", "-p", pids.join(","), "-F", "pn"], 5_000));
  } catch {
    return new Map();
  }
}

// ---- Owners ----------------------------------------------------------------

/** The live run whose process tree holds `pid`. */
function runFor(pid: number, procs: Map<number, ProcInfo>, runs: Map<number, LiveRun>): LiveRun | null {
  const direct = runs.get(pid);
  if (direct) return direct;
  const pgid = procs.get(pid)?.pgid;
  if (pgid && runs.has(pgid)) return runs.get(pgid)!;
  // Up the tree (Windows has no process groups). A parent can't have started
  // after its child; if it did, its pid was reused and the chain ends there.
  let child = pid;
  for (let depth = 0; depth < 64; depth++) {
    const info = procs.get(child);
    const parent = info?.ppid;
    if (!parent || parent === child) return null;
    const parentStart = procs.get(parent)?.startedAt;
    if (parentStart && info.startedAt && Date.parse(parentStart) > Date.parse(info.startedAt)) return null;
    if (runs.has(parent)) return runs.get(parent)!;
    child = parent;
  }
  return null;
}

function containerOwner(c: Container): PortOwner {
  let stackDir: string | null = null;
  if (c.project && c.stack && c.workingDir) {
    const rel = path.relative(path.join(projectsDir(), c.project), c.workingDir);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) stackDir = rel;
  }
  return { kind: "container", project: c.project, container: c.name, image: c.image, stack: c.stack, service: c.service, stackDir };
}

const tcpBindings = (c: Container) => c.bindings ?? c.ports.map((port) => ({ address: "", port }));

function urlFor(port: number, addresses: string[], owner: PortOwner, processName: string | null): string | null {
  if (!likelyWeb(port, owner, processName)) return null;
  // Reachable as localhost: bound to loopback or every interface (or Docker didn't say).
  const local = addresses.length === 0 || addresses.some((a) => isLoopback(a) || isWildcard(a) || a === "");
  return local ? `http://localhost:${port}` : null;
}

// ---- Listing ---------------------------------------------------------------

async function scan(): Promise<PortsResult> {
  const scannedAt = new Date().toISOString();
  let listeners: Listener[] = [];
  let source: PortsResult["source"] = null;
  let note: string | null = null;
  let error: string | null = null;
  try {
    ({ listeners, source, note } = await listListeners());
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    error = err.code === "ENOENT" ? "The tool that lists ports isn't installed" : err.message;
  }

  // One row per port and process: a process listening on 127.0.0.1 and ::1 is one row.
  const rows = new Map<string, { port: number; pid: number | null; command: string | null; addresses: string[] }>();
  for (const l of listeners) {
    const key = `${l.port}/${l.pid ?? ""}`;
    const row = rows.get(key) ?? { port: l.port, pid: l.pid, command: l.command, addresses: [] };
    if (!row.addresses.includes(l.address)) row.addresses.push(l.address);
    rows.set(key, row);
  }

  const pids = [...new Set([...rows.values()].map((r) => r.pid).filter((p): p is number => p !== null))];
  const [procs, runList, snap] = await Promise.all([processInfo(pids), liveRuns().catch(() => []), dockerSnapshot()]);
  const runs = new Map(runList.map((r) => [r.pid, r]));
  const byPort = new Map<number, Container>();
  for (const c of snap.containers) {
    if (!isUp(c)) continue;
    for (const b of tcpBindings(c)) if (!byPort.has(b.port)) byPort.set(b.port, c);
  }

  const ports: ListeningPort[] = [];
  const unowned: ListeningPort[] = [];
  for (const r of rows.values()) {
    const info = r.pid ? procs.get(r.pid) : undefined;
    const name = info?.name ?? r.command;
    const container = byPort.get(r.port);
    const liveRun = r.pid ? runFor(r.pid, procs, runs) : null;
    let owner: PortOwner;
    let startedAt = info?.startedAt ?? null;
    if (r.pid === process.pid) owner = { kind: "self" };
    else if (container) {
      owner = containerOwner(container);
      startedAt = container.startedAt ?? startedAt;
    } else if (liveRun) {
      owner = { kind: "run", project: liveRun.project, slot: liveRun.slot, task: liveRun.kind, script: liveRun.script };
      startedAt ??= liveRun.startedAt;
    } else owner = { kind: "process", project: null };
    const row: ListeningPort = {
      port: r.port,
      addresses: r.addresses,
      scope: r.addresses.every(isLoopback) ? "loopback" : "network",
      pid: r.pid,
      process: name,
      startedAt,
      owner,
      url: urlFor(r.port, r.addresses, owner, name),
    };
    ports.push(row);
    if (owner.kind === "process" && r.pid) unowned.push(row);
  }

  // Started in a project's folder (a dev server run from a terminal, say): say which project.
  const cwds = await workingDirs([...new Set(unowned.map((r) => r.pid!))]);
  for (const row of unowned) {
    const project = projectOf(cwds.get(row.pid!) ?? null);
    if (project) row.owner = { kind: "process", project };
  }

  // Published container ports no listener showed: Docker still says they're open.
  const seen = new Set(ports.map((p) => p.port));
  for (const c of snap.containers) {
    if (!isUp(c)) continue;
    const bindings = tcpBindings(c).filter((b) => !seen.has(b.port));
    for (const port of new Set(bindings.map((b) => b.port))) {
      const addresses = [...new Set(bindings.filter((b) => b.port === port && b.address).map((b) => b.address))];
      const owner = containerOwner(c);
      ports.push({
        port,
        addresses,
        scope: addresses.length === 0 ? null : addresses.every(isLoopback) ? "loopback" : "network",
        pid: null,
        process: null,
        startedAt: c.startedAt,
        owner,
        url: urlFor(port, addresses, owner, null),
      });
      seen.add(port);
    }
  }

  ports.sort((a, b) => a.port - b.port || (a.pid ?? Infinity) - (b.pid ?? Infinity));
  return { ports, source, error, note, scannedAt };
}

let inflight: Promise<PortsResult> | null = null;

/** Every listening TCP port and its owner. Concurrent callers share one scan. */
export function listPorts(): Promise<PortsResult> {
  inflight ??= scan().finally(() => {
    inflight = null;
  });
  return inflight;
}

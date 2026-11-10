import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { dockerMessage, dockerSnapshot, invalidateDocker, isUp, problemKinds, type Container, type ProblemKind } from "./docker";
import { isSelf, resolveProjectDir, tildify } from "./paths";
import type { ContainerGroup, ContainerRow, ContainersList, ContainerStackGroup, ContainersUsage, ContainerUsage } from "./types";

/*
 * The Containers page: every container on this machine, grouped by the
 * project it belongs to (then compose stack), with the ones in no project in
 * a group of their own. Built on docker.ts's shared snapshot.
 *
 * Containers in a project are changed through that project's stack actions
 * (devenv.stackAction). The others may not be the user's work, so the only
 * actions on them are Stop and Remove, one container at a time, and the id
 * must name a container in a fresh snapshot that still belongs to no project.
 * Every docker call is execFile with fixed verbs; the id passed on is the
 * snapshot's, never the request's.
 */

const run = promisify(execFile);

const STATS_TTL_MS = 5_000;
/** A full container id, as `docker ps --no-trunc` prints it. */
const FULL_ID = /^[0-9a-f]{64}$/;

export class ContainerError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

// ---- Listing ---------------------------------------------------------------

/** The project a container belongs to: its folder must still be a project workbench shows. */
function owners(containers: Container[]): Map<Container, { project: string; dir: string } | null> {
  const dirs = new Map<string, string | null>();
  const out = new Map<Container, { project: string; dir: string } | null>();
  for (const c of containers) {
    if (!c.project) {
      out.set(c, null);
      continue;
    }
    if (!dirs.has(c.project)) {
      const dir = resolveProjectDir(c.project);
      dirs.set(c.project, dir && !isSelf(dir) ? dir : null);
    }
    const dir = dirs.get(c.project)!;
    out.set(c, dir ? { project: c.project, dir } : null);
  }
  return out;
}

function toRow(c: Container, problem: ProblemKind | undefined): ContainerRow {
  return {
    id: c.id,
    name: c.name,
    image: c.image,
    state: c.state,
    health: c.health,
    exitCode: c.exitCode,
    oomKilled: c.oomKilled,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    ports: c.ports,
    service: c.service,
    problem: problem?.kind ?? null,
  };
}

/** 0: needs a look, 1: up, 2: stopped. */
const rowRank = (r: ContainerRow) => (r.problem ? 0 : isUp(r) ? 1 : 2);
const minRank = (ranks: number[]) => Math.min(...ranks);
/** By name, with null (loose containers, or no project) last. */
const nullLast = (a: string | null, b: string | null) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b));

/** Group a snapshot's containers by project, then stack; problems first at every level. */
export function groupContainers(containers: Container[], now = Date.now()): ContainerGroup[] {
  const kinds = problemKinds(containers, now);
  const owner = owners(containers);
  const groups = new Map<string, { project: string | null; stacks: Map<string, ContainerStackGroup> }>();

  for (const c of containers) {
    const own = owner.get(c)!;
    const groupKey = own?.project ?? "";
    if (!groups.has(groupKey)) groups.set(groupKey, { project: own?.project ?? null, stacks: new Map() });
    const stacks = groups.get(groupKey)!.stacks;
    // A project's stack is named by its folder relative to the project, as stackAction looks it up.
    const dir = !c.workingDir ? null : own ? path.relative(own.dir, c.workingDir) : tildify(c.workingDir);
    const stackKey = c.stack ? `${c.stack}\0${dir}` : "";
    if (!stacks.has(stackKey)) stacks.set(stackKey, { name: c.stack, dir, containers: [] });
    stacks.get(stackKey)!.containers.push(toRow(c, kinds.get(c)));
  }

  const stackRank = (s: ContainerStackGroup) => minRank(s.containers.map(rowRank));
  const stackName = (s: ContainerStackGroup) => (s.name === null ? null : `${s.name}\0${s.dir}`);
  const groupRank = (g: ContainerGroup) => minRank(g.stacks.map(stackRank));
  const out: ContainerGroup[] = [];
  for (const g of groups.values()) {
    const stacks = [...g.stacks.values()];
    for (const s of stacks) s.containers.sort((a, b) => rowRank(a) - rowRank(b) || a.name.localeCompare(b.name));
    stacks.sort((a, b) => stackRank(a) - stackRank(b) || nullLast(stackName(a), stackName(b)));
    out.push({ project: g.project, stacks });
  }
  return out.sort((a, b) => groupRank(a) - groupRank(b) || nullLast(a.project, b.project));
}

/** Every container on this machine, grouped, and the daemon's state. */
export async function listContainers(): Promise<ContainersList> {
  const snap = await dockerSnapshot();
  return { docker: snap.daemon, groups: groupContainers(snap.containers) };
}

// ---- Usage -----------------------------------------------------------------

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/** Docker's sizes ("128.2MiB", "7.745GiB", "1.5kB", "0B") in bytes; null for "--" or anything else. */
export function parseSize(text: string): number | null {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt]i?b|b)$/i);
  return m ? Math.round(Number(m[1]) * UNITS[m[2].toLowerCase()]) : null;
}

/** "9.87%" → 9.87; null for "--" or anything else. */
export function parsePercent(text: string): number | null {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)%$/);
  return m ? Number(m[1]) : null;
}

interface StatsLine {
  ID?: string;
  Container?: string;
  CPUPerc?: string;
  MemUsage?: string;
}

function parseStats(stdout: string, containers: Container[]): Record<string, ContainerUsage> {
  const usage: Record<string, ContainerUsage> = {};
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let row: StatsLine;
    try {
      row = JSON.parse(line) as StatsLine;
    } catch {
      continue;
    }
    // stats prints the short id; match it to a container in the snapshot.
    const short = typeof row.ID === "string" ? row.ID : "";
    const c = short.length >= 12 ? containers.find((x) => x.id.startsWith(short)) : undefined;
    if (!c) continue;
    const [used, limit = ""] = String(row.MemUsage ?? "").split("/");
    usage[c.id] = { cpu: parsePercent(String(row.CPUPerc ?? "")), memory: parseSize(used), memoryLimit: parseSize(limit) };
  }
  return usage;
}

async function loadUsage(): Promise<ContainersUsage> {
  const snap = await dockerSnapshot();
  const at = new Date().toISOString();
  if (snap.daemon.state !== "running") return { at, usage: {}, error: snap.daemon.message };
  if (!snap.containers.some(isUp)) return { at, usage: {}, error: null };
  try {
    // One sample of every running container; takes a second or two.
    const { stdout } = await run("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    return { at, usage: parseStats(stdout, snap.containers), error: null };
  } catch (e) {
    return { at, usage: {}, error: dockerMessage(e) };
  }
}

let usageCache: { at: number; promise: Promise<ContainersUsage> } | null = null;

/** CPU and memory of every running container; shared by callers for a few seconds. */
export function containerUsage(): Promise<ContainersUsage> {
  if (usageCache && Date.now() - usageCache.at < STATS_TTL_MS) return usageCache.promise;
  const promise = loadUsage();
  usageCache = { at: Date.now(), promise };
  return promise;
}

// ---- Actions on containers outside any project -------------------------------

export type OtherAction = "stop" | "remove";
export const OTHER_ACTIONS: OtherAction[] = ["stop", "remove"];

const inFlight = new Set<string>();

/**
 * Stop or remove one container that belongs to no project. The id has to be
 * a full container id that a fresh snapshot still lists, outside any project;
 * Remove only takes a stopped container and keeps its volumes.
 */
export async function otherContainerAction(id: unknown, action: unknown): Promise<void> {
  if (!OTHER_ACTIONS.includes(action as OtherAction)) throw new ContainerError(400, 'action must be "stop" or "remove"');
  if (typeof id !== "string" || !FULL_ID.test(id)) throw new ContainerError(400, "id must be a full container id");

  invalidateDocker();
  const snap = await dockerSnapshot();
  if (snap.daemon.state !== "running") throw new ContainerError(503, snap.daemon.message ?? "Docker isn't running");
  const target = snap.containers.find((c) => c.id === id);
  if (!target) throw new ContainerError(404, "That container is gone");
  const own = owners([target]).get(target);
  if (own) throw new ContainerError(403, `${target.name} belongs to ${own.project}; use its stack's actions`);
  if (action === "stop" && !isUp(target)) throw new ContainerError(409, `${target.name} isn't running`);
  if (action === "remove" && isUp(target)) throw new ContainerError(409, `Stop ${target.name} before removing it`);
  if (inFlight.has(target.id)) throw new ContainerError(409, `Already changing ${target.name}`);

  inFlight.add(target.id);
  try {
    if (action === "stop") await run("docker", ["stop", target.id], { timeout: 60_000, windowsHide: true });
    // No -f and no -v: a running container is refused, and its volumes stay.
    else await run("docker", ["rm", target.id], { timeout: 30_000, windowsHide: true });
  } catch (e) {
    throw new ContainerError(500, `${action === "stop" ? "docker stop" : "docker rm"} failed: ${dockerMessage(e)}`);
  } finally {
    inFlight.delete(target.id);
    invalidateDocker();
    usageCache = null;
  }
}

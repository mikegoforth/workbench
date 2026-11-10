"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, Container, Copy, FolderGit2, LoaderCircle, PackageOpen, Play, RefreshCw, RotateCw, ScrollText, Square, Trash2 } from "lucide-react";
import { ageShort, plural, timeAgo } from "@/lib/format";
import type { Tone } from "@/lib/status";
import type { ContainerGroup, ContainerRow, ContainersList, ContainersUsage, ContainerStackGroup } from "@/lib/types";
import { DockerNotice, serviceState } from "./Docker";
import { Badge, Button, Card, Chip, EmptyState, FilterBar, PageBody, TABLE, TD, TH, TitleBar } from "./ui";
import type { Ctx } from "./model";

const POLL_MS = 5000;
// `docker stats` takes a second or two and some CPU of its own: sample it less often.
const USAGE_POLL_MS = 20_000;
const COLUMNS = 7;
// TD, with less padding on phones.
const CELL = "border-b border-line px-3 py-3.5 align-middle sm:px-5";

type ChipId = "problems" | "running" | "stopped" | "other";
const CHIPS: { id: ChipId; label: string }[] = [
  { id: "problems", label: "Problems" },
  { id: "running", label: "Running" },
  { id: "stopped", label: "Stopped" },
  { id: "other", label: "Not in a project" },
];

const isUp = (r: ContainerRow) => r.state === "running" || r.state === "restarting" || r.state === "paused";

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const post = (body: object) =>
  getJSON<ContainersList>("/api/containers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Label and tone for a container: red exactly when Needs attention would flag it. */
function rowState(r: ContainerRow): { label: string; tone: Tone; when: string | null } {
  const st = serviceState(r);
  const tone: Tone = r.problem ? "bad" : st.up ? st.tone : "neutral";
  const when = st.up ? null : r.finishedAt ? timeAgo(r.finishedAt) : r.state === "created" ? "never started" : null;
  return { label: st.label, tone, when };
}

function formatBytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

const stackKey = (project: string | null, s: ContainerStackGroup) => `${project ?? ""}\0${s.name ?? ""}\0${s.dir ?? ""}`;

function rowMatches(q: string, chip: ChipId | null, g: ContainerGroup, s: ContainerStackGroup, r: ContainerRow) {
  if (chip === "problems" && !r.problem) return false;
  if (chip === "running" && !isUp(r)) return false;
  if (chip === "stopped" && isUp(r)) return false;
  if (chip === "other" && g.project !== null) return false;
  if (!q) return true;
  return [r.name, r.service, r.image, r.id.slice(0, 12), g.project, s.name, s.dir, ...r.ports.map((p) => `:${p}`)].some((v) => v?.toLowerCase().includes(q));
}

function Ports({ ports }: { ports: number[] }) {
  if (ports.length === 0) return <span className="text-fg-3">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
      {ports.map((port) => (
        <a key={port} href={`http://localhost:${port}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[12.5px] text-brand-text hover:underline" title={`Open localhost:${port}`}>
          :{port}
        </a>
      ))}
    </span>
  );
}

/** `docker logs <id>` to the clipboard, for containers workbench has no logs tab for. */
function CopyLogsCommand({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const command = `docker logs ${id.slice(0, 12)}`;
  return (
    <Button
      size="sm"
      variant="plain"
      icon={copied ? Check : Copy}
      aria-label={`Copy ${command}`}
      title={copied ? "Copied" : `Copy \`${command}\``}
      onClick={() => {
        navigator.clipboard
          ?.writeText(command)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    />
  );
}

export default function ContainersView({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<ContainersList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usage, setUsage] = useState<ContainersUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<ChipId | null>(null);
  // `${key}:${action}` while a stack or container action runs.
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A container outside any project waiting for "are you sure".
  const [confirm, setConfirm] = useState<{ id: string; action: "stop" | "remove" } | null>(null);
  const [reload, setReload] = useState(0);
  const [, setTick] = useState(0);
  const usageBusy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      getJSON<ContainersList>("/api/containers")
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setLoadError(null);
        })
        .catch((e: Error) => {
          if (!cancelled) setLoadError(e.message);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [reload]);

  const daemonUp = data?.docker.state === "running";

  const loadUsage = () => {
    if (usageBusy.current) return;
    usageBusy.current = true;
    setUsageLoading(true);
    getJSON<ContainersUsage>("/api/containers/usage")
      .then(setUsage)
      .catch((e: Error) => setUsage({ at: new Date().toISOString(), usage: {}, error: e.message }))
      .finally(() => {
        usageBusy.current = false;
        setUsageLoading(false);
      });
  };

  // CPU and memory: once the daemon answers, then on a slow timer while the page is visible.
  useEffect(() => {
    if (!daemonUp) return;
    loadUsage();
    const timer = setInterval(() => {
      if (!document.hidden) loadUsage();
    }, USAGE_POLL_MS);
    return () => clearInterval(timer);
  }, [daemonUp]);

  // Keep "as of 12s ago" honest between samples.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  const refresh = () => {
    setReload((n) => n + 1);
    if (daemonUp) loadUsage();
  };

  const run = async (key: string, action: string, body: object) => {
    setPending(`${key}:${action}`);
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
    try {
      setData(await post(body));
      setConfirm(null);
      ctx.actions.activity();
      loadUsage();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [key]: (e as Error).message }));
    } finally {
      setPending(null);
    }
  };

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const all = useMemo(() => groups.flatMap((g) => g.stacks.flatMap((s) => s.containers.map((r) => ({ g, r })))), [groups]);
  const counts: Record<ChipId, number> = {
    problems: all.filter(({ r }) => r.problem).length,
    running: all.filter(({ r }) => isUp(r)).length,
    stopped: all.filter(({ r }) => !isUp(r)).length,
    other: all.filter(({ g }) => g.project === null).length,
  };

  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      // A project with one compose stack shows it in the project's own header row.
      lone: g.project !== null && g.stacks.length === 1 && g.stacks[0].name !== null,
      stacks: g.stacks.map((s) => ({ ...s, rows: s.containers.filter((r) => rowMatches(q, chip, g, s, r)) })).filter((s) => s.rows.length > 0),
    }))
    .filter((g) => g.stacks.length > 0);
  const shownCount = shown.reduce((n, g) => n + g.stacks.reduce((m, s) => m + s.rows.length, 0), 0);
  const hiddenNames = new Set(ctx.items.filter((i) => i.project.hidden).map((i) => i.project.name));

  const stackActions = (g: ContainerGroup, s: ContainerStackGroup) => {
    if (g.project === null || s.name === null || s.dir === null) return null;
    const key = stackKey(g.project, s);
    const busy = pending?.startsWith(`${key}:`) ?? false;
    const isPending = (a: string) => pending === `${key}:${a}`;
    const act = (action: "start" | "stop" | "restart") => run(key, action, { project: g.project, stack: s.name, dir: s.dir, action });
    const up = s.containers.some(isUp);
    return up ? (
      <>
        <Button size="sm" icon={isPending("restart") ? LoaderCircle : RotateCw} spin={isPending("restart")} disabled={busy || !daemonUp} onClick={() => act("restart")}>
          Restart
        </Button>
        <Button size="sm" variant="danger" icon={isPending("stop") ? LoaderCircle : Square} spin={isPending("stop")} disabled={busy || !daemonUp} onClick={() => act("stop")}>
          Stop
        </Button>
      </>
    ) : (
      <Button size="sm" icon={isPending("start") ? LoaderCircle : Play} spin={isPending("start")} disabled={busy || !daemonUp} onClick={() => act("start")} title="docker compose up -d, or docker start if its compose files are gone">
        Start
      </Button>
    );
  };

  const rowActions = (g: ContainerGroup, r: ContainerRow) => {
    if (g.project !== null) {
      const project = g.project;
      return <Button size="sm" variant="plain" icon={ScrollText} aria-label={`Logs for ${r.name}`} title={`${project}'s Logs tab`} onClick={() => ctx.actions.openTab(project, "logs")} />;
    }
    const busy = pending?.startsWith(`${r.id}:`) ?? false;
    const action = isUp(r) ? "stop" : "remove";
    return (
      <span className="inline-flex items-center gap-0.5">
        <CopyLogsCommand id={r.id} />
        <Button
          size="sm"
          variant="danger"
          icon={busy ? LoaderCircle : action === "stop" ? Square : Trash2}
          spin={busy}
          disabled={busy || !daemonUp || confirm?.id === r.id}
          onClick={() => setConfirm({ id: r.id, action })}
          aria-label={`${action === "stop" ? "Stop" : "Remove"} ${r.name}`}
          title={action === "stop" ? "docker stop, after you confirm" : "docker rm, after you confirm (volumes are kept)"}
        >
          <span className="hidden sm:inline">{action === "stop" ? "Stop" : "Remove"}</span>
        </Button>
      </span>
    );
  };

  const confirmRow = (r: ContainerRow) => {
    if (confirm?.id !== r.id) return null;
    const busy = pending === `${r.id}:${confirm.action}`;
    const stop = confirm.action === "stop";
    return (
      <tr>
        <td colSpan={COLUMNS} className="border-b border-line bg-warn-soft px-5 py-3">
          <div role="alertdialog" aria-label={`${stop ? "Stop" : "Remove"} ${r.name}?`} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
            <p className="min-w-0 flex-1 text-fg">
              <span className="font-medium">
                {stop ? "Stop" : "Remove"} <span className="font-mono">{r.name}</span>?
              </span>{" "}
              <span className="text-fg-2">
                It isn&apos;t part of any project in {ctx.projectsDir}, so it may not be yours.{" "}
                {stop ? "docker stop sends it SIGTERM; it can be started again later." : "docker rm deletes the container; its volumes and image are kept."}
              </span>
            </p>
            <span className="flex gap-1">
              <Button size="sm" variant="plain" disabled={busy} onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={busy ? LoaderCircle : stop ? Square : Trash2}
                spin={busy}
                disabled={busy}
                onClick={() => run(r.id, confirm.action, { id: r.id, action: confirm.action })}
                autoFocus
              >
                {stop ? "Stop container" : "Remove container"}
              </Button>
            </span>
          </div>
        </td>
      </tr>
    );
  };

  const stackLabel = (g: ContainerGroup, s: ContainerStackGroup) => (
    <>
      <Container aria-hidden size={15} strokeWidth={2} className="shrink-0 text-fg-3" />
      {s.name !== null ? (
        <>
          <span className="font-mono text-[13px] font-medium text-fg" title="Compose project">
            {s.name}
          </span>
          {s.dir && <span className="min-w-0 font-mono text-[12px] break-all text-fg-3">{g.project !== null ? `${s.dir}/` : s.dir}</span>}
        </>
      ) : (
        <span className="text-[13px] text-fg-2">Not from a compose file</span>
      )}
    </>
  );

  const stackError = (key: string) =>
    errors[key] && (
      <p role="alert" className="mt-1.5 pl-1 text-[12.5px] font-medium wrap-break-word text-bad">
        {errors[key]}
      </p>
    );

  let body;
  if (!data) {
    body = (
      <tr>
        <td colSpan={COLUMNS} className={`${TD} ${loadError ? "font-medium text-bad" : "text-fg-3"}`}>
          {loadError ?? "Reading containers…"}
        </td>
      </tr>
    );
  } else if (!daemonUp) {
    body = (
      <tr>
        <td colSpan={COLUMNS} className="border-b border-line p-4">
          <DockerNotice docker={data.docker} starting={ctx.dockerStarting} onStart={ctx.actions.startDocker} inline />
        </td>
      </tr>
    );
  } else if (all.length === 0) {
    body = (
      <tr>
        <td colSpan={COLUMNS} className="border-b border-line">
          <EmptyState icon={Container} title="No containers">
            Docker is running, but has no containers, running or stopped.
          </EmptyState>
        </td>
      </tr>
    );
  } else if (shown.length === 0) {
    body = (
      <tr>
        <td colSpan={COLUMNS} className={`${TD} text-fg-3`}>
          No containers match the filter.
        </td>
      </tr>
    );
  }

  return (
    <>
      <TitleBar
        title="Containers"
        actions={
          <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
            Refresh
          </Button>
        }
      />
      <PageBody>
        <p className="mb-4 text-[13.5px] text-fg-2">
          Every Docker container on this machine, running or stopped, by project and compose stack. Problems come first; containers that aren&apos;t in any
          project in {ctx.projectsDir} are listed under Other containers.
        </p>
        <Card>
          <FilterBar value={query} onChange={setQuery} placeholder="Name, image, project or port">
            {CHIPS.map((c) => (
              <Chip key={c.id} active={chip === c.id} count={data && daemonUp ? counts[c.id] : undefined} onClick={() => setChip((cur) => (cur === c.id ? null : c.id))}>
                {c.label}
              </Chip>
            ))}
          </FilterBar>
          <div className="relative overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={`${TH} pl-5`}>
                    Name
                  </th>
                  <th scope="col" className={`${TH} hidden sm:table-cell`}>
                    State
                  </th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>
                    Ports
                  </th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>
                    Up for
                  </th>
                  <th scope="col" className={`${TH} hidden text-right sm:table-cell`}>
                    CPU
                  </th>
                  <th scope="col" className={`${TH} hidden text-right sm:table-cell`}>
                    Memory
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              {body ? (
                <tbody>{body}</tbody>
              ) : (
                shown.map((g) => {
                  const rows = g.stacks.flatMap((s) => s.containers);
                  const problems = rows.filter((r) => r.problem).length;
                  const up = rows.filter(isUp).length;
                  return (
                    <tbody key={g.project ?? "\0other"}>
                      <tr>
                        <th scope="rowgroup" colSpan={COLUMNS} className="border-b border-line bg-subtle px-5 py-2.5 text-left font-normal">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {g.project !== null ? (
                              <>
                                <FolderGit2 aria-hidden size={16} strokeWidth={2} className="shrink-0 text-fg-3" />
                                <button type="button" onClick={() => ctx.actions.open(g.project!)} className="text-[14px] font-medium text-brand-text hover:underline" title={`Open ${g.project}`}>
                                  {g.project}
                                </button>
                                {hiddenNames.has(g.project) && <span className="text-[12px] text-fg-3">hidden</span>}
                              </>
                            ) : (
                              <>
                                <PackageOpen aria-hidden size={16} strokeWidth={2} className="shrink-0 text-fg-3" />
                                <span className="text-[14px] font-medium text-fg">Other containers</span>
                                <span className="text-[12.5px] text-fg-3">not in any project; often forgotten leftovers</span>
                              </>
                            )}
                            {g.lone && stackLabel(g, g.stacks[0])}
                            <span className="text-[12.5px] text-fg-2 tabular-nums">
                              {up} of {plural(rows.length, "container")} up
                            </span>
                            {problems > 0 && (
                              <Badge tone="bad" dot>
                                {plural(problems, "problem")}
                              </Badge>
                            )}
                            {g.lone && <span className="ml-auto flex gap-1">{stackActions(g, g.stacks[0])}</span>}
                          </div>
                          {g.lone && stackError(stackKey(g.project, g.stacks[0]))}
                        </th>
                      </tr>
                      {g.stacks.map((s) => {
                        const key = stackKey(g.project, s);
                        const sUp = s.containers.filter(isUp).length;
                        const actions = stackActions(g, s);
                        return (
                          <Fragment key={key}>
                            {!g.lone && (
                              <tr>
                                <td colSpan={COLUMNS} className="border-b border-line px-5 py-2">
                                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pl-1">
                                    {stackLabel(g, s)}
                                    <span className="text-[12px] text-fg-3 tabular-nums">
                                      {sUp} of {s.containers.length} up
                                    </span>
                                    {actions && <span className="ml-auto flex gap-1">{actions}</span>}
                                  </div>
                                  {stackError(key)}
                                </td>
                              </tr>
                            )}
                            {s.rows.map((r) => {
                              const st = rowState(r);
                              const use = usage?.usage[r.id];
                              const measuring = isUp(r) && !use && (!usage || usageLoading);
                              return (
                                <Fragment key={r.id}>
                                  <tr className="transition-colors hover:bg-hover">
                                    <td className={`${CELL} pl-6 sm:pl-9`}>
                                      <span className="block font-mono text-[13px] font-medium wrap-anywhere text-fg" title={r.name}>
                                        {r.service ?? r.name}
                                      </span>
                                      <span className="block font-mono text-[11.5px] wrap-anywhere text-fg-3">
                                        {r.service && r.service !== r.name ? `${r.name} · ` : ""}
                                        {r.image}
                                      </span>
                                      {/* Phones: state and ports under the name, in place of their columns. */}
                                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                                        <Badge tone={st.tone} dot pulse={st.tone === "ok"}>
                                          {st.label}
                                        </Badge>
                                        {st.when && <span className="text-[12px] text-fg-3">{st.when}</span>}
                                      </span>
                                      {r.ports.length > 0 && (
                                        <span className="mt-1 block md:hidden">
                                          <Ports ports={r.ports} />
                                        </span>
                                      )}
                                    </td>
                                    <td className={`${CELL} hidden whitespace-nowrap sm:table-cell`}>
                                      <Badge tone={st.tone} dot pulse={st.tone === "ok"}>
                                        {st.label}
                                      </Badge>
                                      {st.when && <span className="mt-1 block text-[12px] text-fg-3">{st.when}</span>}
                                    </td>
                                    <td className={`${CELL} hidden md:table-cell`}>
                                      <Ports ports={r.ports} />
                                    </td>
                                    <td className={`${CELL} hidden whitespace-nowrap text-fg-2 tabular-nums lg:table-cell`}>
                                      {isUp(r) && r.startedAt ? ageShort(r.startedAt) : <span className="text-fg-3">—</span>}
                                    </td>
                                    <td className={`${CELL} hidden text-right whitespace-nowrap text-fg-2 tabular-nums sm:table-cell`}>
                                      {use?.cpu != null ? `${use.cpu.toFixed(1)}%` : <span className="text-fg-3">{measuring ? "…" : "—"}</span>}
                                    </td>
                                    <td className={`${CELL} hidden text-right whitespace-nowrap text-fg-2 tabular-nums sm:table-cell`}>
                                      {use?.memory != null ? (
                                        <span title={use.memoryLimit ? `of ${formatBytes(use.memoryLimit)}` : undefined}>{formatBytes(use.memory)}</span>
                                      ) : (
                                        <span className="text-fg-3">{measuring ? "…" : "—"}</span>
                                      )}
                                    </td>
                                    <td className={`${CELL} text-right whitespace-nowrap sm:pr-4`}>
                                      {rowActions(g, r)}
                                      {errors[r.id] && (
                                        <span role="alert" className="mt-1 block text-[12px] font-medium whitespace-normal text-bad">
                                          {errors[r.id]}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                  {confirmRow(r)}
                                </Fragment>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  );
                })
              )}
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-[12.5px] text-fg-2">
            <span className="flex flex-wrap items-center gap-x-2">
              {daemonUp && counts.running > 0 && (
                <>
                  <span className={usage?.error ? "text-bad" : undefined}>
                    {usage?.error
                      ? `CPU and memory unavailable: ${usage.error}`
                      : usage
                        ? `CPU and memory as of ${timeAgo(usage.at)}`
                        : "Measuring CPU and memory…"}
                  </span>
                  <Button size="sm" variant="ghost" icon={usageLoading ? LoaderCircle : RefreshCw} spin={usageLoading} disabled={usageLoading} onClick={loadUsage}>
                    Measure now
                  </Button>
                </>
              )}
            </span>
            <span className="tabular-nums">
              {data && daemonUp
                ? `${shownCount === all.length ? plural(all.length, "container") : `${shownCount} of ${all.length} containers`} · ${counts.running} running`
                : ""}
            </span>
          </div>
        </Card>
      </PageBody>
    </>
  );
}

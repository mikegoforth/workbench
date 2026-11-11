"use client";

import { useEffect, useMemo, useState } from "react";
import { Container, Cpu, EthernetPort, ExternalLink, Globe, LoaderCircle, RefreshCw, Server, Square, type LucideIcon } from "lucide-react";
import { ageShort } from "@/lib/format";
import type { ListeningPort, PortOwner, PortsResult } from "@/lib/types";
import { Badge, Button, Card, Chip, EmptyState, FilterBar, PageBody, TABLE, TD, TH, TitleBar, buttonClass } from "./ui";
import type { Ctx } from "./model";

// Light enough to poll while the page is open (lsof + ps, or netstat + one PowerShell call).
const POLL_MS = 10_000;

type Group = "projects" | "containers" | "other";

const GROUPS: { id: Group; label: string }[] = [
  { id: "projects", label: "Projects" },
  { id: "containers", label: "Containers" },
  { id: "other", label: "Other processes" },
];

/** Which chip a row falls under: anything a project runs, any container, or the rest. */
function groupOf(owner: PortOwner): Group {
  if (owner.kind === "container") return "containers";
  if (owner.kind === "run" || (owner.kind === "process" && owner.project)) return "projects";
  return "other";
}

const ownerProject = (owner: PortOwner): string | null => (owner.kind === "self" ? null : owner.project);

/** Words a filter can match: port, addresses, process, pid, project, container, stack, service, image. */
function haystack(p: ListeningPort): string {
  const o = p.owner;
  const parts = [`:${p.port}`, String(p.port), ...p.addresses, p.process, p.pid?.toString(), ownerProject(o)];
  if (o.kind === "container") parts.push(o.container, o.stack, o.service, o.image);
  if (o.kind === "run") parts.push(o.script, o.task);
  if (o.kind === "self") parts.push("workbench");
  return parts.filter(Boolean).join(" ").toLowerCase();
}

interface StopPlan {
  url: string;
  body: object;
  label: string;
  title: string;
}

/**
 * Stop is only for what workbench runs: a project's dev environment or script
 * it started, or a compose stack in a project folder. Never an arbitrary process.
 */
function stopPlan(owner: PortOwner, projects: Set<string>): StopPlan | null {
  if (owner.kind === "run" && projects.has(owner.project)) {
    if (owner.slot === "script") {
      return {
        url: "/api/scripts",
        body: { projectName: owner.project, action: "stop" },
        label: "Stop",
        title: `Stop the script${owner.script ? ` "${owner.script}"` : ""} Workbench is running for ${owner.project}`,
      };
    }
    return {
      url: "/api/dev",
      body: { projectName: owner.project, action: "stop" },
      label: "Stop",
      title: `Stop ${owner.project}'s dev environment: its dev process and every container of the project`,
    };
  }
  if (owner.kind === "container" && owner.project && projects.has(owner.project) && owner.stack && owner.stackDir !== null) {
    return {
      url: "/api/docker",
      body: { projectName: owner.project, stack: owner.stack, dir: owner.stackDir, action: "stop" },
      label: "Stop stack",
      title: `Stop every running container of the ${owner.stack} compose stack in ${owner.project}`,
    };
  }
  return null;
}

function OwnerIcon({ owner }: { owner: PortOwner }) {
  const [Icon, label, tint]: [LucideIcon, string, string] =
    owner.kind === "run"
      ? [Server, "Started by Workbench", "text-ok"]
      : owner.kind === "container"
        ? [Container, "Docker container", "text-brand-text"]
        : owner.kind === "self"
          ? [EthernetPort, "Workbench", "text-brand-text"]
          : [Cpu, "Process", "text-fg-3"];
  return (
    <span title={label} className={`mt-0.5 shrink-0 ${tint}`}>
      <Icon aria-hidden size={16} strokeWidth={2} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ProjectLink({ name, ctx, known }: { name: string; ctx: Ctx; known: boolean }) {
  if (!known) return <span className="font-medium text-fg">{name}</span>;
  return (
    <button type="button" onClick={() => ctx.actions.open(name)} className="text-left font-medium wrap-break-word text-brand-text hover:underline">
      {name}
    </button>
  );
}

/** What holds the port, in words: the project and what of it, the container, or the process. */
function Owner({ row, ctx, projects }: { row: ListeningPort; ctx: Ctx; projects: Set<string> }) {
  const o = row.owner;
  // The process column is hidden on narrow screens; its facts go under the owner there.
  const plain = o.kind === "process" && !o.project;
  const proc = row.process && !plain ? `${row.process}${row.pid ? ` · pid ${row.pid}` : ""}` : row.pid ? `pid ${row.pid}` : null;
  let main;
  let sub: string | null;
  if (o.kind === "run") {
    main = <ProjectLink name={o.project} ctx={ctx} known={projects.has(o.project)} />;
    sub = o.task === "script" ? `Script${o.script ? ` "${o.script}"` : ""}, started by Workbench` : o.task === "install" ? "Dependency install, started by Workbench" : "Dev server, started by Workbench";
  } else if (o.kind === "container") {
    const where = [o.stack, o.service].filter(Boolean).join(" / ");
    main = o.project ? <ProjectLink name={o.project} ctx={ctx} known={projects.has(o.project)} /> : <span className="font-medium text-fg">{o.container}</span>;
    sub = o.project ? `Container ${where || o.container}` : `Container · ${o.image}`;
  } else if (o.kind === "self") {
    main = <span className="font-medium text-fg">Workbench</span>;
    sub = "This app's own server";
  } else if (o.project) {
    main = <ProjectLink name={o.project} ctx={ctx} known={projects.has(o.project)} />;
    sub = "Started in its folder, outside Workbench";
  } else {
    main = <span className="font-medium wrap-break-word text-fg">{row.process ?? "Unknown process"}</span>;
    sub = row.pid ? null : "Its process can't be seen without admin rights";
  }
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <OwnerIcon owner={o} />
      <div className="min-w-0">
        {main}
        {sub && <p className="mt-0.5 text-[12.5px] wrap-break-word text-fg-3">{sub}</p>}
        {proc && <p className="mt-0.5 font-mono text-[11.5px] wrap-break-word text-fg-3 lg:hidden">{proc}</p>}
      </div>
    </div>
  );
}

function Address({ row }: { row: ListeningPort }) {
  if (row.scope === null) return <span className="text-fg-3" title="Docker didn't say which address it's bound to">Unknown</span>;
  if (row.scope === "loopback") {
    return (
      <span className="text-fg-2" title={row.addresses.join(", ")}>
        localhost only
      </span>
    );
  }
  const wildcard = row.addresses.some((a) => a === "*" || a === "0.0.0.0" || a === "::");
  return (
    <Badge tone="warn" icon={Globe} title={`Reachable from other machines on your network: bound to ${row.addresses.join(", ")}`}>
      {wildcard ? "All interfaces" : row.addresses.filter((a) => !/^127\.|^::1$/.test(a)).join(", ")}
    </Badge>
  );
}

function PortRow({ row, ctx, projects, onStopped }: { row: ListeningPort; ctx: Ctx; projects: Set<string>; onStopped: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = stopPlan(row.owner, projects);

  const stop = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(plan.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.body) });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Couldn't stop it");
      ctx.actions.activity();
      onStopped();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const actions = (row.url || plan) && (
    <span className="inline-flex items-center gap-1">
      {row.url && (
        <a href={row.url} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")} title={`Open ${row.url}`}>
          <ExternalLink aria-hidden size={15} strokeWidth={2} className="shrink-0" />
          Open
        </a>
      )}
      {plan && (
        <Button size="sm" variant="danger" icon={busy ? LoaderCircle : Square} spin={busy} disabled={busy} onClick={stop} title={plan.title}>
          {busy ? "Stopping" : plan.label}
        </Button>
      )}
    </span>
  );
  const failure = error && (
    <span role="alert" className="mt-1 block text-[12px] font-medium whitespace-normal text-bad">
      {error}
    </span>
  );

  return (
    <tr className="transition-colors hover:bg-hover">
      <td className={`${TD} pr-2 pl-4 align-top font-mono text-[13.5px] font-medium whitespace-nowrap text-fg tabular-nums sm:pr-5 sm:pl-5`}>:{row.port}</td>
      <td className={`${TD} hidden align-top whitespace-nowrap sm:table-cell`}>
        <Address row={row} />
      </td>
      <td className={`${TD} pl-2 align-top sm:pl-5`}>
        <Owner row={row} ctx={ctx} projects={projects} />
        {/* Phones: the address and actions columns are folded in here. */}
        <div className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
          <Address row={row} />
          {actions}
        </div>
        <div className="sm:hidden">{failure}</div>
      </td>
      <td className={`${TD} hidden align-top lg:table-cell`}>
        {row.process ? (
          <span className="font-mono text-[12.5px] wrap-break-word text-fg-2">
            {row.process}
            {row.pid && <span className="text-fg-3"> · {row.pid}</span>}
          </span>
        ) : (
          <span className="text-fg-3">{row.pid ? `pid ${row.pid}` : "—"}</span>
        )}
      </td>
      <td className={`${TD} hidden align-top whitespace-nowrap text-fg-2 tabular-nums md:table-cell`} title={row.startedAt ? new Date(row.startedAt).toLocaleString() : undefined}>
        {row.startedAt ? ageShort(row.startedAt) : <span className="text-fg-3">—</span>}
      </td>
      <td className={`${TD} hidden pr-5 text-right align-top whitespace-nowrap sm:table-cell`}>
        {actions}
        {failure}
      </td>
    </tr>
  );
}

async function fetchPorts(): Promise<PortsResult> {
  const res = await fetch("/api/ports");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as PortsResult;
}

export default function PortsView({ ctx }: { ctx: Ctx }) {
  const [result, setResult] = useState<PortsResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Set<Group>>(new Set());
  const [networkOnly, setNetworkOnly] = useState(false);

  // Bumped by Refresh and after a Stop, to check again right away.
  const [check, setCheck] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchPorts()
        .then((r) => {
          if (cancelled) return;
          setResult(r);
          setFailed(null);
        })
        .catch((e: Error) => {
          if (!cancelled) setFailed(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [check]);

  const refresh = () => {
    setLoading(true);
    setCheck((n) => n + 1);
  };

  const projects = useMemo(() => new Set(ctx.items.map((i) => i.project.name)), [ctx.items]);
  const all = useMemo(() => result?.ports ?? [], [result]);
  const q = query.trim().toLowerCase();
  const matching = useMemo(() => (q ? all.filter((p) => haystack(p).includes(q)) : all), [all, q]);
  const rows = matching.filter((p) => (groups.size === 0 || groups.has(groupOf(p.owner))) && (!networkOnly || p.scope === "network"));
  const exposed = all.filter((p) => p.scope === "network").length;
  const filtered = q !== "" || groups.size > 0 || networkOnly;

  const toggle = (g: Group) =>
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const error = failed ?? result?.error;

  return (
    <>
      <TitleBar
        title="Ports"
        actions={
          <Button variant="ghost" icon={RefreshCw} spin={loading} onClick={refresh}>
            Refresh
          </Button>
        }
      />
      <PageBody>
        <p className="mb-4 text-[13.5px] text-fg-2">
          Every TCP port listening on this computer and what holds it. Stop is offered only for what Workbench runs: a project&apos;s dev environment,
          script or compose stack.
        </p>
        <Card>
          <FilterBar value={query} onChange={setQuery} placeholder="Filter by port, project, container or process">
            {GROUPS.map((g) => (
              <Chip key={g.id} active={groups.has(g.id)} onClick={() => toggle(g.id)} count={matching.filter((p) => groupOf(p.owner) === g.id).length}>
                {g.label}
              </Chip>
            ))}
            <Chip active={networkOnly} onClick={() => setNetworkOnly((v) => !v)} count={matching.filter((p) => p.scope === "network").length}>
              Open to network
            </Chip>
          </FilterBar>
          {error && (
            <p role="alert" className="border-b border-bad-line bg-bad-soft px-5 py-3 text-[13px] text-bad">
              Couldn&apos;t list every port: {error}
            </p>
          )}
          <div className="relative overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={`${TH} w-20 pr-2 pl-4 sm:w-24 sm:pl-5`}>
                    Port
                  </th>
                  <th scope="col" className={`${TH} hidden sm:table-cell`}>
                    Address
                  </th>
                  <th scope="col" className={`${TH} pl-2 sm:pl-4`}>
                    Used by
                  </th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>
                    Process
                  </th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>
                    Up
                  </th>
                  <th scope="col" className={`${TH} hidden pr-5 text-right sm:table-cell`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!result && !failed ? (
                  <tr>
                    <td colSpan={6} className="border-b border-line px-5 py-8 text-center text-[13px] text-fg-2">
                      <LoaderCircle aria-hidden size={18} className="mr-2 inline animate-spin text-brand" />
                      Checking which ports are open…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="border-b border-line">
                      {filtered && all.length > 0 ? (
                        <EmptyState icon={EthernetPort} title="No ports match">
                          Clear the filter to see all {all.length}.
                        </EmptyState>
                      ) : (
                        <EmptyState icon={EthernetPort} title="Nothing is listening">
                          No TCP ports are open on this computer right now. Start a project&apos;s dev environment and its port shows up here.
                        </EmptyState>
                      )}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => <PortRow key={`${row.port}/${row.pid ?? ""}`} row={row} ctx={ctx} projects={projects} onStopped={refresh} />)
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-[12.5px] text-fg-2">
            <span className="text-fg-3">{result?.note}</span>
            <span className="tabular-nums">
              {filtered && rows.length !== all.length ? `${rows.length} of ${all.length}` : all.length} listening
              {exposed > 0 && <span className="text-warn"> · {exposed} open to the network</span>}
            </span>
          </div>
        </Card>
      </PageBody>
    </>
  );
}

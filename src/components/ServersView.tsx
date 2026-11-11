"use client";

import { useEffect, useState } from "react";
import { EllipsisVertical, LoaderCircle, RefreshCw, RotateCw, ScrollText, Server, Square } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { DevStatus } from "@/lib/types";
import { serviceState, stacksSummary } from "./Docker";
import { Badge, Button, Card, EmptyState, Menu, PageBody, StatusIcon, TABLE, TD, TH, TitleBar, TR, type MenuItem } from "./ui";
import type { Ctx, Item } from "./model";
import { rowOpener } from "./ProjectsView";

const POLL_MS = 5000;

/** Polls one project's dev status; can stop everything it runs and restart its containers. */
export function useServer(name: string, onActivity: () => void) {
  const [dev, setDev] = useState<DevStatus | null>(null);
  const [busy, setBusy] = useState<"stop" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      fetch(`/api/dev?project=${encodeURIComponent(name)}`)
        .then((res) => (res.ok ? (res.json() as Promise<DevStatus>) : null))
        .then((s) => {
          if (!cancelled && s) setDev(s);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [name]);

  const post = async (url: string, body: object, fallback: string) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error ?? fallback);
    setDev(json as DevStatus);
  };

  const run = async (kind: "stop" | "restart") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "stop") {
        // The dev process and every container of the project, however they were started.
        await post("/api/dev", { projectName: name, action: "stop" }, "Couldn't stop it");
      } else {
        for (const stack of dev?.stacks ?? []) {
          if (stack.services.some((s) => serviceState(s).up)) {
            await post("/api/docker", { projectName: name, stack: stack.name, dir: stack.dir, action: "restart" }, `Couldn't restart ${stack.name}`);
          }
        }
      }
      onActivity();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const summary = dev ? stacksSummary(dev.stacks) : null;
  const canStop = !!dev && (dev.running || dev.processRunning);
  return { dev, summary, canStop, stop: () => run("stop"), restart: () => run("restart"), busy, error };
}

/** Where it's served: the dev URL, else the ports its containers publish. */
export function Serving({ dev, ports }: { dev: DevStatus | null; ports?: number[] }) {
  if (dev?.url) {
    return (
      <a href={dev.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[12.5px] text-brand-text hover:underline">
        {dev.url.replace(/^https?:\/\//, "")}
      </a>
    );
  }
  if (dev?.task === "install") return <span className="text-fg-2">Installing dependencies</span>;
  if (ports && ports.length > 0) {
    return (
      <span className="font-mono text-[12.5px] text-fg" title="Published container ports on localhost">
        {ports.map((p) => `:${p}`).join("  ")}
      </span>
    );
  }
  return <span className="text-fg-3">{dev ? "—" : "Checking…"}</span>;
}

function ServerRow({ item, ctx }: { item: Item; ctx: Ctx }) {
  const { project: p, status } = item;
  const { dev, summary, canStop, stop, restart, busy, error } = useServer(p.name, ctx.actions.activity);
  // When it came up: the dev process if workbench started one, else its oldest running container.
  const containerStarts = (dev?.stacks ?? []).flatMap((st) => st.services).filter((sv) => serviceState(sv).up && sv.startedAt).map((sv) => sv.startedAt!);
  const started = dev?.processRunning && dev.startedAt ? dev.startedAt : containerStarts.sort()[0];
  const menu: MenuItem[] = [
    { label: "Restart containers", icon: RotateCw, onSelect: restart, disabled: !summary?.up || busy !== null },
    { label: "View logs", icon: ScrollText, onSelect: () => ctx.actions.openTab(p.name, "logs"), disabled: !summary?.total },
    { label: "Dev environment", icon: Server, onSelect: () => ctx.actions.openTab(p.name, "dev") },
  ];
  return (
    <tr onClick={rowOpener(() => ctx.actions.open(p.name))} className={TR}>
      <td className={`${TD} pl-4`}>
        <StatusIcon status={status} />
      </td>
      <td className={TD}>
        <button type="button" onClick={() => ctx.actions.open(p.name)} className="text-left font-medium wrap-break-word text-brand-text hover:underline">
          {p.name}
        </button>
        {p.hidden && <span className="ml-2 text-[12px] text-fg-3">hidden</span>}
      </td>
      <td className={TD}>
        <Serving dev={dev} ports={ctx.ports[p.name]} />
      </td>
      <td className={`${TD} hidden md:table-cell text-fg-2`}>
        {summary?.total ? `${summary.up} of ${summary.total} up` : dev?.processRunning ? "Dev server only" : "—"}
      </td>
      <td className={`${TD} hidden lg:table-cell`}>
        {summary?.worst ? (
          <Badge tone={summary.worst.tone} dot>
            {summary.worst.label}
          </Badge>
        ) : (
          <span className="text-fg-3">—</span>
        )}
      </td>
      <td className={`${TD} hidden sm:table-cell whitespace-nowrap text-fg-2`}>{started ? timeAgo(started) : "—"}</td>
      <td className={`${TD} text-right whitespace-nowrap`}>
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="danger" icon={busy === "stop" ? LoaderCircle : Square} spin={busy === "stop"} disabled={!canStop || busy !== null} onClick={stop} title="Stop the dev process and every container of this project">
            {busy === "stop" ? "Stopping" : "Stop"}
          </Button>
          {busy === "restart" ? (
            <LoaderCircle aria-label="Restarting" size={16} className="mx-1.5 animate-spin text-fg-2" />
          ) : (
            <Menu label={`More for ${p.name}`} icon={EllipsisVertical} items={menu} />
          )}
        </span>
        {error && (
          <span role="alert" className="mt-1 block text-[12px] font-medium whitespace-normal text-bad">
            {error}
          </span>
        )}
      </td>
    </tr>
  );
}

export default function ServersView({ ctx, items }: { ctx: Ctx; items: Item[] }) {
  return (
    <>
      <TitleBar
        title="Running"
        actions={
          <Button variant="ghost" icon={RefreshCw} onClick={ctx.actions.activity}>
            Refresh
          </Button>
        }
      />
      <PageBody>
        <p className="mb-4 text-[13.5px] text-fg-2">
          Dev servers, scripts and containers running for any project in {ctx.projectsDir}, including hidden ones and stacks started outside Workbench.
        </p>
        <Card>
          <div className="relative overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={`${TH} w-12 pl-4`}>
                    <span className="sr-only">Status</span>
                  </th>
                  <th scope="col" className={TH}>
                    Name
                  </th>
                  <th scope="col" className={TH}>
                    Serving
                  </th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>
                    Containers
                  </th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>
                    Health
                  </th>
                  <th scope="col" className={`${TH} hidden sm:table-cell`}>
                    Up since
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="border-b border-line">
                      <EmptyState icon={Server} title="Nothing running">
                        Open a project and press Start (or S) to run its dev environment.
                      </EmptyState>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => <ServerRow key={item.project.name} item={item} ctx={ctx} />)
                )}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 text-right text-[12.5px] text-fg-2 tabular-nums">
            {items.length} running
          </div>
        </Card>
      </PageBody>
    </>
  );
}

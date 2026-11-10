"use client";

import { useState } from "react";
import { Container, LoaderCircle, Play, RotateCw, Square, TriangleAlert, X } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { Tone } from "@/lib/status";
import type { ComposeStack, DevService, DockerDaemon } from "@/lib/types";
import { Badge, Button } from "./ui";

// ---- Daemon ----

/** "Docker isn't running" with a button to launch it; for the top of the page or inside a panel. */
export function DockerNotice({
  docker,
  starting,
  onStart,
  onDismiss,
  inline = false,
}: {
  docker: DockerDaemon;
  starting: boolean;
  onStart: () => void;
  onDismiss?: () => void;
  inline?: boolean;
}) {
  const stopped = docker.state === "stopped";
  const title = stopped ? "Docker isn't running" : docker.state === "missing" ? "Docker isn't installed" : "Docker isn't responding";
  // No app to launch (Docker Engine on Linux): say how to start it instead of offering a button.
  const manual = stopped && !docker.app && docker.startCommand;
  const detail = manual ? (
    <>
      Start it in a terminal: <code className="font-mono text-[12.5px] text-fg">{docker.startCommand}</code>. Until then, containers
      can&apos;t start, and their status, health and logs are unknown.
    </>
  ) : stopped ? (
    "Containers can't start, and their status, health and logs are unknown until it's up."
  ) : (
    (docker.message ?? "")
  );
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-warn-line bg-warn-soft text-[13.5px] ${
        inline ? "rounded border px-3 py-2.5" : "border-b px-5 py-3 sm:px-5"
      }`}
    >
      <TriangleAlert aria-hidden size={18} strokeWidth={2} className="shrink-0 text-warn" />
      <p className="min-w-0 flex-1 text-fg">
        <span className="font-medium">{title}.</span> <span className="text-fg-2">{detail}</span>
      </p>
      {docker.app && docker.state !== "missing" && (
        <Button size="sm" variant="primary" icon={starting ? LoaderCircle : Play} spin={starting} disabled={starting} onClick={onStart}>
          {starting ? `Starting ${docker.app}…` : `Start ${docker.app === "Docker" ? "Docker Desktop" : docker.app}`}
        </Button>
      )}
      {onDismiss && <Button size="sm" variant="plain" icon={X} onClick={onDismiss} aria-label="Dismiss" title="Dismiss until next visit" />}
    </div>
  );
}

// ---- Services ----

const SIGNAL_EXITS = new Set([130, 137, 143]);
const RECENT_MS = 24 * 60 * 60_000;

/** One word (and tone) for a service's container. */
export function serviceState(s: Pick<DevService, "state" | "health" | "oomKilled" | "exitCode" | "finishedAt">): { label: string; tone: Tone; up: boolean } {
  if (s.state === "not created") return { label: "Not created", tone: "neutral", up: false };
  if (s.state === "restarting") return { label: "Restarting", tone: "bad", up: true };
  if (s.state === "paused") return { label: "Paused", tone: "warn", up: true };
  if (s.state === "running") {
    if (s.health === "unhealthy") return { label: "Unhealthy", tone: "bad", up: true };
    if (s.health === "starting") return { label: "Starting", tone: "warn", up: true };
    if (s.health === "healthy") return { label: "Healthy", tone: "ok", up: true };
    return { label: "Running", tone: "ok", up: true };
  }
  if (s.oomKilled) return { label: "Out of memory", tone: "bad", up: false };
  if (s.state === "dead") return { label: "Dead", tone: "bad", up: false };
  if (s.exitCode) {
    // Red only for a real error exit in the last day; old exits are history.
    const recent = !!s.finishedAt && Date.now() - Date.parse(s.finishedAt) < RECENT_MS;
    return { label: `Exited (${s.exitCode})`, tone: recent && !SIGNAL_EXITS.has(s.exitCode) ? "bad" : "neutral", up: false };
  }
  return { label: s.state === "exited" ? "Exited" : s.state, tone: "neutral", up: false };
}

/** The worst state among containers that are up, for one-word summaries ("2 of 3 up · Unhealthy"). */
export function stacksSummary(stacks: ComposeStack[]): { up: number; total: number; worst: ReturnType<typeof serviceState> | null } {
  const services = stacks.flatMap((s) => s.services).filter((s) => s.container);
  const states = services.map(serviceState);
  const rank = (t: Tone) => ({ bad: 0, warn: 1, ok: 2, info: 3, neutral: 4 })[t];
  const worst = states.filter((s) => s.up).sort((a, b) => rank(a.tone) - rank(b.tone))[0] ?? null;
  return { up: states.filter((s) => s.up).length, total: services.length, worst };
}

function ServiceRow({ s }: { s: DevService }) {
  const st = serviceState(s);
  const when = st.up ? (s.startedAt ? `up since ${timeAgo(s.startedAt)}` : null) : s.finishedAt ? `${timeAgo(s.finishedAt)}` : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[13px]">
      <Badge tone={st.tone} dot pulse={st.tone === "ok" && st.up}>
        {st.label}
      </Badge>
      <span className="font-mono text-[12.5px] text-fg">{s.name}</span>
      {when && <span className="text-[12px] text-fg-3">{when}</span>}
      {s.image && <span className="hidden truncate font-mono text-[11.5px] text-fg-3 xl:inline">{s.image}</span>}
      <span className="ml-auto flex gap-2">
        {s.ports.map((port) => (
          <a key={port} href={`http://localhost:${port}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[12.5px] text-brand-text hover:underline">
            :{port}
          </a>
        ))}
      </span>
    </li>
  );
}

export type StackActionKind = "start" | "stop" | "restart";

/** Every compose stack of a project, each with its services and Start / Stop / Restart. */
export function StackList({
  stacks,
  docker,
  pending,
  onAction,
}: {
  stacks: ComposeStack[];
  docker: DockerDaemon;
  /** `${name}@${dir}:${action}` while that action runs. */
  pending: string | null;
  onAction: (stack: ComposeStack, action: StackActionKind) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (stacks.length === 0) return null;
  const daemonUp = docker.state === "running";

  return (
    <div className="border-t border-line">
      <p className="px-4 pt-3 text-[12.5px] font-medium text-fg-2">Compose stacks</p>
      <ul>
        {stacks.map((stack) => {
          const key = `${stack.name}@${stack.dir}`;
          const busy = pending?.startsWith(`${key}:`) ?? false;
          const isPending = (a: StackActionKind) => pending === `${key}:${a}`;
          const up = stack.services.filter((s) => serviceState(s).up).length;
          const created = stack.services.filter((s) => s.container).length;
          const file = stack.files[0];
          // Long stacks (many old containers) show their live services first.
          const sorted = [...stack.services].sort((a, b) => Number(serviceState(b).up) - Number(serviceState(a).up));
          const shown = expanded[key] ? sorted : sorted.slice(0, 6);
          return (
            <li key={key} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <Container aria-hidden size={16} strokeWidth={2} className="shrink-0 text-fg-3" />
                <span className="font-mono text-[13px] font-medium text-fg">{stack.name}</span>
                <span className="font-mono text-[12px] text-fg-3">
                  {stack.dir ? `${stack.dir}/` : ""}
                  {file ?? ""}
                </span>
                {stack.primary && <Badge tone="info">Runs with Start</Badge>}
                <span className="text-[12px] text-fg-3">
                  {created === 0 ? "not created" : `${up} of ${created} up`}
                </span>
                <span className="ml-auto flex gap-1">
                  {up > 0 ? (
                    <>
                      <Button size="sm" icon={isPending("restart") ? LoaderCircle : RotateCw} spin={isPending("restart")} disabled={busy || !daemonUp} onClick={() => onAction(stack, "restart")}>
                        Restart
                      </Button>
                      <Button size="sm" variant="danger" icon={isPending("stop") ? LoaderCircle : Square} spin={isPending("stop")} disabled={busy || !daemonUp} onClick={() => onAction(stack, "stop")}>
                        Stop
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      icon={isPending("start") ? LoaderCircle : Play}
                      spin={isPending("start")}
                      disabled={busy || !daemonUp || (stack.fromFiles && (!!stack.conflict || !!stack.error)) || (!stack.fromFiles && created === 0)}
                      onClick={() => onAction(stack, "start")}
                      title={stack.error ? "Fix the compose file first" : stack.fromFiles ? "docker compose up -d" : "docker start (its compose files are gone)"}
                    >
                      Start
                    </Button>
                  )}
                </span>
              </div>
              {stack.conflict && (
                <p className="mt-1.5 text-[12.5px] text-warn">
                  Same compose project name as <span className="font-mono">{stack.conflict}</span>, so starting it would take over
                  those containers. Give one a different <code className="font-mono">name:</code>.
                </p>
              )}
              {stack.error && <p className="mt-1.5 text-[12.5px] wrap-break-word text-fg-3">Compose file doesn&apos;t load: {stack.error}</p>}
              {!stack.fromFiles && (
                <p className="mt-1.5 text-[12.5px] text-fg-3">Its compose files are gone; Start restarts the existing containers.</p>
              )}
              {stack.services.length > 0 && (
                <ul className="mt-2 divide-y divide-line rounded border border-line">
                  {shown.map((s) => (
                    <ServiceRow key={s.container ?? s.name} s={s} />
                  ))}
                  {sorted.length > shown.length || expanded[key] ? (
                    <li className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setExpanded((e) => ({ ...e, [key]: !e[key] }))}
                        className="text-[12.5px] font-medium text-brand-text hover:underline"
                      >
                        {expanded[key] ? "Show fewer" : `Show all ${sorted.length}`}
                      </button>
                    </li>
                  ) : null}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

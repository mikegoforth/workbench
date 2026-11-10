"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, Play, Square } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { Tone } from "@/lib/status";
import type { ComposeStack, DevStatus } from "@/lib/types";
import { DockerNotice, StackList, type StackActionKind } from "./Docker";
import { Badge, Button, Panel, PropertyList } from "./ui";
import LogPanel from "./LogPanel";

const POLL_MS = 2500;

export type DevAction = "start" | "stop" | "install";

// Last status seen per project, so coming back to a repo shows its state at once.
const lastStatus = new Map<string, DevStatus>();

/** Polls a project's dev environment and runs Start / Stop / Install. */
export function useDevStatus(projectName: string, onActivity?: () => void) {
  const [status, setStatus] = useState<DevStatus | null>(() => lastStatus.get(projectName) ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<DevAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const lastRunning = useRef<boolean | null>(null);
  const activityRef = useRef(onActivity);
  useEffect(() => {
    activityRef.current = onActivity;
  });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      fetch(`/api/dev?project=${encodeURIComponent(projectName)}`)
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error(body?.error ?? "Couldn't load the dev environment");
          return body as DevStatus;
        })
        .then((s) => {
          if (cancelled) return;
          lastStatus.set(projectName, s);
          setStatus(s);
          setLoadError(null);
          // Something stopped or started on its own: let the board know.
          if (lastRunning.current !== null && lastRunning.current !== s.running) activityRef.current?.();
          lastRunning.current = s.running;
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
  }, [projectName]);

  const act = async (action: DevAction) => {
    setPending(action);
    setActionError(null);
    if (action !== "stop") setShowLog(true);
    try {
      const res = await fetch("/api/dev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, action }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Couldn't ${action}`);
      lastStatus.set(projectName, body as DevStatus);
      setStatus(body as DevStatus);
      lastRunning.current = (body as DevStatus).running;
      onActivity?.();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPending(null);
    }
  };

  // One compose stack: start, stop or restart. `stackPending` is "<name>@<dir>:<action>".
  const [stackPending, setStackPending] = useState<string | null>(null);
  const stackAct = async (stack: ComposeStack, action: StackActionKind) => {
    setStackPending(`${stack.name}@${stack.dir}:${action}`);
    setActionError(null);
    try {
      const res = await fetch("/api/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, stack: stack.name, dir: stack.dir, action }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Couldn't ${action} ${stack.name}`);
      lastStatus.set(projectName, body as DevStatus);
      setStatus(body as DevStatus);
      lastRunning.current = (body as DevStatus).running;
      onActivity?.();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setStackPending(null);
    }
  };

  const hasPlan = (status?.steps.length ?? 0) > 0;
  const running = status?.running ?? false;
  return {
    status,
    loadError,
    pending,
    actionError,
    setActionError,
    act,
    stackAct,
    stackPending,
    showLog,
    setShowLog,
    canStart: hasPlan && !running && pending === null,
    canStop: (running || (status?.processRunning ?? false)) && pending === null,
  };
}

export type DevControls = ReturnType<typeof useDevStatus>;

/** What the dev environment is doing right now, as a status word and tone. */
export function devState(dev: DevControls): { label: string; tone: Tone; busy: boolean } {
  const { status, pending } = dev;
  if (pending === "start") return { label: "Starting", tone: "warn", busy: true };
  if (pending === "stop") return { label: "Stopping", tone: "warn", busy: true };
  if (pending === "install" || status?.task === "install") return { label: "Installing", tone: "warn", busy: true };
  if (status?.running) return { label: "Running", tone: "ok", busy: false };
  return { label: status ? "Stopped" : "Checking", tone: "neutral", busy: false };
}

/** Start / Stop for the title bar and the panel. */
export function DevButtons({ dev, size = "sm" }: { dev: DevControls; size?: "sm" | "md" }) {
  const { pending, act, canStart, canStop } = dev;
  return (
    <>
      <Button
        variant="primary"
        size={size}
        icon={pending === "start" ? LoaderCircle : Play}
        spin={pending === "start"}
        onClick={() => act("start")}
        disabled={!canStart}
        title="Start the dev environment (S)"
      >
        Start
      </Button>
      <Button
        variant="danger"
        size={size}
        icon={pending === "stop" ? LoaderCircle : Square}
        spin={pending === "stop"}
        onClick={() => act("stop")}
        disabled={!canStop}
      >
        Stop
      </Button>
    </>
  );
}

/** Dev environment: state, Start/Stop, what Start runs, where it's served, compose stacks, output. */
export function RunPanel({
  dev,
  dockerStarting = false,
  onStartDocker,
  className = "",
}: {
  dev: DevControls;
  dockerStarting?: boolean;
  onStartDocker?: () => void;
  className?: string;
}) {
  const { status, loadError, actionError, showLog, setShowLog } = dev;
  const state = devState(dev);

  const rows: { label: string; value: ReactNode }[] = [];
  if (status) {
    rows.push({
      label: "Status",
      value: (
        <Badge tone={state.tone} dot pulse={state.tone === "ok" || state.busy}>
          {state.label}
        </Badge>
      ),
    });
    rows.push({
      label: "Start runs",
      value:
        status.steps.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {status.steps.map((step, i) => (
              <span key={step} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-fg-3">then</span>}
                <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-[12px] text-fg">{step}</code>
              </span>
            ))}
          </span>
        ) : status.stacks.length > 0 ? (
          <span className="text-fg-3">
            Nothing at the project root. Start the compose stacks below one at a time; Stop stops them all.
          </span>
        ) : (
          <span className="text-fg-3">
            Nothing to run: no compose file, and no <code className="font-mono text-[12px]">dev</code> or{" "}
            <code className="font-mono text-[12px]">start</code> script.
          </span>
        ),
    });
    if (status.url) {
      rows.push({
        label: "URL",
        value: (
          <a href={status.url} target="_blank" rel="noopener noreferrer" className="font-mono text-brand-text hover:underline">
            {status.url}
          </a>
        ),
      });
    }
    if (status.startedAt && (status.running || status.processRunning)) {
      rows.push({ label: "Started", value: timeAgo(status.startedAt) });
    }
  }

  return (
    <Panel id="run-heading" title="Dev environment" className={className} bodyClassName="" actions={<DevButtons dev={dev} />}>
      {!status ? (
        <p className="px-4 py-3 text-[13px] text-fg-3">{loadError ?? "Checking what's running…"}</p>
      ) : (
        <>
          <PropertyList rows={rows} />
          {status.dockerError && onStartDocker && (
            <div className="border-t border-line px-4 py-3">
              <DockerNotice docker={status.docker} starting={dockerStarting} onStart={onStartDocker} inline />
            </div>
          )}
          <StackList stacks={status.stacks} docker={status.docker} pending={dev.stackPending} onAction={dev.stackAct} />
          {(status.note || (status.dockerError && !onStartDocker) || actionError) && (
            <div className="space-y-1 border-t border-line px-4 py-2.5 text-[13px]">
              {status.note && <p className="text-fg-3">{status.note}</p>}
              {status.dockerError && !onStartDocker && <p className="font-medium text-warn">Docker: {status.dockerError}</p>}
              {actionError && (
                <p role="alert" className="font-medium text-bad">
                  {actionError}
                </p>
              )}
            </div>
          )}
          {(status.log.length > 0 || showLog) && (
            <div className="border-t border-line px-4 py-2.5">
              <LogPanel lines={status.log} open={showLog} onToggle={() => setShowLog((v) => !v)} followKey={status.startedAt} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

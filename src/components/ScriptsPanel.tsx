"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play, Square } from "lucide-react";
import type { Tone } from "@/lib/status";
import type { ScriptStatus } from "@/lib/types";
import { Badge, Button, Panel, ShowAll } from "./ui";
import LogPanel from "./LogPanel";

const POLL_MS = 2500;
const LIMIT = 6;

export default function ScriptsPanel({
  projectName,
  onActivity,
  className = "",
}: {
  projectName: string;
  onActivity?: () => void;
  className?: string;
}) {
  const [status, setStatus] = useState<ScriptStatus | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [runCount, setRunCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const lastRunning = useRef<boolean | null>(null);
  const activityRef = useRef(onActivity);
  useEffect(() => {
    activityRef.current = onActivity;
  });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      fetch(`/api/scripts?project=${encodeURIComponent(projectName)}`)
        .then((res) => (res.ok ? (res.json() as Promise<ScriptStatus>) : null))
        .then((s) => {
          if (cancelled || !s) return;
          setStatus(s);
          if (lastRunning.current !== null && lastRunning.current !== s.running) activityRef.current?.();
          lastRunning.current = s.running;
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectName]);

  const send = async (body: { action: "run"; script: string } | { action: "stop" }) => {
    setPending(body.action === "run" ? body.script : "stop");
    setError(null);
    if (body.action === "run") {
      setShowLog(true);
      setRunCount((n) => n + 1);
    }
    try {
      const res = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, ...body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Couldn't run the script");
      setStatus(json as ScriptStatus);
      lastRunning.current = (json as ScriptStatus).running;
      onActivity?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };

  // Projects without package.json scripts show nothing here.
  if (!status || status.scripts.length === 0) return null;

  const result: { text: string; tone: Tone } | null = status.current
    ? status.running
      ? { text: `${status.current} running`, tone: "warn" }
      : status.exitCode === 0
        ? { text: `${status.current} passed`, tone: "ok" }
        : status.exitCode !== null
          ? { text: `${status.current} failed · exit ${status.exitCode}`, tone: "bad" }
          : status.log.length > 0
            ? { text: `${status.current} stopped`, tone: "neutral" }
            : null
    : null;

  return (
    <Panel
      id="scripts-heading"
      title="Scripts"
      count={status.scripts.length}
      description={<span className="font-mono">{status.pm} run</span>}
      actions={result ? <Badge tone={result.tone} dot pulse={status.running}>{result.text}</Badge> : undefined}
      className={className}
      bodyClassName="p-2"
    >
      <ul>
        {(expanded ? status.scripts : status.scripts.slice(0, LIMIT)).map((script) => {
          const isDev = script.name === status.devScript;
          const isRunning = status.running && status.current === script.name;
          return (
            <li key={script.name} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] font-medium text-fg">{script.name}</p>
                <p className="truncate font-mono text-[11.5px] text-fg-3" title={script.command}>
                  {isDev ? "Runs with Start" : script.command}
                </p>
              </div>
              {isRunning ? (
                <Button size="sm" variant="danger" icon={Square} onClick={() => send({ action: "stop" })} disabled={pending !== null}>
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon={pending === script.name ? LoaderCircle : Play}
                  spin={pending === script.name}
                  onClick={() => send({ action: "run", script: script.name })}
                  disabled={isDev || status.running || pending !== null}
                  title={isDev ? "Start runs this one" : `${status.pm} run ${script.name}`}
                  aria-label={`Run ${script.name}`}
                >
                  Run
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="px-2">
        <ShowAll total={status.scripts.length} limit={LIMIT} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      </div>
      {(error || status.log.length > 0 || showLog) && (
        <div className="mt-2 space-y-2 border-t border-line px-2 pt-3 pb-1">
          {error && (
            <p role="alert" className="text-[13px] font-medium text-bad">
              {error}
            </p>
          )}
          <LogPanel lines={status.log} open={showLog} onToggle={() => setShowLog((v) => !v)} followKey={`${status.current}-${runCount}`} />
        </div>
      )}
    </Panel>
  );
}

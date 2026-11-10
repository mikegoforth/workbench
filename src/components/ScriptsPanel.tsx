"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Play, Square } from "lucide-react";
import type { Tone } from "@/lib/status";
import { matchesScript, orderScripts } from "@/lib/scriptOrder";
import type { ScriptStatus } from "@/lib/types";
import { Badge, Button, FilterBar, Panel, ShowAll } from "./ui";
import LogPanel from "./LogPanel";

const POLL_MS = 2500;
const LIMIT = 6;
/** Above this many scripts the list gets a filter. */
const FILTER_FROM = 10;

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
  const [query, setQuery] = useState("");
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

  // dev, start, build, test, lint… first; the rest as package.json lists them.
  const scripts = useMemo(() => orderScripts(status?.scripts ?? []), [status?.scripts]);

  // Projects without package.json scripts show nothing here.
  if (!status || scripts.length === 0) return null;

  const filtering = scripts.length > FILTER_FROM;
  const q = filtering ? query.trim() : "";
  const matches = q ? scripts.filter((s) => matchesScript(s, q)) : scripts;
  // A filter shows every match; otherwise the first few, plus the running one wherever it is.
  const shown = q || expanded ? matches : matches.filter((s, i) => i < LIMIT || (status.running && s.name === status.current));

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
      bodyClassName={filtering ? "" : "p-2"}
    >
      {filtering && <FilterBar value={query} onChange={setQuery} placeholder="Filter by name or command" />}
      {shown.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-fg-3">No scripts match the filter.</p>
      ) : (
        <ul className={filtering ? "p-2" : ""}>
          {shown.map((script) => {
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
      )}
      {!q && (
        <div className={filtering ? "px-4 pb-3" : "px-2"}>
          <ShowAll total={scripts.length} limit={LIMIT} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        </div>
      )}
      {(error || status.log.length > 0 || showLog) && (
        <div className={`mt-2 space-y-2 border-t border-line pt-3 ${filtering ? "px-4 pb-3" : "px-2 pb-1"}`}>
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

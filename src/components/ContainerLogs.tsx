"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, ScrollText } from "lucide-react";
import type { ContainerLogLine, ContainerLogs as LogsData } from "@/lib/types";
import { Button, Chip, EmptyState, FilterBar, Panel } from "./ui";

const POLL_MS = 2000;
const MAX_LINES = 5000;

// Per-container colors that read on the dark log background.
const COLORS = ["text-sky-300", "text-violet-300", "text-emerald-300", "text-amber-300", "text-pink-300", "text-teal-300", "text-orange-300", "text-lime-300"];
const ERROR = /\b(error|err|fatal|panic|exception|failed|failure|crash(ed)?)\b/i;
const WARN = /\b(warn|warning|deprecated)\b/i;

const lineKey = (l: ContainerLogLine) => `${l.ts}\u0000${l.container}\u0000${l.text}`;

function clock(ts: string) {
  const d = new Date(ts);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** Output from every container of a project, merged by time, following new lines. */
export default function ContainerLogs({ projectName }: { projectName: string }) {
  const [meta, setMeta] = useState<Pick<LogsData, "containers" | "docker"> | null>(null);
  const [lines, setLines] = useState<ContainerLogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [only, setOnly] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [showTime, setShowTime] = useState(true);
  const lastTs = useRef<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden && lastTs.current) return;
      const since = lastTs.current;
      try {
        const res = await fetch(`/api/docker/logs?project=${encodeURIComponent(projectName)}${since ? `&since=${encodeURIComponent(since)}` : ""}`);
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "Couldn't read the logs");
        if (cancelled) return;
        const data = body as LogsData;
        setMeta({ containers: data.containers, docker: data.docker });
        setError(null);
        if (data.lines.length === 0) return;
        setLines((prev) => {
          if (!since) return data.lines;
          // --since includes the boundary second, so drop lines already shown.
          const seen = new Set(prev.slice(-500).map(lineKey));
          const fresh = data.lines.filter((l) => l.ts >= since && !seen.has(lineKey(l)));
          return fresh.length ? [...prev, ...fresh].slice(-MAX_LINES) : prev;
        });
        lastTs.current = data.lines[data.lines.length - 1].ts;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    load();
    if (!follow) return () => void (cancelled = true);
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectName, follow]);

  // Two containers can share a service name (chat/db, forum/db): label those by stack too.
  const labels = useMemo(() => {
    const containers = meta?.containers ?? [];
    const count = new Map<string, number>();
    for (const c of containers) count.set(c.service, (count.get(c.service) ?? 0) + 1);
    return new Map(containers.map((c, i) => [c.name, { text: (count.get(c.service) ?? 0) > 1 ? `${c.stack}/${c.service}` : c.service, color: COLORS[i % COLORS.length] }]));
  }, [meta]);

  const q = query.trim().toLowerCase();
  const shown = lines.filter((l) => (only.size === 0 || only.has(l.container)) && (!q || l.text.toLowerCase().includes(q)));

  // Follow the bottom unless the reader has scrolled up.
  useEffect(() => {
    const el = boxRef.current;
    if (el && follow && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, follow]);

  const toggle = (name: string) =>
    setOnly((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const containers = meta?.containers ?? [];
  const daemonDown = meta && meta.docker.state !== "running";

  return (
    <Panel
      id="logs-heading"
      title="Container logs"
      description={containers.length ? `${containers.length} container${containers.length === 1 ? "" : "s"} · newest at the bottom` : undefined}
      bodyClassName=""
      actions={
        <>
          <Chip active={showTime} onClick={() => setShowTime((v) => !v)}>
            Timestamps
          </Chip>
          <Button
            size="sm"
            variant={follow ? "secondary" : "primary"}
            icon={follow ? Pause : Play}
            onClick={() => {
              atBottom.current = true;
              setFollow((v) => !v);
            }}
            title={follow ? "Stop fetching new lines" : "Fetch new lines every 2 seconds"}
          >
            {follow ? "Pause" : "Follow"}
          </Button>
        </>
      }
    >
      <FilterBar value={query} onChange={setQuery} placeholder="Filter lines">
        {containers.map((c) => {
          // Say so when a container isn't simply running.
          const note = c.state === "running" ? (c.health === "unhealthy" ? "unhealthy" : null) : c.state;
          const bad = c.health === "unhealthy" || c.state === "restarting" || c.state === "dead";
          return (
            <Chip key={c.name} active={only.has(c.name)} onClick={() => toggle(c.name)}>
              {labels.get(c.name)?.text ?? c.service}
              {note && <span className={bad ? "text-bad" : "text-fg-3"}>· {note}</span>}
            </Chip>
          );
        })}
      </FilterBar>
      {error ? (
        <p className="px-5 py-3.5 text-[13px] font-medium text-bad">{error}</p>
      ) : !meta ? (
        <p className="px-5 py-3.5 text-[13px] text-fg-3">Reading container logs…</p>
      ) : daemonDown ? (
        <p className="px-5 py-3.5 text-[13px] text-warn">{meta.docker.message ?? "Docker isn't available."}</p>
      ) : containers.length === 0 ? (
        <EmptyState icon={ScrollText} title="No containers">
          Start one of this project&apos;s compose stacks and its output shows up here.
        </EmptyState>
      ) : (
        <div
          ref={boxRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
          }}
          className="h-[min(68vh,720px)] overflow-auto rounded-b-lg bg-term py-2 font-mono text-[12px] leading-[1.55] text-term-fg"
        >
          {shown.length === 0 ? (
            <p className="px-5 py-2.5 text-[#9aa0a6]">{lines.length ? "No lines match the filter." : "No output yet."}</p>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {shown.map((l, i) => {
                  const label = labels.get(l.container);
                  const tone = ERROR.test(l.text) ? "text-[#f28b82]" : WARN.test(l.text) ? "text-[#fdd663]" : "";
                  return (
                    <tr key={i} className="align-top hover:bg-white/5">
                      {showTime && <td className="pr-3 pl-4 whitespace-nowrap text-[#9aa0a6] tabular-nums">{clock(l.ts)}</td>}
                      <td className={`pr-3 whitespace-nowrap ${showTime ? "" : "pl-4"} ${label?.color ?? ""}`}>{label?.text ?? l.service}</td>
                      <td className={`w-full pr-4 break-all whitespace-pre-wrap ${tone}`}>{l.text || " "}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Panel>
  );
}

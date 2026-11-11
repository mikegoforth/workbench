"use client";

import { useEffect, useState } from "react";
import { FolderCog, FolderSearch, LoaderCircle, ScanSearch } from "lucide-react";
import type { DiscoveredRoot, DiscoveryResult, ProjectsDirInfo } from "@/lib/types";
import { Badge, Button, EmptyState, Panel } from "./ui";

const SOURCE_LABEL: Record<ProjectsDirInfo["source"], string> = {
  settings: "Saved in Workbench",
  env: "From WORKBENCH_PROJECTS_DIR",
  default: "Default",
};

const SAMPLE = 4;

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const putDir = (dir: string | null) =>
  send<ProjectsDirInfo>("/api/projects-dir", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir }),
  });

/**
 * Choose the folder workbench scans: type a path, or scan the home folder for
 * git repos and pick one of the folders that holds them.
 */
export default function ProjectsFolder({
  info,
  onSaved,
}: {
  /** null while loading. */
  info: ProjectsDirInfo | null;
  onSaved: (info: ProjectsDirInfo) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scan, setScan] = useState<DiscoveryResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const value = draft ?? info?.display ?? "";

  const save = async (dir: string | null, key: string) => {
    setSaving(key);
    setSaveError(null);
    try {
      const next = await putDir(dir);
      setDraft(null);
      onSaved(next);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const runScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      setScan(await send<DiscoveryResult>("/api/projects-dir/discover"));
    } catch (e) {
      setScanError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  // First run: the folder doesn't exist yet, so go looking right away.
  const missing = info !== null && !info.exists;
  const [autoScanned, setAutoScanned] = useState(false);
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    send<DiscoveryResult>("/api/projects-dir/discover")
      .then((result) => {
        if (!cancelled) setScan(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setScanError(e.message);
      })
      .finally(() => {
        if (!cancelled) setAutoScanned(true);
      });
    return () => {
      cancelled = true;
    };
  }, [missing]);
  const busy = scanning || (missing && !autoScanned && !scan);

  const toggle = (dir: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <Panel
        id="folder-current"
        title="Projects folder"
        icon={FolderCog}
        description="Every folder directly inside this one is listed as a project."
      >
        {info && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-mono text-[12.5px] text-fg">{info.display}</span>
            <Badge tone={info.source === "settings" ? "info" : "neutral"}>{SOURCE_LABEL[info.source]}</Badge>
            {!info.exists && <Badge tone="warn">Folder not found</Badge>}
          </div>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) save(value, "form");
          }}
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Projects folder path"
            placeholder="~/Projects"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-8 min-w-0 flex-1 basis-64 rounded border border-line bg-surface px-3 font-mono text-[13px] text-fg focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none"
          />
          <Button
            type="submit"
            variant="primary"
            icon={saving === "form" ? LoaderCircle : undefined}
            spin={saving === "form"}
            disabled={!value.trim() || saving !== null || (draft === null && info?.source === "settings")}
          >
            Save
          </Button>
          {info?.source === "settings" && (
            <Button type="button" variant="ghost" onClick={() => save(null, "reset")} disabled={saving !== null}>
              Reset to {info.defaultDisplay}
            </Button>
          )}
        </form>
        {saveError && (
          <p role="alert" className="mt-2 text-[13px] text-bad">
            {saveError}
          </p>
        )}
      </Panel>

      <Panel
        id="folder-discover"
        title="Find your repositories"
        icon={FolderSearch}
        bodyClassName=""
        description="Looks through your home folder for git repos and suggests the folders that hold them, most GitHub repos first. Skips system and media folders, Desktop, Downloads, hidden folders and node_modules."
        actions={
          <Button icon={busy ? LoaderCircle : ScanSearch} spin={busy} onClick={runScan} disabled={busy}>
            {scan ? "Scan again" : "Scan for GitHub repos"}
          </Button>
        }
      >
        {scanError && (
          <p role="alert" className="px-5 py-3.5 text-[13px] text-bad">
            {scanError}
          </p>
        )}
        {busy && !scan && <p className="px-5 py-3.5 text-[13px] text-fg-3">Scanning your home folder…</p>}
        {scan && scan.roots.length === 0 && (
          <EmptyState icon={FolderSearch} title="No git repositories found">
            Type the folder&apos;s path above instead.
          </EmptyState>
        )}
        {scan && scan.roots.length > 0 && (
          <>
            <ul className="divide-y divide-line">
              {scan.roots.map((root) => (
                <RootRow
                  key={root.dir}
                  root={root}
                  current={root.dir === info?.dir}
                  expanded={expanded.has(root.dir)}
                  onToggle={() => toggle(root.dir)}
                  saving={saving === root.dir}
                  disabled={saving !== null}
                  onUse={() => save(root.dir, root.dir)}
                />
              ))}
            </ul>
            <p className="border-t border-line px-5 py-2.5 text-[12.5px] text-fg-3">
              Checked {scan.scannedDirs.toLocaleString()} folders in {(scan.elapsedMs / 1000).toFixed(1)} s.
              {scan.truncated && " Stopped early, so folders deep in your home folder may be missing."}
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}

function RootRow({
  root,
  current,
  expanded,
  onToggle,
  saving,
  disabled,
  onUse,
}: {
  root: DiscoveredRoot;
  current: boolean;
  expanded: boolean;
  onToggle: () => void;
  saving: boolean;
  disabled: boolean;
  onUse: () => void;
}) {
  // GitHub names first (owner/repo), then any repo without a GitHub remote.
  const names = root.github.length > 0 ? root.github : root.repos;
  const shown = expanded ? names : names.slice(0, SAMPLE);
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[13px] break-all text-fg">{root.display}</p>
        <p className="mt-0.5 text-[12.5px] text-fg-2">
          {root.github.length} on GitHub · {root.repos.length} git {root.repos.length === 1 ? "repo" : "repos"}
        </p>
        {names.length > 0 && (
          <p className="mt-1 text-[12.5px] break-words text-fg-3">
            {shown.join(", ")}
            {names.length > SAMPLE && (
              <>
                {" "}
                <button type="button" onClick={onToggle} className="text-brand-text hover:underline" aria-expanded={expanded}>
                  {expanded ? "show fewer" : `+${names.length - SAMPLE} more`}
                </button>
              </>
            )}
          </p>
        )}
      </div>
      {current ? (
        <Badge tone="ok">Current folder</Badge>
      ) : (
        <Button size="sm" icon={saving ? LoaderCircle : undefined} spin={saving} disabled={disabled} onClick={onUse}>
          Use this folder
        </Button>
      )}
    </li>
  );
}

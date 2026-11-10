"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { ProjectInfo } from "@/lib/types";

// Ahead/behind is only as fresh as the last fetch, so a repo fetches itself
// when opened if that's older than this.
const AUTO_FETCH_AFTER_MS = 15 * 60_000;
// Repos already auto-fetched this session, so a failing remote isn't retried every visit.
const autoFetched = new Set<string>();

/** `git fetch` for the open project, plus a quiet auto-fetch when it's stale. */
export function useRemoteSync(project: ProjectInfo, onUpdate: (p: ProjectInfo) => void) {
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = project.isGitRepo && !!project.hasRemote;

  const fetchRemote = async ({ quiet = false } = {}) => {
    setFetching(true);
    if (!quiet) setError(null);
    try {
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: project.name, action: "fetch" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "git fetch failed");
      onUpdate(body.project as ProjectInfo);
    } catch (e) {
      if (!quiet) setError(`Fetch failed: ${(e as Error).message}`);
    } finally {
      setFetching(false);
    }
  };

  const autoFetch = useEffectEvent(() => {
    const last = project.lastFetchedAt ? Date.parse(project.lastFetchedAt) : 0;
    if (Date.now() - last < AUTO_FETCH_AFTER_MS || autoFetched.has(project.name)) return;
    autoFetched.add(project.name);
    fetchRemote({ quiet: true });
  });

  useEffect(() => {
    if (!enabled) return;
    // Wait a moment so arrowing through repos doesn't fetch every one you pass.
    const timer = setTimeout(autoFetch, 1500);
    return () => clearTimeout(timer);
  }, [project.name, enabled]);

  return { enabled, fetching, error, clearError: () => setError(null), fetchRemote: () => fetchRemote() };
}

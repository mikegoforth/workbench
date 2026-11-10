"use client";

import { useEffect, useSyncExternalStore } from "react";
import { editorLabel, terminalButtonLabel } from "@/lib/preferences";
import type { PreferencesInfo } from "@/lib/types";

/*
 * The editor, terminal and rescan preferences, shared by every part of the
 * page that names or uses them (Open in <editor> buttons, the rescan timer,
 * Preferences itself). Loaded once from /api/preferences; Preferences puts
 * the saved result back here, so every label follows at once.
 */

let current: PreferencesInfo | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

const snapshot = () => current;

/** Replace what every component sees (after a save). */
export function setPreferences(next: PreferencesInfo) {
  current = next;
  for (const l of listeners) l();
}

/** Fetch them again, e.g. to pick up an app installed since. */
export function reloadPreferences(): Promise<void> {
  loading = fetch("/api/preferences")
    .then((res) => (res.ok ? (res.json() as Promise<PreferencesInfo>) : null))
    .then((info) => {
      if (info) setPreferences(info);
    })
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The preferences, or null until they've loaded. */
export function usePreferences(): PreferencesInfo | null {
  const info = useSyncExternalStore(subscribe, snapshot, () => null);
  useEffect(() => {
    if (!current && !loading) reloadPreferences();
  }, []);
  return info;
}

/** How buttons name the editor and terminal ("VS Code" and "Terminal" until loaded, as they always read). */
export function useAppLabels(): { editor: string; terminal: string } {
  const info = usePreferences();
  return {
    editor: info ? editorLabel(info.preferences.editor) : "VS Code",
    terminal: info ? terminalButtonLabel(info.preferences.terminal) : "Terminal",
  };
}

"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Sparkles, X } from "lucide-react";
import { APP_VERSION, formatReleaseDate, releasesUpTo, type ChangeKind } from "@/lib/releaseNotes";
import type { Tone } from "@/lib/status";
import { Badge } from "./ui";

// Which version's notes were last opened. Unset on a first install, so a new
// user isn't nudged; after an update it no longer matches, which shows the dot.
const SEEN_KEY = "workbench-notes-seen";
const SEEN_EVENT = "workbench-notes-seen";

const RELEASES = releasesUpTo(APP_VERSION);
const hasNotes = RELEASES.some((r) => r.version === APP_VERSION);

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return APP_VERSION; // Storage blocked: never show the dot.
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    // Storage blocked: nothing to remember.
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(SEEN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SEEN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const KIND: Record<ChangeKind, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "info" },
  changed: { label: "Changed", tone: "neutral" },
  fixed: { label: "Fixed", tone: "ok" },
  security: { label: "Security", tone: "warn" },
};

/**
 * The version and its release notes, at the foot of the side navigation. A
 * dot marks notes for a version you haven't opened yet (after an update).
 */
export default function WhatsNew({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  // The server renders no dot; the stored value takes over after hydration.
  const seen = useSyncExternalStore(subscribe, readSeen, () => APP_VERSION);
  const unseen = hasNotes && seen !== null && seen !== APP_VERSION;
  const trigger = useRef<HTMLButtonElement>(null);

  // First run: remember this version silently, so only later updates show the dot.
  useEffect(() => {
    if (readSeen() === null) markSeen();
  }, []);

  const show = () => {
    setOpen(true);
    if (unseen) markSeen();
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const label = `What's new in Workbench ${APP_VERSION}${unseen ? " (unread)" : ""}`;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-label={label}
        title={collapsed ? label : undefined}
        className={`relative flex h-10 w-full items-center gap-3.5 rounded-lg text-[13px] text-fg-2 hover:bg-hover hover:text-fg ${collapsed ? "justify-center" : "pr-3 pl-4"}`}
      >
        <span className="relative shrink-0">
          <Sparkles aria-hidden size={18} strokeWidth={2} className={unseen ? "text-brand-text" : undefined} />
          {unseen && <span aria-hidden className="absolute -top-0.5 -right-1 size-2 rounded-full bg-brand ring-2 ring-sidebar" />}
        </span>
        {!collapsed && (
          <>
            <span className={`min-w-0 flex-1 truncate text-left ${unseen ? "font-medium text-fg" : ""}`}>What&apos;s new</span>
            <span className="text-[12px] text-fg-3 tabular-nums">v{APP_VERSION}</span>
          </>
        )}
      </button>
      {open && <ReleaseNotesDialog onClose={close} />}
    </>
  );
}

function ReleaseNotesDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  // Esc closes; Tab stays inside the dialog.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialog.current) return;
    const focusable = dialog.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        aria-describedby="whats-new-version"
        onKeyDown={onKeyDown}
        className="flex max-h-[76vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-surface shadow-pop motion-safe:animate-dialog-in"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="whats-new-title" className="text-[18px] font-normal text-fg">
              What&apos;s new
            </h2>
            <p id="whats-new-version" className="mt-0.5 text-[13px] text-fg-3">
              You&apos;re on Workbench <span className="tabular-nums">{APP_VERSION}</span>
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 grid size-8 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-hover hover:text-fg"
          >
            <X aria-hidden size={18} />
          </button>
        </header>

        <div tabIndex={0} aria-label="Release notes" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 focus-visible:-outline-offset-2">
          {RELEASES.map((release) => {
            const current = release.version === APP_VERSION;
            return (
              <section key={release.version} aria-labelledby={`release-${release.version}`} className="border-b border-line py-5 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 id={`release-${release.version}`} className="text-[15px] font-medium text-fg tabular-nums">
                    Version {release.version}
                  </h3>
                  {release.date && (
                    <time dateTime={release.date} className="text-[12.5px] text-fg-3">
                      {formatReleaseDate(release.date)}
                    </time>
                  )}
                  {current && (
                    <Badge tone="info" className="self-center">
                      Installed
                    </Badge>
                  )}
                </div>
                {release.summary && <p className="mt-1.5 text-[13.5px] text-fg-2">{release.summary}</p>}
                <ul className="mt-3.5 space-y-3">
                  {release.changes.map((change, i) => (
                    <li key={i} className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-3">
                      <span>
                        <Badge tone={KIND[change.kind].tone}>{KIND[change.kind].label}</Badge>
                      </span>
                      <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-fg-2">{change.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

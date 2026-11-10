"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Monitor, Palette, Search, X } from "lucide-react";
import { applyThemePref, previewTheme, readThemePref, resolveTheme, THEMES, themeInfo, type ThemeInfo, type ThemePref } from "@/lib/theme";
import { Button, Kbd } from "./ui";

const CHANGE_EVENT = "workbench-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const prefLabel = (pref: ThemePref) => (pref === "system" ? "Follow system" : themeInfo(pref).label);

/**
 * Color theme button in the top bar. Opens a picker like VS Code's: arrow
 * through the themes to preview each one live, Enter (or a click) keeps it,
 * Esc puts the previous one back.
 */
export default function ThemeSwitch() {
  const { pref, open, picker } = useThemeChooser();

  // While following the system, follow it live.
  useEffect(() => {
    if (pref !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemePref("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  return (
    <>
      <Button
        variant="plain"
        size="md"
        icon={Palette}
        onClick={open}
        aria-haspopup="dialog"
        aria-label={`Color theme: ${prefLabel(pref)}`}
        title={`Color theme: ${prefLabel(pref)}`}
      />
      {picker}
    </>
  );
}

/**
 * The current theme, as Preferences shows it: its colors, name and
 * description, with a button that opens the same picker as the top bar's.
 */
export function ThemeSetting() {
  const { pref, open, picker } = useThemeChooser();
  // Follow system: the theme it shows right now. Before hydration, Light (what the server renders).
  const dark = useSyncExternalStore(subscribeToScheme, prefersDark, () => false);
  const theme = themeInfo(resolveTheme(pref, dark));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <Swatch theme={theme} system={pref === "system"} />
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-[14px] text-fg">{prefLabel(pref)}</p>
        <p className="text-[12.5px] text-fg-3">
          {pref === "system" ? `Light or Dark, as your system is set (now ${theme.label})` : theme.description}
        </p>
      </div>
      <Button icon={Palette} onClick={open} aria-haspopup="dialog">
        Change theme
      </Button>
      {picker}
    </div>
  );
}

function subscribeToScheme(onChange: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** The saved theme and the picker that changes it; every chooser on the page stays in step. */
function useThemeChooser() {
  // Server renders "system"; the stored choice takes over after hydration.
  const pref = useSyncExternalStore(subscribe, readThemePref, () => "system" as ThemePref);
  const [isOpen, setOpen] = useState(false);
  const picker = isOpen ? (
    <ThemePicker
      current={pref}
      onClose={(chosen) => {
        setOpen(false);
        if (chosen) {
          applyThemePref(chosen);
          window.dispatchEvent(new Event(CHANGE_EVENT));
        } else {
          previewTheme(pref);
        }
      }}
    />
  ) : null;
  return { pref, open: () => setOpen(true), picker };
}

type Row = { pref: ThemePref; label: string; description: string; group: string; theme: ThemeInfo };

function ThemePicker({ current, onClose }: { current: ThemePref; onClose: (chosen: ThemePref | null) => void }) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const system: Row = {
      pref: "system",
      label: "Follow system",
      description: "Light or Dark, as your system is set",
      group: "Automatic",
      theme: themeInfo(resolveTheme("system", prefersDark())),
    };
    const all = [system, ...THEMES.map((t) => ({ pref: t.id, label: t.label, description: t.description, group: t.group, theme: t }))];
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => `${r.label} ${r.description} ${r.group}`.toLowerCase().includes(q)) : all;
  }, [query]);

  const [active, setActive] = useState(() => Math.max(0, rows.findIndex((r) => r.pref === current)));
  const index = Math.min(active, Math.max(0, rows.length - 1));

  // Live preview of the highlighted theme.
  useEffect(() => {
    const row = rows[index];
    if (row) previewTheme(row.pref);
  }, [rows, index]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const move = (step: number) => setActive(Math.min(rows.length - 1, Math.max(0, index + step)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(null);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-picker-title"
        className="flex max-h-[76vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop motion-safe:animate-dialog-in"
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 id="theme-picker-title" className="text-[17px] font-medium text-fg">
            Color theme
          </h2>
          <button
            type="button"
            onClick={() => onClose(null)}
            aria-label="Close"
            className="-mr-1.5 grid size-8 place-items-center rounded-full text-fg-2 hover:bg-hover hover:text-fg"
          >
            <X aria-hidden size={18} />
          </button>
        </div>
        <div className="px-5 pb-3">
          <label className="flex h-10 items-center gap-2.5 rounded-lg bg-subtle px-3 ring-1 ring-line focus-within:ring-2 focus-within:ring-brand">
            <Search aria-hidden size={16} strokeWidth={2} className="shrink-0 text-fg-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(e.key === "ArrowDown" ? 1 : -1);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (rows[index]) onClose(rows[index].pref);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose(null);
                }
              }}
              placeholder="Find a theme"
              aria-label="Find a theme"
              role="combobox"
              aria-expanded="true"
              aria-controls="theme-list"
              aria-activedescendant={rows.length ? `theme-row-${index}` : undefined}
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-3 focus:outline-none"
            />
          </label>
        </div>

        <div ref={listRef} id="theme-list" role="listbox" aria-label="Color themes" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {rows.length === 0 && <p className="px-3 py-8 text-center text-[13.5px] text-fg-3">No themes match “{query}”.</p>}
          {rows.map((row, i) => {
            const selected = i === index;
            const isCurrent = row.pref === current;
            const startsGroup = i === 0 || rows[i - 1].group !== row.group;
            return (
              <div key={row.pref}>
                {startsGroup && <p className="px-3 pt-3 pb-1.5 text-[11.5px] font-medium tracking-[0.06em] text-fg-3 uppercase">{row.group}</p>}
                <div
                  id={`theme-row-${i}`}
                  data-row={i}
                  role="option"
                  aria-selected={selected}
                  onClick={() => onClose(row.pref)}
                  className={`flex cursor-pointer items-center gap-3.5 rounded-lg px-3 py-2.5 ${selected ? "bg-brand-soft" : "hover:bg-hover"}`}
                >
                  <Swatch theme={row.theme} system={row.pref === "system"} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[14px] ${selected ? "font-medium text-fg" : "text-fg"}`}>{row.label}</span>
                    <span className="block truncate text-[12.5px] text-fg-3">{row.description}</span>
                  </span>
                  {isCurrent && <Check aria-label="Current theme" size={17} strokeWidth={2.25} className="shrink-0 text-brand-text" />}
                </div>
              </div>
            );
          })}
        </div>

        <p className="flex items-center gap-3 border-t border-line px-5 py-2.5 text-[12px] text-fg-3">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> preview
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Enter</Kbd> keep
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Esc</Kbd> cancel
          </span>
        </p>
      </div>
    </div>
  );
}

/** A tiny window in the theme's own colors: background, a panel, an accent and text. */
function Swatch({ theme, system }: { theme: ThemeInfo; system: boolean }) {
  const [bg, surface, accent, fg] = theme.swatch;
  return (
    <span aria-hidden className="relative grid h-9 w-12 shrink-0 overflow-hidden rounded-md ring-1 ring-line" style={{ background: bg }}>
      <span className="absolute top-1.5 right-1.5 bottom-1.5 left-3.5 rounded-[3px]" style={{ background: surface, boxShadow: `inset 0 0 0 1px ${fg}1a` }} />
      <span className="absolute top-3 left-5 h-[3px] w-4 rounded-full" style={{ background: fg, opacity: 0.7 }} />
      <span className="absolute top-[18px] left-5 size-2 rounded-full" style={{ background: accent }} />
      {system && (
        <span className="absolute right-0.5 bottom-0.5 grid size-4 place-items-center rounded-full bg-surface text-fg-2 ring-1 ring-line">
          <Monitor size={10} strokeWidth={2.25} />
        </span>
      )}
    </span>
  );
}

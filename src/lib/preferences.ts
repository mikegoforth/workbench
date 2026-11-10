import type { Platform } from "./platform";

/*
 * The owner's preferences: which editor and terminal workbench hands projects
 * to, and how often it rescans the projects folder. (The color theme is a
 * preference too, but it lives in the browser: see theme.ts.)
 *
 * Saved in settings.json as ids from the fixed lists below, never as paths or
 * commands: the server maps each id to a known app and how to start it
 * (apps.ts). Anything else in the file is dropped when it's read, and an id
 * that doesn't apply on this system falls back to the default.
 *
 * No Node modules here: the page imports this too, for the labels.
 */

export const EDITORS = [
  { id: "vscode", label: "VS Code" },
  { id: "cursor", label: "Cursor" },
  { id: "zed", label: "Zed" },
  { id: "windsurf", label: "Windsurf" },
  { id: "sublime", label: "Sublime Text" },
  { id: "idea", label: "IntelliJ IDEA" },
  { id: "webstorm", label: "WebStorm" },
] as const;

export type EditorId = (typeof EDITORS)[number]["id"];

const MAC_TERMINALS = [
  { id: "terminal", label: "Terminal" },
  { id: "iterm2", label: "iTerm2" },
  { id: "warp", label: "Warp" },
  { id: "ghostty", label: "Ghostty" },
] as const;

/**
 * Linux terminals by command name, in the order "Automatic" tries them. Must
 * match LINUX_TERMINALS in platform.ts, which knows how to open each in a
 * folder (a test checks they agree).
 */
export const LINUX_TERMINAL_NAMES = [
  "x-terminal-emulator",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "kitty",
  "alacritty",
  "wezterm",
  "foot",
  "ptyxis",
  "kgx",
  "tilix",
  "terminator",
  "xterm",
] as const;

const LINUX_TERMINAL_LABEL: Record<(typeof LINUX_TERMINAL_NAMES)[number], string> = {
  "x-terminal-emulator": "System default (x-terminal-emulator)",
  "gnome-terminal": "GNOME Terminal",
  konsole: "Konsole",
  "xfce4-terminal": "Xfce Terminal",
  kitty: "kitty",
  alacritty: "Alacritty",
  wezterm: "WezTerm",
  foot: "foot",
  ptyxis: "Ptyxis",
  kgx: "Console (kgx)",
  tilix: "Tilix",
  terminator: "Terminator",
  xterm: "xterm",
};

const LINUX_TERMINALS = [
  { id: "auto", label: "Automatic" },
  ...LINUX_TERMINAL_NAMES.map((id) => ({ id, label: LINUX_TERMINAL_LABEL[id] })),
] as const;

const WINDOWS_TERMINALS = [
  { id: "wt", label: "Windows Terminal" },
  { id: "cmd", label: "Command Prompt" },
] as const;

export type TerminalId =
  | (typeof MAC_TERMINALS)[number]["id"]
  | "auto"
  | (typeof LINUX_TERMINAL_NAMES)[number]
  | (typeof WINDOWS_TERMINALS)[number]["id"];

export const RESCAN_INTERVALS = [
  { id: "30s", label: "30 s", ms: 30_000 },
  { id: "1m", label: "1 min", ms: 60_000 },
  { id: "5m", label: "5 min", ms: 300_000 },
  { id: "manual", label: "Manual only", ms: null },
] as const;

export type RescanId = (typeof RESCAN_INTERVALS)[number]["id"];

export interface Preferences {
  editor: EditorId;
  terminal: TerminalId;
  rescan: RescanId;
}

/** What settings.json holds: only what was chosen, each an id from the lists above. */
export type StoredPreferences = Partial<Preferences>;

type Option<T extends string> = { id: T; label: string };

/** The terminals offered on a system, in order. */
export function terminalsFor(os: Platform): readonly Option<TerminalId>[] {
  switch (os) {
    case "mac":
      return MAC_TERMINALS;
    case "linux":
      return LINUX_TERMINALS;
    case "windows":
      return WINDOWS_TERMINALS;
    default:
      return [];
  }
}

const ALL_TERMINALS: readonly Option<TerminalId>[] = [...MAC_TERMINALS, ...LINUX_TERMINALS, ...WINDOWS_TERMINALS];

/** What each system does when nothing is chosen: what workbench always did. */
export function defaultTerminal(os: Platform): TerminalId {
  return os === "mac" ? "terminal" : os === "windows" ? "wt" : "auto";
}

export const DEFAULT_EDITOR: EditorId = "vscode";
/** Rescanning used to be manual only. */
export const DEFAULT_RESCAN: RescanId = "manual";

const isOneOf = <T extends string>(list: readonly Option<T>[], value: unknown): value is T =>
  typeof value === "string" && list.some((o) => o.id === value);

export const isEditorId = (value: unknown): value is EditorId => isOneOf(EDITORS, value);
export const isRescanId = (value: unknown): value is RescanId => isOneOf(RESCAN_INTERVALS, value);
/** A terminal id on any system (what settings.json may hold). */
export const isTerminalId = (value: unknown): value is TerminalId => isOneOf(ALL_TERMINALS, value);
/** A terminal id this system offers. */
export const isTerminalFor = (os: Platform, value: unknown): value is TerminalId => isOneOf(terminalsFor(os), value);

/** Keeps only known ids from what settings.json holds; anything else is dropped. */
export function sanitizePreferences(raw: unknown): StoredPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  return {
    ...(isEditorId(r.editor) ? { editor: r.editor } : {}),
    ...(isTerminalId(r.terminal) ? { terminal: r.terminal } : {}),
    ...(isRescanId(r.rescan) ? { rescan: r.rescan } : {}),
  };
}

/** The preferences in effect on a system: saved ones that apply there, defaults for the rest. */
export function resolvePreferences(stored: StoredPreferences | undefined, os: Platform): Preferences {
  return {
    editor: isEditorId(stored?.editor) ? stored.editor : DEFAULT_EDITOR,
    terminal: isTerminalFor(os, stored?.terminal) ? stored.terminal : defaultTerminal(os),
    rescan: isRescanId(stored?.rescan) ? stored.rescan : DEFAULT_RESCAN,
  };
}

export const editorLabel = (id: EditorId): string => EDITORS.find((e) => e.id === id)!.label;

export const terminalLabel = (id: TerminalId): string => ALL_TERMINALS.find((t) => t.id === id)!.label;

/**
 * How buttons name the terminal: "Terminal" for each system's own default
 * (which may be one of two apps), the app's name for one chosen.
 */
export function terminalButtonLabel(id: TerminalId): string {
  return id === "terminal" || id === "auto" || id === "wt" || id === "cmd" ? "Terminal" : terminalLabel(id);
}

/** Milliseconds between background rescans, or null for manual only. */
export const rescanMs = (id: RescanId): number | null => RESCAN_INTERVALS.find((r) => r.id === id)!.ms;

/**
 * Color themes. Each theme is a set of color variables in globals.css under
 * html[data-theme="<id>"]; data-mode says whether it's light or dark (the
 * `dark:` variant and the native color-scheme follow it). "system" follows
 * the OS between Light and Dark.
 */

export type ThemeId = "light" | "dark" | "dimmed" | "paper" | "hc-light" | "hc-dark";
export type ThemePref = ThemeId | "system";
export type ThemeMode = "light" | "dark";

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  description: string;
  mode: ThemeMode;
  /** Picker group: regular light and dark themes, then high contrast. */
  group: "Light" | "Dark" | "High contrast";
  /** Background, surface, accent and text, for the picker's preview chip. */
  swatch: [string, string, string, string];
}

export const THEMES: ThemeInfo[] = [
  { id: "light", label: "Light", description: "Clean white panels on soft grey", mode: "light", group: "Light", swatch: ["#f7f7f8", "#ffffff", "#1a73e8", "#1d1d20"] },
  { id: "paper", label: "Paper", description: "Warm and low-glare, for long sessions", mode: "light", group: "Light", swatch: ["#f3eee4", "#faf6ee", "#9a4a1c", "#2f2a22"] },
  { id: "dark", label: "Dark", description: "Neutral charcoal, like a modern editor", mode: "dark", group: "Dark", swatch: ["#1b1b1d", "#222225", "#5b9df9", "#e6e6ea"] },
  { id: "dimmed", label: "Dimmed", description: "Softer slate blue, less contrast at night", mode: "dark", group: "Dark", swatch: ["#22272e", "#2a3038", "#6cb6ff", "#d3dbe4"] },
  { id: "hc-light", label: "High contrast light", description: "Black on white with strong borders", mode: "light", group: "High contrast", swatch: ["#ffffff", "#ffffff", "#0f4a85", "#000000"] },
  { id: "hc-dark", label: "High contrast dark", description: "White on black with strong borders", mode: "dark", group: "High contrast", swatch: ["#000000", "#000000", "#75beff", "#ffffff"] },
];

export const THEME_KEY = "workbench-theme";
const IDS = THEMES.map((t) => t.id);

export const isThemeId = (value: unknown): value is ThemeId => typeof value === "string" && (IDS as string[]).includes(value);

export const themeInfo = (id: ThemeId): ThemeInfo => THEMES.find((t) => t.id === id)!;

/** The theme a preference shows: "system" follows the OS between Light and Dark. */
export function resolveTheme(pref: ThemePref, prefersDark: boolean): ThemeId {
  if (pref === "system") return prefersDark ? "dark" : "light";
  return pref;
}

/**
 * JSON that's safe inside an inline <script>: "<", ">" and "/" can't close the
 * tag, and U+2028/U+2029 can't end a line, because each becomes a \u escape
 * (which JavaScript reads back as the same character).
 */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * Runs in <head> before first paint so the page never flashes the wrong
 * theme. Storage can throw (private windows); fall back to the system theme.
 */
export const themeInitScript = `(function(){var m=${scriptSafeJson(Object.fromEntries(THEMES.map((t) => [t.id, t.mode])))};var k=${scriptSafeJson(THEME_KEY)};var d=matchMedia("(prefers-color-scheme: dark)").matches;var p=null;try{p=localStorage.getItem(k);}catch(e){}var t=m[p]?p:(d?"dark":"light");var r=document.documentElement;r.dataset.theme=t;r.dataset.mode=m[t];})();`;

export function readThemePref(): ThemePref {
  try {
    const p = localStorage.getItem(THEME_KEY);
    return isThemeId(p) ? p : "system";
  } catch {
    return "system";
  }
}

const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

/** Shows a theme without saving it (the picker's live preview). */
export function previewTheme(pref: ThemePref) {
  const id = resolveTheme(pref, prefersDark());
  const root = document.documentElement;
  root.dataset.theme = id;
  root.dataset.mode = themeInfo(id).mode;
}

/** Saves and shows a theme. */
export function applyThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Not persisted; still applied for this visit.
  }
  previewTheme(pref);
}

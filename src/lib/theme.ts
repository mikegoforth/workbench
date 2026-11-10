export type ThemePref = "light" | "system" | "dark";

export const THEME_KEY = "workbench-theme";

/**
 * Runs in <head> before first paint so the page never flashes the wrong
 * theme. Storage can throw (private windows); fall back to the system theme.
 */
export const themeInitScript = `(function(){var d=false;try{var p=localStorage.getItem("${THEME_KEY}");d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);}catch(e){d=matchMedia("(prefers-color-scheme: dark)").matches;}document.documentElement.dataset.theme=d?"dark":"light";})();`;

export function readThemePref(): ThemePref {
  try {
    const p = localStorage.getItem(THEME_KEY);
    return p === "light" || p === "dark" ? p : "system";
  } catch {
    return "system";
  }
}

export function applyThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Not persisted; still applied for this visit.
  }
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

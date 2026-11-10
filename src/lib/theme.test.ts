import { afterEach, describe, expect, it, vi } from "vitest";
import { isThemeId, readThemePref, resolveTheme, THEME_KEY, themeInfo, themeInitScript, THEMES } from "./theme";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeBrowser({ stored, dark, storageThrows = false }: { stored?: string | null; dark: boolean; storageThrows?: boolean }) {
  const dataset: Record<string, string> = {};
  vi.stubGlobal("document", { documentElement: { dataset } });
  vi.stubGlobal("matchMedia", () => ({ matches: dark }));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("blocked");
      return key === THEME_KEY ? (stored ?? null) : null;
    },
  });
  return dataset;
}

describe("THEMES", () => {
  it("has unique ids, a mode and a four-color swatch for each theme", () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect(["light", "dark"]).toContain(t.mode);
      expect(t.swatch).toHaveLength(4);
      for (const color of t.swatch) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("has a matching block in globals.css for every theme but the default", async () => {
    const fs = await import("fs");
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    for (const t of THEMES.filter((t) => t.id !== "light")) expect(css).toContain(`:root[data-theme="${t.id}"]`);
  });
});

describe("resolveTheme", () => {
  it("follows the system between Light and Dark", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("keeps a chosen theme whatever the system says", () => {
    expect(resolveTheme("paper", true)).toBe("paper");
    expect(resolveTheme("hc-dark", false)).toBe("hc-dark");
  });
});

describe("isThemeId and themeInfo", () => {
  it("knows the theme ids", () => {
    expect(isThemeId("dimmed")).toBe(true);
    expect(isThemeId("system")).toBe(false);
    expect(isThemeId("solarized")).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(themeInfo("hc-light").mode).toBe("light");
  });
});

describe("readThemePref", () => {
  it("reads a saved theme, and falls back to the system for anything else", () => {
    fakeBrowser({ stored: "dimmed", dark: false });
    expect(readThemePref()).toBe("dimmed");
    fakeBrowser({ stored: "neon", dark: false });
    expect(readThemePref()).toBe("system");
    fakeBrowser({ stored: null, dark: false });
    expect(readThemePref()).toBe("system");
    fakeBrowser({ dark: false, storageThrows: true });
    expect(readThemePref()).toBe("system");
  });
});

describe("themeInitScript", () => {
  const run = () => new Function(themeInitScript)();

  it("sets the saved theme and its mode before first paint", () => {
    const dataset = fakeBrowser({ stored: "paper", dark: true });
    run();
    expect(dataset).toEqual({ theme: "paper", mode: "light" });
  });

  it("follows the system when nothing valid is saved", () => {
    let dataset = fakeBrowser({ stored: "bogus", dark: true });
    run();
    expect(dataset).toEqual({ theme: "dark", mode: "dark" });
    dataset = fakeBrowser({ stored: null, dark: false });
    run();
    expect(dataset).toEqual({ theme: "light", mode: "light" });
  });

  it("still sets a theme when storage is blocked", () => {
    const dataset = fakeBrowser({ dark: true, storageThrows: true });
    run();
    expect(dataset).toEqual({ theme: "dark", mode: "dark" });
  });
});

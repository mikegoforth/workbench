import { describe, expect, it } from "vitest";
import { isPinnedScript, matchesScript, orderScripts } from "./scriptOrder";

const s = (name: string, command = `run ${name}`) => ({ name, command });

describe("orderScripts", () => {
  it("pins the common scripts first, in a fixed order, and keeps the rest in package.json order", () => {
    const scripts = ["zeta", "lint", "alpha", "test", "dev", "storybook", "build"].map((n) => s(n));
    expect(orderScripts(scripts).map((x) => x.name)).toEqual(["dev", "build", "test", "lint", "zeta", "alpha", "storybook"]);
  });

  it("doesn't change the input", () => {
    const scripts = [s("b"), s("dev")];
    orderScripts(scripts);
    expect(scripts.map((x) => x.name)).toEqual(["b", "dev"]);
  });

  it("knows which names are pinned", () => {
    expect(isPinnedScript("typecheck")).toBe(true);
    expect(isPinnedScript("test:e2e")).toBe(false);
  });
});

describe("matchesScript", () => {
  it("matches the name or the command, ignoring case", () => {
    expect(matchesScript(s("test:e2e", "playwright test"), "E2E")).toBe(true);
    expect(matchesScript(s("e2e", "playwright test"), "playwright")).toBe(true);
    expect(matchesScript(s("build", "next build"), "lint")).toBe(false);
    expect(matchesScript(s("build"), "")).toBe(true);
  });
});

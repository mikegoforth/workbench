import { describe, expect, it } from "vitest";
import { linuxTerminalNames } from "./platform";
import {
  defaultTerminal,
  EDITORS,
  editorLabel,
  isEditorId,
  isRescanId,
  isTerminalFor,
  isTerminalId,
  LINUX_TERMINAL_NAMES,
  rescanMs,
  resolvePreferences,
  sanitizePreferences,
  terminalButtonLabel,
  terminalLabel,
  terminalsFor,
} from "./preferences";

describe("the fixed lists", () => {
  it("offers these editors everywhere", () => {
    expect(EDITORS.map((e) => e.id)).toEqual(["vscode", "cursor", "zed", "windsurf", "sublime", "idea", "webstorm"]);
  });

  it("offers each system its own terminals", () => {
    expect(terminalsFor("mac").map((t) => t.id)).toEqual(["terminal", "iterm2", "warp", "ghostty"]);
    expect(terminalsFor("windows").map((t) => t.id)).toEqual(["wt", "cmd"]);
    expect(terminalsFor("linux").map((t) => t.id)).toEqual(["auto", ...LINUX_TERMINAL_NAMES]);
    expect(terminalsFor("other")).toEqual([]);
  });

  it("knows the same Linux terminals, in the same order, as platform.ts", () => {
    expect([...LINUX_TERMINAL_NAMES]).toEqual(linuxTerminalNames());
  });

  it("defaults to what each system always opened", () => {
    expect(defaultTerminal("mac")).toBe("terminal");
    expect(defaultTerminal("linux")).toBe("auto");
    expect(defaultTerminal("windows")).toBe("wt");
    expect(defaultTerminal("other")).toBe("auto");
  });

  it("has labels for everything", () => {
    expect(editorLabel("sublime")).toBe("Sublime Text");
    expect(editorLabel("idea")).toBe("IntelliJ IDEA");
    expect(terminalLabel("iterm2")).toBe("iTerm2");
    expect(terminalLabel("gnome-terminal")).toBe("GNOME Terminal");
    expect(terminalLabel("cmd")).toBe("Command Prompt");
  });

  it("calls each system's default terminal just Terminal on buttons", () => {
    for (const id of ["terminal", "auto", "wt", "cmd"] as const) expect(terminalButtonLabel(id)).toBe("Terminal");
    expect(terminalButtonLabel("ghostty")).toBe("Ghostty");
    expect(terminalButtonLabel("konsole")).toBe("Konsole");
  });

  it("turns rescan ids into milliseconds", () => {
    expect(rescanMs("30s")).toBe(30_000);
    expect(rescanMs("1m")).toBe(60_000);
    expect(rescanMs("5m")).toBe(300_000);
    expect(rescanMs("manual")).toBeNull();
  });
});

describe("id checks", () => {
  it.each([undefined, null, 1, "", "VSCode", "code", "/usr/bin/code", "__proto__", "toString", ["vscode"]])("rejects %j", (value) => {
    expect(isEditorId(value)).toBe(false);
    expect(isTerminalId(value)).toBe(false);
    expect(isRescanId(value)).toBe(false);
  });

  it("checks terminals per system", () => {
    expect(isTerminalId("iterm2")).toBe(true);
    expect(isTerminalFor("mac", "iterm2")).toBe(true);
    expect(isTerminalFor("linux", "iterm2")).toBe(false);
    expect(isTerminalFor("windows", "konsole")).toBe(false);
    expect(isTerminalFor("linux", "konsole")).toBe(true);
    expect(isTerminalFor("other", "auto")).toBe(false);
  });
});

describe("sanitizePreferences", () => {
  it("keeps known ids", () => {
    expect(sanitizePreferences({ editor: "zed", terminal: "warp", rescan: "5m" })).toEqual({ editor: "zed", terminal: "warp", rescan: "5m" });
  });

  it("keeps a terminal from another system (it's resolved per system later)", () => {
    expect(sanitizePreferences({ terminal: "cmd" })).toEqual({ terminal: "cmd" });
  });

  it("drops paths, commands, unknown ids and extra keys", () => {
    expect(
      sanitizePreferences({
        editor: "/Applications/Evil.app",
        terminal: "xterm -e rm -rf ~",
        rescan: 30,
        command: "calc.exe",
        __proto__: { editor: "cursor" },
      })
    ).toEqual({});
  });

  it.each([undefined, null, "vscode", 5, ["vscode"]])("treats %j as nothing saved", (raw) => {
    expect(sanitizePreferences(raw)).toEqual({});
  });
});

describe("resolvePreferences", () => {
  it("uses the defaults when nothing is saved", () => {
    expect(resolvePreferences(undefined, "mac")).toEqual({ editor: "vscode", terminal: "terminal", rescan: "manual" });
    expect(resolvePreferences({}, "linux")).toEqual({ editor: "vscode", terminal: "auto", rescan: "manual" });
    expect(resolvePreferences({}, "windows")).toEqual({ editor: "vscode", terminal: "wt", rescan: "manual" });
  });

  it("uses what's saved where it applies", () => {
    expect(resolvePreferences({ editor: "webstorm", terminal: "ghostty", rescan: "1m" }, "mac")).toEqual({
      editor: "webstorm",
      terminal: "ghostty",
      rescan: "1m",
    });
  });

  it("falls back to the system's terminal when the saved one is another system's", () => {
    expect(resolvePreferences({ terminal: "iterm2" }, "linux").terminal).toBe("auto");
    expect(resolvePreferences({ terminal: "konsole" }, "windows").terminal).toBe("wt");
    expect(resolvePreferences({ terminal: "cmd" }, "mac").terminal).toBe("terminal");
  });

  it("falls back to the defaults for ids that slipped past (a hand-edited object)", () => {
    const bad = { editor: "emacs", terminal: "hyper", rescan: "1h" } as unknown as Parameters<typeof resolvePreferences>[0];
    expect(resolvePreferences(bad, "mac")).toEqual({ editor: "vscode", terminal: "terminal", rescan: "manual" });
  });
});

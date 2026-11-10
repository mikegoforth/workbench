import { describe, expect, it, vi } from "vitest";
import { devEnv } from "./devenv";

describe("devEnv", () => {
  it("never passes the desktop app's API token to a project", () => {
    vi.stubEnv("WORKBENCH_API_TOKEN", "secret-token");
    vi.stubEnv("WORKBENCH_DATA_DIR", "/data");
    const env = devEnv();
    expect(env).not.toHaveProperty("WORKBENCH_API_TOKEN");
    expect(env).not.toHaveProperty("WORKBENCH_DATA_DIR");
    expect(Object.values(env)).not.toContain("secret-token");
  });

  it("drops workbench's own Next.js, npm and Electron settings", () => {
    for (const key of [
      "__NEXT_PRIVATE_X",
      "NEXT_RUNTIME",
      "TURBOPACK",
      "npm_lifecycle_event",
      "ELECTRON_RUN_AS_NODE",
      "PORT",
      "HOSTNAME",
      "NODE_ENV",
      "INIT_CWD",
    ]) {
      vi.stubEnv(key, "x");
    }
    const env = devEnv();
    for (const key of ["__NEXT_PRIVATE_X", "NEXT_RUNTIME", "TURBOPACK", "npm_lifecycle_event", "ELECTRON_RUN_AS_NODE", "PORT", "HOSTNAME", "NODE_ENV", "INIT_CWD"]) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it("keeps the rest of the environment", () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    vi.stubEnv("HOME", "/Users/me");
    vi.stubEnv("MY_PROJECT_SETTING", "1");
    expect(devEnv()).toMatchObject({ PATH: "/usr/bin:/bin", HOME: "/Users/me", MY_PROJECT_SETTING: "1" });
  });
});

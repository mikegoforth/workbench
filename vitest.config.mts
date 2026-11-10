import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the server-side logic in src/lib and the API proxy. They run
// in Node (no browser), against temporary folders, never your real data.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests set WORKBENCH_* variables; put them back after each one.
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      // What coverage is measured against: every server-side module, tested or
      // not, so an untested file counts as 0% instead of disappearing.
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts", "src/proxy.ts"],
      exclude: [
        "src/**/*.test.ts",
        // Types only: nothing runs.
        "src/lib/types.ts",
        // Browser code (run in the page, not the server): the theme switch and keyboard shortcuts.
        "src/lib/theme.ts",
        "src/lib/useShortcut.ts",
      ],
      reporter: ["text-summary", "text", "html", "json-summary"],
      reportsDirectory: "coverage",
      // A floor, not a goal: CI fails if coverage drops below it. Raise it as tests are added.
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
});

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server (.next/standalone/server.js) that the desktop app runs. `next dev` is unaffected.
  output: "standalone",
  // The server reads other repos' .git folders and the data folder at paths only known at
  // runtime. The tracer can't tell, so it guesses this repo's own .git, data/ and source.
  // None of that belongs in the shipped server. (".git" too: in a worktree it is a file.)
  outputFileTracingExcludes: {
    "/**": [".git", ".git/**", "data/**", "src/**", "electron/**", "scripts/**", "release/**", "dist-electron/**", ".env*",
      // Native image library; nothing uses next/image, and leaving it out keeps the server pure JS (any CPU).
      "node_modules/sharp/**", "node_modules/@img/**"],
  },
  images: { unoptimized: true },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

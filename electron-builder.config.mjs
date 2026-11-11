// electron-builder config for the desktop app: macOS (dmg + zip), Linux
// (AppImage) and Windows (NSIS installer). Builds for the current OS by
// default; the release workflow builds macOS and Linux on a macOS runner and
// Windows on a Windows runner.
//
// macOS signing: with a "Developer ID Application" certificate (in the keychain, or
// CSC_LINK + CSC_KEY_PASSWORD in CI) the app is signed with the hardened
// runtime, and notarized when APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and
// APPLE_TEAM_ID are set. Updates then install themselves. Without one it is
// ad-hoc signed: it runs, but updates link to their download instead.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The release workflow passes every signing secret, and a secret that isn't set
// arrives as an empty string. electron-builder treats an empty CSC_LINK as a
// certificate path (and fails with "<project dir> not a file"), so unset them.
for (const name of ["CSC_LINK", "CSC_KEY_PASSWORD", "CSC_NAME", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
  if (!process.env[name]?.trim()) delete process.env[name];
}

function hasDeveloperId() {
  if (process.env.CSC_LINK || process.env.CSC_NAME) return true;
  try {
    return execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" }).includes("Developer ID Application");
  } catch {
    return false;
  }
}

const signed = hasDeveloperId();

// Where installed apps look for updates: set by the release workflow (the
// repo it runs in) or by hand. Without both, the build has no update feed and
// the app never checks, so a fork or a local build can't end up trusting
// someone else's releases.
const releasesOwner = process.env.WORKBENCH_RELEASES_OWNER?.trim();
const releasesRepo = process.env.WORKBENCH_RELEASES_REPO?.trim();

/** @type {import("electron-builder").Configuration} */
const config = {
  // A neutral identifier. If you sign the app, switch to a reverse domain you
  // control. Changing it later resets macOS permissions granted to the app.
  appId: "app.workbench.desktop",
  productName: "workbench",
  copyright: "Copyright © 2026 workbench contributors",
  directories: {
    output: "release",
    buildResources: "electron/resources",
  },
  // Only the bundled main/preload scripts go in app.asar (esbuild already
  // inlined electron-updater), so none of the project's node_modules ship there.
  files: ["dist-electron/**", "package.json", "!node_modules/**"],
  // The Next.js server goes in Contents/Resources/server. It's copied here
  // rather than with extraResources, which drops its node_modules folder.
  // Runs before signing, so the server's files are signed with the app.
  afterPack: async (context) => {
    const resources =
      context.electronPlatformName === "darwin"
        ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
        : path.join(context.appOutDir, "resources");
    const target = path.join(resources, "server");
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(import.meta.dirname, ".next", "standalone"), target, { recursive: true, verbatimSymlinks: true });
  },
  // Switches compiled into the Electron binary that close ways to misuse a
  // signed app: running it as plain Node (ELECTRON_RUN_AS_NODE), injecting
  // code with NODE_OPTIONS or --inspect, or swapping app.asar (Electron checks
  // its hash, recorded in Info.plist, before loading it). The server runs via
  // utilityProcess, which doesn't need RunAsNode.
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // Off on purpose: workbench stores no cookies (its API token lives in
    // memory per launch). Encryption keeps its key in the Keychain, and an
    // app whose signature changes (every ad-hoc build, a new appId) gets a
    // Keychain prompt that blocks the window from loading until answered.
    enableCookieEncryption: false,
    grantFileProtocolExtraPrivileges: false,
  },
  mac: {
    category: "public.app-category.developer-tools",
    // App icons live in electron/resources (buildResources). icon.icns holds
    // every macOS size with Apple's standard margins; Linux sizes are generated
    // from it. The source artwork is docs/assets/logo.svg.
    icon: "icon.icns",
    // Apple Silicon and Intel. The zip is what auto-update downloads; the dmg is for first installs.
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    identity: signed ? undefined : "-",
    hardenedRuntime: signed,
    notarize: signed,
  },
  // Linux: an AppImage per CPU. It runs without installing and, unlike the
  // unsigned Mac build, can install its own updates. Built on the macOS release
  // runner too (electron-builder fetches the Linux tools itself).
  linux: {
    target: [{ target: "AppImage", arch: ["x64", "arm64"] }],
    category: "Development",
    executableName: "workbench",
    synopsis: "A control panel for every coding project on your machine",
  },
  appImage: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  // The static AppImage runtime. The default (legacy) one needs libfuse2 and an
  // unversioned libz.so, which stock Ubuntu 24.04 and other current distros
  // don't have, so the AppImage wouldn't even start there.
  toolsets: { appimage: "1.0.3" },
  // Windows: an x64 installer, built on a Windows runner (Windows on ARM runs
  // it through its x64 emulation; listing both CPUs would bundle both into one
  // larger installer). Unsigned for now: SmartScreen warns on first install
  // ("More info" → "Run anyway"); updates install themselves either way. A
  // certificate in CSC_LINK / WIN_CSC_LINK signs it.
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    // Full-bleed artwork, 16 to 256 px.
    icon: "icon.ico",
  },
  nsis: {
    // Per-user install: no admin prompt, and updates never need one either.
    oneClick: true,
    perMachine: false,
    artifactName: "${productName}-${version}-${arch}-setup.${ext}",
    shortcutName: "workbench",
  },
  dmg: {
    // Name both by chip (arm64, x64): by default the Intel one has no suffix,
    // which is easy to mistake for the only download. The zips keep the
    // default names that installed apps' update feed expects.
    artifactName: "${productName}-${version}-${arch}.${ext}",
    writeUpdateInfo: false,
  },
  // GitHub releases must be public for the app to read them without a token
  // (see docs/development.md, "Updates and releases"). null: no feed, and updates are off.
  publish:
    releasesOwner && releasesRepo
      ? // Builds run with --publish never: this only writes the update feed (app-update.yml
        // in the app, latest*.yml beside it). The release workflow creates the release.
        { provider: "github", owner: releasesOwner, repo: releasesRepo, releaseType: "draft" }
      : null,
};

export default config;

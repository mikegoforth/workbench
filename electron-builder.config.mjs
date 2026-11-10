// electron-builder config for the macOS desktop app.
//
// Signing: with a "Developer ID Application" certificate (in the keychain, or
// CSC_LINK + CSC_KEY_PASSWORD in CI) the app is signed with the hardened
// runtime, and notarized when APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and
// APPLE_TEAM_ID are set. Updates then install themselves. Without one it is
// ad-hoc signed: it runs, but updates link to their download instead.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
    const app = `${context.packager.appInfo.productFilename}.app`;
    const target = path.join(context.appOutDir, app, "Contents", "Resources", "server");
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
    // Apple Silicon and Intel. The zip is what auto-update downloads; the dmg is for first installs.
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    identity: signed ? undefined : "-",
    hardenedRuntime: signed,
    notarize: signed,
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
      ? // A draft: the release workflow attaches checksums and provenance, then
        // publishes it. (The app's update check doesn't read this setting.)
        { provider: "github", owner: releasesOwner, repo: releasesRepo, releaseType: "draft" }
      : null,
};

export default config;

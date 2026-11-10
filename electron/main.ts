import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, utilityProcess, type UtilityProcess } from "electron";
import { autoUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { loginShellPath } from "./shellPath";
import type { UpdateStatus } from "./updateTypes";

/**
 * The desktop app: runs the Next.js standalone server on a free loopback port
 * with a real shell PATH, shows it in a window, and keeps it up to date.
 */

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const SERVER_START_TIMEOUT_MS = 30_000;

// Packaged: copied into Contents/Resources/server. Unpackaged (`npm run desktop`): the build output.
const bundledServerDir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(app.getAppPath(), ".next", "standalone");

interface ServerManifest {
  buildId: string;
  /** Path relative to the server folder → SHA-256. */
  files: Record<string, string>;
}

function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

/** Files that are missing or differ from the build's manifest (empty when the copy is intact). */
function changedFiles(dir: string, manifest: ServerManifest): string[] {
  return Object.entries(manifest.files)
    .filter(([rel, sha]) => {
      try {
        return createHash("sha256").update(fs.readFileSync(path.join(dir, rel))).digest("hex") !== sha;
      } catch {
        return true;
      }
    })
    .map(([rel]) => rel);
}

/**
 * Where the server runs from. Next writes caches inside its own folder, and a
 * write inside the .app breaks its code signature (macOS then refuses to open
 * a downloaded copy, and signed updates fail to verify). So the packaged app
 * runs a copy in Application Support, one per build.
 *
 * Anything running as this user can edit that copy, so at every launch it's
 * checked against the manifest of SHA-256s made at build time (kept in
 * app.asar, which Electron itself verifies). Changed files mean a fresh copy;
 * files that aren't in the manifest (Next's caches, or anything added) are
 * deleted before the server starts.
 */
function runtimeServerDir(): string {
  if (!app.isPackaged) return bundledServerDir;
  const manifest: ServerManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "server-manifest.json"), "utf-8"));
  const root = path.join(app.getPath("userData"), "server");
  const dir = path.join(root, manifest.buildId);

  const copy = () => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(bundledServerDir, dir, { recursive: true, verbatimSymlinks: true });
  };
  if (!fs.existsSync(dir)) {
    log(`copying server for build ${manifest.buildId}`);
    copy();
  }
  let changed = changedFiles(dir, manifest);
  if (changed.length > 0) {
    log(`server copy differs from the build (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", …" : ""}); copying again`);
    copy();
    changed = changedFiles(dir, manifest);
    if (changed.length > 0) {
      throw new Error(`workbench's own files don't match this build (${changed[0]}). Reinstall workbench from a release download.`);
    }
  }
  for (const rel of walk(dir)) {
    if (!(rel in manifest.files)) fs.rmSync(path.join(dir, rel), { force: true });
  }

  // Earlier builds' copies are no longer needed.
  for (const name of fs.readdirSync(root)) {
    if (name !== manifest.buildId) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  return dir;
}

let server: UtilityProcess | null = null;
let origin: string | null = null;
let win: BrowserWindow | null = null;
let quitting = false;
let status: UpdateStatus = { state: "idle", current: app.getVersion() };

/**
 * A secret for this launch only. The server refuses API requests without it,
 * and only this app's window sends it, so other programs on the Mac that find
 * the port can't start scripts or read project files through the API.
 */
const apiToken = randomBytes(32).toString("hex");
const TOKEN_HEADER = "x-workbench-token";

// ---- Logging (macOS ~/Library/Logs/workbench/main.log, Linux ~/.config/workbench/logs/main.log) ----

const logFile = () => path.join(app.getPath("logs"), "main.log");

function log(message: string) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.appendFileSync(logFile(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Logging must never take the app down.
  }
}

// ---- Server ----

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function waitUntilUp(url: string) {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!server) throw new Error("The server stopped while starting.");
    try {
      const res = await fetch(`${url}/api/projects-dir`, { headers: { [TOKEN_HEADER]: apiToken } });
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`The server didn't start within ${SERVER_START_TIMEOUT_MS / 1000} seconds.`);
}

async function startServer(): Promise<string> {
  if (!fs.existsSync(path.join(bundledServerDir, "server.js"))) {
    throw new Error(`${path.join(bundledServerDir, "server.js")} is missing. Run "npm run desktop:build" first.`);
  }
  const serverDir = runtimeServerDir();
  const serverJs = path.join(serverDir, "server.js");
  const [port, PATH] = await Promise.all([freePort(), loginShellPath()]);
  log(`starting server on 127.0.0.1:${port}`);

  server = utilityProcess.fork(serverJs, [], {
    cwd: serverDir,
    serviceName: "workbench server",
    stdio: "pipe",
    env: {
      ...process.env,
      // Windows apps already get the full PATH (spelled "Path" there); setting
      // PATH as well would give the server two of them.
      ...(process.platform === "win32" ? {} : { PATH }),
      PORT: String(port),
      // Loopback only: nothing else on the network can reach the API.
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      // The same folder `npm run dev` uses, so both share settings and running dev servers.
      WORKBENCH_DATA_DIR: path.join(app.getPath("userData"), "data"),
      WORKBENCH_API_TOKEN: apiToken,
    },
  });
  server.stdout?.on("data", (chunk) => log(`[server] ${String(chunk).trimEnd()}`));
  server.stderr?.on("data", (chunk) => log(`[server] ${String(chunk).trimEnd()}`));
  server.on("exit", (code) => {
    server = null;
    log(`server exited with code ${code}`);
    if (!quitting) {
      dialog.showErrorBox("workbench stopped", `Its server exited unexpectedly (code ${code}).\n\nDetails are in ${logFile()}.`);
      app.quit();
    }
  });

  const url = `http://127.0.0.1:${port}`;
  await waitUntilUp(url);
  return url;
}

function stopServer() {
  quitting = true;
  // Dev servers started from workbench run in their own process groups, so they keep running.
  server?.kill();
}

// ---- Window ----

function openExternal(url: string) {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
}

/**
 * The window's session: every request to the server carries the launch token,
 * and every permission request (camera, microphone, notifications…) is
 * refused, since nothing in workbench uses them.
 */
function secureSession(appOrigin: string) {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders({ urls: ["http://127.0.0.1/*"] }, (details, callback) => {
    if (new URL(details.url).origin === appOrigin) details.requestHeaders[TOKEN_HEADER] = apiToken;
    callback({ requestHeaders: details.requestHeaders });
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  // Failed API calls from the window go in main.log (a 403 here would mean the token isn't being sent).
  ses.webRequest.onCompleted({ urls: ["http://127.0.0.1/*"] }, (details) => {
    const url = new URL(details.url);
    if (url.origin === appOrigin && url.pathname.startsWith("/api/") && details.statusCode >= 400) {
      log(`[api] ${details.method} ${url.pathname} → ${details.statusCode}`);
    }
  });
}

function createWindow() {
  if (!origin) return;
  const appOrigin = origin;
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 820,
    minHeight: 560,
    title: "workbench",
    show: false,
    // The page's --bg, so the window doesn't flash white before it paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b1d" : "#f7f7f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.on("did-finish-load", () => log("window loaded"));
  // GitHub, CI and PR links open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== appOrigin) {
      event.preventDefault();
      openExternal(url);
    }
  });
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(appOrigin);
}

// ---- Updates ----

function setStatus(next: UpdateStatus) {
  status = next;
  win?.webContents.send("update:status", next);
}

/**
 * Whether an update can install itself, or the app should link to the download.
 * - macOS only installs over an app signed with a Developer ID certificate.
 *   Ad-hoc signed builds still find updates, but link to the download.
 * - Linux: the AppImage replaces itself (APPIMAGE is its path); any other
 *   copy (an unpacked folder) links to the download.
 * - Windows: the installed app updates itself.
 */
function canInstallUpdates(): Promise<boolean> {
  if (!app.isPackaged) return Promise.resolve(false);
  if (process.platform === "linux") return Promise.resolve(!!process.env.APPIMAGE);
  // Windows: the NSIS installer updates in place, signed or not.
  if (process.platform === "win32") return Promise.resolve(true);
  if (process.platform !== "darwin") return Promise.resolve(false);
  const bundle = path.resolve(process.execPath, "..", "..", "..");
  return new Promise((resolve) => {
    execFile("/usr/bin/codesign", ["-dv", "--verbose=2", bundle], (error, _stdout, stderr) => {
      resolve(!error && /Authority=Developer ID Application/.test(String(stderr)));
    });
  });
}

/**
 * The update feed electron-builder wrote into the app, if the build had one.
 * Builds made without WORKBENCH_RELEASES_OWNER/REPO (local builds, forks)
 * have none and never check for updates.
 */
const updateFeedFile = () => path.join(process.resourcesPath, "app-update.yml");
const hasUpdateFeed = () => app.isPackaged && fs.existsSync(updateFeedFile());

/** The release page for a version, from the feed electron-builder baked into the app. */
function releaseUrl(version: string): string {
  try {
    const yml = fs.readFileSync(updateFeedFile(), "utf-8");
    const field = (key: string) => yml.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^['"]|['"]$/g, "");
    if (field("provider") === "github") return `https://github.com/${field("owner")}/${field("repo")}/releases/tag/v${version}`;
    return field("url") ?? "";
  } catch {
    return "";
  }
}

async function checkForUpdates({ fromMenu = false } = {}) {
  if (!app.isPackaged) {
    if (fromMenu) dialog.showMessageBox({ message: "Updates are only checked in the installed app." });
    return;
  }
  if (!hasUpdateFeed()) {
    if (fromMenu) dialog.showMessageBox({ message: "This build doesn't check for updates.", detail: "It was built without a release feed, so update it by building or downloading a new version." });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (fromMenu && !result?.isUpdateAvailable) {
      dialog.showMessageBox({ message: "workbench is up to date", detail: `You have version ${app.getVersion()}.` });
    }
  } catch (error) {
    log(`[update] check failed: ${(error as Error).stack ?? error}`);
    if (fromMenu) dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: (error as Error).message });
  }
}

async function setupUpdates() {
  if (!app.isPackaged) return;
  if (!hasUpdateFeed()) {
    log("[update] no release feed in this build: updates are off");
    return;
  }
  const current = app.getVersion();
  const install = await canInstallUpdates();
  const why =
    process.platform === "darwin"
      ? install ? "signed with a Developer ID" : "not Developer ID signed"
      : process.platform === "win32"
        ? "installed with the Windows installer"
        : install ? "running as an AppImage" : "not an AppImage";
  log(`[update] ${why}: updates ${install ? "install themselves" : "link to their download"}`);

  autoUpdater.autoDownload = install;
  autoUpdater.autoInstallOnAppQuit = install;
  autoUpdater.logger = {
    info: (m: unknown) => log(`[update] ${m}`),
    warn: (m: unknown) => log(`[update] ${m}`),
    error: (m: unknown) => log(`[update] ${m}`),
    debug: () => {},
  };

  let offered: string | null = null;
  const manual = (version: string) => setStatus({ state: "manual", current, version, url: releaseUrl(version) });

  autoUpdater.on("update-available", (info) => {
    offered = info.version;
    if (install) setStatus({ state: "downloading", current, version: info.version });
    else manual(info.version);
  });
  autoUpdater.on("download-progress", (progress) => {
    if (status.state === "downloading") setStatus({ ...status, percent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => setStatus({ state: "ready", current, version: info.version }));
  autoUpdater.on("error", (error) => {
    log(`[update] ${error?.stack ?? error}`);
    // Found a version but couldn't download or install it: offer the download instead.
    if (offered && status.state !== "ready") manual(offered);
  });

  checkForUpdates();
  setInterval(checkForUpdates, CHECK_EVERY_MS);
}

ipcMain.on("app:version", (event) => {
  event.returnValue = app.getVersion();
});
ipcMain.handle("update:get", () => status);
ipcMain.handle("update:check", () => checkForUpdates());
ipcMain.handle("update:install", () => {
  if (status.state !== "ready") return;
  stopServer();
  autoUpdater.quitAndInstall();
});

// ---- Menu ----

function buildMenu() {
  const checkForUpdatesItem = { label: "Check for Updates…", click: () => checkForUpdates({ fromMenu: true }) };
  // Linux and Windows: a window menu bar instead of the macOS app menu.
  if (process.platform !== "darwin") {
    return Menu.buildFromTemplate([
      { label: "&File", submenu: [checkForUpdatesItem, { type: "separator" }, { role: "quit" }] },
      { role: "editMenu" },
      { role: "viewMenu" },
      { label: "&Help", submenu: [{ role: "about" }] },
    ]);
  }
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        checkForUpdatesItem,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]);
}

// ---- Lifecycle ----

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu());
    try {
      origin = await startServer();
    } catch (error) {
      log(`startup failed: ${(error as Error).stack ?? error}`);
      dialog.showErrorBox("workbench couldn't start", `${(error as Error).message}\n\nDetails are in ${logFile()}.`);
      stopServer();
      app.quit();
      return;
    }
    secureSession(origin);
    createWindow();
    setupUpdates();
  });

  // Like other Mac apps: closing the window keeps workbench in the Dock; clicking it reopens.
  // Elsewhere, closing the last window quits (and stops the server).
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!win) createWindow();
  });
  app.on("before-quit", stopServer);
}

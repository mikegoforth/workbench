/**
 * Update state the main process sends to the page. Shared by the Electron
 * main process, the preload script and the Next.js app.
 *
 * - "idle": nothing to report (up to date, or not checked yet)
 * - "downloading": a newer version is downloading in the background
 * - "ready": downloaded; restarting installs it
 * - "manual": a newer version exists but can't install itself (an unsigned
 *   build, or the install failed), so the page links to its download
 */
export type UpdateStatus =
  | { state: "idle"; current: string }
  | { state: "downloading"; current: string; version: string; percent?: number }
  | { state: "ready"; current: string; version: string }
  | { state: "manual"; current: string; version: string; url: string };

/** What the preload script exposes on `window.workbench` in the desktop app. */
export interface WorkbenchDesktop {
  version: string;
  getUpdate(): Promise<UpdateStatus>;
  onUpdate(listener: (status: UpdateStatus) => void): () => void;
  installUpdate(): Promise<void>;
  checkForUpdates(): Promise<void>;
}

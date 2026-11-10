import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { UpdateStatus, WorkbenchDesktop } from "./updateTypes";

// The only thing the page can reach in the main process: update status and
// two commands. Everything else goes through the Next.js server like in a browser.
const api: WorkbenchDesktop = {
  version: String(ipcRenderer.sendSync("app:version")),
  getUpdate: () => ipcRenderer.invoke("update:get"),
  onUpdate: (listener) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on("update:status", handler);
    return () => {
      ipcRenderer.removeListener("update:status", handler);
    };
  },
  installUpdate: () => ipcRenderer.invoke("update:install"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
};

contextBridge.exposeInMainWorld("workbench", api);

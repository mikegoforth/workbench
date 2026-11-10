import fs from "fs";
import path from "path";
import { dataDir } from "./dataDir";
import { SettingsData } from "./types";

// Lives next to notes.json in the data folder.
const settingsFile = () => path.join(dataDir(), "settings.json");

export function readSettings(): SettingsData {
  try {
    if (!fs.existsSync(settingsFile())) {
      return { hiddenProjects: [], parked: {} };
    }
    const raw = JSON.parse(fs.readFileSync(settingsFile(), "utf-8"));
    const parked: Record<string, string> = {};
    if (raw?.parked && typeof raw.parked === "object") {
      for (const [name, fingerprint] of Object.entries(raw.parked)) {
        if (typeof fingerprint === "string") parked[name] = fingerprint;
      }
    }
    return {
      hiddenProjects: Array.isArray(raw?.hiddenProjects)
        ? raw.hiddenProjects.filter((n: unknown) => typeof n === "string")
        : [],
      parked,
      ...(typeof raw?.projectsDir === "string" && path.isAbsolute(raw.projectsDir)
        ? { projectsDir: raw.projectsDir }
        : {}),
      ...(typeof raw?.setupCompletedAt === "string" ? { setupCompletedAt: raw.setupCompletedAt } : {}),
    };
  } catch {
    return { hiddenProjects: [], parked: {} };
  }
}

export function writeSettings(data: SettingsData): void {
  const dir = path.dirname(settingsFile());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(settingsFile(), JSON.stringify(data, null, 2));
}

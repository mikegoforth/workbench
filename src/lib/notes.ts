import fs from "fs";
import path from "path";
import { dataDir } from "./dataDir";
import { NotesData } from "./types";

const notesFile = () => path.join(dataDir(), "notes.json");

export function readNotes(): NotesData {
  try {
    if (!fs.existsSync(notesFile())) {
      return {};
    }
    return JSON.parse(fs.readFileSync(notesFile(), "utf-8"));
  } catch {
    return {};
  }
}

export function writeNotes(data: NotesData): void {
  const dir = path.dirname(notesFile());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(notesFile(), JSON.stringify(data, null, 2));
}

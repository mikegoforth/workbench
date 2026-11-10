import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { readNotes, writeNotes } from "@/lib/notes";
import { resolveProjectDir } from "@/lib/paths";
import { TodoItem } from "@/lib/types";

const MAX_NOTES_CHARS = 100_000;
const MAX_TODOS = 500;
const MAX_TODO_CHARS = 2_000;

const isTodo = (t: unknown): t is TodoItem => {
  const todo = t as TodoItem;
  return (
    !!todo &&
    typeof todo.id === "string" &&
    typeof todo.text === "string" &&
    todo.text.length <= MAX_TODO_CHARS &&
    typeof todo.done === "boolean" &&
    typeof todo.createdAt === "string"
  );
};

// PUT /api/notes { projectName, notes?, todos? } — save a project's notes and todos.
export async function PUT(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: true });
  if (rejected) return rejected;

  let body: { projectName?: unknown; notes?: unknown; todos?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectName, notes, todos } = body ?? {};

  // Only real project folders: also keeps names like "__proto__" out of the saved object.
  if (typeof projectName !== "string" || !resolveProjectDir(projectName)) {
    return NextResponse.json({ error: "Unknown project" }, { status: 400 });
  }
  if (notes !== undefined && (typeof notes !== "string" || notes.length > MAX_NOTES_CHARS)) {
    return NextResponse.json({ error: `notes must be a string up to ${MAX_NOTES_CHARS} characters` }, { status: 400 });
  }
  if (todos !== undefined && (!Array.isArray(todos) || todos.length > MAX_TODOS || !todos.every(isTodo))) {
    return NextResponse.json({ error: "todos must be a list of { id, text, done, createdAt }" }, { status: 400 });
  }

  try {
    const data = readNotes();
    const entry = Object.hasOwn(data, projectName) ? data[projectName] : { notes: "", todos: [] };
    if (notes !== undefined) entry.notes = notes as string;
    if (todos !== undefined) entry.todos = todos as TodoItem[];
    data[projectName] = entry;
    writeNotes(data);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save notes: " + (error as Error).message },
      { status: 500 }
    );
  }
}

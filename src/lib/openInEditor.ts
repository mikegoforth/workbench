async function open(body: Record<string, string | undefined>, fallback: string) {
  const res = await fetch("/api/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? fallback);
  }
}

/** Ask the server to open a project (or one of its files) in VS Code. Throws with a readable message. */
export function openInEditor(projectName: string, file?: string): Promise<void> {
  return open({ projectName, file }, "Couldn't open VS Code");
}

/** Ask the server to open a Terminal window in the project's folder. */
export function openInTerminal(projectName: string): Promise<void> {
  return open({ projectName, app: "terminal" }, "Couldn't open Terminal");
}

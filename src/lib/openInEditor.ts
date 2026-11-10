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

/**
 * Ask the server to open a project (or one of its files) in the editor chosen
 * in Preferences; `label` names it in the message if that fails without one.
 * Throws with a readable message.
 */
export function openInEditor(projectName: string, file?: string, label = "the editor"): Promise<void> {
  return open({ projectName, file }, `Couldn't open ${label}`);
}

/** Ask the server to open the terminal chosen in Preferences in the project's folder. */
export function openInTerminal(projectName: string, label = "Terminal"): Promise<void> {
  return open({ projectName, app: "terminal" }, `Couldn't open ${label}`);
}

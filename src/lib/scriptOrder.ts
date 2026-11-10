/** The scripts most projects run most often, in the order they're pinned to the top. */
export const PINNED_SCRIPTS = ["dev", "start", "build", "test", "lint", "typecheck", "type-check", "format"];

/** Pinned scripts first (in PINNED_SCRIPTS order), then the rest as package.json lists them. */
export function orderScripts<T extends { name: string }>(scripts: T[]): T[] {
  const rank = (name: string) => {
    const i = PINNED_SCRIPTS.indexOf(name);
    return i === -1 ? PINNED_SCRIPTS.length : i;
  };
  // Array.prototype.sort is stable, so unpinned scripts keep their order.
  return [...scripts].sort((a, b) => rank(a.name) - rank(b.name));
}

export const isPinnedScript = (name: string) => PINNED_SCRIPTS.includes(name);

/** Case-insensitive match on the script's name or its command. */
export function matchesScript(script: { name: string; command: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return script.name.toLowerCase().includes(q) || script.command.toLowerCase().includes(q);
}

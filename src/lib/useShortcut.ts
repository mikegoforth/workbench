"use client";

import { useEffect, useRef } from "react";

/** True when a keypress belongs to whatever has focus (typing, a menu), not to us. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Run `handler` when one of `keys` (KeyboardEvent.key values, case-insensitive)
 * is pressed with no modifiers, unless the user is typing in a field.
 * `skipControls` also leaves the key alone on a focused button or link, so
 * Enter still activates the control. `handler` may change every render.
 */
export function useShortcut(
  keys: string[],
  handler: (event: KeyboardEvent) => void,
  {
    enabled = true,
    allowRepeat = false,
    skipControls = false,
  }: { enabled?: boolean; allowRepeat?: boolean; skipControls?: boolean } = {}
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const keyList = keys.map((k) => k.toLowerCase()).join("|");
  useEffect(() => {
    if (!enabled) return;
    const wanted = new Set(keyList.split("|"));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (e.repeat && !allowRepeat) return;
      if (!wanted.has(e.key?.toLowerCase()) || isTypingTarget(e.target)) return;
      if (skipControls && e.target instanceof HTMLElement && e.target.closest("a, button, [role='button']")) return;
      e.preventDefault();
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyList, enabled, allowRepeat, skipControls]);
}

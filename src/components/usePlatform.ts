"use client";

import { useSyncExternalStore } from "react";

// The platform never changes while the page is open: nothing to subscribe to.
const subscribe = () => () => {};

function browserIsMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

/**
 * Whether the page runs on a Mac, for shortcut labels (⌘ or Ctrl). The server
 * render says yes, so macOS renders exactly as before; other platforms switch
 * right after hydration, without a mismatch.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribe, browserIsMac, () => true);
}

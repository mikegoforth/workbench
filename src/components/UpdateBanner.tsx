"use client";

import { useEffect, useState } from "react";
import { Download, RotateCw, Sparkles, X } from "lucide-react";
import type { UpdateStatus, WorkbenchDesktop } from "../../electron/updateTypes";
import { Button, LinkButton } from "./ui";

declare global {
  interface Window {
    /** Set by the desktop app's preload script; absent in a browser. */
    workbench?: WorkbenchDesktop;
  }
}

/**
 * "A new version is ready" bar in the desktop app. Renders nothing in a
 * browser, while up to date, or while an update is still downloading.
 */
export default function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const desktop = window.workbench;
    if (!desktop) return;
    let live = true;
    desktop.getUpdate().then((s) => {
      if (live) setStatus(s);
    });
    const unsubscribe = desktop.onUpdate(setStatus);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  if (!status || (status.state !== "ready" && status.state !== "manual") || dismissed === status.version) return null;

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-brand-line bg-brand-soft px-5 py-3 text-[13.5px] sm:px-5">
      <Sparkles aria-hidden size={18} strokeWidth={2} className="shrink-0 text-brand-text" />
      <p className="min-w-0 flex-1 text-fg">
        <span className="font-medium">workbench {status.version} is {status.state === "ready" ? "ready to install" : "available"}.</span>{" "}
        <span className="text-fg-2">
          {status.state === "ready"
            ? "Restarting takes a few seconds. Running dev servers keep running."
            : `You have ${status.current}. Download it and install it in place of this one.`}
        </span>
      </p>
      {status.state === "ready" ? (
        <Button
          size="sm"
          variant="primary"
          icon={RotateCw}
          spin={installing}
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            window.workbench?.installUpdate();
          }}
        >
          Restart to update
        </Button>
      ) : (
        status.url && (
          <LinkButton size="sm" variant="primary" icon={Download} href={status.url}>
            Download
          </LinkButton>
        )
      )}
      <Button size="sm" variant="plain" icon={X} onClick={() => setDismissed(status.version)} aria-label="Dismiss until next launch" title="Dismiss until next launch" />
    </div>
  );
}

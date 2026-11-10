"use client";

import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Collapsible process output in a terminal box. Follows new lines unless the
 * user has scrolled up to read something; changing `followKey` (e.g. a new
 * run's start time) resumes following.
 */
export default function LogPanel({
  lines,
  open,
  onToggle,
  followKey,
  emptyText = "No output yet.",
}: {
  lines: string[];
  open: boolean;
  onToggle: () => void;
  followKey?: string | null;
  emptyText?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    follow.current = true;
  }, [followKey]);

  useEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines, open, followKey]);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-fg-2 hover:text-fg"
      >
        <ChevronRight aria-hidden size={14} strokeWidth={2.25} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {open ? "Hide output" : "Show output"}
        <span className="font-normal text-fg-3">· {lines.length} lines</span>
      </button>
      {open && (
        <pre
          ref={ref}
          onScroll={(e) => {
            const el = e.currentTarget;
            follow.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
          }}
          className="mt-2 max-h-80 overflow-auto rounded-lg bg-term p-3.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-term-fg"
        >
          {lines.length ? lines.join("\n") : emptyText}
        </pre>
      )}
    </div>
  );
}

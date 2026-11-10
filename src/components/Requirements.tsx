"use client";

import { CircleCheck, CircleX, ExternalLink } from "lucide-react";
import type { Requirement } from "@/lib/types";
import { LinkButton } from "./ui";

/**
 * A check or a cross per requirement, with where to get what's missing.
 * Required ones first; optional ones under their own heading.
 */
export default function RequirementList({ requirements }: { requirements: Requirement[] }) {
  const required = requirements.filter((r) => !r.optional);
  const optional = requirements.filter((r) => r.optional);
  return (
    <>
      <ul className="divide-y divide-line" aria-label="Required">
        {required.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </ul>
      {optional.length > 0 && (
        <>
          <p className="border-t border-line bg-subtle px-5 py-2.5 text-[11.5px] font-medium tracking-[0.06em] text-fg-3 uppercase">
            Optional
          </p>
          <ul className="divide-y divide-line border-t border-line" aria-label="Optional">
            {optional.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Row({ r }: { r: Requirement }) {
  // A missing optional tool is a gap, not a blocker: grey, not red.
  const tone = r.ok ? "text-ok" : r.optional ? "text-fg-3" : "text-bad";
  const Icon = r.ok ? CircleCheck : CircleX;
  return (
    <li className="flex gap-3 px-4 py-4">
      <Icon aria-hidden size={22} strokeWidth={2} className={`mt-px shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[14px] font-medium text-fg">
          {r.name}
          <span className="sr-only">{r.ok ? "installed" : r.optional ? "not set up (optional)" : "missing"}</span>
          <span className="text-[12.5px] font-normal text-fg-3">Needs {r.need}</span>
        </p>
        <p className={`mt-0.5 text-[13px] ${r.ok ? "text-fg-2" : "text-fg"}`}>{r.detail}</p>
        {!r.ok && r.hint && <p className="mt-1 text-[12.5px] text-fg-3">{r.hint}</p>}
        {!r.ok && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {r.help.map((h, i) => (
              <LinkButton key={h.url} href={h.url} size="sm" variant={i === 0 ? "secondary" : "ghost"} icon={ExternalLink}>
                {h.label}
              </LinkButton>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

"use client";

import {
  ChevronsLeft,
  ChevronsRight,
  EthernetPort,
  EyeOff,
  FolderCog,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Server,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/lib/status";
import { Count } from "./ui";
import WhatsNew from "./WhatsNew";
import { VIEW_TITLE, type Counts, type View } from "./model";

interface NavItem {
  view: View;
  icon: LucideIcon;
  count?: number;
  /** Tint the count when it's non-zero. */
  tone?: Tone;
}

/**
 * The console's left navigation: one product, its pages grouped by purpose.
 * Collapses to an icon rail on desktop and becomes a drawer on small screens.
 */
export default function SideNav({
  view,
  counts,
  counting = false,
  setupIssues = 0,
  reviewCount,
  collapsed,
  onGo,
  onToggleCollapsed,
  className = "",
}: {
  /** The page that's selected (a project page keeps the page it was opened from). */
  view: View;
  counts: Counts;
  /** The first scan is still running: counts aren't known yet. */
  counting?: boolean;
  /**
   * Tool checks that aren't passing (optional ones included). Setup is only
   * listed when there's something to fix there, or while it's open; it's
   * always reachable from search, and it takes over by itself at launch if a
   * required tool goes missing.
   */
  setupIssues?: number;
  /** Open PRs waiting on your review; undefined until GitHub has answered (or when it can't). */
  reviewCount?: number;
  collapsed: boolean;
  onGo: (view: View) => void;
  onToggleCollapsed?: () => void;
  className?: string;
}) {
  const groups: { title?: string; items: NavItem[] }[] = [
    { items: [{ view: "dashboard", icon: LayoutDashboard }] },
    {
      title: "Resources",
      items: [
        { view: "projects", icon: FolderGit2, count: counts.projects },
        { view: "servers", icon: Server, count: counts.servers, tone: "ok" },
        { view: "ports", icon: EthernetPort },
      ],
    },
    {
      title: "Operations",
      items: [
        { view: "attention", icon: TriangleAlert, count: counts.attention, tone: "warn" },
        { view: "pulls", icon: GitPullRequest, count: reviewCount, tone: "warn" },
        { view: "activity", icon: GitCommitHorizontal },
        { view: "todos", icon: ListTodo, count: counts.todos, tone: "info" },
      ],
    },
    {
      title: "Settings",
      items: [
        { view: "folder", icon: FolderCog },
        { view: "hidden", icon: EyeOff, count: counts.hidden },
        ...(setupIssues > 0 || view === "setup" ? [{ view: "setup" as const, icon: ListChecks, count: setupIssues || undefined, tone: "warn" as const }] : []),
      ],
    },
  ];

  return (
    <nav
      aria-label="workbench"
      className={`flex shrink-0 flex-col border-r border-line bg-sidebar transition-[width] duration-150 ${collapsed ? "w-15" : "w-64"} ${className}`}
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        {groups.map((g, gi) => (
          <div key={gi} className={gi > 0 ? "mt-4" : ""}>
            {g.title && !collapsed && (
              <p className="px-6 pt-1 pb-1.5 text-[11.5px] font-medium tracking-[0.06em] text-fg-3 uppercase">{g.title}</p>
            )}
            <ul className="space-y-0.5 px-2">
              {g.items.map((it) => {
                const active = it.view === view;
                const Icon = it.icon;
                const label = VIEW_TITLE[it.view];
                return (
                  <li key={it.view}>
                    <button
                      type="button"
                      onClick={() => onGo(it.view)}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? `${label}${it.count && !counting ? ` (${it.count})` : ""}` : undefined}
                      className={`relative flex h-10 w-full items-center gap-3.5 rounded-lg text-left text-[13.5px] transition-colors ${
                        collapsed ? "justify-center mx-auto w-11!" : "pr-3 pl-4"
                      } ${active ? "bg-brand-soft font-medium text-brand-text" : "text-fg-2 hover:bg-hover hover:text-fg"}`}
                    >
                      <Icon aria-hidden size={18} strokeWidth={2} className="shrink-0" />
                      {collapsed ? (
                        <>
                          <span className="sr-only">{label}</span>
                          {!!it.count && !counting && it.tone && (
                            <span aria-hidden className={`absolute top-1.5 right-2 size-2 rounded-full ${it.tone === "ok" ? "bg-ok-dot" : it.tone === "warn" ? "bg-warn-dot" : "bg-brand"}`} />
                          )}
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          {it.count !== undefined && counting ? (
                            <>
                              <span aria-hidden className="w-4.5 text-center text-[12px] text-fg-3">
                                –
                              </span>
                              <span className="sr-only">(still counting)</span>
                            </>
                          ) : (
                            it.count !== undefined &&
                            (it.count > 0 || it.view !== "todos") && <Count tone={it.count && it.tone ? it.tone : "neutral"}>{it.count}</Count>
                          )}
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="space-y-0.5 border-t border-line p-2">
        <WhatsNew collapsed={collapsed} />
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={`flex h-10 w-full items-center gap-3.5 rounded-lg text-[13px] text-fg-2 hover:bg-hover hover:text-fg ${collapsed ? "justify-center" : "pr-3 pl-4"}`}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? <ChevronsRight aria-hidden size={18} /> : <ChevronsLeft aria-hidden size={18} />}
            {!collapsed && "Collapse"}
          </button>
        )}
      </div>
    </nav>
  );
}

"use client";

import { ChevronDown, FolderGit2, Menu as MenuIcon, RefreshCw, Search } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { Button, Kbd, Logo } from "./ui";
import ThemeSwitch from "./ThemeSwitch";

/**
 * The console's top bar: nav toggle, product name, project picker, the big
 * search box, and global actions.
 */
export default function AppBar({
  onToggleNav,
  onHome,
  currentProject,
  onPickProject,
  onSearch,
  scannedAt,
  scanning,
  projectsDir,
  onRescan,
}: {
  onToggleNav: () => void;
  onHome: () => void;
  currentProject: string | null;
  onPickProject: () => void;
  onSearch: () => void;
  scannedAt: string | null;
  scanning: boolean;
  projectsDir: string;
  onRescan: () => void;
}) {
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-1.5 bg-surface px-2 shadow-bar sm:gap-3 sm:px-3">
      <Button variant="plain" size="md" icon={MenuIcon} onClick={onToggleNav} aria-label="Navigation menu" title="Navigation menu" />

      <button type="button" onClick={onHome} className="flex shrink-0 items-center gap-2 rounded px-1.5 py-1 hover:bg-hover" title="Dashboard">
        <Logo />
        <span className="hidden text-[19px] tracking-[-0.01em] text-fg-2 sm:inline">
          <span className="font-medium text-fg">work</span>bench
        </span>
      </button>

      <button
        type="button"
        onClick={onPickProject}
        className="hidden h-9 max-w-64 min-w-0 shrink items-center gap-2 rounded border border-line px-3 text-[13.5px] text-fg hover:bg-hover md:flex"
        title="Select a project"
      >
        <FolderGit2 aria-hidden size={16} strokeWidth={2} className="shrink-0 text-fg-2" />
        <span className="truncate">{currentProject ?? "Select a project"}</span>
        <ChevronDown aria-hidden size={16} strokeWidth={2} className="shrink-0 text-fg-2" />
      </button>

      <button
        type="button"
        onClick={onSearch}
        className="mx-auto flex h-10 min-w-0 flex-1 items-center gap-3 rounded-lg border border-transparent bg-hover px-3.5 text-[14px] text-fg-3 hover:border-line hover:bg-surface hover:shadow-card sm:max-w-2xl"
      >
        <Search aria-hidden size={18} strokeWidth={2} className="shrink-0 text-fg-2" />
        <span className="truncate">
          Search <span className="hidden sm:inline">(/) for projects, branches and notes</span>
        </span>
        <span className="ml-auto hidden sm:inline-flex">
          <Kbd>⌘K</Kbd>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <span className="mr-1 hidden text-[12.5px] text-fg-3 xl:inline" aria-live="polite">
          {scanning ? `Scanning ${projectsDir}…` : scannedAt ? `Scanned ${timeAgo(scannedAt)}` : ""}
        </span>
        <Button
          variant="plain"
          size="md"
          icon={RefreshCw}
          spin={scanning}
          onClick={onRescan}
          disabled={scanning}
          aria-label="Refresh every project"
          title="Refresh every project"
        />
        <ThemeSwitch />
      </div>
    </header>
  );
}

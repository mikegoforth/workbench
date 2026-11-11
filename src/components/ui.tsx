"use client";

import {
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  CirclePause,
  ListFilter,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Reason } from "@/lib/attention";
import { SEVERITY_TONE, type Status, type Tone } from "@/lib/status";
import type { CheckState, OverviewEntry } from "@/lib/types";
import { useShortcut } from "@/lib/useShortcut";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

// Cloud-console primitives: buttons, status, cards, title bars, tables, menus.

// ---- Buttons ----

/** primary: filled blue. secondary: outlined, blue text. ghost: blue text button. plain: grey icon/text button. */
type Variant = "primary" | "secondary" | "ghost" | "plain" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover hover:shadow-card",
  secondary: "border border-line bg-surface text-brand-text hover:border-brand-line hover:bg-brand-soft",
  ghost: "text-brand-text hover:bg-brand-soft",
  plain: "text-fg-2 hover:bg-hover hover:text-fg",
  danger: "border border-line bg-surface text-bad hover:border-bad-line hover:bg-bad-soft",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-[13.5px]",
};
const ICON_SIZE: Record<Size, string> = { sm: "size-8", md: "size-9" };

export function buttonClass(variant: Variant = "secondary", size: Size = "md", iconOnly = false) {
  return `inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
    iconOnly ? `rounded-full ${ICON_SIZE[size]}` : `rounded ${SIZE[size]}`
  } ${VARIANT[variant]}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  spin?: boolean;
};

export function Button({ variant, size = "md", icon: Icon, spin, children, className = "", ...rest }: ButtonProps) {
  return (
    <button type="button" className={`${buttonClass(variant, size, !children)} ${className}`} {...rest}>
      {Icon && <Icon aria-hidden size={size === "sm" ? 15 : 17} strokeWidth={2} className={`shrink-0 ${spin ? "animate-spin" : ""}`} />}
      {children}
    </button>
  );
}

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
};

/** An external link that looks like a button; always opens in a new tab. */
export function LinkButton({ variant, size = "md", icon: Icon, children, className = "", ...rest }: LinkButtonProps) {
  return (
    <a target="_blank" rel="noopener noreferrer" className={`${buttonClass(variant, size, !children)} ${className}`} {...rest}>
      {Icon && <Icon aria-hidden size={size === "sm" ? 15 : 17} strokeWidth={2} className="shrink-0" />}
      {children}
    </a>
  );
}

/** A blue inline text action ("View all", "Show all 78"). */
export function TextButton({ children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`text-[13px] font-medium text-brand-text hover:underline hover:underline-offset-3 ${className}`} {...rest}>
      {children}
    </button>
  );
}

// ---- Status ----

const BADGE_TONE: Record<Tone, string> = {
  neutral: "border-line bg-subtle text-fg-2",
  ok: "border-ok-line bg-ok-soft text-ok",
  warn: "border-warn-line bg-warn-soft text-warn",
  bad: "border-bad-line bg-bad-soft text-bad",
  info: "border-brand-line bg-brand-soft text-brand-text",
};
const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-fg-3",
  ok: "bg-ok-dot",
  warn: "bg-warn-dot",
  bad: "bg-bad-dot",
  info: "bg-brand",
};

export function StatusDot({ tone, pulse = false, className = "" }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span aria-hidden className={`relative inline-flex size-2 shrink-0 ${className}`}>
      {pulse && <span className={`absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping ${DOT_TONE[tone]}`} />}
      <span className={`relative size-full rounded-full ${DOT_TONE[tone]}`} />
    </span>
  );
}

export function Badge({
  tone = "neutral",
  dot = false,
  pulse = false,
  icon: Icon,
  title,
  className = "",
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  icon?: LucideIcon;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] leading-none font-medium whitespace-nowrap ${BADGE_TONE[tone]} ${className}`}
    >
      {dot && <StatusDot tone={tone} pulse={pulse} className="size-1.5!" />}
      {Icon && <Icon aria-hidden size={12} strokeWidth={2.25} className="shrink-0" />}
      {children}
    </span>
  );
}

/** A count in a small pill, next to a heading, tab or nav label. */
export function Count({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full border px-1.5 text-[11px] leading-none font-medium tabular-nums ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

const STATUS_ICON: Record<string, { Icon: LucideIcon; className: string }> = {
  Running: { Icon: CircleCheck, className: "fill-ok-dot text-surface" },
  Failing: { Icon: CircleAlert, className: "fill-bad-dot text-surface" },
  Attention: { Icon: TriangleAlert, className: "fill-warn-dot text-surface" },
  Parked: { Icon: CirclePause, className: "fill-fg-3 text-surface" },
  Idle: { Icon: Circle, className: "text-fg-3" },
};

/** The console's status glyph: a filled icon in the status color, optionally with its word. */
export function StatusIcon({ status, label = false, size = 18 }: { status: Status; label?: boolean; size?: number }) {
  const { Icon, className } = STATUS_ICON[status.label] ?? STATUS_ICON.Idle;
  return (
    <span className="inline-flex items-center gap-2" title={label ? undefined : status.label}>
      <Icon aria-hidden size={size} strokeWidth={2} className={`shrink-0 ${className}`} />
      {label ? <span className="text-[13px] text-fg">{status.label}</span> : <span className="sr-only">{status.label}</span>}
    </span>
  );
}

export function ReasonBadge({ reason }: { reason: Reason }) {
  return <Badge tone={SEVERITY_TONE[reason.severity]}>{reason.label}</Badge>;
}

/** Ahead / behind the upstream; non-zero values in the warning color. */
export function SyncValue({ ahead, behind }: { ahead: number; behind: number }) {
  const part = (n: number, Icon: LucideIcon, word: string) => (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${n ? "font-medium text-warn" : "text-fg-3"}`}>
      <Icon aria-hidden size={13} strokeWidth={2.25} />
      {n}
      <span className="sr-only"> {word}</span>
    </span>
  );
  return (
    <span className="inline-flex items-center gap-2.5">
      {part(ahead, ArrowUp, "ahead")}
      {part(behind, ArrowDown, "behind")}
    </span>
  );
}

/** CI on the latest pushed commit of the current branch. */
export function CiBadge({ github, loaded }: { github: OverviewEntry["github"] | undefined; loaded: boolean }) {
  if (!loaded) return <span className="text-[13px] text-fg-3">Checking</span>;
  if (!github) return <span className="text-[13px] text-fg-3" title="Not on GitHub">—</span>;
  return <ChecksBadge state={github.ci} />;
}

/** A commit's combined checks, in the same words everywhere: Passing, Failing, In progress, No checks. */
export function ChecksBadge({ state }: { state: CheckState | null }) {
  switch (state) {
    case "SUCCESS":
      return <Badge tone="ok" dot>Passing</Badge>;
    case "FAILURE":
    case "ERROR":
      return <Badge tone="bad" dot>Failing</Badge>;
    case "PENDING":
    case "EXPECTED":
      return <Badge tone="warn" dot>In progress</Badge>;
    default:
      return <span className="text-[13px] text-fg-3">No checks</span>;
  }
}

// ---- Page structure ----

/**
 * The console title bar: optional back arrow, the page title, then the page's
 * actions as a row of text buttons right beside it.
 */
export function TitleBar({
  title,
  onBack,
  backLabel = "Back",
  status,
  actions,
}: {
  title: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-surface/95 px-5 py-3.5 backdrop-blur-sm sm:px-8">
      <div className="flex min-w-0 items-center gap-2">
        {onBack && <Button variant="plain" icon={ArrowLeft} onClick={onBack} aria-label={backLabel} title={`${backLabel} (Esc)`} />}
        <h1 className="min-w-0 text-[22px] leading-tight font-normal wrap-break-word text-fg">{title}</h1>
        {status}
      </div>
      {actions && <div className="-ml-2 flex flex-wrap items-center gap-0.5">{actions}</div>}
    </div>
  );
}

/** Page body: the padded column under the title bar. */
export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-8 sm:py-7 ${className}`}>{children}</div>;
}

export function Card({ children, className = "", ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={`min-w-0 rounded-lg border border-line bg-surface ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({
  id,
  title,
  icon: Icon,
  count,
  countTone,
  description,
  actions,
}: {
  id?: string;
  title: ReactNode;
  icon?: LucideIcon;
  count?: ReactNode;
  countTone?: Tone;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-5 py-3.5">
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-[15px] leading-tight font-medium text-fg">
          {Icon && <Icon aria-hidden size={17} strokeWidth={2} className="shrink-0 text-fg-3" />}
          {title}
          {count !== undefined && count !== null && <Count tone={countTone}>{count}</Count>}
        </h2>
        {description && <p className="mt-0.5 text-[12.5px] text-fg-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
    </div>
  );
}

/** A card with a header; the usual container for one job on a page. */
export function Panel({
  id,
  title,
  icon,
  count,
  countTone,
  description,
  actions,
  footer,
  className = "",
  bodyClassName = "p-5",
  children,
}: {
  id: string;
  title: ReactNode;
  icon?: LucideIcon;
  count?: ReactNode;
  countTone?: Tone;
  description?: ReactNode;
  actions?: ReactNode;
  /** A footer link row, e.g. "Go to Todos". */
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Card aria-labelledby={id} className={`flex flex-col ${className}`}>
      <CardHeader id={id} title={title} icon={icon} count={count} countTone={countTone} description={description} actions={actions} />
      <div className={`flex-1 ${bodyClassName}`}>{children}</div>
      {footer && <div className="border-t border-line px-3 py-2">{footer}</div>}
    </Card>
  );
}

/** Label / value rows, as on a console resource's Details tab. */
export function PropertyList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-1 gap-0.5 px-5 py-3 sm:grid-cols-[176px_minmax(0,1fr)] sm:gap-5">
          <dt className="text-[13px] text-fg-3">{r.label}</dt>
          <dd className="min-w-0 text-[13px] wrap-break-word text-fg">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Lists show their first rows; this reveals the rest. */
export function ShowAll({
  total,
  limit,
  expanded,
  onToggle,
}: {
  total: number;
  limit: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (total <= limit) return null;
  return (
    <TextButton onClick={onToggle} aria-expanded={expanded} className="mt-3">
      {expanded ? "Show fewer" : `Show all ${total}`}
    </TextButton>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded border border-line bg-subtle px-1.5 font-mono text-[11px] leading-none text-fg-3">
      {children}
    </kbd>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-hover text-fg-3">
        <Icon aria-hidden size={18} strokeWidth={2} />
      </span>
      <p className="mt-3 text-[14px] font-medium text-fg">{title}</p>
      {children && <div className="mt-1 max-w-sm text-[13px] text-fg-3">{children}</div>}
    </div>
  );
}

// ---- Tabs and filters ----

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
  countTone?: Tone;
}

const DEFAULT_TAB_PREFIX = "tabs";

/** The id of a tab button rendered by <Tabs idPrefix={idPrefix}>. */
export const tabId = (id: string, idPrefix = DEFAULT_TAB_PREFIX) => `${idPrefix}-tab-${id}`;

/** The id <Tabs idPrefix={idPrefix}> expects on the panel showing tab `id` (its aria-controls). */
export const tabPanelId = (id: string, idPrefix = DEFAULT_TAB_PREFIX) => `${idPrefix}-panel-${id}`;

/**
 * Spread on the element that shows the active tab's content, so it's announced
 * as that tab's panel: `<div {...tabPanelProps(activeTab, "project")}>`.
 */
export function tabPanelProps(id: string, idPrefix = DEFAULT_TAB_PREFIX) {
  return { id: tabPanelId(id, idPrefix), role: "tabpanel", "aria-labelledby": tabId(id, idPrefix) } as const;
}

/**
 * Resource tabs: blue text and underline on the active one. A WAI-ARIA tab list:
 * only the active tab is in the tab order; Left/Right/Home/End move and select.
 * With `shortcuts`, [ and ] select the previous/next tab from anywhere on the
 * page (unless the user is typing in a field).
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix = DEFAULT_TAB_PREFIX,
  shortcuts = false,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Prefix for the tab and panel ids; see tabPanelProps. */
  idPrefix?: string;
  /** Bind [ and ] to the previous/next tab. Use on one tab list per page. */
  shortcuts?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const found = tabs.findIndex((t) => t.id === value);
  // The tab that takes focus from the keyboard: the active one, else the first.
  const current = Math.max(0, found);

  const select = (index: number, focus: boolean) => {
    if (tabs.length === 0) return;
    const i = (index + tabs.length) % tabs.length;
    if (focus) listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus();
    if (tabs[i].id !== value) onChange(tabs[i].id);
  };

  useShortcut(["[", "]"], (e) => select(current + (e.key === "]" ? 1 : -1), false), { enabled: shortcuts });

  // Keep the active tab in view when the strip scrolls sideways (phones).
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !tab) return;
    const box = list.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    if (r.left < box.left) list.scrollLeft += r.left - box.left - 8;
    else if (r.right > box.right) list.scrollLeft += r.right - box.right + 8;
  }, [value]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    select(next, true);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-keyshortcuts={shortcuts ? "[ ]" : undefined}
      // The baseline is an inset shadow, not a border, and the active underline
      // sits inside its tab, so nothing pokes out of the scroll box (no stray
      // vertical scrollbar). Sideways it still scrolls, with a quiet scrollbar.
      className="flex overflow-x-auto overflow-y-hidden bg-surface px-1 shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:none] sm:px-3 sm:[scrollbar-width:thin]"
    >
      {tabs.map((t, i) => {
        const active = i === found;
        return (
          <button
            key={t.id}
            id={tabId(t.id, idPrefix)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={active ? tabPanelId(t.id, idPrefix) : undefined}
            tabIndex={i === current ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={onKeyDown}
            className={`inline-flex h-12 shrink-0 items-center gap-2 px-5 text-[13.5px] font-medium transition-colors focus-visible:outline-offset-[-2px] ${
              active
                ? "text-brand-text shadow-[inset_0_-2px_0_var(--color-brand)]"
                : "text-fg-2 shadow-[inset_0_-1px_0_var(--color-line)] hover:bg-hover hover:text-fg"
            }`}
          >
            {t.label}
            {t.count !== undefined && <Count tone={t.countTone}>{t.count}</Count>}
          </button>
        );
      })}
    </div>
  );
}

/** A compact toggle group, e.g. Commits / Branches / Stashes. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  size = "md",
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap overflow-hidden rounded border border-line">
      {items.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 font-medium transition-colors ${i > 0 ? "border-l border-line" : ""} ${
              size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3 text-[13px]"
            } ${active ? "bg-brand-soft text-brand-text" : "bg-surface text-fg-2 hover:bg-hover"}`}
          >
            {active && <Check aria-hidden size={13} strokeWidth={2.5} />}
            {t.label}
            {t.count !== undefined && <span className="text-[12px] tabular-nums opacity-80">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A filter chip; checked chips are tinted blue with a tick. */
export function Chip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${
        active ? "border-brand-line bg-brand-soft text-brand-text" : "border-line text-fg-2 hover:bg-hover"
      }`}
    >
      {active && <Check aria-hidden size={13} strokeWidth={2.5} />}
      {children}
      {count !== undefined && <span className="tabular-nums opacity-75">{count}</span>}
    </button>
  );
}

/** The console filter bar above a table: a free-text filter plus optional chips. */
export function FilterBar({
  value,
  onChange,
  placeholder = "Enter property name or value",
  className = "border-b border-line",
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Defaults to a bottom border, for sitting on top of a table. */
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 ${className}`}>
      <label className="flex h-8 min-w-56 flex-1 items-center gap-2 text-[13px]">
        <ListFilter aria-hidden size={17} strokeWidth={2} className="shrink-0 text-fg-2" />
        <span className="shrink-0 font-medium text-fg-2">Filter</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && value) {
              e.preventDefault();
              onChange("");
            }
          }}
          placeholder={placeholder}
          aria-label="Filter rows"
          className="h-full min-w-0 flex-1 bg-transparent text-fg focus:outline-none"
        />
        {value && (
          <button type="button" onClick={() => onChange("")} aria-label="Clear filter" className="grid size-6 place-items-center rounded-full text-fg-3 hover:bg-hover">
            <X aria-hidden size={14} strokeWidth={2.25} />
          </button>
        )}
      </label>
      {children && <div className="flex flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  );
}

// ---- Tables ----

export const TABLE = "w-full border-collapse text-left text-[13px]";
export const TH = "h-11 border-b border-line px-4 text-[12.5px] font-medium whitespace-nowrap text-fg-2";
export const TD = "border-b border-line px-5 py-3.5 align-middle";
export const TR = "group cursor-pointer transition-colors hover:bg-hover";

export type SortDir = "asc" | "desc";

/** A sortable column header. */
export function SortTh({
  label,
  active,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onSort: () => void;
  className?: string;
}) {
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={`${TH} ${className}`}>
      <button type="button" onClick={onSort} className={`group/sort inline-flex items-center gap-1 hover:text-fg ${active ? "text-fg" : ""}`}>
        {label}
        <Icon aria-hidden size={13} strokeWidth={2.25} className={active ? "opacity-100" : "opacity-0 group-hover/sort:opacity-50"} />
      </button>
    </th>
  );
}

// ---- Menus ----

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Shows a tick: the current choice in a pick-one menu. */
  checked?: boolean;
}

/**
 * A button that opens a list of actions. The list is fixed-positioned so a
 * scrolling table can't clip it; it closes on outside click, Esc or scroll.
 */
export function Menu({
  label,
  icon,
  text,
  items,
  variant = "plain",
  size = "sm",
}: {
  label: string;
  icon?: LucideIcon;
  text?: ReactNode;
  items: MenuItem[];
  variant?: Variant;
  size?: Size;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (open || !buttonRef.current) {
      setOpen(false);
      return;
    }
    // Open below the button, or above it when there's no room (rows are 36px).
    const r = buttonRef.current.getBoundingClientRect();
    const height = items.length * 36 + 14;
    const below = r.bottom + 4 + height <= window.innerHeight;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height), right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !listRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    listRef.current?.querySelector<HTMLElement>("[role^=menuitem]:not([aria-disabled=true])")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const itemClass = (it: MenuItem) =>
    `flex h-9 w-full items-center gap-3 px-4 text-left text-[13.5px] whitespace-nowrap hover:bg-hover focus:bg-hover focus:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-45 ${
      it.danger ? "text-bad" : "text-fg"
    }`;

  return (
    <>
      <div ref={buttonRef} className="inline-flex">
        <Button
          variant={variant}
          size={size}
          icon={icon}
          aria-label={text ? undefined : label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        >
          {text}
        </Button>
      </div>
      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label={label}
          style={pos ?? undefined}
          className="fixed z-50 min-w-52 rounded border border-line bg-surface py-1.5 shadow-pop"
        >
          {items.map((it) => {
            const Icon = it.icon;
            const content = (
              <>
                {Icon && <Icon aria-hidden size={16} strokeWidth={2} className={it.danger ? "text-bad" : "text-fg-2"} />}
                <span className="flex-1">{it.label}</span>
                {it.checked && <Check aria-hidden size={16} strokeWidth={2.25} className="text-brand-text" />}
              </>
            );
            return it.href && !it.disabled ? (
              <a key={it.label} role="menuitem" href={it.href} target="_blank" rel="noopener noreferrer" className={itemClass(it)} onClick={() => setOpen(false)}>
                {content}
              </a>
            ) : (
              <button
                key={it.label}
                type="button"
                role={it.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={it.checked}
                aria-disabled={it.disabled || undefined}
                className={itemClass(it)}
                onClick={() => {
                  if (it.disabled) return;
                  setOpen(false);
                  it.onSelect?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * The Workbench mark: a dashboard of project tiles, one with a green status
 * light, on a navy tile. Same artwork as docs/assets/logo.svg and the app
 * icons, with a flat background (the gradient doesn't show at this size).
 */
export function Logo() {
  return (
    <svg aria-hidden viewBox="0 0 512 512" width="28" height="28" className="size-7 shrink-0">
      <rect width="512" height="512" rx="114" fill="#111b2e" />
      <rect x="108" y="108" width="136" height="136" rx="32" fill="#1a73e8" />
      <rect x="268" y="108" width="136" height="136" rx="32" fill="#fff" fillOpacity=".92" />
      <rect x="108" y="268" width="136" height="136" rx="32" fill="#fff" fillOpacity=".92" />
      <rect x="268" y="268" width="136" height="136" rx="32" fill="#fff" fillOpacity=".18" />
      <circle cx="336" cy="336" r="30" fill="#3ddc97" />
    </svg>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  CirclePause,
  CirclePlay,
  CodeXml,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Plus,
  RefreshCw,
  SquareTerminal,
  X,
} from "lucide-react";
import type { StripState } from "@/lib/attention";
import { openInEditor, openInTerminal } from "@/lib/openInEditor";
import { repoHostLabel } from "@/lib/repoUrl";
import { projectStatus } from "@/lib/status";
import type { OverviewEntry, ProjectInfo, TodoItem } from "@/lib/types";
import { useShortcut } from "@/lib/useShortcut";
import AttentionPanel from "./AttentionPanel";
import ChangedFiles from "./ChangedFiles";
import ContainerLogs from "./ContainerLogs";
import { LifecycleButton, RunPanel, useDevStatus } from "./DevEnvironment";
import GitHubPanel from "./GitHubPanel";
import HistoryPanel, { RecentCommits } from "./HistoryPanel";
import ResumeSummary from "./ResumeSummary";
import { Badge, Button, CiBadge, Menu, PageBody, Panel, PropertyList, StatusIcon, Tabs, tabPanelProps, TitleBar, type MenuItem, type TabItem } from "./ui";
import type { DetailTab } from "./model";
import ReadmePanel from "./ReadmePanel";
import ScriptsPanel from "./ScriptsPanel";
import { useAppLabels } from "./usePreferences";
import { useRemoteSync } from "./useRemoteSync";

async function saveNotes(projectName: string, notes: string, todos: TodoItem[]) {
  const res = await fetch("/api/notes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectName, notes, todos }),
  });
  if (!res.ok) throw new Error("Couldn't save notes");
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mb-4 rounded border border-bad-line bg-bad-soft px-5 py-3 text-[13.5px] text-bad">
      {children}
    </p>
  );
}

export default function ProjectDetail({
  project,
  state,
  entry,
  overviewLoaded,
  tab,
  onTab,
  onBack,
  backLabel,
  onUpdate,
  onHiddenChange,
  onPark,
  onPull,
  pullPending,
  stripError,
  onActivity,
  dockerStarting,
  onStartDocker,
}: {
  project: ProjectInfo;
  state: StripState;
  entry?: OverviewEntry;
  overviewLoaded: boolean;
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  onBack: () => void;
  /** The page Back returns to. */
  backLabel: string;
  onUpdate: (p: ProjectInfo) => void;
  onHiddenChange: (hidden: boolean) => void;
  onPark: (fingerprint: string | null) => void;
  onPull: () => void;
  pullPending: boolean;
  stripError?: string | null;
  /** Something started or stopped, so what's running should refresh. */
  onActivity: () => void;
  dockerStarting: boolean;
  onStartDocker: () => void;
}) {
  const [notes, setNotes] = useState(project.notes || "");
  const [todos, setTodos] = useState<TodoItem[]>(project.todos || []);
  const [newTodo, setNewTodo] = useState("");
  // Notes save on blur: "Saving…", then a brief "Saved".
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const [notesFocused, setNotesFocused] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [opening, setOpening] = useState<"editor" | "terminal" | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const dev = useDevStatus(project.name, onActivity);
  const apps = useAppLabels();
  const sync = useRemoteSync(project, onUpdate);

  const openWith = async (app: "editor" | "terminal") => {
    setOpening(app);
    setOpenError(null);
    try {
      await (app === "editor" ? openInEditor(project.name, undefined, apps.editor) : openInTerminal(project.name, apps.terminal));
    } catch (e) {
      setOpenError((e as Error).message);
    } finally {
      setOpening(null);
    }
  };

  useShortcut(["o"], () => openWith("editor"));
  useShortcut(["t"], () => openWith("terminal"));
  useShortcut(["g"], () => window.open(project.repoUrl, "_blank", "noopener,noreferrer"), { enabled: !!project.repoUrl });
  useShortcut(["s"], () => dev.act("start"), { enabled: dev.canStart });

  const isGit = project.isGitRepo;
  const status = projectStatus(state);
  const gh = entry?.github;
  const onGitHub = !!project.repoUrl && repoHostLabel(project.repoUrl) === "GitHub";
  const behind = project.aheadBehind?.behind ?? 0;
  const ahead = project.aheadBehind?.ahead ?? 0;
  const changed = (project.uncommittedChanges ?? 0) + (project.untrackedFiles ?? 0);
  const pendingTodos = todos.filter((t) => !t.done).length;
  const historyKey = `${project.branch}|${project.lastCommitDate}|${ahead}|${behind}|${project.lastFetchedAt}`;
  const notesOpen = notesFocused || notes.length > 0;

  const persist = async (nextNotes: string, nextTodos: TodoItem[]) => {
    clearTimeout(savedTimer.current);
    setSaveState("saving");
    setNotesError(null);
    try {
      await saveNotes(project.name, nextNotes, nextTodos);
      onUpdate({ ...project, notes: nextNotes, todos: nextTodos });
      setSaveState("saved");
      savedTimer.current = setTimeout(() => setSaveState("idle"), 2000);
    } catch (e) {
      setNotesError((e as Error).message);
      setSaveState("idle");
    }
  };

  const updateTodos = (updated: TodoItem[]) => {
    setTodos(updated);
    persist(notes, updated);
  };

  const addTodo = () => {
    if (!newTodo.trim()) return;
    updateTodos([...todos, { id: crypto.randomUUID(), text: newTodo.trim(), done: false, createdAt: new Date().toISOString() }]);
    setNewTodo("");
  };

  // ---- Title bar ----

  const more: MenuItem[] = [];
  if (project.repoUrl) more.push({ label: `View on ${repoHostLabel(project.repoUrl)}`, icon: ExternalLink, href: project.repoUrl });
  if (state.fingerprint) {
    more.push(
      state.parked
        ? { label: "Unpark", icon: CirclePlay, onSelect: () => onPark(null) }
        : { label: "Park until it changes", icon: CirclePause, onSelect: () => onPark(state.fingerprint) }
    );
  }
  more.push(
    project.hidden
      ? { label: "Unhide", icon: Eye, onSelect: () => onHiddenChange(false) }
      : { label: "Hide from lists", icon: EyeOff, onSelect: () => onHiddenChange(true) }
  );

  // The title bar owns the lifecycle: Start is the page's one filled button.
  const actions = (
    <>
      <span className="mr-2 ml-2 inline-flex">
        <LifecycleButton dev={dev} />
      </span>
      <Button variant="ghost" icon={opening === "editor" ? LoaderCircle : CodeXml} spin={opening === "editor"} onClick={() => openWith("editor")} disabled={opening !== null} title={`Open in ${apps.editor} (O)`}>
        Open in {apps.editor}
      </Button>
      <Button variant="ghost" icon={SquareTerminal} onClick={() => openWith("terminal")} disabled={opening !== null} title={apps.terminal === "Terminal" ? "Open a terminal window here (T)" : `Open ${apps.terminal} here (T)`}>
        {apps.terminal}
      </Button>
      {sync.enabled && (
        <Button variant="ghost" icon={RefreshCw} spin={sync.fetching} onClick={sync.fetchRemote} disabled={sync.fetching || pullPending} title="git fetch --all --prune">
          Fetch
        </Button>
      )}
      {sync.enabled && behind > 0 && (
        <Button variant="ghost" icon={pullPending ? LoaderCircle : ArrowDown} spin={pullPending} onClick={onPull} disabled={sync.fetching || pullPending} title="git pull --ff-only: only fast-forwards, never merges">
          Pull {behind}
        </Button>
      )}
      <Menu label="More actions" icon={EllipsisVertical} size="md" items={more} />
    </>
  );

  const tabs: TabItem<DetailTab>[] = [
    { id: "details", label: "Details" },
    ...(isGit ? [{ id: "changes" as const, label: "Changes", count: changed || undefined }] : []),
    { id: "dev", label: "Dev environment" },
    // Until the status arrives, trust a link straight to the Logs tab.
    ...((dev.status ? dev.status.stacks.some((st) => st.services.some((sv) => sv.container)) : tab === "logs")
      ? [{ id: "logs" as const, label: "Logs" }]
      : []),
    ...(isGit ? [{ id: "history" as const, label: "History" }] : []),
    ...(onGitHub ? [{ id: "github" as const, label: "GitHub" }] : []),
    { id: "readme", label: "README" },
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "details";

  // ---- Details ----

  // Branch, upstream, working tree and last commit are in the summary above;
  // status and the dev server are in the title bar.
  const detailRows: { label: string; value: ReactNode }[] = [
    { label: "Location", value: <span className="font-mono text-[12.5px]">{project.path}</span> },
  ];
  if (project.repoUrl) {
    detailRows.push({
      label: "Repository",
      value: (
        <a href={project.repoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-text hover:underline">
          {project.repoUrl.replace(/^https?:\/\//, "")}
          <ExternalLink aria-hidden size={13} />
        </a>
      ),
    });
  }
  if (gh) {
    detailRows.push({
      label: "CI",
      value: (
        <span className="inline-flex flex-wrap items-center gap-2">
          <CiBadge github={gh} loaded={overviewLoaded} />
          {/* Only link to checks that exist. */}
          {gh.ci && gh.ciUrl && (
            <a href={gh.ciUrl} target="_blank" rel="noopener noreferrer" className="text-brand-text hover:underline">
              Checks
            </a>
          )}
        </span>
      ),
    });
    detailRows.push({
      label: "Pull requests",
      value: (
        <span>
          {gh.openPullRequests} open
          {gh.reviewRequested > 0 && <span className="ml-2 font-medium text-warn">{gh.reviewRequested} awaiting your review</span>}
        </span>
      ),
    });
  }

  const notesCard = (
    <Panel
      id="notes-heading"
      title="Notes and todos"
      actions={
        <span aria-live="polite" className="text-[12.5px] text-fg-3">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
      }
      bodyClassName="grid grid-cols-1 md:grid-cols-2 md:divide-x divide-line max-md:divide-y"
    >
      <div className="p-4">
        <label htmlFor="project-notes" className="mb-1.5 block text-[12.5px] font-medium text-fg-2">
          Notes
        </label>
        <textarea
          id="project-notes"
          value={notes}
          // One line until it's in use, so an empty note doesn't take the page's best spot.
          rows={notesOpen ? 6 : 1}
          onChange={(e) => setNotes(e.target.value)}
          onFocus={() => setNotesFocused(true)}
          onBlur={(e) => {
            setNotesFocused(false);
            if (e.target.value !== (project.notes || "")) persist(e.target.value, todos);
          }}
          className={`block w-full rounded border border-line bg-surface px-3 text-[13.5px] leading-relaxed text-fg focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none ${
            notesOpen ? "resize-y py-2" : "h-8 resize-none overflow-hidden py-1"
          }`}
          placeholder={notesOpen ? "Where did you leave off? What's next?" : "Add a note…"}
        />
        {notesError && <p className="mt-2 text-[12.5px] font-medium text-bad">{notesError}</p>}
      </div>
      <div className="flex min-w-0 flex-col p-4">
        <p className="mb-1.5 text-[12.5px] font-medium text-fg-2">
          Todos {todos.length > 0 && <span className="font-normal text-fg-3">· {pendingTodos} of {todos.length} open</span>}
        </p>
        {todos.length > 0 ? (
          <ul className="-mx-1 mb-2 max-h-52 overflow-y-auto">
            {todos.map((todo) => (
              <li key={todo.id} className="group flex items-center gap-2.5 rounded px-1 py-1 hover:bg-hover">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => updateTodos(todos.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)))}
                  aria-label={`Mark "${todo.text}" ${todo.done ? "open" : "done"}`}
                  className="size-4 shrink-0 accent-brand"
                />
                <span className={`min-w-0 flex-1 text-[13.5px] ${todo.done ? "text-fg-3 line-through" : "text-fg"}`}>{todo.text}</span>
                <Button
                  size="sm"
                  variant="plain"
                  icon={X}
                  onClick={() => updateTodos(todos.filter((t) => t.id !== todo.id))}
                  aria-label={`Remove "${todo.text}"`}
                  className="opacity-100 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-2 text-[13px] text-fg-3">No todos yet.</p>
        )}
        <div className="mt-auto flex gap-2">
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTodo()}
            aria-label="New todo"
            placeholder="Add a todo"
            className="h-8 min-w-0 flex-1 rounded border border-line bg-surface px-3 text-[13.5px] text-fg focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none"
          />
          <Button icon={Plus} onClick={addTodo} disabled={!newTodo.trim()}>
            Add
          </Button>
        </div>
      </div>
    </Panel>
  );

  // Is it running, and where: the project's status, then the dev server's URL.
  const titleStatus = (
    <span className="ml-1 inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <StatusIcon status={status} label />
      {state.parked && status.label !== "Parked" && <Badge>Parked</Badge>}
      {project.hidden && <Badge icon={EyeOff}>Hidden</Badge>}
      {dev.status?.url && (
        <a
          href={dev.status.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the dev server"
          className="inline-flex items-center gap-1 font-mono text-[12.5px] text-brand-text hover:underline"
        >
          {dev.status.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          <ExternalLink aria-hidden size={12} />
        </a>
      )}
    </span>
  );

  return (
    <>
      <div className="sticky top-0 z-20">
        <TitleBar title={project.name} onBack={onBack} backLabel={`Back to ${backLabel}`} status={titleStatus} actions={actions} />
        <Tabs label="Project sections" tabs={tabs} value={activeTab} onChange={onTab} idPrefix="project" shortcuts />
      </div>
      <PageBody>
        {(openError || stripError || sync.error) && <Banner>{openError ?? stripError ?? sync.error}</Banner>}

        <div {...tabPanelProps(activeTab, "project")}>

        {activeTab === "details" && (
          <div className="space-y-6">
            <ResumeSummary
              project={project}
              dev={dev}
              historyKey={historyKey}
              fetching={sync.fetching}
              onFetch={sync.enabled && !pullPending ? sync.fetchRemote : undefined}
              onChanges={() => onTab("changes")}
              onHistory={() => onTab("history")}
            />
            {/* DOM order is reading order: on a phone, attention and Run come right after the summary. */}
            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <div className="min-w-0 space-y-6">
                <AttentionPanel
                  project={project}
                  state={state}
                  dev={dev}
                  pullPending={pullPending}
                  onPull={onPull}
                  onLogs={() => onTab("logs")}
                  onChanges={isGit ? () => onTab("changes") : undefined}
                />
                <RunPanel dev={dev} dockerStarting={dockerStarting} onStartDocker={onStartDocker} />
                {isGit && notesCard}
              </div>
              <div className="min-w-0 space-y-6">
                {/* Without git there's nothing else for this column, so notes go here. */}
                {!isGit && notesCard}
                {isGit && (
                  <ChangedFiles
                    projectName={project.name}
                    files={project.files ?? []}
                    truncated={project.filesTruncated}
                    limit={6}
                    onViewAll={() => onTab("changes")}
                  />
                )}
                {isGit && <RecentCommits projectName={project.name} repoUrl={project.repoUrl} refreshKey={historyKey} onViewAll={() => onTab("history")} />}
                {/* Without git, the summary already says everything this would. */}
                {isGit && (
                  <Panel id="details-heading" title="Project details" bodyClassName="">
                    <PropertyList rows={detailRows} />
                  </Panel>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "changes" && (
          <ChangedFiles projectName={project.name} files={project.files ?? []} truncated={project.filesTruncated} limit={100} />
        )}

        {activeTab === "dev" && (
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <RunPanel dev={dev} dockerStarting={dockerStarting} onStartDocker={onStartDocker} />
            <div className="min-w-0 space-y-6">
              <ScriptsPanel projectName={project.name} onActivity={onActivity} />
              <AttentionPanel
                project={project}
                state={state}
                dev={dev}
                pullPending={pullPending}
                onPull={onPull}
                onLogs={() => onTab("logs")}
                onChanges={isGit ? () => onTab("changes") : undefined}
              />
            </div>
          </div>
        )}

        {activeTab === "logs" && <ContainerLogs projectName={project.name} />}

        {activeTab === "history" && <HistoryPanel projectName={project.name} repoUrl={project.repoUrl} refreshKey={historyKey} />}

        {activeTab === "github" && <GitHubPanel projectName={project.name} />}

        {activeTab === "readme" && <ReadmePanel projectName={project.name} repoUrl={project.repoUrl} />}

        </div>

        {/* Keyboard hints: only where there's a keyboard to use them. */}
        <p className="mt-6 hidden text-[12px] text-fg-3 sm:block">
          Keys: <span className="font-mono">[</span>/<span className="font-mono">]</span> previous / next tab · <span className="font-mono">O</span> {apps.editor} · <span className="font-mono">T</span> {apps.terminal} · <span className="font-mono">S</span> Start
          {project.repoUrl && (
            <>
              {" "}
              · <span className="font-mono">G</span> {repoHostLabel(project.repoUrl)}
            </>
          )}{" "}
          · <span className="font-mono">J</span>/<span className="font-mono">K</span> next / previous project · <span className="font-mono">Esc</span> back
        </p>
      </PageBody>
    </>
  );
}

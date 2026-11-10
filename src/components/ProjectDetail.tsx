"use client";

import { useState, type ReactNode } from "react";
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
  Play,
  Plus,
  RefreshCw,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import type { StripState } from "@/lib/attention";
import { timeAgo } from "@/lib/format";
import { openInEditor, openInTerminal } from "@/lib/openInEditor";
import { repoHostLabel } from "@/lib/repoUrl";
import { projectStatus } from "@/lib/status";
import type { OverviewEntry, ProjectInfo, TodoItem } from "@/lib/types";
import { useShortcut } from "@/lib/useShortcut";
import AttentionPanel from "./AttentionPanel";
import ChangedFiles from "./ChangedFiles";
import ContainerLogs from "./ContainerLogs";
import { devState, RunPanel, useDevStatus } from "./DevEnvironment";
import GitHubPanel from "./GitHubPanel";
import HistoryPanel, { RecentCommits } from "./HistoryPanel";
import { Badge, Button, CiBadge, Menu, PageBody, Panel, PropertyList, StatusIcon, SyncValue, Tabs, TextButton, TitleBar, type MenuItem, type TabItem } from "./ui";
import type { DetailTab } from "./model";
import ReadmePanel from "./ReadmePanel";
import ScriptsPanel from "./ScriptsPanel";
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
    <p role="alert" className="mb-4 rounded border border-bad-line bg-bad-soft px-4 py-2.5 text-[13.5px] text-bad">
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
  const [saving, setSaving] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [opening, setOpening] = useState<"vscode" | "terminal" | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const dev = useDevStatus(project.name, onActivity);
  const sync = useRemoteSync(project, onUpdate);

  const openWith = async (app: "vscode" | "terminal") => {
    setOpening(app);
    setOpenError(null);
    try {
      await (app === "vscode" ? openInEditor(project.name) : openInTerminal(project.name));
    } catch (e) {
      setOpenError((e as Error).message);
    } finally {
      setOpening(null);
    }
  };

  useShortcut(["o"], () => openWith("vscode"));
  useShortcut(["t"], () => openWith("terminal"));
  useShortcut(["g"], () => window.open(project.repoUrl, "_blank", "noopener,noreferrer"), { enabled: !!project.repoUrl });
  useShortcut(["s"], () => dev.act("start"), { enabled: dev.canStart });

  const isGit = project.isGitRepo;
  const status = projectStatus(state);
  const gh = entry?.github;
  const onGitHub = !!project.repoUrl && repoHostLabel(project.repoUrl) === "GitHub";
  const behind = project.aheadBehind?.behind ?? 0;
  const ahead = project.aheadBehind?.ahead ?? 0;
  const modified = project.uncommittedChanges ?? 0;
  const untracked = project.untrackedFiles ?? 0;
  const changed = modified + untracked;
  const pendingTodos = todos.filter((t) => !t.done).length;
  const historyKey = `${project.branch}|${project.lastCommitDate}|${ahead}|${behind}|${project.lastFetchedAt}`;
  const run = devState(dev);

  const persist = async (nextNotes: string, nextTodos: TodoItem[]) => {
    setSaving(true);
    setNotesError(null);
    try {
      await saveNotes(project.name, nextNotes, nextTodos);
      onUpdate({ ...project, notes: nextNotes, todos: nextTodos });
    } catch (e) {
      setNotesError((e as Error).message);
    } finally {
      setSaving(false);
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

  const actions = (
    <>
      <Button variant="ghost" icon={opening === "vscode" ? LoaderCircle : CodeXml} spin={opening === "vscode"} onClick={() => openWith("vscode")} disabled={opening !== null} title="Open in VS Code (O)">
        Open in VS Code
      </Button>
      <Button variant="ghost" icon={SquareTerminal} onClick={() => openWith("terminal")} disabled={opening !== null} title="Open a Terminal window here (T)">
        Terminal
      </Button>
      {dev.canStop ? (
        <Button variant="ghost" icon={dev.pending === "stop" ? LoaderCircle : Square} spin={dev.pending === "stop"} onClick={() => dev.act("stop")} className="text-bad! hover:bg-bad-soft!">
          Stop
        </Button>
      ) : (
        <Button
          variant="ghost"
          icon={dev.pending === "start" ? LoaderCircle : Play}
          spin={dev.pending === "start"}
          onClick={() => dev.act("start")}
          disabled={!dev.canStart}
          title={dev.status && dev.status.steps.length === 0 ? "Nothing to start in this project" : "Start the dev environment (S)"}
        >
          Start
        </Button>
      )}
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
    ...(isGit ? [{ id: "changes" as const, label: "Changes", count: changed }] : []),
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

  const detailRows: { label: string; value: ReactNode }[] = [
    {
      label: "Status",
      value: (
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusIcon status={status} label size={16} />
          {state.parked && <Badge>Parked</Badge>}
          {project.hidden && <Badge icon={EyeOff}>Hidden</Badge>}
        </span>
      ),
    },
    { label: "Location", value: <span className="font-mono text-[12.5px]">{project.path}</span> },
  ];
  if (isGit) {
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
    detailRows.push({ label: "Branch", value: <span className="font-mono text-[12.5px]">{project.branch ?? "detached HEAD"}</span> });
    detailRows.push({
      label: "Upstream",
      value: project.hasRemote ? (
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <SyncValue ahead={ahead} behind={behind} />
          <span className="text-fg-3">
            {ahead || behind ? `${ahead} ahead, ${behind} behind` : "In sync"} · fetched{" "}
            {sync.fetching ? "now" : project.lastFetchedAt ? timeAgo(project.lastFetchedAt) : "never"}
          </span>
        </span>
      ) : (
        <span className="text-fg-3">No remote</span>
      ),
    });
    detailRows.push({
      label: "Working tree",
      value: changed ? (
        <TextButton onClick={() => onTab("changes")} className="text-[13px]!">
          {modified} modified, {untracked} untracked
        </TextButton>
      ) : (
        <span className="text-fg-3">Clean</span>
      ),
    });
    if (gh) {
      detailRows.push({
        label: "CI",
        value: (
          <span className="inline-flex flex-wrap items-center gap-2">
            <CiBadge github={gh} loaded={overviewLoaded} />
            {gh.ciUrl && (
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
    detailRows.push({
      label: "Last commit",
      value: project.lastCommitDate ? (
        <span>
          {project.lastCommitMessage}
          <span className="block text-[12.5px] text-fg-3">
            {project.lastCommitAuthor} · {timeAgo(project.lastCommitDate)}
          </span>
        </span>
      ) : (
        <span className="text-fg-3">No commits yet</span>
      ),
    });
  } else {
    detailRows.push({ label: "Git", value: <span className="text-fg-3">Not a git repository</span> });
  }
  detailRows.push({
    label: "Dev server",
    value: (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Badge tone={run.tone} dot pulse={run.tone === "ok" || run.busy}>
          {run.label}
        </Badge>
        {dev.status?.url && (
          <a href={dev.status.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[12.5px] text-brand-text hover:underline">
            {dev.status.url}
          </a>
        )}
      </span>
    ),
  });

  const notesCard = (
    <Panel
      id="notes-heading"
      title="Notes and todos"
      description="Where you left off and what's next"
      actions={saving ? <span className="text-[12.5px] text-fg-3">Saving…</span> : undefined}
      bodyClassName="grid grid-cols-1 md:grid-cols-2 md:divide-x divide-line max-md:divide-y"
    >
      <div className="p-4">
        <label htmlFor="project-notes" className="mb-1.5 block text-[12.5px] font-medium text-fg-2">
          Notes
        </label>
        <textarea
          id="project-notes"
          value={notes}
          rows={7}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={(e) => {
            if (e.target.value !== (project.notes || "")) persist(e.target.value, todos);
          }}
          className="block w-full resize-y rounded border border-line bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-fg focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none"
          placeholder="Where did you leave off? What's next?"
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

  return (
    <>
      <div className="sticky top-0 z-20">
        <TitleBar title={project.name} onBack={onBack} backLabel={`Back to ${backLabel}`} status={<StatusIcon status={status} />} actions={actions} />
        <Tabs label="Project sections" tabs={tabs} value={activeTab} onChange={onTab} />
      </div>
      <PageBody>
        {(openError || stripError || sync.error) && <Banner>{openError ?? stripError ?? sync.error}</Banner>}

        {activeTab === "details" && (
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="min-w-0 space-y-4">
              {notesCard}
              <Panel id="details-heading" title="Project details" bodyClassName="">
                <PropertyList rows={detailRows} />
              </Panel>
              {isGit && <RecentCommits projectName={project.name} repoUrl={project.repoUrl} refreshKey={historyKey} onViewAll={() => onTab("history")} />}
            </div>
            <div className="min-w-0 space-y-4">
              <AttentionPanel project={project} state={state} dev={dev} pullPending={pullPending} onPull={onPull} onLogs={() => onTab("logs")} />
              <RunPanel dev={dev} dockerStarting={dockerStarting} onStartDocker={onStartDocker} />
              {isGit && (
                <ChangedFiles
                  projectName={project.name}
                  files={project.files ?? []}
                  truncated={project.filesTruncated}
                  limit={6}
                  onViewAll={() => onTab("changes")}
                />
              )}
            </div>
          </div>
        )}

        {activeTab === "changes" && (
          <ChangedFiles projectName={project.name} files={project.files ?? []} truncated={project.filesTruncated} limit={100} />
        )}

        {activeTab === "dev" && (
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <RunPanel dev={dev} dockerStarting={dockerStarting} onStartDocker={onStartDocker} />
            <div className="min-w-0 space-y-4">
              <ScriptsPanel projectName={project.name} onActivity={onActivity} />
              <AttentionPanel project={project} state={state} dev={dev} pullPending={pullPending} onPull={onPull} onLogs={() => onTab("logs")} />
            </div>
          </div>
        )}

        {activeTab === "logs" && <ContainerLogs projectName={project.name} />}

        {activeTab === "history" && <HistoryPanel projectName={project.name} repoUrl={project.repoUrl} refreshKey={historyKey} />}

        {activeTab === "github" && <GitHubPanel projectName={project.name} />}

        {activeTab === "readme" && <ReadmePanel projectName={project.name} repoUrl={project.repoUrl} />}

        <p className="mt-6 text-[12px] text-fg-3">
          Keys: <span className="font-mono">O</span> VS Code · <span className="font-mono">T</span> Terminal · <span className="font-mono">S</span> Start
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { stripState } from "@/lib/attention";
import { listCount } from "@/lib/pullRequestRows";
import { changedCount, openTodoCount, projectStatus } from "@/lib/status";
import type { ContainerProblem, DockerDaemon, Overview, ProjectInfo, ProjectsDirInfo, RequirementsResult } from "@/lib/types";
import { useShortcut } from "@/lib/useShortcut";
import ActivityView from "./ActivityView";
import AppBar from "./AppBar";
import AttentionView from "./AttentionView";
import DashboardView from "./DashboardView";
import { DockerNotice } from "./Docker";
import { Button, PageBody, TitleBar } from "./ui";
import { DETAIL_TABS, VIEW_TITLE, VIEWS, type Actions, type Counts, type Ctx, type DetailTab, type Item, type View } from "./model";
import ProjectDetail from "./ProjectDetail";
import ProjectPicker from "./ProjectPicker";
import ProjectsFolder from "./ProjectsFolder";
import PullRequestsView, { loadErrorOf, loadPullRequests, type PullRequestsState } from "./PullRequestsView";
import Setup from "./Setup";
import UpdateBanner from "./UpdateBanner";
import { queryRows, type ChipId, type Sort, type SortKey } from "./projectQuery";
import ProjectsView from "./ProjectsView";
import PortsView from "./PortsView";
import ServersView from "./ServersView";
import SideNav from "./SideNav";
import TodosView from "./TodosView";

const RUNNING_POLL_MS = 5000;
// The server caches a minute; this keeps the nav's review count current without hammering GitHub.
const PULL_REQUESTS_POLL_MS = 3 * 60_000;
const DOCKER_WAIT_MS = 120_000;

interface RunningPoll {
  running: string[];
  ports?: Record<string, number[]>;
  problems: Record<string, ContainerProblem[]>;
  docker: DockerDaemon;
}

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Where you are: a page from the nav, and optionally a project opened from it. */
interface Route {
  view: View;
  project: string | null;
  tab: DetailTab;
}

function readRoute(): Route {
  const q = new URLSearchParams(location.search);
  const view = q.get("view") as View | null;
  const tab = q.get("tab") as DetailTab | null;
  return {
    view: view && VIEWS.includes(view) ? view : "dashboard",
    project: q.get("p"),
    tab: tab && DETAIL_TABS.includes(tab) ? tab : "details",
  };
}

function routeUrl(r: Route): string {
  const q = new URLSearchParams();
  if (r.view !== "dashboard") q.set("view", r.view);
  if (r.project) {
    q.set("p", r.project);
    if (r.tab !== "details") q.set("tab", r.tab);
  }
  const s = q.toString();
  return s ? `?${s}` : location.pathname;
}

export default function Dashboard() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dirInfo, setDirInfo] = useState<ProjectsDirInfo | null>(null);
  // Node, Docker and Git. Missing ones are shown before anything else, unless skipped for this session.
  const [requirements, setRequirements] = useState<RequirementsResult | null>(null);
  const [checkingRequirements, setCheckingRequirements] = useState(false);
  const [requirementsSkipped, setRequirementsSkipped] = useState(false);
  // When first-run setup was finished: undefined while loading, null if it hasn't been.
  const [setupCompletedAt, setSetupCompletedAt] = useState<string | null | undefined>(undefined);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [ports, setPorts] = useState<Record<string, number[]>>({});
  const [problems, setProblems] = useState<Record<string, ContainerProblem[]>>({});
  const [docker, setDocker] = useState<DockerDaemon | null>(null);
  const [dockerStarting, setDockerStarting] = useState(false);
  const [dockerDismissed, setDockerDismissed] = useState(false);
  // Bumped when something starts or stops, to re-check what's running right away.
  const [runningCheck, setRunningCheck] = useState(0);

  const [route, setRoute] = useState<Route>({ view: "dashboard", project: null, tab: "details" });
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<Set<ChipId>>(new Set());
  const [sort, setSort] = useState<Sort>({ key: "status", dir: "asc" });
  const [focusName, setFocusName] = useState<string | null>(null);
  const [picker, setPicker] = useState<"search" | "select" | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [prs, setPrs] = useState<PullRequestsState>({ data: null, error: null, loading: true });

  // First scan and the overview; the URL's route applies once the list is known.
  useEffect(() => {
    let cancelled = false;
    // Show where the URL points while the first scan runs (it's checked once the list is known).
    setRoute(readRoute());
    getJSON<ProjectInfo[]>("/api/projects")
      .then((data) => {
        if (cancelled) return;
        setProjects(data);
        setScannedAt(new Date().toISOString());
        setError(null);
        const r = readRoute();
        setRoute(r.project && !data.some((p) => p.name === r.project) ? { ...r, project: null } : r);
        if (r.project) setFocusName(r.project);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    getJSON<Overview>("/api/overview")
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch(() => {});
    getJSON<{ completedAt: string | null }>("/api/setup")
      .then((s) => {
        if (!cancelled) setSetupCompletedAt(s.completedAt);
      })
      // Can't tell: assume it's done rather than trap anyone in setup.
      .catch(() => {
        if (!cancelled) setSetupCompletedAt(new Date(0).toISOString());
      });
    getJSON<RequirementsResult>("/api/requirements")
      .then((r) => {
        if (!cancelled) setRequirements(r);
      })
      // If the check itself fails, don't lock anyone out of the dashboard.
      .catch(() => {
        if (!cancelled) setRequirements({ ok: true, requirements: [] });
      });
    getJSON<ProjectsDirInfo>("/api/projects-dir")
      .then((d) => {
        if (!cancelled) setDirInfo(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Browser back / forward.
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // What's running (dev servers, scripts, containers), polled.
  const runningRef = useRef(running);
  useEffect(() => {
    runningRef.current = running;
  });
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      getJSON<RunningPoll>("/api/dev/running")
        .then((data) => {
          if (cancelled) return;
          const next = new Set(data.running);
          const prev = runningRef.current;
          if (next.size !== prev.size || [...next].some((n) => !prev.has(n))) setRunning(next);
          // Only replace when changed, so a quiet poll doesn't re-render every page.
          const same = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
          const nextPorts = data.ports ?? {};
          setPorts((p) => (same(p, nextPorts) ? p : nextPorts));
          setProblems((p) => (same(p, data.problems) ? p : data.problems));
          setDocker((d) => (same(d, data.docker) ? d : data.docker));
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, RUNNING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runningCheck]);

  // Open PRs involving you, across GitHub: on load, every few minutes while visible, and on refresh.
  const prsRequest = useRef(0);
  const refreshPullRequests = (fresh: boolean) => {
    const id = ++prsRequest.current;
    setPrs((s) => ({ ...s, loading: true }));
    loadPullRequests(fresh)
      .then((data) => {
        if (id === prsRequest.current) setPrs({ data, error: null, loading: false });
      })
      // Keep what's on screen; the page says it couldn't refresh.
      .catch((e) => {
        if (id === prsRequest.current) setPrs((s) => ({ ...s, error: loadErrorOf(e), loading: false }));
      });
  };
  const refreshPullRequestsRef = useRef(refreshPullRequests);
  useEffect(() => {
    refreshPullRequestsRef.current = refreshPullRequests;
  });
  useEffect(() => {
    refreshPullRequestsRef.current(false);
    const timer = setInterval(() => {
      if (!document.hidden) refreshPullRequestsRef.current(false);
    }, PULL_REQUESTS_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // ---- Derived ----

  const items = useMemo<Item[]>(
    () =>
      projects.map((project) => {
        const state = stripState(project, overview?.entries[project.name], running.has(project.name), problems[project.name]);
        return { project, state, status: projectStatus(state) };
      }),
    [projects, overview, running, problems]
  );

  const derived = useMemo(() => {
    const visible = items.filter((i) => !i.project.hidden);
    // Running includes hidden projects, so nothing hides a server you forgot.
    const servers = items.filter((i) => i.state.bay === "running").sort((a, b) => a.project.name.localeCompare(b.project.name));
    const attention = visible
      .filter((i) => i.state.reasons.some((r) => r.severity !== "note"))
      .sort((a, b) => a.status.rank - b.status.rank || Date.parse(b.project.lastCommitDate ?? "0") - Date.parse(a.project.lastCommitDate ?? "0"));
    const counts: Counts = {
      projects: visible.length,
      servers: servers.length,
      attention: attention.filter((i) => !i.state.parked).length,
      todos: visible.reduce((n, i) => n + openTodoCount(i.project), 0),
      hidden: items.length - visible.length,
      changes: visible.filter((i) => changedCount(i.project) > 0).length,
    };
    return { visible, servers, attention, counts };
  }, [items]);

  const listHidden = route.view === "hidden";
  const rows = useMemo(() => queryRows(items, listHidden, query, chips, sort), [items, listHidden, query, chips, sort]);

  // The order j / k walks: whatever list the current page shows.
  const navOrder =
    route.view === "servers"
      ? derived.servers
      : route.view === "attention"
        ? derived.attention
        : route.view === "projects" || route.view === "hidden"
          ? rows
          : queryRows(items, false, "", new Set(), sort);

  const openItem = route.project ? (items.find((i) => i.project.name === route.project) ?? null) : null;

  // ---- Navigation ----

  const navigate = (patch: Partial<Route>, { replace = false } = {}) => {
    const next: Route = { ...route, ...patch };
    if (patch.project !== undefined && patch.project !== route.project && patch.tab === undefined) next.tab = "details";
    const url = routeUrl(next);
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    setRoute(next);
  };

  const go = (view: View) => {
    setDrawerOpen(false);
    navigate({ view, project: null });
  };

  const open = (name: string, opts?: { replace?: boolean }) => {
    setFocusName(name);
    navigate({ project: name }, opts);
  };

  const back = () => {
    if (route.project) navigate({ project: null });
  };

  const toggleNav = () => {
    if (matchMedia("(min-width: 1024px)").matches) setNavCollapsed((c) => !c);
    else setDrawerOpen((o) => !o);
  };

  // ⌘K / Ctrl+K, or "/" outside a text field, opens search.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);
      if (((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === "k") || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        setPicker((p) => (p ? null : "search"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const listFocus = route.view === "projects" || route.view === "hidden";
  useShortcut(
    ["ArrowDown", "ArrowUp", "j", "k"],
    (e) => {
      if (navOrder.length === 0) return;
      const current = route.project ?? focusName;
      const i = navOrder.findIndex((it) => it.project.name === current);
      const step = e.key === "ArrowDown" || e.key.toLowerCase() === "j" ? 1 : -1;
      const next = navOrder[i === -1 ? 0 : Math.min(navOrder.length - 1, Math.max(0, i + step))];
      if (route.project) open(next.project.name, { replace: true });
      else setFocusName(next.project.name);
    },
    { allowRepeat: true, enabled: !picker && (!!route.project || listFocus) }
  );
  useShortcut(["Enter"], () => focusName && open(focusName), { enabled: !picker && !route.project && listFocus && !!focusName, skipControls: true });
  useShortcut(["Escape"], back, { enabled: !picker && !!route.project });

  // Keep the focused row in view.
  useEffect(() => {
    if (!focusName || route.project) return;
    document.querySelector(`[data-row="${CSS.escape(focusName)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusName, route.project]);

  // ---- Actions ----

  const mark = (setter: typeof setPending, name: string, value: string | null) =>
    setter((prev) => {
      const next = { ...prev };
      if (value) next[name] = value;
      else delete next[name];
      return next;
    });

  const updateProject = (updated: ProjectInfo) => setProjects((prev) => prev.map((p) => (p.name === updated.name ? updated : p)));

  const pull = async (name: string) => {
    mark(setPending, name, "pull");
    mark(setErrors, name, null);
    try {
      const body = await getJSON<{ project: ProjectInfo }>("/api/git", jsonInit("POST", { projectName: name, action: "pull" }));
      updateProject(body.project);
    } catch (e) {
      mark(setErrors, name, `Pull failed: ${(e as Error).message}`);
    } finally {
      mark(setPending, name, null);
    }
  };

  const park = async (name: string, fingerprint: string | null) => {
    mark(setPending, name, "park");
    mark(setErrors, name, null);
    try {
      await getJSON("/api/park", jsonInit("PUT", { projectName: name, fingerprint }));
      setProjects((prev) => prev.map((p) => (p.name === name ? { ...p, parkedFingerprint: fingerprint ?? undefined } : p)));
    } catch (e) {
      mark(setErrors, name, `Couldn't park it: ${(e as Error).message}`);
    } finally {
      mark(setPending, name, null);
    }
  };

  const setHidden = async (names: string[], hidden: boolean) => {
    await Promise.all(
      names.map(async (name) => {
        mark(setErrors, name, null);
        try {
          await getJSON("/api/hidden", jsonInit("PUT", { projectName: name, hidden }));
          setProjects((prev) => prev.map((p) => (p.name === name ? { ...p, hidden } : p)));
        } catch (e) {
          mark(setErrors, name, (e as Error).message);
        }
      })
    );
  };

  const toggleTodo = async (name: string, todoId: string) => {
    const p = projects.find((x) => x.name === name);
    if (!p) return;
    const todos = (p.todos ?? []).map((t) => (t.id === todoId ? { ...t, done: !t.done } : t));
    updateProject({ ...p, todos });
    try {
      await getJSON("/api/notes", jsonInit("PUT", { projectName: name, notes: p.notes ?? "", todos }));
    } catch (e) {
      updateProject(p);
      mark(setErrors, name, `Couldn't save the todo: ${(e as Error).message}`);
    }
  };

  const rescan = () => {
    setLoading(true);
    getJSON<ProjectInfo[]>("/api/projects")
      .then((data) => {
        setProjects(data);
        setScannedAt(new Date().toISOString());
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    getJSON<Overview>("/api/overview?fresh=1")
      .then(setOverview)
      .catch(() => {});
    refreshPullRequests(true);
    setRunningCheck((n) => n + 1);
  };

  // A new projects folder: everything on screen came from the old one, so scan again.
  const recheckRequirements = () => {
    setCheckingRequirements(true);
    getJSON<RequirementsResult>("/api/requirements")
      .then(setRequirements)
      .catch(() => {})
      .finally(() => setCheckingRequirements(false));
  };

  const onFolderSaved = (info: ProjectsDirInfo) => {
    setDirInfo(info);
    rescan();
  };

  // Launch Docker Desktop, then poll until the daemon answers (or give up after two minutes).
  const startDocker = async () => {
    if (dockerStarting) return;
    setDockerStarting(true);
    try {
      await getJSON("/api/docker", jsonInit("POST", { action: "start-daemon" }));
      const until = Date.now() + DOCKER_WAIT_MS;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await getJSON<RunningPoll>("/api/dev/running").catch(() => null);
        if (poll?.docker.state === "running") break;
      }
    } catch (e) {
      setDocker((d) => (d ? { ...d, message: (e as Error).message } : d));
    } finally {
      setDockerStarting(false);
      setRunningCheck((n) => n + 1);
    }
  };

  const actions: Actions = {
    open: (name) => open(name),
    openTab: (name, tab) => {
      setFocusName(name);
      navigate({ project: name, tab });
    },
    go,
    pull,
    park,
    setHidden,
    toggleTodo,
    rescan,
    activity: () => setRunningCheck((n) => n + 1),
    startDocker,
  };

  const folderLabel = dirInfo?.display ?? "your projects folder";
  const ctx: Ctx = { items, overview, ports, pending, errors, scannedAt, scanning: loading, projectsDir: folderLabel, docker, dockerStarting, actions };
  // Wait for the requirements too, so a missing one never flashes the dashboard first.
  const initialLoad = (loading && projects.length === 0) || !requirements || setupCompletedAt === undefined;
  // Until the first scan finishes, counts would read 0: show them as unknown instead.
  const firstScan = loading && !scannedAt;

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "updated" || key === "changes" ? "desc" : "asc" }));
  const onChip = (id: ChipId) =>
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Setup takes the whole window: on first run, when something required has gone
  // missing since, or when opened from Settings → Setup.
  // Tool checks that aren't passing; the Setup nav item only shows when there are some.
  const setupIssues = requirements?.requirements.filter((r) => !r.ok).length ?? 0;
  const reviewCount = prs.data ? listCount(prs.data.review) : undefined;
  const setupDue =
    requirements !== null &&
    setupCompletedAt !== undefined &&
    (setupCompletedAt === null || (!requirements.ok && !requirementsSkipped) || route.view === "setup");
  if (setupDue && requirements) {
    const leaveSetup = () => {
      setRequirementsSkipped(true);
      if (route.view === "setup") go("dashboard");
    };
    return (
      <div className="h-dvh overflow-y-auto bg-bg text-fg">
        <Setup
          requirements={requirements}
          checking={checkingRequirements}
          onRecheck={recheckRequirements}
          dirInfo={dirInfo}
          onFolderSaved={onFolderSaved}
          projectCount={projects.length}
          scanning={loading}
          alreadySetUp={!!setupCompletedAt}
          onFinish={async () => {
            const body = await getJSON<{ completedAt: string | null }>("/api/setup", jsonInit("PUT", { completed: true }));
            setSetupCompletedAt(body.completedAt);
            leaveSetup();
          }}
          onClose={leaveSetup}
        />
      </div>
    );
  }

  let content;
  if (initialLoad) {
    content = (
      <div className="flex h-full items-center justify-center gap-3 text-[14px] text-fg-2">
        <LoaderCircle aria-hidden size={20} className="animate-spin text-brand" />
        Scanning {folderLabel}…
      </div>
    );
  } else if (error && projects.length === 0) {
    // Usually first run: the default ~/Projects doesn't exist. Offer to pick the folder right here.
    content = (
      <PageBody className="max-w-3xl!">
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-bad-line bg-bad-soft px-5 py-3.5">
          <p className="min-w-0 flex-1 text-[14px] text-bad">
            {dirInfo && !dirInfo.exists ? (
              <>
                <span className="font-mono">{dirInfo.display}</span> doesn&apos;t exist. Choose the folder that holds your projects, or let
                workbench find it.
              </>
            ) : (
              <>
                Couldn&apos;t scan {folderLabel}: {error}
              </>
            )}
          </p>
          <Button icon={RefreshCw} onClick={rescan}>
            Try again
          </Button>
        </div>
        <ProjectsFolder info={dirInfo} onSaved={onFolderSaved} />
      </PageBody>
    );
  } else if (route.view === "folder" && !route.project) {
    content = (
      <>
        <TitleBar title="Projects folder" />
        <PageBody className="max-w-3xl!">
          <ProjectsFolder info={dirInfo} onSaved={onFolderSaved} />
        </PageBody>
      </>
    );
  } else if (openItem) {
    const name = openItem.project.name;
    content = (
      <ProjectDetail
        key={name}
        project={openItem.project}
        state={openItem.state}
        entry={overview?.entries[name]}
        overviewLoaded={!!overview}
        tab={route.tab}
        onTab={(tab) => navigate({ tab }, { replace: true })}
        onBack={back}
        backLabel={VIEW_TITLE[route.view]}
        onUpdate={updateProject}
        onHiddenChange={(hidden) => setHidden([name], hidden)}
        onPark={(fingerprint) => park(name, fingerprint)}
        onPull={() => pull(name)}
        pullPending={pending[name] === "pull"}
        stripError={errors[name]}
        onActivity={actions.activity}
        dockerStarting={dockerStarting}
        onStartDocker={startDocker}
      />
    );
  } else {
    switch (route.view) {
      case "dashboard":
        content = <DashboardView ctx={ctx} counts={derived.counts} visible={derived.visible} attention={derived.attention} servers={derived.servers} />;
        break;
      case "projects":
      case "hidden":
        content = (
          <ProjectsView
            key={route.view}
            ctx={ctx}
            hidden={listHidden}
            rows={rows}
            query={query}
            onQuery={setQuery}
            chips={chips}
            onChip={onChip}
            sort={sort}
            onSort={onSort}
            focusName={focusName}
          />
        );
        break;
      case "servers":
        content = <ServersView ctx={ctx} items={derived.servers} />;
        break;
      case "ports":
        content = <PortsView ctx={ctx} />;
        break;
      case "attention":
        content = <AttentionView ctx={ctx} items={derived.attention} />;
        break;
      case "pulls":
        content = <PullRequestsView ctx={ctx} prs={prs} onRefresh={() => refreshPullRequests(true)} />;
        break;
      case "activity":
        content = <ActivityView ctx={ctx} items={derived.visible} />;
        break;
      case "todos":
        content = <TodosView ctx={ctx} items={derived.visible} />;
        break;
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <AppBar
        onToggleNav={toggleNav}
        onHome={() => go("dashboard")}
        currentProject={route.project}
        onPickProject={() => setPicker("select")}
        onSearch={() => setPicker("search")}
        scannedAt={scannedAt}
        scanning={loading}
        projectsDir={folderLabel}
        onRescan={rescan}
      />
      <div className="flex min-h-0 flex-1">
        <SideNav
          className="hidden lg:flex"
          view={route.view}
          counts={derived.counts}
          counting={firstScan}
          setupIssues={setupIssues}
          reviewCount={reviewCount}
          collapsed={navCollapsed}
          onGo={go}
          onToggleCollapsed={() => setNavCollapsed((c) => !c)}
        />
        {drawerOpen && (
          <div className="fixed inset-x-0 top-14 bottom-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-hidden />
            <SideNav className="relative h-full shadow-pop" view={route.view} counts={derived.counts} counting={firstScan} setupIssues={setupIssues} reviewCount={reviewCount} collapsed={false} onGo={go} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <UpdateBanner />
          {docker && (docker.state === "stopped" || docker.state === "error") && !dockerDismissed && (
            <DockerNotice docker={docker} starting={dockerStarting} onStart={startDocker} onDismiss={() => setDockerDismissed(true)} />
          )}
          <main key={route.project ?? route.view} className="min-h-0 flex-1 overflow-y-auto">
            {content}
          </main>
        </div>
      </div>
      {picker && (
        <ProjectPicker
          title={picker === "select" ? "Select a project" : "Search"}
          items={items}
          currentProject={route.project}
          onOpenProject={(name) => open(name)}
          onGo={go}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

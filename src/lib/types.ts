import type { Preferences, StoredPreferences } from "./preferences";

export interface ProjectInfo {
  name: string;
  path: string;
  isGitRepo: boolean;
  branch?: string;
  lastCommitMessage?: string;
  lastCommitDate?: string;
  lastCommitAuthor?: string;
  uncommittedChanges?: number;
  untrackedFiles?: number;
  aheadBehind?: { ahead: number; behind: number };
  /** Web page of the repo's remote (origin, else the first remote), if hosted. */
  repoUrl?: string;
  /** The repo has at least one remote, so Fetch/Pull make sense. */
  hasRemote?: boolean;
  /** When `git fetch` last ran (FETCH_HEAD's mtime); ahead/behind is only this fresh. */
  lastFetchedAt?: string | null;
  /** Conditions the owner parked (acknowledged); the strip stays in Quiet until they change. */
  parkedFingerprint?: string;
  notes?: string;
  todos?: TodoItem[];
  /** Hidden from the dashboard's main lists (see data/settings.json). */
  hidden?: boolean;
  /** Changed and untracked files from `git status` (capped; see filesTruncated). */
  files?: ChangedFile[];
  /** How many more changed files exist beyond `files`. */
  filesTruncated?: number;
}

/** One line of `git status`. `index`/`workingDir` are git's X/Y status codes. */
export interface ChangedFile {
  path: string;
  /** Original path, for renames. */
  from?: string;
  index: string;
  workingDir: string;
}

/** A check that the project is ready to run (deps, env, Node version, compose). */
export interface SetupCheck {
  id: string;
  level: "ok" | "warn" | "info";
  title: string;
  detail?: string;
  /** One-click fix offered with this check. */
  action?:
    | { kind: "install"; label: string }
    | { kind: "open"; label: string; file: string };
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

/** One service of a compose stack: its container, or "not created" if it has none yet. */
export interface DevService {
  name: string;
  /** Container name; null when the service has no container yet. */
  container: string | null;
  /** Docker container state ("running", "exited", "restarting"…) or "not created". */
  state: string;
  /** The container's health check, if it has one. */
  health: "healthy" | "unhealthy" | "starting" | null;
  /** Exit code of an exited container. */
  exitCode: number | null;
  /** The kernel killed it for using too much memory. */
  oomKilled: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Host ports published by this service. */
  ports: number[];
  image: string | null;
}

/** A compose project (stack) that belongs to a workbench project. */
export interface ComposeStack {
  /** Compose project name; also how actions address the stack. */
  name: string;
  /** Folder it runs from, relative to the project ("" for the project root). */
  dir: string;
  /** Compose files, relative to `dir`. */
  files: string[];
  services: DevService[];
  /** Start (the dev environment) brings this one up: the compose file at the project root. */
  primary: boolean;
  /** Its compose files are on disk, so Start runs `docker compose up -d`; otherwise it restarts the existing containers. */
  fromFiles: boolean;
  /** `docker compose config` failed for it. */
  error: string | null;
  /**
   * Another folder (relative to the projects folder) has containers under the same
   * compose project name; starting this one would take them over.
   */
  conflict: string | null;
}

export type DockerState = "running" | "stopped" | "missing" | "error";

export interface DockerDaemon {
  state: DockerState;
  message: string | null;
  /** The app workbench can launch to start the daemon, if one is installed. */
  app: "Docker" | "OrbStack" | null;
  /**
   * When it's stopped and there's no app to launch (Docker Engine on Linux):
   * the command that starts it, for the user to run in a terminal.
   */
  startCommand?: string;
}

/** A container that needs a look: unhealthy, crash-looping, or exited with an error. */
export interface ContainerProblem {
  stack: string;
  service: string;
  kind: "unhealthy" | "restarting" | "exited" | "oom";
  exitCode: number | null;
}

/** One container on the Containers page (/api/containers). */
export interface ContainerRow {
  /** Full container id. */
  id: string;
  name: string;
  image: string;
  /** Docker's state: running, exited, restarting, paused, created, dead. */
  state: string;
  health: DevService["health"];
  exitCode: number | null;
  oomKilled: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Host ports it publishes on localhost. */
  ports: number[];
  /** Compose service, if Compose created it. */
  service: string | null;
  /** Why it needs a look, by the same rules as Needs attention; null if it doesn't. */
  problem: ContainerProblem["kind"] | null;
}

export interface ContainerStackGroup {
  /** Compose project name; null for containers Compose didn't create. */
  name: string | null;
  /**
   * Where it runs from: for a project's stack, the folder relative to the
   * project ("" for its root), as the stack actions expect; for other
   * containers, the folder with the home folder shortened to ~ (null if unknown).
   */
  dir: string | null;
  containers: ContainerRow[];
}

export interface ContainerGroup {
  /** The workbench project; null for containers that belong to none. */
  project: string | null;
  stacks: ContainerStackGroup[];
}

export interface ContainersList {
  docker: DockerDaemon;
  /** Problems first, then groups with something running, then by name; "no project" last among equals. */
  groups: ContainerGroup[];
}

/** CPU and memory of a running container, from `docker stats --no-stream`. */
export interface ContainerUsage {
  /** Percent of one CPU (can pass 100 on several cores); null if Docker didn't say. */
  cpu: number | null;
  /** Bytes in use and the container's limit (the machine's memory when unlimited). */
  memory: number | null;
  memoryLimit: number | null;
}

export interface ContainersUsage {
  /** When it was measured. */
  at: string;
  /** By full container id; running containers only. */
  usage: Record<string, ContainerUsage>;
  error: string | null;
}

/** One line of container output (/api/docker/logs). */
export interface ContainerLogLine {
  ts: string;
  /** Container name. */
  container: string;
  service: string;
  stream: "out" | "err";
  text: string;
}

export interface ContainerLogs {
  containers: { name: string; service: string; stack: string; state: string; health: DevService["health"] }[];
  lines: ContainerLogLine[];
  docker: DockerDaemon;
}

/** A project's local dev environment, as returned by /api/dev. */
export interface DevStatus {
  /** Commands Start runs, in order. Empty when nothing runnable was found. */
  steps: string[];
  /** Why the plan differs from the obvious one, if it does. */
  note: string | null;
  /** True if the dev process or any compose container is running. */
  running: boolean;
  /** True if the process started by Start (or Install) is still alive. */
  processRunning: boolean;
  /** What that process is doing, or null if nothing we started is running. */
  task: "dev" | "install" | null;
  /** Readiness checks: dependencies, env vars, Node version, compose file. */
  checks: SetupCheck[];
  startedAt: string | null;
  /** Compose stacks in the project folder or its subfolders, however they were started. */
  stacks: ComposeStack[];
  /** The Docker daemon, as of this status. */
  docker: DockerDaemon;
  /** Set when Docker couldn't be queried (e.g. Docker Desktop isn't running) and the project uses it. */
  dockerError: string | null;
  /** Local URL the dev server printed, if it's running. */
  url: string | null;
  /** Last lines of output from Start/Stop. */
  log: string[];
}

// ---- Git history (/api/git) ----

export interface CommitSummary {
  hash: string;
  subject: string;
  author: string;
  date: string;
  /** False if not on the upstream branch yet; null when there's no upstream. */
  pushed: boolean | null;
}

export interface BranchSummary {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** The upstream branch was deleted on the remote. */
  gone: boolean;
  lastCommitDate: string;
}

export interface StashSummary {
  index: number;
  message: string;
  date: string;
}

export interface GitHistory {
  commits: CommitSummary[];
  branches: BranchSummary[];
  stashes: StashSummary[];
}

// ---- GitHub (/api/github) ----

/** GitHub's combined check state for a commit. */
export type CheckState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  author: string | null;
  updatedAt: string;
  branch: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** You (the gh login) are a requested reviewer. */
  reviewRequestedFromYou: boolean;
  checks: CheckState | null;
}

export interface GitHubStatus {
  /** owner/name */
  repo: string;
  /** The gh login these results are for. */
  viewer: string;
  openIssues: number;
  openPullRequests: number;
  /** Most recently updated open PRs (up to 10). */
  pullRequests: PullRequestSummary[];
  /** CI for the current branch's latest pushed commit; null if that branch isn't on GitHub. */
  ci: {
    branch: string;
    sha: string;
    url: string;
    state: CheckState | null;
    failing: { name: string; url: string | null }[];
    pending: number;
    total: number;
  } | null;
  /** Local branch name (or "HEAD" when detached). */
  branch: string;
  fetchedAt: string;
}

// ---- Pull requests (/api/pull-requests) ----

export interface PullRequestRow {
  /** owner/name */
  repo: string;
  /** https://github.com/owner/name */
  repoUrl: string;
  number: number;
  title: string;
  url: string;
  draft: boolean;
  author: string | null;
  updatedAt: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** CI on the PR's latest commit. */
  checks: CheckState | null;
}

export interface PullRequestList {
  items: PullRequestRow[];
  /** GitHub's count for the search, before PRs an earlier section shows are left out. */
  total: number;
  /** GitHub has more than one page of these. */
  truncated: boolean;
}

export interface PullRequests {
  /** The gh login these are for. */
  viewer: string;
  /** Review requested from you or a team you're in. */
  review: PullRequestList;
  /** Opened by you (minus any already under review). */
  authored: PullRequestList;
  /** Assigned to you (minus any listed above). */
  assigned: PullRequestList;
  /** Part of the result couldn't be read (e.g. an org that needs SSO); the rest is here. */
  warning: string | null;
  fetchedAt: string;
}

export type PullRequestsErrorReason = "missing" | "signed-out" | "rate-limited" | "failed";

// ---- Scripts (/api/scripts) ----

export interface ScriptStatus {
  pm: string;
  scripts: { name: string; command: string }[];
  /** The script Start runs; not runnable here so there aren't two copies. */
  devScript: string | null;
  /** The last script run from here. */
  current: string | null;
  running: boolean;
  /** Exit code of the last run, once it has finished; null if it was stopped. */
  exitCode: number | null;
  log: string[];
}

// ---- Board overview (/api/overview) ----

export interface OverviewEntry {
  /** Setup checks at warning level (dependencies, env vars, Node, compose). */
  warnings: { id: string; title: string }[];
  /** GitHub state for repos on github.com; null otherwise. */
  github: {
    /** Combined checks on the current branch's latest pushed commit. */
    ci: CheckState | null;
    ciUrl: string | null;
    openPullRequests: number;
    /** Open PRs where you are a requested reviewer. */
    reviewRequested: number;
  } | null;
}

export interface Overview {
  generatedAt: string;
  entries: Record<string, OverviewEntry>;
  /** Set when GitHub couldn't be queried; entries then have github: null. */
  githubError: string | null;
}

export interface SettingsData {
  hiddenProjects: string[];
  /** Project name → fingerprint of the conditions that were parked. */
  parked: Record<string, string>;
  /** Absolute path of the folder scanned for projects; unset means the env var or ~/Projects. */
  projectsDir?: string;
  /** When first-run setup was finished; unset means it hasn't been. */
  setupCompletedAt?: string;
  /** Editor, terminal and rescan interval, as ids from preferences.ts; unset ones use the defaults. */
  preferences?: StoredPreferences;
}

/** An editor or terminal as Preferences offers it. */
export interface AppOption {
  id: string;
  label: string;
  installed: boolean;
  /** A note under the name, e.g. which terminal Automatic opens. */
  detail?: string;
}

export interface AppChoices {
  /** Installed ones, plus the current choice even if it isn't (shown as not found). */
  offered: AppOption[];
  /** The rest of what workbench supports on this system, by name: none of them is installed. */
  missing: string[];
}

/** GET/PUT /api/preferences. */
export interface PreferencesInfo {
  platform: "mac" | "linux" | "windows" | "other";
  /** In effect: what's saved where it applies here, defaults for the rest. */
  preferences: Preferences;
  editors: AppChoices;
  terminals: AppChoices;
}

/** Something workbench needs installed on this machine (GET /api/requirements). */
export interface Requirement {
  id: "node" | "docker" | "git" | "gh" | "vscode";
  name: string;
  /** Nice to have: missing it never blocks setup. */
  optional?: boolean;
  /** What counts as installed, e.g. "22.12 or later". */
  need: string;
  ok: boolean;
  /** Installed version, if any. */
  found: string | null;
  detail: string;
  /** A command or step that fixes it, shown under the detail. */
  hint?: string;
  /** Where to get it. */
  help: { label: string; url: string }[];
}

export interface RequirementsResult {
  /** Every required (non-optional) one is installed. */
  ok: boolean;
  requirements: Requirement[];
}

/** GET/PUT /api/projects-dir */
export interface ProjectsDirInfo {
  dir: string;
  /** `dir` with the home folder shortened to ~. */
  display: string;
  source: "settings" | "env" | "default";
  exists: boolean;
  defaultDisplay: string;
}

/** A folder holding git repos, found by GET /api/projects-dir/discover. */
export interface DiscoveredRoot {
  dir: string;
  display: string;
  /** Direct subfolders that are git repos, by name. */
  repos: string[];
  /** Of those, the ones with a GitHub remote, as owner/repo. */
  github: string[];
}

export interface DiscoveryResult {
  roots: DiscoveredRoot[];
  scannedDirs: number;
  /** The scan stopped at its folder or time limit, so some repos may be missing. */
  truncated: boolean;
  elapsedMs: number;
}

export interface NotesData {
  [projectName: string]: {
    notes: string;
    todos: TodoItem[];
  };
}

/** What holds a listening port. */
export type PortOwner =
  /** A process workbench started for a project (its dev environment, an install, or a script), or one of its children. */
  | { kind: "run"; project: string; slot: "dev" | "script"; task: "dev" | "install" | "script"; script: string | null }
  /** A Docker container publishing the port; `stackDir` is its compose folder relative to the project's. */
  | { kind: "container"; project: string | null; container: string; image: string; stack: string | null; service: string | null; stackDir: string | null }
  /** Any other process; `project` when its working folder is in one (e.g. a dev server started in a terminal). */
  | { kind: "process"; project: string | null }
  /** workbench's own server. */
  | { kind: "self" };

export interface ListeningPort {
  port: number;
  /** Addresses it's bound to, as reported ("127.0.0.1", "::1", "*", "0.0.0.0", "::"). */
  addresses: string[];
  /** "loopback": this machine only; "network": all interfaces or a non-loopback address; null if unknown. */
  scope: "loopback" | "network" | null;
  pid: number | null;
  /** The process name, when it could be seen. */
  process: string | null;
  /** When the process (or container) started, when known. */
  startedAt: string | null;
  owner: PortOwner;
  /** http://localhost:<port> when it's likely a web server reachable on localhost. */
  url: string | null;
}

export interface PortsResult {
  ports: ListeningPort[];
  /** The tool that listed them; null if none could run. */
  source: "lsof" | "ss" | "netstat" | null;
  /** Why the list may be empty or incomplete. */
  error: string | null;
  /** A caveat about what couldn't be seen (other users' processes without admin rights). */
  note: string | null;
  scannedAt: string;
}

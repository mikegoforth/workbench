import type { StripState } from "@/lib/attention";
import type { Status } from "@/lib/status";
import type { DockerDaemon, Overview, ProjectInfo } from "@/lib/types";

/** Pages in the left nav. */
export type View = "dashboard" | "projects" | "servers" | "containers" | "ports" | "attention" | "pulls" | "activity" | "todos" | "hidden" | "folder" | "setup";

/** Tabs on a project's page. */
export type DetailTab = "details" | "changes" | "dev" | "logs" | "history" | "github" | "readme";

export const VIEWS: View[] = ["dashboard", "projects", "servers", "containers", "ports", "attention", "pulls", "activity", "todos", "hidden", "folder", "setup"];
export const DETAIL_TABS: DetailTab[] = ["details", "changes", "dev", "logs", "history", "github", "readme"];

export const VIEW_TITLE: Record<View, string> = {
  dashboard: "Dashboard",
  projects: "Projects",
  servers: "Running",
  containers: "Containers",
  ports: "Ports",
  attention: "Needs attention",
  pulls: "Pull requests",
  activity: "Activity",
  todos: "Todos",
  hidden: "Hidden projects",
  folder: "Projects folder",
  setup: "Setup",
};

export interface Item {
  project: ProjectInfo;
  state: StripState;
  status: Status;
}

/** Everything a page can do; Dashboard owns the state behind it. */
export interface Actions {
  open: (name: string) => void;
  /** Open a project at one of its tabs. */
  openTab: (name: string, tab: DetailTab) => void;
  go: (view: View) => void;
  pull: (name: string) => void;
  park: (name: string, fingerprint: string | null) => void;
  setHidden: (names: string[], hidden: boolean) => void;
  toggleTodo: (name: string, todoId: string) => void;
  rescan: () => void;
  /** Something started or stopped; re-check what's running. */
  activity: () => void;
  /** Launch Docker Desktop and wait for the daemon. */
  startDocker: () => void;
}

/** Data every page reads. */
export interface Ctx {
  items: Item[];
  overview: Overview | null;
  /** Host ports published by running containers, per repo. */
  ports: Record<string, number[]>;
  /** "pull" | "park" while that action is in flight, per repo. */
  pending: Record<string, string>;
  errors: Record<string, string>;
  scannedAt: string | null;
  scanning: boolean;
  /** The folder being scanned, for display (e.g. ~/Projects). */
  projectsDir: string;
  /** The Docker daemon, from the running poll (null until the first poll). */
  docker: DockerDaemon | null;
  dockerStarting: boolean;
  actions: Actions;
}

export type Counts = Record<"projects" | "servers" | "attention" | "todos" | "hidden" | "changes", number>;

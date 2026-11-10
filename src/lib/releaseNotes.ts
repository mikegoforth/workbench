/**
 * What changed in each release, as shown in What's new (sidebar footer).
 * Written for the person using the app: features and fixes they'll notice,
 * not internal work like tests or refactors. Newest first.
 *
 * Add notes in the PR that makes the change, under the next version (no date
 * yet). The app only shows versions up to the one it's running, so upcoming
 * notes stay hidden until the release PR bumps the version and sets the date.
 * A test checks the current version has dated notes.
 */

export type ChangeKind = "new" | "changed" | "fixed" | "security";

export interface Release {
  version: string;
  /** Release day, YYYY-MM-DD. Unset until the version is released. */
  date?: string;
  summary?: string;
  changes: { kind: ChangeKind; text: string }[];
}

export const RELEASES: Release[] = [
  {
    version: "0.1.4",
    changes: [
      {
        kind: "new",
        text: "Color themes: Light, Paper, Dark, Dimmed and two high-contrast themes, or follow your system. Pick one from the palette button in the top bar; use the arrow keys to preview each before you choose.",
      },
      {
        kind: "new",
        text: "Three special themes with character: Matrix (phosphor green in terminal type, with digital rain behind the page), Cyberpunk (neon cyan and hot pink, with hard edges) and Crypto (gold on midnight, with ticker green and red).",
      },
      {
        kind: "changed",
        text: "A roomier, calmer layout: more space around cards and rows, softer corners, and a lighter top bar and sidebar.",
      },
    ],
  },
  {
    version: "0.1.3",
    date: "2026-11-09",
    changes: [
      {
        kind: "security",
        text: "Hardened how workbench names the files that track your running dev servers and scripts, so they always stay inside its own data folder.",
      },
    ],
  },
  {
    version: "0.1.2",
    date: "2026-11-09",
    changes: [
      {
        kind: "new",
        text: "workbench runs on Windows and Linux. On Windows, run the installer; on Linux, make the AppImage executable and open it. Both install their own updates.",
      },
      {
        kind: "new",
        text: "See which version you're running, and what changed in each release, from What's new at the bottom of the sidebar.",
      },
      {
        kind: "security",
        text: "Projects opened in VS Code no longer inherit workbench's private settings, including the key that protects its connection to its own window.",
      },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-11-09",
    changes: [
      {
        kind: "security",
        text: "The README tab won't open a file outside the project. A cloned repo could make its README a link to a private file on your computer, such as an SSH key.",
      },
      {
        kind: "fixed",
        text: "Container logs show every line again, including output from containers that run with a terminal and progress bars that redraw in place.",
      },
      {
        kind: "changed",
        text: "Setup now asks for Node.js 22.12 or later, because Node 20 no longer receives security fixes.",
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-09",
    summary: "The first release.",
    changes: [
      {
        kind: "new",
        text: "A dashboard of what needs attention across every project: failing CI, pull requests waiting on you, uncommitted or unpushed work, branches behind, and crashed containers.",
      },
      { kind: "new", text: "Start and stop a project's containers and dev server in one click, run its scripts, and read the output." },
      { kind: "new", text: "Notes and todos for each project, next to its changed files and branch state, so you can pick up where you left off." },
      { kind: "new", text: "Open any project in VS Code, Terminal or GitHub." },
      { kind: "new", text: "Setup checks for Node.js, Docker, Git, the GitHub CLI and VS Code, and links to anything missing." },
      { kind: "new", text: "A banner tells you when a new version is out." },
    ],
  },
];

/** The running version, from package.json at build time (see next.config.ts). */
export const APP_VERSION: string = process.env.WORKBENCH_VERSION ?? "0.0.0";

/** Negative, zero or positive as a is older than, the same as, or newer than b ("0.1.10" > "0.1.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** The releases up to `version` (upcoming notes stay hidden), newest first. */
export function releasesUpTo(version: string): Release[] {
  return RELEASES.filter((r) => compareVersions(r.version, version) <= 0);
}

/** "Nov 9, 2026". Dates are calendar days, so they're read as UTC to avoid shifting a day. */
export function formatReleaseDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

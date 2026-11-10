# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: a developer using it on their own computer (macOS, Windows or Linux), as a desktop app or at http://localhost:3000. No accounts, no team, no hosting. They work across dozens of folders in one projects folder: work and personal repos, most of them Node/Next.js, some Go, Expo or compose-only.

## Product Purpose

A single local control room for every project on the machine. It answers two questions equally often:

1. **Triage:** across all repos, what needs attention? Failing CI, PRs awaiting review, uncommitted or unpushed work, repos behind their remote, setup problems, things left running.
2. **Resume:** for one project, where did I leave off, and how do I get it running? Notes and todos, changed files, branch state, setup checks, Start/Stop, then jump into VS Code or a terminal.

Success is opening workbench and knowing within seconds what to do next, without visiting GitHub, a terminal, or each repo by hand.

## Positioning

It reads the actual machine: the real git state of every folder, the processes and compose containers actually running, the project's own package.json scripts and env files, and GitHub through the owner's own `gh` login. It acts on them directly (start/stop dev environments, run scripts, fetch/pull, open editor or terminal). A hosted dashboard or GitHub itself can't see local, uncommitted, or running state.

## Operating Context

- Runs on the same machine it inspects (macOS, Windows or Linux): as a desktop app (Electron around the Next.js server), or as a Next.js dev server (`npm run dev`) reached at localhost in a browser.
- Used alongside VS Code, a terminal (Terminal.app on macOS), Docker and GitHub; workbench hands off to them rather than replacing them.
- Sessions alternate between a quick scan of all projects and long focused work in one, often leaving dev servers or containers running between visits.

## Capabilities and Constraints

- Scans every direct subfolder of the projects folder (chosen in setup; `~/Projects` by default), excluding workbench's own checkout: git branch, changed/untracked files, ahead/behind, last commit, remote web URL, last fetch time.
- Pages: Dashboard, Projects (table with filter chips: uncommitted, behind, unpushed, failing, todos), Dev servers, Needs attention, Activity, Todos, Hidden projects; search with ⌘K or /. Projects can be hidden or parked; Dev servers always shows running projects even if hidden.
- Per project: notes and todos (stored in gitignored `data/`), setup checks (dependencies, env vars vs `.env.example` by name only, `.nvmrc` vs Node on PATH, compose file validity), dev environment Start/Stop (compose then dev script), dependency install, package.json script runner with live output, changed files (open in VS Code), fetch / fast-forward-only pull, history (commits, branches, stashes), GitHub status (CI, PRs, issues), README preview, open in VS Code / Terminal / GitHub.
- Docker: compose stacks found in the project folder, its subfolders, and from container labels (so stacks started outside workbench count); per-stack Start/Stop/Restart; container health, crash loops and error exits raised in Needs attention; merged container logs; Docker Desktop status with a Start button.
- Keyboard: ⌘K (Ctrl K on Windows and Linux) or / to search; ↑/↓ or j/k to move through projects, Enter to open, Esc to go back; O, G, T, S for VS Code, GitHub, Terminal, Start.
- Command-running API routes accept only loopback hosts and JSON requests; the dev server itself listens on all interfaces.
- Must offer color themes (owner's request): Light, Paper, Dark, Dimmed, high-contrast light and dark, the special Matrix, Cyberpunk and Crypto, or follow the system, chosen from a VS Code-style picker with live preview.
- macOS, Windows and Linux; Open in Terminal uses Terminal.app on macOS, Windows Terminal (or Command Prompt) on Windows, and the first terminal found on Linux. GitHub data requires `gh auth login`.

## Brand Commitments

- The product name is **workbench** (lowercase).
- The UI is organized like a cloud console (Google Cloud Console style): top bar with project picker and search, left navigation, title bars with inline actions, resource tables, tabbed resource pages. No Google branding.

## Evidence on Hand

- Real data only: the owner's actual repos, git state, CI and PR results. No users, testimonials, metrics or marketing claims exist or should be invented.

## Product Principles

1. **Attention first.** Surface what needs action (failing, behind, unpushed, running, misconfigured) before what's merely informational.
2. **Truth over decoration.** Every number and badge reflects live machine or GitHub state, and says how fresh it is when it might be stale.
3. **One step to act.** Anything the dashboard reports should be fixable or openable from right where it's shown.
4. **Hand off, don't replace.** Get the owner into VS Code, Terminal or GitHub fast; don't rebuild those tools inside workbench.
5. **Safe by default.** Actions that change repos or run code are explicit, reversible where possible, and never triggered by browsing alone (auto-fetch is the one deliberate exception).

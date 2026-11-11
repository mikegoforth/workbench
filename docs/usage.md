# Using Workbench

## Pages

- **Dashboard**: what needs attention, what's running, CI across your GitHub repos, recent activity, open todos.
- **Projects**: one table of every project, with status, branch, ahead/behind, uncommitted changes, CI and issues. You can filter, sort and hide projects.
- **Running**: everything running for any project, including compose stacks started outside Workbench. Stop or restart from here.
- **Containers**: every Docker container on this computer, grouped by project and compose stack, with health, published ports, uptime, and CPU and memory (sampled every 20 seconds). Problems (unhealthy, restarting, recently exited with an error) come first. Start, Stop or Restart a project's stacks, or open its Logs tab. Containers that belong to no project are listed under Other containers; you can Stop or Remove those one at a time after confirming (Remove keeps volumes), or copy a `docker logs` command for them.
- **Ports**: every TCP port listening on this computer and what holds it: a project's dev server or script, a Docker container (with its project and stack), or another process (name and pid), with how long it's been up. Ports open beyond localhost are flagged. Filter by port, project or process, or by owner type. Likely web ports have an Open link; Stop is offered only for what Workbench runs (a project's dev environment or script, or a compose stack in a project), never for other processes. On macOS and Linux, other users' processes (system services) need admin rights to see.
- **Needs attention**: failing CI, merge conflicts, review requests, branches behind or ahead, and failing containers (unhealthy, crash-looping, or exited with an error). Park a project to acknowledge its issues until they change.
- **Pull requests**: every open pull request across GitHub that's waiting on your review (asked of you or a team you're on), opened by you, or assigned to you, with draft, checks, review decision and when it was last updated. Each links to GitHub, and to the project's page when you have the repo locally. The sidebar count is how many wait on your review. Needs `gh auth login`.
- **Activity** and **Todos**: the latest commit in each project, and todos from every project.
- **A project's page**:
  - Details: notes and todos, git and CI state, what needs attention, and changed files.
  - Dev environment: Start/Stop, setup checks, every compose stack with per-stack Start/Stop/Restart, and package.json scripts.
  - Logs: merged output from the project's containers.
  - History, GitHub and README tabs.
- **Settings**: preferences, projects folder, hidden projects, and setup (rerun it any time).

## Keyboard

| Keys | Action |
| --- | --- |
| `⌘K` (`Ctrl K` on Windows and Linux) or `/` | Search |
| `J` / `K` or arrows | Move through projects |
| `Enter` | Open the selected project |
| `Esc` | Go back |
| `O` / `T` / `S` / `G` | On a project page: open in your editor / terminal (VS Code and Terminal unless changed in Preferences), Start, open on GitHub |

## Preferences

**Settings → Preferences** sets:

- **Editor**: where Open in …, the `O` key and changed files open a project. VS Code by default; or Cursor, Zed, Windsurf, Sublime Text, IntelliJ IDEA or WebStorm. Only editors found on this computer are listed (press **Check again** after installing one).
- **Terminal**: what the `T` key and Open in Terminal open, in the project's folder. macOS: Terminal (default), iTerm2, Warp or Ghostty. Linux: Automatic (default: `$TERMINAL`, else the first terminal found), or one you pick, such as GNOME Terminal, Konsole or kitty. Windows: Windows Terminal (default; a Command Prompt if it isn't installed) or Command Prompt.
- **Appearance**: the color theme (see below).
- **Rescan projects**: scan the projects folder again every 30 seconds, minute or 5 minutes while Workbench is open, or only when you press Rescan (the default).

The editor, terminal and rescan interval are saved in `settings.json` as names from a fixed list, never as paths or commands. If the chosen editor or terminal is uninstalled, opening says so rather than using another.

## Color themes

The palette button at the right of the top bar (or **Change theme** in Preferences) opens the theme picker: **Light**, **Paper** (warm, low-glare), **Dark**, **Dimmed** (soft slate), **High contrast light** and **High contrast dark**, the special themes **Matrix**, **Cyberpunk** and **Crypto**, or **Follow system** (Light or Dark, as the system is set). Arrow keys preview each theme across the whole app; `Enter` or a click keeps it and `Esc` puts the previous one back. The choice is remembered on this computer.

## What the actions do

- **Start** runs `docker compose up -d` if the project root has a compose file, then its `dev` (or `start`) script. Processes run detached, so they keep running when Workbench restarts or updates.
- **Stop** stops that process and every running container of the project's compose stacks, however they were started.
- **Pull** is `git pull --ff-only`, so it never merges. Fetch runs on its own when a project's last fetch is over 15 minutes old.
- A stack whose compose project name is already used by another folder won't start, because Compose would take over the other folder's containers.

## The projects folder

Every folder directly inside it is a project. When you run Workbench from source, its own checkout is left out. The folder is, in order of precedence:

1. The one chosen in setup or under **Settings → Projects folder**.
2. `WORKBENCH_PROJECTS_DIR`, if set (e.g. `WORKBENCH_PROJECTS_DIR=~/code npm run dev`).
3. `~/Projects`.

If the folder doesn't exist, setup scans your home folder for git repos and suggests the folders that hold them, most GitHub repos first. The scan skips `~/Library`, `~/Desktop`, `~/Downloads`, media folders, hidden folders and `node_modules`. It goes four levels deep, and stops after 25,000 folders or 8 seconds.

## Where data is stored

Everything Workbench saves is in its data folder, shared by `npm run dev` and the desktop app: `~/Library/Application Support/workbench/data/` on macOS, `~/.config/workbench/data/` on Linux (or under `$XDG_CONFIG_HOME`), and `%APPDATA%\workbench\data\` on Windows. Set `WORKBENCH_DATA_DIR` to use another folder.

- `settings.json`: projects folder, hidden and parked projects, when setup was finished, and your editor, terminal and rescan preferences
- `notes.json`: notes and todos
- `dev/`: dev environment and script logs, plus the process ID of each running process

The desktop app's own log is `~/Library/Logs/workbench/main.log` on macOS `~/.config/workbench/logs/main.log` on Linux, and `%APPDATA%\workbench\logs\main.log` on Windows.

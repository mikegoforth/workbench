# Using workbench

## Pages

- **Dashboard**: what needs attention, what's running, CI across your GitHub repos, recent activity, open todos.
- **Projects**: one table of every project, with status, branch, ahead/behind, uncommitted changes, CI and issues. You can filter, sort and hide projects.
- **Running**: everything running for any project, including compose stacks started outside workbench. Stop or restart from here.
- **Needs attention**: failing CI, merge conflicts, review requests, branches behind or ahead, and failing containers (unhealthy, crash-looping, or exited with an error). Park a project to acknowledge its issues until they change.
- **Activity** and **Todos**: the latest commit in each project, and todos from every project.
- **A project's page**:
  - Details: notes and todos, git and CI state, what needs attention, and changed files.
  - Dev environment: Start/Stop, setup checks, every compose stack with per-stack Start/Stop/Restart, and package.json scripts.
  - Logs: merged output from the project's containers.
  - History, GitHub and README tabs.
- **Settings**: projects folder, hidden projects, and setup (rerun it any time).

## Keyboard

| Keys | Action |
| --- | --- |
| `⌘K` (`Ctrl K` on Windows and Linux) or `/` | Search |
| `J` / `K` or arrows | Move through projects |
| `Enter` | Open the selected project |
| `Esc` | Go back |
| `O` / `T` / `S` / `G` | On a project page: open in VS Code / Terminal, Start, open on GitHub |

## Color themes

The palette button at the right of the top bar opens the theme picker: **Light**, **Paper** (warm, low-glare), **Dark**, **Dimmed** (soft slate), **High contrast light** and **High contrast dark**, the special themes **Matrix**, **Cyberpunk** and **Crypto**, or **Follow system** (Light or Dark, as the system is set). Arrow keys preview each theme across the whole app; `Enter` or a click keeps it and `Esc` puts the previous one back. The choice is remembered on this computer.

## What the actions do

- **Start** runs `docker compose up -d` if the project root has a compose file, then its `dev` (or `start`) script. Processes run detached, so they keep running when workbench restarts or updates.
- **Stop** stops that process and every running container of the project's compose stacks, however they were started.
- **Pull** is `git pull --ff-only`, so it never merges. Fetch runs on its own when a project's last fetch is over 15 minutes old.
- A stack whose compose project name is already used by another folder won't start, because Compose would take over the other folder's containers.

## The projects folder

Every folder directly inside it is a project. When you run workbench from source, its own checkout is left out. The folder is, in order of precedence:

1. The one chosen in setup or under **Settings → Projects folder**.
2. `WORKBENCH_PROJECTS_DIR`, if set (e.g. `WORKBENCH_PROJECTS_DIR=~/code npm run dev`).
3. `~/Projects`.

If the folder doesn't exist, setup scans your home folder for git repos and suggests the folders that hold them, most GitHub repos first. The scan skips `~/Library`, `~/Desktop`, `~/Downloads`, media folders, hidden folders and `node_modules`. It goes four levels deep, and stops after 25,000 folders or 8 seconds.

## Where data is stored

Everything workbench saves is in its data folder, shared by `npm run dev` and the desktop app: `~/Library/Application Support/workbench/data/` on macOS, `~/.config/workbench/data/` on Linux (or under `$XDG_CONFIG_HOME`), and `%APPDATA%\workbench\data\` on Windows. Set `WORKBENCH_DATA_DIR` to use another folder.

- `settings.json`: projects folder, hidden and parked projects, and when setup was finished
- `notes.json`: notes and todos
- `dev/`: dev environment and script logs, plus the process ID of each running process

The desktop app's own log is `~/Library/Logs/workbench/main.log` on macOS `~/.config/workbench/logs/main.log` on Linux, and `%APPDATA%\workbench\logs\main.log` on Windows.

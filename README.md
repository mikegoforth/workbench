<div align="center">

<img src="docs/assets/logo.svg" width="64" height="64" alt="">

# workbench

**A control panel for every coding project on your Mac or Linux machine.**

See what needs attention across all your repos, start and stop dev environments,<br>
and pick up where you left off, without opening GitHub, a terminal, or each repo by hand.

[![Latest release](https://img.shields.io/github/v/release/mikegoforth/workbench?label=release)](https://github.com/mikegoforth/workbench/releases/latest)
[![CI](https://github.com/mikegoforth/workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/mikegoforth/workbench/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmikegoforth%2Fworkbench%2Fbadges%2Fcoverage.json)](docs/development.md#commands)
[![Platforms: macOS 13+ and Linux](https://img.shields.io/badge/platforms-macOS%2013%2B%20%7C%20Linux-24292f)](#requirements)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[**Download**](https://github.com/mikegoforth/workbench/releases/latest) · [Features](#features) · [Install](#install) · [Requirements](#requirements) · [Docs](docs/usage.md)

</div>

<!--
  OpenSSF Scorecard badge, once the ossf/scorecard-action workflow runs with
  publish_results: true:
  [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/mikegoforth/workbench/badge)](https://scorecard.dev/viewer/?uri=github.com/mikegoforth/workbench)
-->

## Features

workbench reads the real state of every project on your machine: git status, running dev servers and containers, GitHub CI and pull requests, notes and todos. You act on it from the same place.

- **See what needs attention.** Failing CI, pull requests waiting on you, uncommitted or unpushed work, branches behind their remote, and crashed containers, across every repo at once.
- **Start and stop projects.** One click brings up a project's compose stack and dev script, and stops them again. Run any `package.json` script and watch its output.
- **Pick up where you left off.** Notes, todos, changed files and branch state for each project, all on one page.
- **Hand off fast.** Open a project in VS Code, Terminal or GitHub, or pull its latest changes, without leaving the dashboard.
- **Stay current.** See the version you're on and what changed in each release, and get told when a new one is out.

> [!NOTE]
> **Private by design.** workbench runs entirely on your computer. No accounts, no telemetry, nothing hosted. It reaches the network only through your own tools (`git` for your remotes, the `gh` CLI for GitHub) and to check GitHub for new releases.

## Install

### macOS

1. Download the `.dmg` for your Mac from the [latest release](https://github.com/mikegoforth/workbench/releases/latest):

   | Your Mac | File |
   | --- | --- |
   | Apple silicon (M1 and later) | `workbench-<version>-arm64.dmg` |
   | Intel | `workbench-<version>-x64.dmg` |

2. Open it and drag **workbench** to **Applications**.
3. Open workbench. Setup checks your tools and asks for your projects folder; every folder directly inside it becomes a project.

> [!IMPORTANT]
> The app isn't notarized by Apple yet, so macOS blocks it the first time you open it. Go to **System Settings → Privacy & Security** and click **Open Anyway**. You only need to do this once.

When a new version comes out, workbench shows a banner with a link to download it.

### Linux

Available from version 0.1.2.

1. Download the AppImage for your computer from the [latest release](https://github.com/mikegoforth/workbench/releases/latest):

   | Your computer | File |
   | --- | --- |
   | Intel or AMD (64-bit) | `workbench-<version>-x86_64.AppImage` |
   | ARM (64-bit) | `workbench-<version>-arm64.AppImage` |

2. Make it executable and open it:

   ```bash
   chmod +x workbench-*.AppImage
   ./workbench-*.AppImage
   ```

3. Setup checks your tools and asks for your projects folder.

The AppImage installs its own updates: when one is ready, workbench offers to restart. Keep it somewhere permanent, such as `~/Applications`.

> [!TIP]
> AppImages mount themselves with FUSE, which most desktop distributions include. Without it, run with `APPIMAGE_EXTRACT_AND_RUN=1` set.

<details>
<summary><b>Verify your download</b></summary>

<br>

Every release file comes with a signed record that it was built from this repo by its release workflow. Check it with the [GitHub CLI](https://cli.github.com):

```bash
gh attestation verify workbench-<version>-arm64.dmg --repo mikegoforth/workbench
```

Each release also lists every file's SHA-256 in `SHA256SUMS`.

</details>

## Requirements

A Mac running **macOS 13 (Ventura) or later**, or a 64-bit **Linux** desktop (Intel/AMD or ARM), with:

| Tool | Used for | Needed |
| --- | --- | --- |
| [Node.js](https://nodejs.org/en/download) 22.12+ | Installing dependencies and running your projects' dev servers | Required |
| Docker: [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [OrbStack](https://orbstack.dev) on macOS; [Docker Engine](https://docs.docker.com/engine/install/) or Docker Desktop on Linux | Projects with a compose file | Required |
| [Git](https://git-scm.com/downloads) | Branches, changes and history for every project | Required |
| [GitHub CLI](https://cli.github.com), signed in | CI status, pull requests and review requests | Optional |
| [VS Code](https://code.visualstudio.com) | Opening projects and changed files | Optional |

On first launch, setup checks for each one and links to anything missing. [REQUIREMENTS.md](REQUIREMENTS.md) lists every dependency and where its security fixes are announced.

## Run from source

```bash
npm install
npm run dev            # http://localhost:3000
```

Or build the desktop app:

```bash
npm run desktop:dist   # for the system you're on: .dmg and .zip (macOS) or AppImages (Linux) in release/
```

## Documentation

| Guide | What's in it |
| --- | --- |
| [Using workbench](docs/usage.md) | Features, keyboard shortcuts, the projects folder, and where data is stored |
| [Development](docs/development.md) | Commands, tests, the desktop app, releasing and signing, and the code layout |
| [Requirements](REQUIREMENTS.md) | Dependencies and where their security fixes are announced |
| [Security](SECURITY.md) | How workbench protects your machine, and how to report a vulnerability |

## License

[MIT](LICENSE)

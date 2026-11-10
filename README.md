# workbench

[![macOS 13+](https://img.shields.io/badge/macOS-13%2B-000000?logo=apple&logoColor=white)](REQUIREMENTS.md)
[![Node.js 22.12+](https://img.shields.io/badge/Node.js-%E2%89%A522.12-5FA04E?logo=nodedotjs&logoColor=white)](REQUIREMENTS.md)
[![Electron](https://img.shields.io/badge/-Electron-47848F?logo=electron&logoColor=white)](docs/development.md#desktop-app)
[![Next.js](https://img.shields.io/badge/-Next.js-000000?logo=nextdotjs&logoColor=white)](docs/development.md)

[![Latest release](https://img.shields.io/github/v/release/mikegoforth/workbench)](https://github.com/mikegoforth/workbench/releases/latest)
[![CI](https://github.com/mikegoforth/workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/mikegoforth/workbench/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<!--
  OpenSSF Scorecard badge, once the ossf/scorecard-action workflow runs with
  publish_results: true:
  [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/mikegoforth/workbench/badge)](https://scorecard.dev/viewer/?uri=github.com/mikegoforth/workbench)
-->

A control panel for every coding project on your Mac.

workbench shows the real state of each project in one place: git status, running dev servers and containers, GitHub CI and pull requests, notes and todos. You can act on it from there: start and stop dev environments, run scripts, pull, read logs, and open a project in VS Code or Terminal.

It runs entirely on your Mac. There are no accounts and nothing is hosted.

## What it does

- **Shows what needs attention**: failing CI, pull requests waiting on you, uncommitted or unpushed work, branches behind, and crashed containers.
- **Starts and stops projects**: one click runs a project's compose stack and dev script, and stops them again.
- **Helps you pick up where you left off**: notes, todos, changed files and branch state for each project.
- **Hands off fast**: opens a project in VS Code, Terminal or GitHub.

## Requirements

A Mac (macOS 13 or later) with Node.js 22.12+, Docker Desktop or OrbStack, and Git. The GitHub CLI and VS Code are optional. On first launch, setup checks for each of these and links to anything missing.

## Install

Download the `.dmg` for your Mac from the [latest release](https://github.com/mikegoforth/workbench/releases/latest): `arm64` for Apple silicon (M1 and later), `x64` for Intel. Open it and drag workbench to Applications.

The app isn't notarized by Apple yet, so macOS blocks it the first time you open it. Go to **System Settings → Privacy & Security** and click **Open Anyway**. You only need to do this once.

When a new version comes out, workbench shows a banner with a link to download it.

To check a download was built from this repo by its release workflow, use the [GitHub CLI](https://cli.github.com):

```bash
gh attestation verify workbench-<version>-arm64.dmg --repo mikegoforth/workbench
```

Each release also lists every file's SHA-256 in `SHA256SUMS`.

## Run from source

```bash
npm install
npm run dev            # open http://localhost:3000
```

Or build the desktop app:

```bash
npm run desktop:dist   # workbench.app, .dmg and .zip in release/
```

Setup asks for your projects folder. Every folder directly inside it shows up as a project.

## Learn more

- [Using workbench](docs/usage.md): features, keyboard shortcuts, the projects folder, and where data is stored
- [Development](docs/development.md): commands, the desktop app, releasing and signing, and the code layout
- [Requirements](REQUIREMENTS.md): dependencies and where their security fixes are announced
- [Security](SECURITY.md): how workbench protects your machine, and how to report a vulnerability

# Installing Workbench

Download Workbench from the [latest release](https://github.com/mikegoforth/workbench/releases/latest), then follow the steps for your computer: [macOS](#macos), [Windows](#windows) or [Linux](#linux).

The first time you open it, setup checks for the tools below and asks for your projects folder. Every folder directly inside it becomes a project.

## What you need

A Mac with **macOS 13 (Ventura) or later**, a PC with **Windows 10 or 11**, or a 64-bit **Linux** desktop (Intel/AMD or ARM). Plus:

| Tool | What Workbench uses it for | |
| --- | --- | --- |
| [Node.js](https://nodejs.org/en/download) 22.12 or later | Installing your projects' dependencies and running their dev servers | Required |
| Docker: [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [OrbStack](https://orbstack.dev) on macOS; [Docker Engine](https://docs.docker.com/engine/install/) or Docker Desktop on Linux; [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) on Windows | Projects with a compose file | Required |
| [Git](https://git-scm.com/downloads) | Branches, changes and history for every project | Required |
| [GitHub CLI](https://cli.github.com), signed in | CI status, pull requests and review requests | Optional |
| [VS Code](https://code.visualstudio.com) or another editor | Opening projects and changed files | Optional |

Setup links to anything that's missing. [REQUIREMENTS.md](../REQUIREMENTS.md) lists every dependency and where its security fixes are announced.

## macOS

1. Download the `.dmg` for your Mac:

   | Your Mac | File |
   | --- | --- |
   | Apple silicon (M1 and later) | `workbench-<version>-arm64.dmg` |
   | Intel | `workbench-<version>-x64.dmg` |

2. Open it and drag **Workbench** to **Applications**.
3. Open Workbench.

> [!IMPORTANT]
> The app isn't notarized by Apple yet, so macOS blocks it the first time you open it. Go to **System Settings → Privacy & Security** and click **Open Anyway**. You only need to do this once.

**Updates:** when a new version comes out, Workbench shows a banner with a link to download it.

## Windows

1. Download `workbench-<version>-x64-setup.exe` and run it. It installs for your account only, with no administrator prompt, and adds Workbench to the Start menu.
2. Open Workbench.

> [!IMPORTANT]
> The installer isn't signed yet, so Windows SmartScreen warns the first time you run it. Click **More info**, then **Run anyway**.

**Updates:** Workbench installs them itself. When one is ready, it offers to restart.

It runs on Windows on ARM through Windows' x64 emulation.

## Linux

1. Download the AppImage for your computer:

   | Your computer | File |
   | --- | --- |
   | Intel or AMD (64-bit) | `workbench-<version>-x86_64.AppImage` |
   | ARM (64-bit) | `workbench-<version>-arm64.AppImage` |

2. Keep it somewhere permanent, such as `~/Applications`, then make it executable and open it:

   ```bash
   chmod +x workbench-*.AppImage
   ./workbench-*.AppImage
   ```

**Updates:** the AppImage installs them itself. When one is ready, Workbench offers to restart.

> [!TIP]
> AppImages mount themselves with FUSE, which most desktop distributions include. Without it, run with `APPIMAGE_EXTRACT_AND_RUN=1` set.

## Check your download

Every release file comes with a signed record that it was built from this repo by its release workflow. Check it with the [GitHub CLI](https://cli.github.com):

```bash
gh attestation verify workbench-<version>-arm64.dmg --repo mikegoforth/workbench
```

Releases after 0.1.4 also attach that record as `workbench-<version>.intoto.jsonl`. To check against the file instead of GitHub's copy, add `--bundle workbench-<version>.intoto.jsonl`.

Each release also lists every file's SHA-256 in `SHA256SUMS`.

## Build it yourself

To run Workbench from source or build your own copy of the app, see [Development](development.md#run-from-source).

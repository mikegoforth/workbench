# Requirements and dependencies

Everything workbench depends on, at what version, and where security fixes for each are announced. Update this file whenever one of these versions changes.

Last reviewed: 2026-11-09, for workbench 0.1.1.

## On the user's computer

Setup's first step checks these and links to downloads for anything missing ([src/lib/requirements.ts](src/lib/requirements.ts)).

| Tool | Needed for | Minimum | Required |
| --- | --- | --- | --- |
| macOS or Linux | Running the app | macOS 13 (Ventura), Electron 45's minimum. Linux: x64 or arm64 desktop; checked on Ubuntu 24.04 and Debian 12 | Yes |
| Node.js | Installing dependencies and running projects' dev servers. Also running workbench from source (`npm run dev`) | 22.12 (`MIN_NODE` in `requirements.ts`, `engines` in `package.json`). Node 20 is end-of-life | Yes |
| Docker: Desktop or OrbStack on macOS; Engine or Docker Desktop on Linux | Projects with a compose file | Any | Yes |
| Git | Reading every project's branch, changes and history | Any recent | Yes |
| GitHub CLI (`gh`), signed in | CI status, pull requests, review requests | Any | Optional |
| VS Code | Opening projects and files | Any | Optional |
| A terminal app (Linux) | Open in Terminal: `$TERMINAL`, else the first of gnome-terminal, konsole, xfce4-terminal, kitty, alacritty, wezterm, foot, Ptyxis and others ([platform.ts](src/lib/platform.ts)) | Any | Optional |

The desktop app finds these on the `PATH` of the user's login shell (including nvm's default Node), read once at launch. A tool installed while the app is open is picked up on the next launch.

## Inside workbench.app

These ship to users. A vulnerability in one of them means shipping a new build.

| Component | Version | Notes |
| --- | --- | --- |
| Electron | 45.2.3 | Runs the window and the server |
| ↳ Chromium | 156.0.8078.80 | Bundled by Electron. Browser security fixes arrive only through Electron releases |
| ↳ Node.js | 24.22.2 | Bundled by Electron. **The app's server runs on this, not on the system's Node.** Updating Node on the computer does not patch the app |
| electron-updater | 6.8.11 | Inlined into `dist-electron/main.cjs` by esbuild. It's a devDependency, so `npm audit --omit=dev` skips it. Always run the full `npm audit` |
| Next.js | 16.4.5 | The server (`Contents/Resources/server`) |
| React, React DOM | 19.3.0 | |
| simple-git | 4.0.2 | Compiled into the server build |
| react-markdown, remark-gfm | 10.1.0, 4.0.1 | Compiled into the page build (README tab) |
| lucide-react | 1.61.0 | Icons, compiled into the page build |
| styled-jsx, semver, detect-libc, @swc/helpers, client-only | 5.1.6, 6.3.2, 2.1.2, 0.5.23, 0.0.1 | Pulled in by Next.js |

`sharp` (Next's native image library) is deliberately left out. Nothing uses `next/image`, so there are no native binaries in the server.

## Build tools only

Not shipped. A vulnerability here affects the machine doing the build, not users: electron-builder 26.18.0, esbuild 0.28.2, TypeScript 5, ESLint 9, Tailwind CSS 4.

## Status at last review

- `npm audit --omit=dev`: **0 vulnerabilities**. `electron-updater` isn't covered by this (see above), but it doesn't appear in the full report either.
- `npm audit`: 12 moderate, all in build and lint tooling (`electron-builder`, `typescript-eslint`) through one `minimatch` denial-of-service advisory. Nothing that ships. `npm audit fix` resolves them without breaking changes.
- Code signing: none yet. Builds are ad-hoc signed, so macOS warns when a downloaded copy is first opened, and updates link to their download instead of installing themselves. A Developer ID certificate fixes both (see docs/development.md, "Signing"). Linux AppImages need no signing and install their own updates.
- Update feed: set at build time from `WORKBENCH_RELEASES_OWNER` / `WORKBENCH_RELEASES_REPO` (the release workflow sets them to the repo it runs in, or the `RELEASES_OWNER` / `RELEASES_REPO` variables). Builds without them don't check for updates. Installed apps can only read releases from a public repo.

## Where fixes are announced

| Component | Watch |
| --- | --- |
| Electron (and its Chromium and Node) | https://releases.electronjs.org/ and https://github.com/electron/electron/security/advisories. Electron supports only its latest few major versions, so plan to move up a major version every few months |
| Next.js | https://github.com/vercel/next.js/security/advisories |
| React | https://github.com/facebook/react/security/advisories |
| npm packages generally | Dependabot alerts on the GitHub repo, and `npm audit` |
| Node.js (users' Macs) | https://nodejs.org/en/blog/vulnerability |
| Docker Desktop | https://docs.docker.com/desktop/release-notes/ |
| Git | https://github.com/git/git/security/advisories |
| GitHub CLI | https://github.com/cli/cli/security/advisories |

Users update the tools on their own Macs themselves. The setup screen only enforces minimums.

## Routine check

```bash
npm audit                                         # everything, including electron-updater
npm outdated electron electron-updater next react react-dom
```

## Shipping a security fix

1. Update the package, keeping exact versions for Electron and its tooling, e.g. `npm install --save-exact electron@45.x.y`.
2. Raise `version` in `package.json`. Installed apps only offer an update when the version is higher.
3. `npm run desktop:dist`, then open `release/mac-arm64/workbench.app` (on Linux, `release/workbench-<version>-<arch>.AppImage`) and check it starts and lists projects.
4. Merge the release PR and push its tag; the release workflow builds and publishes every platform. Installed apps check at launch and every 4 hours.
5. Update the versions in this file.

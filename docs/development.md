# Development

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on localhost:3000 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate Next's route types, then run TypeScript |
| `npm test` | Unit tests (Vitest). `npm run test:watch` reruns them as you edit |
| `npm run test:coverage` | Tests plus a coverage report in `coverage/` (open `coverage/index.html`). Fails if coverage drops below the floor in `vitest.config.mts` |
| `npm run desktop` | Build the desktop app's pieces and open it with Electron (no packaging) |
| `npm run desktop:dist` | Package `workbench.app`, a `.dmg` and an update `.zip` into `release/` |

`next dev` listens on every network interface. The API refuses requests that don't come from localhost, but to keep the whole app on this computer, run `npm run dev -- -H localhost`. `npm run dev` has no per-launch API token (see [SECURITY.md](../SECURITY.md)), so prefer the desktop app for everyday use.

## Desktop app

The desktop app is an Electron shell around the same Next.js app. At launch it:

1. Reads `PATH` from your login shell, activating nvm's default Node if you use nvm. (Apps opened from Finder, the Dock or a Linux app launcher get a minimal `PATH`.)
2. Copies its server to its data folder (`~/Library/Application Support/workbench/server/` on macOS, `~/.config/workbench/server/` on Linux, `%APPDATA%\workbench\server\` on Windows) and checks every file against SHA-256s recorded at build time, so it never runs edited code and never writes inside the signed app.
3. Starts the Next.js server on a free port on `127.0.0.1` only, with a secret token for this launch.
4. Opens a window on it. Links to GitHub and elsewhere open in your browser.

Dev servers it starts keep running when you quit or update the app.

## Updates and releases

**Release notes.** What's new (sidebar footer) shows [src/lib/releaseNotes.ts](../src/lib/releaseNotes.ts). Add a note in the same PR as any change a user would notice, under the next version and without a date. Write it for the person using the app, not as a commit message. Notes for versions newer than the running one stay hidden.

**Releasing.** Open a release PR that raises the version (`npm version patch --no-git-tag-version`) and sets that version's date in `releaseNotes.ts`; a test fails if the current version has no dated notes. After it merges, tag `main` and push the tag: `git tag v<version> && git push origin v<version>`. The [release workflow](../.github/workflows/release.yml) builds Apple Silicon and Intel versions into a draft release, attaches `SHA256SUMS` and a build-provenance attestation, then publishes it. If any step fails, the release stays an unpublished draft. This order works with **immutable releases** (Settings → General → Releases), which lock a release's files and tag once it's published. The workflow's header lists the optional secrets.

**Update feed.** A build only checks for updates when `WORKBENCH_RELEASES_OWNER` and `WORKBENCH_RELEASES_REPO` are set at build time. The release workflow sets them to the repo it runs in, or to the `RELEASES_OWNER` / `RELEASES_REPO` variables. Local builds and forks without them never check for updates, so they can't pick up someone else's releases. When there is a feed, the app checks at launch, every 4 hours, and from **workbench → Check for Updates…**.

**Public releases, private source.** Installed apps read releases without a token, so releases must be in a public repo. To keep the source private, publish to a separate public repo that holds only releases: set the two variables, and add a `RELEASES_TOKEN` secret (a fine-grained token that can write only to that repo).

## Signing

Without a Developer ID certificate, builds are ad-hoc signed. They run, but macOS warns the first time a downloaded copy is opened (System Settings → Privacy & Security → Open Anyway). Updates then link to their download, because macOS won't install updates over an ad-hoc signed app.

With a certificate (Apple Developer Program) in the keychain or in `CSC_LINK` / `CSC_KEY_PASSWORD`, builds are signed with the hardened runtime and updates install themselves. They're also notarized when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set. If you sign, also set `appId` in `electron-builder.config.mjs` to a reverse domain you control.

## Code layout

- `src/app/api/`: route handlers (projects, git, GitHub, dev environment, scripts, Docker, notes, settings)
- `src/proxy.ts`: the check every `/api` request passes (localhost only, plus the desktop app's token)
- `src/lib/`: scanning, git, GitHub, the dev environment manager (`devenv.ts`), Docker (`docker.ts`), setup checks, attention rules
- `src/components/`: the UI (app bar, side nav, pages, project tabs, setup wizard, shared primitives in `ui.tsx`)
- `electron/`: the desktop app's main process (`main.ts`), preload script and login-shell `PATH` lookup
- `scripts/build-desktop.mjs`, `electron-builder.config.mjs`: desktop build and packaging

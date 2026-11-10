# Security

## Reporting a vulnerability

Please report it privately through GitHub: the repository's **Security** tab → **Report a vulnerability**. Don't open a public issue.

Include what's affected (desktop app, `npm run dev`, or the release process), the version, and steps to reproduce.

## Supported versions

Only the latest release gets fixes. The desktop app checks for updates at launch and every 4 hours.

## How workbench protects your machine

workbench runs commands on your Mac (git, npm scripts, Docker), so its API is locked down:

- **Local only.** The server listens on `127.0.0.1` and refuses requests whose `Host` isn't a loopback name, which blocks DNS-rebinding pages.
- **Only its own window.** In the desktop app, a random secret made at each launch must accompany every API request, so other programs on the Mac can't use the API.
- **No cross-site writes.** Writes must send `Content-Type: application/json`, which a cross-site page can't do without a CORS preflight that's never approved.
- **No arbitrary paths or commands.** Project names must be folders in the projects folder, file paths must resolve (through symlinks) inside the project, and commands run with fixed arguments, never through a shell built from request data.
- **Untampered app.** Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, and Electron verifies `app.asar` before loading it. The server's files are checked against SHA-256s recorded at build time at every launch.
- **Verifiable releases.** Each release has `SHA256SUMS`, and a build-provenance attestation when the repository is public:

  ```bash
  gh attestation verify workbench-<version>-arm64.dmg --repo <owner>/<repo>
  ```

Dependencies and where their security fixes are announced: [REQUIREMENTS.md](REQUIREMENTS.md).

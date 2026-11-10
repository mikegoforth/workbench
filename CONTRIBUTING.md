# Contributing

Thanks for helping. Small, focused changes are the quickest to review.

## Bugs and feature requests

Open an issue: <https://github.com/mikegoforth/workbench/issues>. For a bug, include your system (macOS, Windows or Linux), the workbench version (in the sidebar footer) and the steps that show it.

**Security problems:** don't open an issue. Report them privately as described in [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repo and branch from `main`.
2. Make the change. [docs/development.md](docs/development.md) has the commands and the code layout.
3. Open a pull request against `main`. Say what changed and why; for anything visible, what a user sees.
4. CI has to pass before a pull request can merge: lint, typecheck, the tests with coverage and `npm audit` ("Checks"), the tests on macOS and Windows, and the packaged desktop app starting on macOS, Linux and Windows.

## What a change needs

- **Tests.** New functionality and bug fixes come with tests in the Vitest suite (`src/**/*.test.ts`). Run them with `npm test`, or `npm run test:coverage` to also check coverage: CI fails if it drops below the floor in [vitest.config.mts](vitest.config.mts). Code that turns request data into paths or commands should also get a property-based test (fast-check), like the ones in `src/lib/files.test.ts` and `src/lib/paths.test.ts`.
- **No lint or type errors.** `npm run lint` (ESLint with Next's rules) and `npm run typecheck` (TypeScript in strict mode) both have to pass with no errors and no warnings.
- **The security rules.** Every `/api` route is covered by `src/proxy.ts`. Validate project names with `resolveProjectDir` and file paths with `resolveFileIn`. Run commands with `execFile` or `spawn` and fixed arguments, never through a shell built from request data. [SECURITY.md](SECURITY.md) explains why.
- **A release note** for any change a user would notice, in `src/lib/releaseNotes.ts`, in the same pull request. See [docs/development.md](docs/development.md#updates-and-releases).
- **Pinned actions.** Workflows pin every action to a full commit SHA (the repo refuses anything else), and only GitHub's own actions and `ossf/scorecard-action` are allowed to run.
- **Dependencies.** A new package that ships in the app also goes in [REQUIREMENTS.md](REQUIREMENTS.md), with where its security fixes are announced.
- **Commit messages.** A subject line that says what changed, and a body that says why.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), like the rest of workbench.

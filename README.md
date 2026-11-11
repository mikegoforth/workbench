<a id="readme-top"></a>

<!-- Layout based on Best-README-Template: https://github.com/othneildrew/Best-README-Template -->

[![Latest release][release-shield]][release-url]
[![CI][ci-shield]][ci-url]
[![Coverage][coverage-shield]][coverage-url]
[![OpenSSF Best Practices][bestpractices-shield]][bestpractices-url]
[![License: MIT][license-shield]][license-url]

<!--
  OpenSSF Scorecard badge. .github/workflows/scorecard.yml publishes the score;
  add it to the row above once it's above 7 (6.8 at c8b7fbc):
  [![OpenSSF Scorecard][scorecard-shield]][scorecard-url]
-->

<br />
<div align="center">
  <a href="https://github.com/mikegoforth/workbench">
    <img src="docs/assets/logo.svg" alt="Workbench logo" width="80" height="80">
  </a>

  <h3 align="center">Workbench</h3>

  <p align="center">
    A control panel for every coding project on your computer.
    <br />
    <a href="docs/usage.md"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/mikegoforth/workbench/releases/latest">Download</a>
    &middot;
    <a href="https://github.com/mikegoforth/workbench/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/mikegoforth/workbench/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li><a href="#security">Security</a></li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#feedback-and-contributing">Feedback and contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

<!-- Add a screenshot here once there is one, e.g. docs/assets/screenshot.png -->

Workbench looks at every project in your projects folder and shows you where each one stands: git status, running dev servers and containers, GitHub CI and pull requests, notes and todos. You can act on all of it from the same place, without opening GitHub, a terminal, or each repo by hand.

- **See what needs attention.** Failing CI, pull requests waiting on you, unpushed work, branches that are behind, and crashed containers, across every repo at once.
- **Start and stop projects.** One click starts a project's Docker containers and dev server, and stops them again. Run any script from `package.json` and watch its output.
- **Pick up where you left off.** Notes, todos, changed files and the current branch for each project, on one page.
- **Jump straight in.** Open a project in your editor, your terminal or on GitHub, or pull its latest changes.
- **Stay up to date.** See what's new in each release, and get told when an update is out.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

[![Next.js][next-shield]][next-url]
[![React][react-shield]][react-url]
[![TypeScript][typescript-shield]][typescript-url]
[![Electron][electron-shield]][electron-url]
[![Tailwind CSS][tailwind-shield]][tailwind-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Security

Workbench can run commands on your computer, so it's built so that only you can use it.

- **Everything stays on your computer.** No accounts, no tracking, nothing in the cloud. It only goes online through your own git and GitHub tools, and to check for updates.
- **Only you can reach it.** In the desktop app, other computers, websites and other programs on your computer are all turned away.
- **It stays inside your projects folder.** It won't open files outside it, and it never runs a command pieced together from outside input. On every change, automated tests throw thousands of made-up paths at it to make sure.
- **Downloads you can check.** Every release is built in public by GitHub Actions, with a signed record that proves where it came from.

Every change is scanned by CodeQL and has to pass CI before it's merged, and Dependabot keeps dependencies patched. The details, and how to report a problem privately, are in [SECURITY.md](SECURITY.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

Workbench is a desktop app for macOS, Windows and Linux.

[![macOS 13 or later][macos-shield]](docs/install.md#macos)
[![Windows 10 or 11][windows-shield]](docs/install.md#windows)
[![Linux x64 or arm64][linux-shield]](docs/install.md#linux)

### Prerequisites

- **macOS 13 or later**, **Windows 10 or 11**, or **64-bit Linux**
- [Node.js](https://nodejs.org/en/download) 22.12 or later, [Git](https://git-scm.com/downloads), and Docker ([Docker Desktop](https://www.docker.com/products/docker-desktop/), [OrbStack](https://orbstack.dev) or [Docker Engine](https://docs.docker.com/engine/install/))
- Optional: the [GitHub CLI](https://cli.github.com), signed in, for CI and pull requests, and an editor such as [VS Code](https://code.visualstudio.com)

Setup checks for each of these on first launch and links to anything that's missing. The full list is in [What you need](docs/install.md#what-you-need).

### Installation

1. Download Workbench from the [latest release](https://github.com/mikegoforth/workbench/releases/latest).
2. Open it. macOS and Windows warn you the first time, because it isn't approved by Apple or signed for Windows yet. The install guide shows how to get past that on [macOS](docs/install.md#macos) and [Windows](docs/install.md#windows), and how to run it on [Linux](docs/install.md#linux).
3. Setup checks your tools and asks where your projects live. Every folder directly inside that folder becomes a project.

Or run it from source:

```sh
git clone https://github.com/mikegoforth/workbench.git
cd workbench
npm install
npm run dev    # http://localhost:3000
```

More in [Development](docs/development.md#run-from-source).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

The **Dashboard** opens first: what needs attention, what's running, CI across your GitHub repos, recent activity and open todos. Click a project for its notes, git state, dev environment, logs and history.

A few shortcuts:

| Keys | Action |
| --- | --- |
| `⌘K` (`Ctrl K` on Windows and Linux) or `/` | Search |
| `J` / `K` | Move through projects |
| `Enter` | Open the selected project |
| `O` / `T` / `S` / `G` | On a project page: open in your editor / terminal, Start, open on GitHub |

Every page, preference and shortcut is described in [Using Workbench](docs/usage.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Desktop apps for macOS, Windows and Linux, with built-in update checks
- [x] Signed build provenance for every release
- [x] OpenSSF Best Practices passing badge
- [ ] Notarize the macOS app, so it opens without the security prompt
- [ ] Sign the Windows installer, so SmartScreen doesn't warn

See the [open issues](https://github.com/mikegoforth/workbench/issues) for proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Feedback and contributing

Found a bug or want a feature? [Open an issue](https://github.com/mikegoforth/workbench/issues). For a security problem, follow [SECURITY.md](SECURITY.md) instead.

Contributions are welcome:

1. Fork the project
2. Create a branch from `main` (`git checkout -b feature/your-feature`)
3. Commit your changes, with tests
4. Push the branch (`git push origin feature/your-feature`)
5. Open a pull request

[CONTRIBUTING.md](CONTRIBUTING.md) explains what a pull request needs, such as tests, lint and a release note.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Mike Goforth: [@mikegoforth](https://github.com/mikegoforth)

Project link: [github.com/mikegoforth/workbench](https://github.com/mikegoforth/workbench)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

- [Best-README-Template](https://github.com/othneildrew/Best-README-Template), for this README's layout
- [Lucide](https://lucide.dev), for the icons
- [Shields.io](https://shields.io), for the badges
- [OpenSSF Scorecard](https://scorecard.dev) and [OpenSSF Best Practices](https://www.bestpractices.dev), for keeping the project honest about security

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[release-shield]: https://img.shields.io/github/v/release/mikegoforth/workbench?style=for-the-badge&label=release
[release-url]: https://github.com/mikegoforth/workbench/releases/latest
[ci-shield]: https://img.shields.io/github/actions/workflow/status/mikegoforth/workbench/ci.yml?branch=main&style=for-the-badge&label=CI
[ci-url]: https://github.com/mikegoforth/workbench/actions/workflows/ci.yml
[coverage-shield]: https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmikegoforth%2Fworkbench%2Fbadges%2Fcoverage.json&style=for-the-badge
[coverage-url]: docs/development.md#commands
[bestpractices-shield]: https://img.shields.io/cii/level/16546?style=for-the-badge&label=OpenSSF%20best%20practices
[bestpractices-url]: https://www.bestpractices.dev/projects/16546
[scorecard-shield]: https://img.shields.io/ossf-scorecard/github.com/mikegoforth/workbench?style=for-the-badge&label=OpenSSF%20scorecard
[scorecard-url]: https://scorecard.dev/viewer/?uri=github.com/mikegoforth/workbench
[license-shield]: https://img.shields.io/github/license/mikegoforth/workbench?style=for-the-badge
[license-url]: LICENSE
[macos-shield]: https://img.shields.io/badge/macOS-13%2B-000000?style=for-the-badge&logo=apple&logoColor=white
[windows-shield]: https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTMgM2g4LjV2OC41SDN6TTEyLjUgM0gyMXY4LjVoLTguNXpNMyAxMi41aDguNVYyMUgzek0xMi41IDEyLjVIMjFWMjFoLTguNXoiLz48L3N2Zz4%3D
[linux-shield]: https://img.shields.io/badge/Linux-x64%20%7C%20arm64-FCC624?style=for-the-badge&logo=linux&logoColor=black
[next-shield]: https://img.shields.io/badge/next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[next-url]: https://nextjs.org/
[react-shield]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[react-url]: https://react.dev/
[typescript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[typescript-url]: https://www.typescriptlang.org/
[electron-shield]: https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white
[electron-url]: https://www.electronjs.org/
[tailwind-shield]: https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white
[tailwind-url]: https://tailwindcss.com/

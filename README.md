<p align="center">
  <img src="build/icons/256x256.png" width="96" alt="EnsoCode" />
</p>

<h1 align="center">EnsoCode</h1>

<p align="center">
  <b>Your projects, models, and coding agents — one desktop workspace.</b>
</p>

<p align="center">
  A local-first coding agent workbench, independently maintained by
  <a href="https://github.com/tingyuxuan123">@tingyuxuan123</a>.
</p>

<p align="center">
  <a href="https://github.com/tingyuxuan123/EnsoCode/releases"><b>Download</b></a>
  ·
  <a href="#the-workspace">Features</a>
  ·
  <a href="#development">Development</a>
  ·
  <a href="https://github.com/tingyuxuan123/EnsoCode/issues">Feedback</a>
  ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/tingyuxuan123/EnsoCode/releases"><img src="https://img.shields.io/github/v/release/tingyuxuan123/EnsoCode?include_prereleases&label=personal%20release" alt="Latest personal release" /></a>
  <img src="https://img.shields.io/badge/personal%20build-macOS%20Apple%20Silicon-555" alt="Personal build: macOS Apple Silicon" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

---

<p align="center">
  <img src="docs/readme/workspace-current.png" alt="Current EnsoCode workspace with project navigation, task composer, and source preview" width="1100" />
</p>
<p align="center"><sub>The current workspace in light mode: project navigation, a new task, and source files side by side.</sub></p>

## About this version

This repository started as a fork of [J3n5en/EnsoCode](https://github.com/J3n5en/EnsoCode) and is now independently maintained here. It keeps the EnsoCode name and builds on the original project, with its own interface, development priorities, and personal release channel. It is **not an official upstream distribution**.

The focus is a workspace you can use every day: move between projects and conversations, choose the right model, delegate work, and review the result without scattering everything across separate windows.

Built with Electron, React, TypeScript, and the [pi](https://github.com/earendil-works/pi) coding agent harness.

## The workspace

### A conversation with the tools beside it

The workspace brings project navigation, the conversation timeline, and dockable tool panels together. Open files, inspect changes, run a terminal, or check a page in the embedded browser while keeping the task in view.

- **Projects & sessions** — organize work by repository and keep separate conversations for separate tasks.
- **Files & changes** — browse source files and review session or Git changes next to the conversation.
- **Terminal & browser** — run commands and preview web work without leaving the app.
- **Appearance** — light and dark themes, terminal palettes, background images, and opacity settings.

<details>
<summary><strong>Appearance settings</strong></summary>

<p align="center">
  <img src="docs/readme/appearance-current.png" alt="Current appearance settings with theme modes, accent colors, and a terminal preview" width="900" />
</p>
<p align="center"><sub>Theme modes, accent colors, and a live terminal palette preview.</sub></p>

</details>

### Choose models and reuse your setup

Connect your own providers and endpoints rather than committing to one model service. Configure models, skills, MCP servers, and runtime presets for the way you work.

- Import supported local configuration and history from Claude Code, Codex, and Cursor.
- Reference files and sessions with `@`, and use skills and slash commands in the composer.
- Keep model selection and context usage visible while you work.

### Delegate without losing the thread

| Tool | Use it for |
| :--- | :--- |
| **Subagents** | Self-contained research, implementation, testing, or review in a separate context. |
| **Coworkers** | Longer collaboration in a separate session you can inspect and steer. |
| **Workflows** | Repeatable multi-agent tasks, with presets and a panel for run progress. |
| **Goal tracking** | Keep an outcome in view while the agent works through multiple turns. |
| **Background tasks** | Keep dev servers, watchers, and long-running commands separate from the main conversation. |

Git worktrees are available for tasks that need separate working trees. Separate agent contexts alone do not isolate concurrent file edits.

<p align="center">
  <img src="docs/readme/workflows-current.png" alt="Current EnsoCode dark-mode workspace with the parallel review workflow preset expanded" width="1100" />
</p>
<p align="center"><sub>Dark mode with the workflow panel open: configure a parallel review or choose a multi-angle investigation.</sub></p>

Screenshots use an isolated local preview without private conversations or provider credentials; no model run is shown.

### Review and stay in control

Review diffs, approve tool actions, queue follow-ups, or interrupt a running task. Approval modes let you choose between manual review, automatically accepting edits, and full access. Git checkpoints provide a way to rewind supported changes.

For work away from the desk, the project also includes an optional phone companion, paired desktop remote nodes, and SSH projects. Phone and remote-node pairing use end-to-end encryption; a relay forwards ciphertext rather than conversation plaintext.

## Download & get started

**[Browse this repository’s releases →](https://github.com/tingyuxuan123/EnsoCode/releases)**

The current personal release channel targets **macOS on Apple Silicon**, with `.dmg` and `.zip` assets under `personal-v*` prereleases. Windows, Linux, and Intel Mac build support in the source tree should not be read as a promise of maintained personal binaries for those platforms.

1. Download the installer from a `personal-v*` release in **this repository**.
2. Open Settings and connect a model provider, or import a supported local setup.
3. Add a project and start a conversation.
4. Describe the task, review the proposed actions, and inspect the resulting changes.

No EnsoCode account is required. Model requests go to the provider or endpoint you configure, and any usage charges belong to that service.

### Personal updates

Personal builds use this repository’s `personal-updates` channel. An upstream installation does not automatically switch to it; the initial migration requires a manual installation of a personal build. Back up important settings and sessions before switching distributions.

These builds use a personal signing certificate, **not Apple Developer ID notarization**. macOS may require additional confirmation. Check the release notes and `SHA256SUMS` before installing; do not disable system security globally.

## Local-first, with clear boundaries

| Data or action | Boundary |
| :--- | :--- |
| Conversations and settings | Stored locally by the app. |
| Provider credentials | Managed by the desktop Main process, not included in the phone catalog. |
| Model requests | Sent to your configured provider or endpoint, including the context needed for the request. |
| MCP and external tools | May access files or services according to their configuration and the permissions you grant. |
| Phone and remote nodes | Optional pairing; relayed session traffic is end-to-end encrypted. |
| Browser and network tools | Contact the sites and services you open or ask the agent to use. |

Local-first does not mean offline-only. Choose providers, tools, and remote services according to your own privacy requirements.

## Development

Use the Node.js version in [`.nvmrc`](.nvmrc) and the pnpm version pinned in [`package.json`](package.json).

```bash
pnpm install
pnpm dev
```

```bash
# Build the application bundles
pnpm build

# Checks before submitting changes
pnpm typecheck && pnpm lint && pnpm test
```

- [Engineering guidelines](docs/engineering-guidelines.md) — conventions, testing, and layer boundaries.
- [Release & update guide](docs/engineering-reference/guides/releasing.md) — personal builds are packaged and verified by GitHub Actions, not locally.
- [Self-hosting the relay](packages/relay/README.md) — optional infrastructure for paired devices.

## Feedback & contributions

Use [Issues in this repository](https://github.com/tingyuxuan123/EnsoCode/issues) for bugs and suggestions about this version. Include the app version, operating system, reproduction steps, and relevant redacted logs. Never post API keys, pairing secrets, or private conversation content.

This is a personally maintained project. Development follows the maintainer’s own usage and priorities; upstream features and releases may differ. For substantial contributions, discuss the scope in an issue first and keep pull requests focused.

## Acknowledgements & license

Thanks to [J3n5en/EnsoCode](https://github.com/J3n5en/EnsoCode) and its contributors for the original project, and to [pi](https://github.com/earendil-works/pi) and the open-source projects this workbench builds on.

Released under the [MIT License](LICENSE). Original copyright and license notices are preserved. See also [Third-party notices](THIRD_PARTY_NOTICES.md).

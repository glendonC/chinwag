# Contributing to chinmeister

chinmeister is the control layer for agentic development: one command connects your AI coding tools into a unified system with shared memory, live coordination, and conflict prevention. The MCP server is the product. After `npx chinmeister init` (or a global install and `chinmeister init`), it runs invisibly alongside each agent.

We welcome contributions from everyone. Whether you are fixing a typo, reporting a bug, improving documentation, or building a feature, thank you.

This guide covers what you need to contribute effectively. If something is unclear, open an issue and ask. Questions are contributions too.

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [How to Contribute](#how-to-contribute)
- [Development Guide](#development-guide)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Code Review](#code-review)
- [Legal](#legal)

## Code of Conduct

Be kind, be constructive, be welcoming. We are building a community tool, and the way we work together should reflect that.

We do not tolerate harassment, personal attacks, or exclusionary behavior. Maintainers will enforce this at their discretion.

## Getting Started

### Prerequisites

- **Node.js 22+** (required for native WebSocket support in the CLI)
- **npm** (comes with Node)
- **Wrangler CLI** (`npm install -g wrangler`) for worker development
- A Cloudflare account (only needed if deploying workers; not needed for CLI work)

### Clone and install

```bash
git clone https://github.com/glendonchin/chinmeister.git
cd chinmeister
npm install
```

This installs the root workspace dependencies for `packages/cli`, `packages/worker`, `packages/mcp`, `packages/shared`, and `packages/web`.
`packages/web` is part of the root npm workspaces too, so the root install is the only install step you need for local development.

### Running locally

```bash
# Recommended: start the full local stack with isolated local auth
npm run dev:local

# Optional: run individual pieces
npm run dev:cli
npm run dev:worker
npm run dev:web
```

`npm run dev:local` uses:

- The worker in local mode
- The web dashboard in the local profile
- An isolated local config at `~/.chinmeister/local/config.json`
- A local dashboard URL that is safe to use without touching production auth

If you want to run the CLI against the local worker manually:

```bash
CHINMEISTER_PROFILE=local CHINMEISTER_API_URL=http://localhost:8787 npm run dev:cli
```

If you want to run the web dashboard against the local worker manually:

```bash
VITE_CHINMEISTER_PROFILE=local npm run dev --workspace=packages/web
```

## Project structure

chinmeister is a monorepo with five packages:

```
packages/
  mcp/          MCP server (the product: shared brain for agents)
    index.js      Server entry: stdio transport, config/profile bootstrap
    hook.js       Claude Code hook handler (check-conflict, report-edit, session-start)
    channel.js    Claude Code channel server (WebSocket push with HTTP fallback)
    lib/          API client, team operations, config, profile detection, WebSocket managers

  cli/          Node.js terminal UI (Ink/React, optional)
    cli.jsx       Entry point, screen router, error boundary
    lib/
      init-command.js   chinmeister init: account, team, tool detection, config writing
      add-command.js    chinmeister add: adds MCP config, fetches catalog from API
      tools.js          CLI re-export of the shared MCP tool registry
      mcp-config.js     Tool detection and config file writing
      dashboard.jsx     Agent activity dashboard
      discover.jsx      Tool discovery screen (fetches catalog from API)
      chat.jsx, customize.jsx             Other screens
      api.js            HTTP client with timeout + retry
    dist/         Build output (gitignored)

  shared/       Shared infrastructure primitives (TypeScript)
    contracts.ts        Type definitions: TeamContext, delta events, API contracts
    tool-registry.ts    Canonical MCP-configurable tool definitions
    agent-identity.ts   Tool detection and agent/session ID helpers
    api-client.ts       Shared JSON API client factory
    session-registry.ts Terminal/session helpers used across surfaces
    dashboard-ws.ts     WebSocket delta normalization and state application
    integration-doctor.ts  Host integration detection and configuration
    config.ts, team-utils.ts, process-utils.ts

  worker/       Cloudflare Workers backend
    src/
      index.js      HTTP router, auth middleware, rate limiting
      db.js         DatabaseDO: users, agent profiles, rate limits
      team.js       TeamDO: coordination, activity, conflicts, memory, sessions
      lobby.js      LobbyDO: room assignment and presence
      room.js       RoomDO: WebSocket chat rooms
      moderation.js Content moderation (blocklist + Llama Guard 3)

  web/          Landing page + React dashboard (Cloudflare Pages)
    dashboard.html SPA entry for the authenticated dashboard
    src/          React app: views, components, stores, tests
    index.html    Landing page with marketing copy and install flow
    vite.config.js Vite config for dashboard builds
```

If you are unsure which package your change belongs in, follow where the behavior lives: user-facing display is CLI, server logic is worker, marketing and landing is web.

## How to contribute

### Reporting bugs

[Open a bug report](https://github.com/glendonchin/chinmeister/issues/new) with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, terminal emulator)

### Suggesting features

[Open a feature request](https://github.com/glendonchin/chinmeister/issues/new) with:

- The problem you are trying to solve
- Your proposed solution
- Alternatives you considered

### Your first contribution

Look for issues labeled [`good first issue`](https://github.com/glendonchin/chinmeister/labels/good%20first%20issue). These are scoped, well-defined tasks designed to be approachable.

Good first contributions also include:

- Improving error messages in the CLI
- Adding test coverage
- Documentation improvements
- Accessibility fixes in the terminal UI

### Security vulnerabilities

**Do not open a public issue.** See [SECURITY.md](../SECURITY.md) for responsible disclosure instructions.

## Development guide

### Code style

- **JavaScript** (ES modules). Shared primitives (`packages/shared/`) are TypeScript.
- **JSX** for CLI components (Ink uses React)
- ESLint and Prettier are configured. Run `npm run lint:fix` to auto-format. Match the existing style:
  - 2-space indentation
  - Single quotes for strings
  - `const` by default, `let` when reassignment is needed
  - Descriptive variable names, no abbreviations beyond common ones (`req`, `res`, `ctx`, `env`)
- Keep files focused. One Durable Object per file, one screen component per file.

### Testing

Vitest is set up across the repo. Prefer targeted unit or integration tests in the package you are changing.

For manual testing:

```bash
# CLI changes: rebuild and run
cd packages/cli && npm run dev

# Worker changes: use local Wrangler dev server
cd packages/worker && npm run dev:local

# Full local stack
npm run dev:local

# Test API endpoints directly
curl http://localhost:8787/stats
curl -X POST http://localhost:8787/auth/init -H 'CF-Connecting-IP: 127.0.0.1'
```

Current automated test commands:

```bash
npm run test:cli
npm run test:mcp
npm run test:worker
npm run test:web
npm run test
```

### React versions

- `packages/cli` uses **React 18** (required by [Ink](https://github.com/vadimdemedes/ink) for terminal rendering)
- `packages/web` uses **React 19** (standard browser React)

These versions must not be unified. They target different runtimes, and Ink does not support React 19.

### Per-package notes

**CLI (`packages/cli/`)**

- Built with [Ink](https://github.com/vadimdemedes/ink) (React for terminals)
- Bundled with esbuild to `dist/cli.js`
- Screen components are in `lib/`. The dashboard is the primary control surface; other screens receive `navigate`, `user`, and `config` props as needed.
- Colors are mapped in `lib/colors.js`. Use `getInkColor()` for Ink components.
- Production config lives at `~/.chinmeister/config.json`. Local profile config lives at `~/.chinmeister/local/config.json`. Use `lib/config.js` helpers; never write directly.

**Worker (`packages/worker/`)**

- Four Durable Object classes: `DatabaseDO`, `TeamDO`, `LobbyDO`, `RoomDO`
- Single `DatabaseDO` instance holds all persistent data (SQLite)
- `LobbyDO` manages room assignment; rooms auto-size to ~20 users
- `RoomDO` handles one chat room each with WebSocket connections
- Moderation is two-layer: fast blocklist plus Llama Guard 3 AI. See `CLAUDE.md` for the design rationale. Do not grow the blocklist as a strategy.
- KV is for auth token lookups only. Do not add new KV use cases without discussion.

**Web (`packages/web/`)**

- Landing page plus React 19 dashboard, built with Vite and Zustand.
- Fetches the same public API as the CLI and MCP server.
- Uses the root workspace install. For the local profile, prefer `npm run dev:local` from the repo root.
- Deployed on Cloudflare Pages.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) with package scopes:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`

**Scopes** (map to packages): `cli`, `worker`, `web`. Omit scope for repo-wide changes.

**Examples:**

```
feat(cli): add room shuffle with [n] key
fix(worker): handle null room ID in lobby assignment
docs: add CONTRIBUTING.md
refactor(worker): extract rate limit logic to moderation.js
chore: update wrangler to v4.1
```

Keep the subject line under 72 characters. Use the body for context on _why_, not _what_ (the diff shows what).

## Pull request process

1. **Branch from `main`.** Use a descriptive branch name: `fix/lobby-null-room`, `feat/cli-color-picker`, `docs/security-policy`.

2. **One concern per PR.** A bug fix is one PR. A feature is one PR. Do not bundle unrelated changes.

3. **Write a clear description.** What does this change? Why? How can a reviewer test it? Link to the issue if there is one.

4. **Keep PRs small when possible.** Smaller PRs get reviewed faster and are less likely to introduce regressions.

5. **All CI checks must pass** before merge.

6. **Maintainers may request changes.** That is normal and collaborative. It is about making the code better together.

### Draft PRs

Open a draft PR if you want early feedback on an approach before it is complete. This is encouraged for larger changes.

## Code review

### What reviewers look for

1. **Correctness:** Does the code do what it claims? Are edge cases handled?
2. **Architecture:** Does this change belong in this package or file? Does it follow existing patterns?
3. **Security:** Does this introduce untrusted input paths? Are inputs validated?
4. **Simplicity:** Is there a simpler way to achieve the same result?

### Response times

We aim to review PRs within 48 hours. If you have not heard back in a week, it is okay to leave a polite ping on the PR.

### Addressing feedback

Push new commits to address review feedback (do not force-push over the review). This makes it easy for reviewers to see what changed. We squash on merge.

## Legal

### License

chinmeister is licensed under the [MIT License](../LICENSE). By contributing, you agree that your contributions will be licensed under the same terms.

### Developer Certificate of Origin

By submitting a contribution, you certify that you have the right to do so under the [Developer Certificate of Origin](https://developercertificate.org/) (DCO). In short: you wrote it, or you have permission to contribute it under an open source license.

We do not require a CLA. We do not require `Signed-off-by` lines. Submitting a PR implies your agreement with the DCO.

---

_This guide is a living document. If something is missing or unclear, open an issue or PR to improve it._

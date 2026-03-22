# Contributing to chinwag

We welcome contributions from everyone. Whether you're fixing a typo, reporting a bug, improving documentation, or building a feature — thank you.

This guide covers everything you need to contribute effectively. If something is unclear, open an issue and ask. Questions are contributions too.

## Table of Contents

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

Be kind, be constructive, be welcoming. We're building a community tool — the way we work together should reflect that.

We do not tolerate harassment, personal attacks, or exclusionary behavior. Maintainers will enforce this at their discretion.

## Getting Started

### Prerequisites

- **Node.js 22+** (required for native WebSocket support in the CLI)
- **npm** (comes with Node)
- **Wrangler CLI** (`npm install -g wrangler`) for worker development
- A Cloudflare account (only needed if deploying workers; not needed for CLI work)

### Clone and Install

```bash
git clone https://github.com/glendonchin/chinwag.git
cd chinwag
npm install
```

This installs dependencies for all packages via npm workspaces.

### Running Locally

```bash
# CLI — build and run the terminal client
npm run dev:cli

# Worker — start local dev server (uses Wrangler's local mode)
npm run dev:worker

# Both in separate terminals for full-stack development
```

The CLI points to the production API by default. To point it at your local worker, set:

```bash
CHINWAG_API_URL=http://localhost:8787 CHINWAG_WS_URL=ws://localhost:8787/ws/chat npm run dev:cli
```

## Project Structure

chinwag is a monorepo with three packages:

```
packages/
  cli/          Node.js terminal UI (Ink/React)
    cli.jsx       Entry point and screen router
    lib/          Screen components and utilities
    dist/         Build output (gitignored)

  worker/       Cloudflare Workers backend
    src/
      index.js      HTTP router and auth middleware
      db.js         DatabaseDO — users, notes, exchanges
      lobby.js      LobbyDO — room assignment and presence
      room.js       RoomDO — WebSocket chat rooms
      moderation.js Content moderation (blocklist + AI)

  web/          Static landing page (Cloudflare Pages)
    index.html    Single-page site
    script.js     Stats fetching
    style.css     Styling
```

If you're unsure which package your change belongs in, look at where the behavior lives: user-facing display is CLI, server logic is worker, marketing/landing is web.

## How to Contribute

### Reporting Bugs

[Open a bug report](https://github.com/glendonchin/chinwag/issues/new) with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, terminal emulator)

### Suggesting Features

[Open a feature request](https://github.com/glendonchin/chinwag/issues/new) with:

- The problem you're trying to solve
- Your proposed solution
- Alternatives you considered

### Your First Contribution

Look for issues labeled [`good first issue`](https://github.com/glendonchin/chinwag/labels/good%20first%20issue). These are scoped, well-defined tasks designed to be approachable.

Good first contributions also include:

- Improving error messages in the CLI
- Adding test coverage
- Documentation improvements
- Accessibility fixes in the terminal UI

### Security Vulnerabilities

**Do not open a public issue.** See [SECURITY.md](../SECURITY.md) for responsible disclosure instructions.

## Development Guide

### Code Style

- **JavaScript** (ES modules, no TypeScript currently)
- **JSX** for CLI components (Ink uses React)
- No linter configured yet — match the existing style:
  - 2-space indentation
  - Single quotes for strings
  - `const` by default, `let` when reassignment is needed
  - Descriptive variable names, no abbreviations beyond common ones (`req`, `res`, `ctx`, `env`)
- Keep files focused. One Durable Object per file, one screen component per file.

### Testing

Testing infrastructure is not yet set up. If you're adding tests (very welcome), propose your test framework choice in the PR.

For manual testing:

```bash
# CLI changes — rebuild and run
cd packages/cli && npm run dev

# Worker changes — use local Wrangler dev server
cd packages/worker && npx wrangler dev

# Test API endpoints directly
curl http://localhost:8787/stats
curl -X POST http://localhost:8787/auth/init
```

### Per-Package Notes

**CLI (`packages/cli/`)**

- Built with [Ink](https://github.com/vadimdemedes/ink) (React for terminals)
- Bundled with esbuild → `dist/cli.js`
- Screen components are in `lib/`. Each screen is a React component receiving `navigate`, `user`, and `config` props.
- Colors are mapped in `lib/colors.js`. Use `getInkColor()` for Ink components.
- Config lives at `~/.chinwag/config.json`. Use `lib/config.js` helpers, never write directly.

**Worker (`packages/worker/`)**

- Three Durable Object classes: `DatabaseDO`, `LobbyDO`, `RoomDO`
- Single `DatabaseDO` instance holds all persistent data (SQLite)
- `LobbyDO` manages room assignment — rooms auto-size to ~20 users
- `RoomDO` handles one chat room each with WebSocket connections
- Moderation is two-layer: fast blocklist + Llama Guard 3 AI. See `CLAUDE.md` for the design rationale — do not grow the blocklist as a strategy.
- KV is for auth token lookups only. Do not add new KV use cases without discussion.

**Web (`packages/web/`)**

- Static HTML/CSS/JS. No build step, no framework.
- Fetches live stats from the production API.
- Deployed on Cloudflare Pages.

## Commit Conventions

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

Keep the subject line under 72 characters. Use the body for context on *why*, not *what* (the diff shows what).

## Pull Request Process

1. **Branch from `main`**. Use a descriptive branch name: `fix/lobby-null-room`, `feat/cli-color-picker`, `docs/security-policy`.

2. **One concern per PR.** A bug fix is one PR. A feature is one PR. Don't bundle unrelated changes.

3. **Write a clear description.** What does this change? Why? How can a reviewer test it? Link to the issue if there is one.

4. **Keep PRs small when possible.** Smaller PRs get reviewed faster and are less likely to introduce regressions.

5. **All CI checks must pass** before merge.

6. **Maintainers may request changes.** This is normal and collaborative — it's about making the code better together.

### Draft PRs

Open a draft PR if you want early feedback on an approach before it's complete. This is encouraged for larger changes.

## Code Review

### What reviewers look for

1. **Correctness** — Does the code do what it claims? Are edge cases handled?
2. **Architecture** — Does this change belong in this package/file? Does it follow existing patterns?
3. **Security** — Does this introduce untrusted input paths? Are inputs validated?
4. **Simplicity** — Is there a simpler way to achieve the same result?

### Response times

We aim to review PRs within 48 hours. If you haven't heard back in a week, it's okay to leave a polite ping on the PR.

### Addressing feedback

Push new commits to address review feedback (don't force-push over the review). This makes it easy for reviewers to see what changed. We squash on merge.

## Legal

### License

chinwag is licensed under the [MIT License](../LICENSE). By contributing, you agree that your contributions will be licensed under the same terms.

### Developer Certificate of Origin

By submitting a contribution, you certify that you have the right to do so under the [Developer Certificate of Origin](https://developercertificate.org/) (DCO). In short: you wrote it, or you have permission to contribute it under an open source license.

We do not require a CLA. We do not require `Signed-off-by` lines. Submitting a PR implies your agreement with the DCO.

---

*This guide is a living document. If something is missing or unclear, open an issue or PR to improve it.*

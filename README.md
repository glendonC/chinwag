# chinwag

The vendor-neutral control layer for agentic development. One command connects all your AI coding tools into a unified system: shared memory, live coordination, conflict prevention, workflow visibility.

## Quick start

```bash
npx chinwag init
```

This detects your AI tools (Claude Code, Cursor, Windsurf, VS Code, Codex, Aider, JetBrains, Amazon Q), writes MCP configs, and creates a team for your project. After init, your agents automatically coordinate through chinwag.

**Running the `chinwag` command.** `npx chinwag …` always works. The shorter `chinwag …` form is available after a global install: `npm install -g chinwag` (adds the binary to your PATH).

## What it does

- **Connect** — `npx chinwag init` detects tools and writes configs. `npx chinwag add <tool>` expands.
- **Remember** — Agents share a brain. What one agent learns, every agent knows next session.
- **Coordinate** — Live awareness of every agent. Conflict prevention enforced on Claude Code, advisory on others.
- **Discover** — Browse 30+ AI dev tools. See what fits your stack. Add with one action.
- **Observe** — See what agents are doing across all tools and projects.

## Teams

The `.chinwag` file gets committed to git. When a teammate runs `npx chinwag init`, they auto-join the same team. Every agent across every teammate shares memory and gets conflict prevention.

## Commands

```bash
npx chinwag init              # Setup: account + team + tool configs
npx chinwag add <tool>        # Add a specific tool
npx chinwag add --list        # Browse all tools
npx chinwag dashboard         # Open web dashboard
npx chinwag                   # TUI: dashboard, discover, chat, settings
```

## Architecture

Monorepo with four packages: MCP server (agent interface), Cloudflare Workers backend, CLI/TUI, and web dashboard. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

## Development

```bash
npm run dev:cli           # Build + run CLI
npm run dev:worker        # Local worker dev server
npm run deploy            # Deploy worker to production
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for setup and code style.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and threat model.

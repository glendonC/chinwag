# chinmeister

The vendor-neutral control layer for agentic development. One command connects all your AI coding tools into a unified system: shared memory, live coordination, conflict prevention, workflow visibility.

## Quick start

```bash
npx chinmeister init
```

This detects your AI tools (Claude Code, Cursor, Windsurf, VS Code, Codex, Aider, JetBrains, Amazon Q), writes MCP configs, and creates a team for your project. After init, your agents automatically coordinate through chinmeister.

**Running the `chinmeister` command.** `npx chinmeister …` always works. The shorter `chinmeister …` form is available after a global install: `npm install -g chinmeister` (adds the binary to your PATH).

## What it does

- **Connect:** `npx chinmeister init` detects tools and writes configs. `npx chinmeister add <tool>` expands coverage.
- **Remember:** Agents share project context across sessions.
- **Coordinate:** Agents see current activity. Conflict prevention is enforced on Claude Code and advisory on other tools.
- **Discover:** Browse AI development tools from one catalog and add them with one action.
- **Observe:** See what agents are doing across tools and projects.

## Teams

The `.chinmeister` file gets committed to git. When a teammate runs `npx chinmeister init`, they auto-join the same team. Every agent across every teammate shares memory and gets conflict prevention.

## Commands

```bash
npx chinmeister init              # Setup: account + team + tool configs
npx chinmeister add <tool>        # Add a specific tool
npx chinmeister add --list        # Browse all tools
npx chinmeister token             # Print the active auth token
npx chinmeister dashboard         # Open web dashboard
npx chinmeister                   # TUI: dashboard, discover, chat, settings
```

## Architecture

Monorepo with five packages: MCP server (agent interface), Cloudflare Workers backend, CLI/TUI, shared primitives, and the web dashboard. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

## Development

```bash
npm run dev:local         # Full local stack: worker + web + isolated local auth
npm run dev:cli           # Build + run CLI
npm run dev:worker        # Worker dev server
npm run dev:web           # Web dashboard only
npm run deploy            # Deploy worker to production
```

`npm run dev:local` keeps local development isolated from production by using the local worker, the local dashboard, and `~/.chinmeister/local/config.json`. See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for setup and code style.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and threat model.

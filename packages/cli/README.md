# chinwag

**Problem.** Every AI coding tool keeps its own memory and coordinates only with itself. Sessions in different tools diverge, duplicate work, and collide on files. No vendor ships neutral cross-tool coordination; doing so would help their competitors.

**Who.** chinwag is for solo developers using several AI tools across a few active projects; small teams (2 to 5 people) on the same repo with different preferred tools; and team leads who need visibility into agent activity and coordination.

**Promise.** chinwag is the vendor-neutral control layer for agentic development: connect your stack with `npx chinwag init`, share project memory across tools and teammates, get live coordination and conflict prevention where the tool allows it, and see your workflow in one place. Agents are the primary user. Value shows up through the MCP server that runs beside each session.

**Non-goals.** chinwag is not an agent orchestrator, not a standalone APM or observability product, not a community or social product, not a replacement for static project instructions like CLAUDE.md or AGENTS.md, and not a marketplace for arbitrary MCP servers. Discover is about AI dev tools for your workflow.

## Install

```bash
npx chinwag init
```

Use `npx chinwag <command>` so you do not need a global install. To run `chinwag` without the `npx` prefix, install globally: `npm install -g chinwag`.

Documentation: [Architecture](https://github.com/glendonchin/chinwag/blob/main/docs/ARCHITECTURE.md) · [chinwag.dev](https://chinwag.dev)

## Commands

```bash
npx chinwag init          # account + team + MCP config
npx chinwag add <tool>    # add one MCP-configurable tool
npx chinwag add --list    # browse the discover catalog
npx chinwag dashboard     # open the web dashboard
npx chinwag               # launch the terminal dashboard
```

## Development

From the repo root:

```bash
npm run dev --workspace=packages/cli
npm run test --workspace=packages/cli
```

## Environment

- `CHINWAG_API_URL`: override the default API base URL
- `CHINWAG_WS_URL`: override the chat WebSocket URL
- `CHINWAG_DASHBOARD_URL`: override the browser dashboard URL opened by the CLI

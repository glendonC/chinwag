# chinmeister

**Problem.** Every AI coding tool keeps its own memory and coordinates only with itself. Sessions in different tools diverge, duplicate work, and collide on files. No vendor ships neutral cross-tool coordination; doing so would help their competitors.

**Who.** chinmeister is for solo developers using several AI tools across a few active projects; small teams (2 to 5 people) on the same repo with different preferred tools; and team leads who need visibility into agent activity and coordination.

**Promise.** chinmeister is the vendor-neutral control layer for agentic development: connect your stack with `npx chinmeister init`, share project memory across tools and teammates, get live coordination and conflict prevention where the tool allows it, and see your workflow in one place. Agents are the primary user. Value shows up through the MCP server that runs beside each session.

**Non-goals.** chinmeister is not an agent orchestrator, not a standalone APM or observability product, not a community or social product, not a replacement for static project instructions like CLAUDE.md or AGENTS.md, and not a marketplace for arbitrary MCP servers.

## Install

```bash
npx chinmeister init
```

Use `npx chinmeister <command>` so you do not need a global install. To run `chinmeister` without the `npx` prefix, install globally: `npm install -g chinmeister`.

Documentation: [Architecture](https://github.com/glendonchin/chinmeister/blob/main/docs/ARCHITECTURE.md) · [chinmeister.com](https://chinmeister.com)

## Commands

```bash
npx chinmeister init          # account + team + MCP config
npx chinmeister add <tool>    # add one MCP-configurable tool
npx chinmeister doctor        # scan integration health
npx chinmeister token         # print the active auth token
npx chinmeister dashboard     # open the web dashboard
npx chinmeister               # launch the terminal dashboard
```

## Development

From the repo root:

```bash
npm run dev --workspace=packages/cli
npm run test --workspace=packages/cli
```

## Environment

- `CHINMEISTER_PROFILE`: runtime profile (`prod` or `local`)
- `CHINMEISTER_API_URL`: override the default API base URL
- `CHINMEISTER_WS_URL`: override the chat WebSocket URL
- `CHINMEISTER_DASHBOARD_URL`: override the browser dashboard URL opened by the CLI

When `CHINMEISTER_PROFILE=local`, the CLI uses isolated auth at `~/.chinmeister/local/config.json` instead of the production config path.

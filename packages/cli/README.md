# chinmeister

**Problem.** AI coding tools keep separate memory and coordinate only with themselves. Sessions in different tools can diverge, duplicate work, and collide on files. Cross-tool coordination needs to be neutral so it can work across vendors.

**Who.** chinmeister is for solo developers using several AI tools across active projects, small teams working in the same repo with different preferred tools, and team leads who need visibility into agent activity and coordination.

**What it does.** `npx chinmeister init` connects supported tools to shared project memory, live coordination, conflict checks where the host tool supports them, and a shared workflow view. The MCP server runs beside each agent session and provides the core coordination layer.

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
- `CHINMEISTER_DASHBOARD_URL`: override the browser dashboard URL opened by the CLI

When `CHINMEISTER_PROFILE=local`, the CLI uses isolated auth at `~/.chinmeister/local/config.json` instead of the production config path.

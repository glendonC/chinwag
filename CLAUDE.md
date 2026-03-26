# chinwag: Development Guide

**Primary docs:**

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): system design, code map, data flow, design decisions
- [`docs/ROADMAP.md`](docs/ROADMAP.md): what to build next, concrete tasks
- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md): dev setup, code style, PR process
- [`SECURITY.md`](SECURITY.md): vulnerability reporting, threat model, safe harbor

## Architecture

Monorepo with four packages:

- **`packages/mcp/`:** MCP server (the core product). Runs locally alongside each AI agent. Reports activity, checks conflicts, reads/writes shared memory. Stdio transport. Never `console.log`.
- **`packages/worker/`:** Cloudflare Workers backend. Durable Objects for team coordination (TeamDO), data (DatabaseDO), chat rooms (RoomDO), presence (LobbyDO). KV for auth token lookups only.
- **`packages/cli/`:** TUI dashboard and setup. Handles `chinwag init`, `chinwag add`, agent dashboard, tool discovery. Node.js CLI built with Ink (React for terminals). Entry: `cli.jsx`, screens in `lib/`. Built with esbuild to `dist/cli.js`. Requires Node 22+ (native WebSocket).
- **`packages/web/`:** Web presence at chinwag.dev. Landing page plus authenticated dashboard (static HTML/CSS/JS on Cloudflare Pages). Cross-project workflow visibility, tool discovery, and team management.

**Live API:** `https://chinwag-api.glendonchin.workers.dev`

## Development Principles

### Smart infrastructure over manual maintenance

Do not solve problems with static lists, hardcoded values, or patterns that require ongoing manual curation. Build systems that scale themselves.

**Example (content moderation):** Two-layer system in `packages/worker/src/moderation.js`:

- **Layer 1 (blocklist):** Static regex patterns for obvious slurs. Instant, zero-latency. This is the fallback, not the strategy. Do not grow this list; improve the AI layer instead.
- **Layer 2 (AI):** Llama Guard 3 (`@cf/meta/llama-guard-3-8b`) on Cloudflare Workers AI. Outperforms OpenAI Moderation API on real-world benchmarks. No external API key, runs on CF edge, customizable taxonomy. Bound as `env.AI` in wrangler.toml.
- **Why not OpenAI Moderation?** Fixed categories, can't customize, external dependency, over-moderates counter-speech, under-moderates implicit hate. Llama Guard is strictly better for our use case.
- **Architecture:** Blocklist runs first (sync, <1ms). AI runs second (async). For status, both layers run before persisting. For chat, blocklist runs inline; AI moderation for chat can be added async (broadcast, then retract if flagged) when needed.

This same principle applies everywhere: prefer intelligent systems over growing config files.

### Vision: The control layer for agentic development

chinwag is the control layer for agentic development. One command connects all your AI coding tools into a unified system: shared memory, live coordination, conflict prevention, workflow visibility. It works across every MCP-compatible tool, across team members, and across projects.

#### The five pillars

1. **Connect:** `npx chinwag init` detects tools, writes configs, hooks everything up. `chinwag add <tool>` expands. One command, all tools unified.
2. **Remember:** Agents share a brain. Knowledge compounds across tools, sessions, and teammates. What one agent learns, every agent knows next session.
3. **Coordinate:** Live awareness of every agent across every tool. Conflict prevention enforced on Claude Code, advisory everywhere else. No platform does cross-tool coordination the way chinwag does.
4. **Discover:** See your full AI workflow. Browse AI dev tools. See what fits your stack. Add with one action from TUI or web.
5. **Observe:** See what agents are doing, how long they've been at it, where they're stuck, what they've accomplished. Across all tools and projects.

#### Who it's for (ICP)

**Solo developers with multiple AI tools.** You run Claude Code and Cursor on the same project, maybe Aider for quick fixes, across 2-3 active projects. You want your tools to share context instead of duplicating work, and one place to see your entire AI workflow across all projects.

**Small teams (2-5 devs) where everyone has agents.** Your team works on the same repo. Each person uses their preferred tools. Agents collide on files, duplicate discoveries, and waste time. You need cross-tool, cross-teammate coordination without changing how anyone works. The `.chinwag` file gets committed. When a teammate runs `chinwag init`, they auto-join the same team.

**Team leads who need workflow visibility.** You want to see which AI tools your team is using, where agents are getting stuck, whether coordination is working. chinwag gives you the dashboard.

#### How it works

`npx chinwag init` detects installed tools via a declarative registry (`packages/cli/lib/tools.js`) and writes MCP config files for each. `npx chinwag add <tool>` adds new tools. The TUI discover screen fetches the full tool catalog from the API (`GET /tools/catalog`). The catalog is maintained in the worker, not hardcoded in the CLI. The web dashboard gives you cross-project visibility. The MCP server runs invisibly alongside each agent. After init, it just works.

**Teams, same repo:** Each project has a `.chinwag` file (committed to git) that identifies the team. When any teammate runs `chinwag init`, they auto-join. From that point, every agent across every teammate shares memory, sees who is editing what, and gets conflict prevention. The team lead sees the full picture in the dashboard.

**Solo dev, multiple projects:** One chinwag account (`~/.chinwag/config.json`) spans all projects. Each project has its own team and memory. The web dashboard shows your full AI workflow across all projects: which agents are running where, what they are working on, where things are stuck.

**Why no platform will build this:** GitHub Agent HQ coordinates agents inside GitHub. Claude Code Agent Teams coordinates inside Claude Code. Cursor's multi-agent coordinates inside Cursor. No platform is incentivized to build cross-tool coordination; it would help their competitors. chinwag is the neutral layer.

## Commands

```bash
# CLI
cd packages/cli && npm run build    # Build CLI
cd packages/cli && npm run dev      # Build + run CLI

# Worker
cd packages/worker && npx wrangler dev     # Local dev server
npx wrangler deploy                         # Deploy to production (from worker dir)

# From repo root
npm run dev:cli      # Dev CLI
npm run dev:worker   # Dev worker
npm run deploy       # Deploy worker
```

## Code Quality Standards

Every change must pass these checks. These are not aspirational; they are blockers.

### Security

- **Every read endpoint must verify the caller has access.** If data is scoped to a team, room, or user, check membership before returning it. Never assume the URL is proof of authorization. Unauthenticated reads are bugs.
- **Every write endpoint must validate and sanitize input.** Accept only known fields. Cap string lengths. Ensure arrays contain the expected types. Reject unexpected shapes. No raw body passthrough to storage.
- **Every creation endpoint must be rate-limited.** If a user can create unbounded resources (teams, accounts, notes), add a per-user or per-IP daily limit. Use `db.checkRateLimit(key, maxPerDay)`; the `account_limits` table handles all per-day rate limits.
- **Never expose internal IDs, DO names, or server internals** in API responses. Return only what the client needs.

### Robustness

- **Keep time logic in one domain.** When working with SQLite timestamps, use SQLite's `datetime('now', '-60 seconds')` for comparisons, not JS `Date` math converted to strings. Mixing time domains causes silent bugs when formats or timezones drift.
- **Normalize data on write, not read.** File paths, tags, handles: normalize once when storing, so every read is clean. `normalizePath()` in team.js is the pattern.
- **One query over two.** If you can UPDATE and check the result in one step (`SELECT changes()`), don't SELECT then UPDATE. Fewer round trips, no race window.
- **Idempotent schema initialization.** Every DO uses `#ensureSchema()` with `CREATE TABLE IF NOT EXISTS`. Guard with a `#schemaReady` flag so it runs once per instance.

### Patterns to follow

- **DO RPC, not fetch.** All Durable Object communication uses native RPC (direct method calls), not HTTP fetch. `await db.someMethod(args)`, not `await db.fetch(new Request(...))`.
- **Error returns, not throws.** DO methods return `{ ok: true }` or `{ error: 'message' }`. Route handlers check for `.error` and return the appropriate HTTP status. Throws are for unexpected failures only.
- **Handlers validate, DOs trust.** Input validation (type checking, length caps, sanitization) happens in the route handler. DO methods assume clean input. This keeps DOs focused on data logic.
- **MCP server: never `console.log`.** Stdio transport uses stdout for JSON-RPC. Any `console.log` corrupts the protocol. Use `console.error` for all logging.

## Key Design Decisions

- **MCP server is the product, not the CLI:** value delivered invisibly through agent connections
- **Three surfaces, one backend:** MCP server (agents), TUI (terminal users), web dashboard (visual workflow management). All hit the same API.
- **`chinwag init` writes config for all detected tools:** zero-friction, one command setup
- **Claude Code gets deepest integration** (hooks + channels = enforceable). Other tools get MCP-based awareness. Depth increases as tools add hook-like capabilities.
- **TeamDO is the coordination hub:** one instance per team, single-writer for conflict detection
- **One team per project, one account across projects:** `.chinwag` file scopes team to repo, `~/.chinwag/config.json` gives the user a cross-project identity
- Handle format: 3-20 chars, alphanumeric + underscores, globally unique
- 12-color palette: red, cyan, yellow, green, magenta, blue, orange, lime, pink, sky, lavender, white

### Non-goals
- chinwag is not an agent orchestrator (it does not spawn, assign, or manage agent processes; it coordinates agents already running in their native tools)
- chinwag is not a standalone APM/observability platform (observation supports the workflow, not a separate product)
- chinwag is not a community platform (chat exists but is secondary)
- chinwag is not a replacement for CLAUDE.md or AGENTS.md (those are per-tool static instructions; chinwag is dynamic shared memory and real-time coordination)
- chinwag is not an MCP server registry (Smithery/Glama do that; chinwag's discover pillar is about AI dev tools for your workflow)

### Chat (secondary)
- No "room" jargon exposed to users; chat just says "N devs here"
- Status line: use a simple separator, not a "Working on:" prefix

# chinwag — Development Guide

**Primary docs:**

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, code map, data flow, design decisions
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what to build next, concrete tasks
- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) — dev setup, code style, PR process
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting, threat model, safe harbor

## Architecture

Monorepo with four packages:

- **`packages/cli/`** — Node.js CLI built with Ink (React for terminals). Entry: `cli.jsx`, screens in `lib/`. Built with esbuild → `dist/cli.js`. Requires Node 22+ (native WebSocket).
- **`packages/worker/`** — Cloudflare Workers backend. Durable Objects for data (DatabaseDO), chat rooms (RoomDO), presence (LobbyDO), and team coordination (TeamDO). KV for auth token lookups only.
- **`packages/mcp/`** — MCP server for agent connection. Runs locally on the developer's machine, wraps the REST API. Reads `~/.chinwag/config.json` for auth (same token as CLI).
- **`packages/web/`** — Landing page at chinwag.dev. Static HTML/CSS/JS on Cloudflare Pages.

**Live API:** `https://chinwag-api.glendonchin.workers.dev`

## Development Principles

### Smart infrastructure over manual maintenance

Do not solve problems with static lists, hardcoded values, or patterns that require ongoing manual curation. Build systems that scale themselves.

**Example — Content moderation:** Two-layer system in `packages/worker/src/moderation.js`:

- **Layer 1 (blocklist):** Static regex patterns for obvious slurs. Instant, zero-latency. This is the fallback, not the strategy. Do not grow this list — improve the AI layer instead.
- **Layer 2 (AI):** Llama Guard 3 (`@cf/meta/llama-guard-3-8b`) on Cloudflare Workers AI. Outperforms OpenAI Moderation API on real-world benchmarks. No external API key, runs on CF edge, customizable taxonomy. Bound as `env.AI` in wrangler.toml.
- **Why not OpenAI Moderation?** Fixed categories, can't customize, external dependency, over-moderates counter-speech, under-moderates implicit hate. Llama Guard is strictly better for our use case.
- **Architecture:** Blocklist runs first (sync, <1ms). AI runs second (async). For notes/status, both layers run before persisting. For chat, blocklist runs inline; AI moderation for chat can be added async (broadcast, then retract if flagged) when needed.

This same principle applies everywhere: prefer intelligent systems over growing config files.

### Vision: Your dev home in the terminal

chinwag is two things in one terminal: an agent dashboard and a developer community.

**Agent dashboard:** Connect all your AI agents (Claude Code, Codex, Cursor — anything that speaks MCP). See what each is doing, prevent conflicts when they touch the same files, and build up project knowledge across sessions so agents stop re-discovering the same things. Works solo. Works with your team.

**Developer community:** Chat with other developers without leaving your terminal. Post a daily note about what you're building to unlock chat and get someone else's note back. No doomscrolling, no algorithms.

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

Every change must pass these checks. These are not aspirational — they are blockers.

### Security

- **Every read endpoint must verify the caller has access.** If data is scoped to a team, room, or user — check membership before returning it. Never assume the URL is proof of authorization. Unauthenticated reads are bugs.
- **Every write endpoint must validate and sanitize input.** Accept only known fields. Cap string lengths. Ensure arrays contain the expected types. Reject unexpected shapes. No raw body passthrough to storage.
- **Every creation endpoint must be rate-limited.** If a user can create unbounded resources (teams, accounts, notes), add a per-user or per-IP daily limit. Use the existing `account_limits` table pattern.
- **Never expose internal IDs, DO names, or server internals** in API responses. Return only what the client needs.

### Robustness

- **Keep time logic in one domain.** When working with SQLite timestamps, use SQLite's `datetime('now', '-60 seconds')` for comparisons — not JS `Date` math converted to strings. Mixing time domains causes silent bugs when formats or timezones drift.
- **Normalize data on write, not read.** File paths, tags, handles — normalize once when storing, so every read is clean. `normalizePath()` in team.js is the pattern.
- **One query over two.** If you can UPDATE and check the result in one step (`SELECT changes()`), don't SELECT then UPDATE. Fewer round trips, no race window.
- **Idempotent schema initialization.** Every DO uses `#ensureSchema()` with `CREATE TABLE IF NOT EXISTS`. Guard with a `#schemaReady` flag so it runs once per instance.

### Patterns to follow

- **DO RPC, not fetch.** All Durable Object communication uses native RPC (direct method calls), not HTTP fetch. `await db.someMethod(args)`, not `await db.fetch(new Request(...))`.
- **Error returns, not throws.** DO methods return `{ ok: true }` or `{ error: 'message' }`. Route handlers check for `.error` and return the appropriate HTTP status. Throws are for unexpected failures only.
- **Handlers validate, DOs trust.** Input validation (type checking, length caps, sanitization) happens in the route handler. DO methods assume clean input. This keeps DOs focused on data logic.
- **MCP server: never `console.log`.** Stdio transport uses stdout for JSON-RPC. Any `console.log` corrupts the protocol. Use `console.error` for all logging.

## Key Design Decisions

- No editing posts — once posted, it's permanent for the day
- Feed and chat open to lurkers — only inbox gated behind posting
- No "room" jargon exposed to users — chat just says "N devs here"
- Status shown with em dash, no "Working on:" prefix
- 12-color palette: red, cyan, yellow, green, magenta, blue, orange, lime, pink, sky, lavender, white
- Handle format: 3-20 chars, alphanumeric + underscores, globally unique
- Daily reset at 00:00 UTC

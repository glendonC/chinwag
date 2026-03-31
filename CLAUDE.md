# chinwag: Development Guide

**Primary docs:**

- [`docs/VISION.md`](docs/VISION.md): product vision, positioning, ICP, differentiation
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): system design, code map, data flow, design decisions
- [`docs/ROADMAP.md`](docs/ROADMAP.md): what to build next, concrete tasks
- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md): dev setup, code style, PR process
- [`SECURITY.md`](SECURITY.md): vulnerability reporting, threat model, safe harbor

## Architecture

Monorepo with five packages:

- **`packages/mcp/`:** MCP server (the core product). Runs locally alongside each AI agent. Reports activity, checks conflicts, reads/writes shared memory. Stdio transport. Never `console.log`.
- **`packages/worker/`:** Cloudflare Workers backend. Durable Objects for team coordination (TeamDO), data (DatabaseDO), chat rooms (RoomDO), presence (LobbyDO). KV for auth token lookups only.
- **`packages/cli/`:** TUI dashboard and setup. Handles `chinwag init`, `chinwag add`, agent dashboard, tool discovery. Node.js CLI built with Ink (React for terminals). Entry: `cli.jsx`, screens in `lib/`. Built with esbuild to `dist/cli.js`. Requires Node 22+ (native WebSocket).
- **`packages/shared/`:** Shared primitives reused across packages. Tool registry, agent identity, API client factory, session registry. Dependency-light, no grab bags.
- **`packages/web/`:** Web presence at chinwag.dev. React 19 + Vite SPA on Cloudflare Pages. Landing page (`index.html`) plus authenticated dashboard (`dashboard.html`) with Zustand state management and CSS Modules. Cross-project workflow visibility, tool discovery, and team management.

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

### Model-agnostic coordination infrastructure

chinwag provides the network, shared state, and coordination primitives — agents bring the intelligence. Primitives are freeform and unopinionated so they scale as models get smarter, not against them. Memory uses freeform tags, not fixed categories. Search returns results by recency — agents are the semantic ranker. Conflict detection surfaces data — agents decide what to do with it.

For product vision, positioning, ICP, and differentiation, see [`docs/VISION.md`](docs/VISION.md).

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
- **Normalize data on write, not read.** File paths, tags, handles: normalize once when storing, so every read is clean. `normalizePath()` in `lib/text-utils.js` is the pattern.
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

See [`docs/VISION.md`](docs/VISION.md) for the full list. Key ones for development: chinwag is not an agent orchestrator, not a standalone APM, and not an MCP server registry.

### Chat (secondary)
- No "room" jargon exposed to users; chat just says "N devs here"
- Status line: use a simple separator, not a "Working on:" prefix

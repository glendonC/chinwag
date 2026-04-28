# chinmeister: Development Guide

**Primary docs:**

- [`docs/VISION.md`](docs/VISION.md): product vision, positioning, ICP, differentiation
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): system design, code map, data flow, design decisions
- [`docs/ROADMAP.md`](docs/ROADMAP.md): what to build next, concrete tasks
- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md): dev setup, code style, PR process
- [`SECURITY.md`](SECURITY.md): vulnerability reporting, threat model, safe harbor

## Architecture

Monorepo with five packages:

- **`packages/mcp/`:** MCP server (the core product). Runs locally alongside each AI agent. Reports activity, checks conflicts, reads/writes shared memory. Stdio transport. Never `console.log`.
- **`packages/worker/`:** Cloudflare Workers backend. Durable Objects for team coordination (TeamDO), data (DatabaseDO), and global presence (LobbyDO). KV for auth token lookups only.
- **`packages/cli/`:** TUI dashboard and setup. Handles `chinmeister init`, `chinmeister add`, agent dashboard, tool discovery. Node.js CLI built with Ink (React for terminals). Entry: `cli.jsx`, screens in `lib/`. Built with esbuild to `dist/cli.js`. Requires Node 22+ (native WebSocket).
- **`packages/shared/`:** Shared primitives reused across packages. Tool registry, agent identity, API client factory, session registry. Dependency-light, no grab bags.
- **`packages/web/`:** Web presence at chinmeister.com. React 19 + Vite SPA on Cloudflare Pages. Landing page (`index.html`) plus authenticated dashboard (`dashboard.html`) with Zustand state management and CSS Modules. Cross-project workflow visibility, tool discovery, and team management.

**Live API:** `https://api.chinmeister.com`

## Development Principles

### Maintainable infrastructure

Prefer systems that scale with usage over static lists, hardcoded values, or patterns that require ongoing manual curation.

**Example (content moderation):** Two-layer system in `packages/worker/src/moderation.js`:

- Layer 1 is a blocklist of static regex patterns for obvious slurs. It is fast and zero-latency, but it is the fallback. Do not grow this list as the main strategy.
- Layer 2 is Llama Guard 3 (`@cf/meta/llama-guard-3-8b`) on Cloudflare Workers AI. It does not require an external API key, runs on the Cloudflare edge, and supports a customizable taxonomy. It is bound as `env.AI` in `wrangler.toml`.
- OpenAI Moderation is not used because its fixed categories are a poor fit for this product and it adds an external dependency.
- The blocklist runs first, synchronously in under 1 ms. AI moderation runs second, asynchronously. For status text and team names, both layers run before persistence.

Apply this pattern elsewhere when appropriate: improve the underlying system instead of adding long-term manual maintenance.

### Model-agnostic coordination infrastructure

chinmeister provides the network, shared state, and coordination primitives. Agents bring the intelligence. Primitives are freeform and unopinionated so they scale as models improve. Memory uses freeform tags, not fixed categories. Search returns results by recency, and agents decide how to rank them semantically. Conflict detection surfaces data, and agents decide what to do with it.

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

- Every read endpoint must verify that the caller has access. If data is scoped to a team, room, or user, check membership before returning it. Never assume the URL is proof of authorization. Unauthenticated reads are bugs.
- Every write endpoint must validate and sanitize input. Accept only known fields. Cap string lengths. Ensure arrays contain the expected types. Reject unexpected shapes. Do not pass raw request bodies through to storage.
- Every creation endpoint must be rate-limited. If a user can create unbounded resources (teams, accounts, notes), add a per-user or per-IP daily limit. Use `db.checkRateLimit(key, maxPerDay)`; the `account_limits` table handles all per-day rate limits.
- Never expose internal IDs, DO names, or server internals in API responses. Return only what the client needs.

### Robustness

- Keep time logic in one domain. When working with SQLite timestamps, use SQLite's `datetime('now', '-60 seconds')` for comparisons, not JS `Date` math converted to strings. Mixing time domains causes silent bugs when formats or timezones drift.
- Normalize data on write, not read. File paths, tags, and handles should be normalized once when stored so every read is clean. `normalizePath()` in `lib/text-utils.js` is the pattern.
- Prefer one query over two. If you can update and check the result in one step (`SELECT changes()`), do not select and then update. This avoids an extra round trip and a race window.
- Schema initialization should be idempotent. Every DO uses `#ensureSchema()` with `CREATE TABLE IF NOT EXISTS`. Guard with a `#schemaReady` flag so it runs once per instance.

### Patterns to follow

- Use DO RPC instead of fetch for Durable Object communication. Call methods directly, for example `await db.someMethod(args)`, instead of `await db.fetch(new Request(...))`. The WebSocket upgrade in `routes/team/membership.ts` is the exception because Cloudflare's Hibernation API exposes WebSockets through a fetch-shaped entry point. The worker sets `X-Chinmeister-Verified: 1` on the internal request and `TeamDO.fetch` trusts it. Every other code path is RPC.
- DO methods return `{ ok: true }` or `{ error: 'message' }` instead of throwing for expected failures. Route handlers check for `.error` and return the appropriate HTTP status. Throws are for unexpected failures only.
- Route handlers validate inputs, and DO methods trust validated shapes with a small amount of defense in depth for persisted free text. Handlers perform type checks, length caps, and sanitization. DOs still cap directly persisted free-text fields, for example `tool.slice(0,100)` and `error_preview.slice(0,200)` in `dos/team/sessions.ts`, and reject unknown enum values on outcomes and moderation categories.
- The MCP server must never call `console.log`. Stdio transport uses stdout for JSON-RPC, so any `console.log` corrupts the protocol. Use `console.error` for all logging. ESLint enforces this with `no-console` as `error` for the MCP package.

### Comments and documentation

The full standard is in [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md#comments-and-documentation). Two rules trip people up most often. Do not reference private, gitignored files from a comment, doc, or user-visible string, because those references are dead to anyone reading the public repo. Do not use em-dashes anywhere; use commas, periods, colons, hyphens, or parentheses depending on context.

## Key Design Decisions

- **MCP server is the product, not the CLI:** value delivered invisibly through agent connections
- **Three surfaces, one backend:** MCP server (agents), TUI (terminal users), web dashboard (visual workflow management). All hit the same API.
- **`chinmeister init` writes config for all detected tools:** zero-friction, one command setup
- **Claude Code gets deepest integration** (hooks + channels = enforceable). Other tools get MCP-based awareness. Depth increases as tools add hook-like capabilities.
- **Four-tier analytics model:** Agent-level (observe/measure/control individual sessions), project-level (activity in this codebase, scoped by `.chinmeister`), developer-level (personal AI performance across projects and tools), team-level (manage a team of developers and their agents). Analytics endpoints mirror this: session detail, `GET /teams/:tid/analytics` (project scope), `GET /me/analytics` (developer scope), team-scoped analytics with `member_analytics`. Every session captures duration, edits, files, tokens, cost, conflicts, outcome, and conversation events. Hook-enabled tools (Claude Code) provide automatic granular capture; MCP-only tools provide coordination data.
- **TeamDO is the coordination hub:** one instance per team, single-writer for conflict detection
- **One team per project, one account across projects:** `.chinmeister` file scopes team to repo, `~/.chinmeister/config.json` gives the user a cross-project identity
- Handle format: 3-20 chars, alphanumeric + underscores, globally unique
- 12-color palette: red, cyan, yellow, green, magenta, blue, orange, lime, pink, sky, lavender, white

### Non-goals

See [`docs/VISION.md`](docs/VISION.md) for the full list. Key ones for development: chinmeister is not an agent orchestrator, not a standalone APM, and not an MCP server registry.

### Status line

- Use a simple separator, not a "Working on:" prefix

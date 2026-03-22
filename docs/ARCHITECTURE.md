# Architecture

chinwag is your dev home in the terminal. It has two sides: an agent dashboard that lets you manage all your AI agents (Claude Code, Codex, Cursor — anything MCP-compatible) from one place, and a developer community where you chat with other devs without leaving the terminal. Project knowledge persists across agent sessions. The backend runs entirely on Cloudflare's edge.

This document is the map. It explains what each piece does, where it lives, and why we made the choices we did. Read this before diving into the code.

## System Context

```
┌─────────────────────────────────────────────────────────┐
│                      chinwag                            │
│                                                         │
│  ┌─────────┐   HTTPS/WSS   ┌──────────────────────┐   │
│  │   CLI   │ ◄────────────► │  Cloudflare Workers  │   │
│  │ (terminal│               │  (API + WebSocket)   │   │
│  │  client) │               └──────────┬───────────┘   │
│  └─────────┘                           │               │
│                              ┌─────────┴─────────┐     │
│                              │  Durable Objects   │     │
│                              │  (state + compute) │     │
│                              └─────────┬─────────┘     │
│                              ┌─────────┴─────────┐     │
│  ┌─────────┐                 │  Cloudflare KV     │     │
│  │   Web   │                 │  (token lookups)   │     │
│  │ (landing │                └───────────────────┘     │
│  │  page)  │                 ┌───────────────────┐     │
│  └─────────┘                 │  Workers AI        │     │
│                              │  (Llama Guard 3)   │     │
│                              └───────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

**Users** interact exclusively through the terminal CLI or the web landing page. There is no browser-based app for the core features.

**External dependencies** are limited to Cloudflare's platform: Workers (compute), Durable Objects (state), KV (auth lookups), Workers AI (content moderation), and Pages (static hosting). There are no external databases, no Redis, no third-party APIs.

## Containers

The monorepo has three deployable units:

### `packages/cli/` — Terminal Client

- **Technology:** Node.js 22+, Ink (React for terminals), esbuild
- **Entry point:** `cli.jsx` — screen router
- **Responsibility:** All user interaction. Renders screens, handles input, manages local config (`~/.chinwag/config.json`). Communicates with the worker over HTTPS (REST) and WSS (chat).
- **Key constraint:** The CLI has no knowledge of Durable Objects, room IDs, or server internals. It speaks only the public HTTP/WebSocket API.

### `packages/worker/` — Backend API

- **Technology:** Cloudflare Workers, Durable Objects (SQLite), KV, Workers AI
- **Entry point:** `src/index.js` — HTTP router and auth middleware
- **Responsibility:** Authentication, data persistence, content moderation, real-time chat, presence tracking. All business logic lives here.
- **Key constraint:** Stateless at the Worker level. All persistent state lives in Durable Objects. The Worker is a router that authenticates requests and forwards them to the appropriate DO.

### `packages/web/` — Landing Page

- **Technology:** Static HTML/CSS/JS on Cloudflare Pages
- **Entry point:** `index.html`
- **Responsibility:** Marketing, install instructions, live stats display. Fetches from the public `/stats` endpoint.
- **Key constraint:** No build step, no framework. Intentionally simple.

## Code Map

### Worker (`packages/worker/src/`)

| File | Responsibility |
|---|---|
| `index.js` | HTTP router. Matches request paths to handlers. Runs Bearer token auth on protected routes via KV lookup. Bridges HTTP/WebSocket to Durable Objects. |
| `db.js` | `DatabaseDO` — single instance holding all persistent data. Users, notes, exchanges, rate limits. SQLite storage. Implements the note exchange matching algorithm. |
| `lobby.js` | `LobbyDO` — single instance managing room assignment and global presence. Tracks active rooms and their sizes. Assigns users to rooms targeting ~20 people. Heartbeat-based presence with 60s TTL. |
| `room.js` | `RoomDO` — one instance per chat room. Holds WebSocket connections, broadcasts messages, maintains last 50 messages as history. Enforces per-user rate limits (10 msg/min) and message length (280 chars). |
| `moderation.js` | Two-layer content filter. Layer 1: synchronous regex blocklist (<1ms). Layer 2: async AI moderation via Llama Guard 3. Exports `checkContent()` for notes/status and `isBlocked()` for inline chat filtering. |
| `team.js` | `TeamDO` — one instance per team. Manages team membership, agent activity tracking, and file conflict detection for multi-agent coordination. |

### CLI (`packages/cli/`)

| File | Responsibility |
|---|---|
| `cli.jsx` | App shell. Manages screen state machine: loading → welcome → home → {post, inbox, feed, chat, customize}. Loads/validates config on startup. |
| `lib/home.jsx` | Home screen. Menu with single-key navigation. Displays greeting, status, online count. 30s heartbeat to presence endpoint. |
| `lib/post.jsx` | Note composition. Text input with 280-char counter. One post per day enforced server-side. |
| `lib/inbox.jsx` | Inbox viewer. Three states: locked (haven't posted), waiting (no match yet), ready (note received). |
| `lib/feed.jsx` | Global feed. Cursor-based pagination, arrow-key scrolling, 20 notes per page. |
| `lib/chat.jsx` | Live chat. WebSocket connection with exponential backoff reconnect (1s→15s cap). Room shuffle via `[n]` key. Shows last 15 messages. |
| `lib/customize.jsx` | Profile editor. Change handle, cycle through 12-color palette, set status. |
| `lib/api.js` | HTTP client. Wraps fetch with Bearer token auth. All API calls go through this. |
| `lib/colors.js` | Maps chinwag's 12 colors to ANSI terminal colors for Ink rendering. |
| `lib/config.js` | Reads/writes `~/.chinwag/config.json`. Token, handle, color. |

## Data Flow

### Authentication

1. User runs `npx chinwag` for the first time
2. CLI calls `POST /auth/init` (no auth required)
3. Worker creates user in DatabaseDO: generates UUID, token, random two-word handle, random color
4. Worker writes `token:{uuid} → user_id` to KV
5. CLI saves `{token, handle, color}` to `~/.chinwag/config.json`
6. All subsequent requests include `Authorization: Bearer {token}`
7. Worker validates token via KV lookup on every protected request

### Posting a Note and Exchange Matching

1. User writes note in CLI, hits Enter
2. CLI calls `POST /notes` with `{message}`
3. Worker authenticates, runs content through both moderation layers
4. If clean, DatabaseDO persists note and runs `#matchExchange`:
   - Find other users who posted today and haven't been matched with this user
   - Randomly select one, create bidirectional exchange records
5. User can now access `GET /notes/inbox` to see their received note

### Chat (WebSocket)

1. CLI calls `GET /ws/chat` with Bearer token
2. Worker authenticates, asks LobbyDO for room assignment
3. LobbyDO picks room closest to 20 users (or creates new room if all ≥30)
4. Worker forwards WebSocket upgrade to the assigned RoomDO
5. RoomDO accepts connection, sends message history + room count
6. RoomDO broadcasts join notification to all participants
7. Each message from client: validate → rate limit check → blocklist check → broadcast to room
8. On disconnect: remove session, broadcast leave, update Lobby room count

### Presence

1. CLI home screen sends `POST /presence/heartbeat` every 30 seconds
2. Worker forwards to LobbyDO, which updates handle→timestamp map
3. `GET /stats` queries LobbyDO, which counts entries with timestamp < 60s old
4. Stale entries cleaned on each stats query

## Key Design Decisions

**Durable Objects over external databases.** Each DO provides single-threaded coordination with embedded SQLite, eliminating the need for external database connections, connection pooling, or cache invalidation. State and compute are colocated at the edge. Trade-off: single-instance bottleneck for DatabaseDO, but adequate for our scale (single-digit-thousands DAU target).

**Single DatabaseDO instance.** All user data, notes, and exchanges live in one DO. This simplifies transactions (exchange matching must be atomic) at the cost of vertical scaling. If chinwag grows past ~5K DAU, this is the first thing to shard — likely by splitting read-heavy operations (feed) from write-heavy ones (posting, matching).

**Two-layer moderation over single-layer.** Blocklist catches obvious slurs instantly (<1ms, zero cost). AI catches context-dependent toxicity that regex never will. The blocklist is a fallback, not the strategy — it should not grow. If something slips through the blocklist, improve the AI layer. See `CLAUDE.md` for the full rationale.

**Llama Guard 3 over OpenAI Moderation API.** Runs on Cloudflare's edge (no external API call), customizable taxonomy (14 categories vs. OpenAI's fixed set), outperforms on implicit hate and counter-speech. No API key to manage.

**KV for auth only.** KV is eventually consistent, which is fine for token→user_id lookups (tokens are write-once). All other data lives in Durable Objects where we need strong consistency. Adding new KV use cases should be a deliberate decision.

**No editing posts.** Once a note is posted, it's permanent for the day. This is a product decision (authenticity, no anxiety-editing) that also simplifies the data model and moderation — we moderate once on write, never on update.

**Room auto-sizing.** Rooms target 20 users, create new rooms at 30, and don't shuffle users into rooms under 5. This creates the "drop-in" feel (always someone to talk to) without overwhelming noise. The constants live in `lobby.js`.

## Architectural Invariants

These are constraints that should be preserved as the codebase evolves:

- **CLI ↔ Worker boundary is the public API.** The CLI must never depend on server internals (DO class names, room IDs, internal data formats). If the CLI needs something, it should be a documented API endpoint.
- **Durable Objects own their data.** No external system reads DO storage directly. All access goes through the DO's fetch handler. This preserves the single-writer guarantee.
- **Moderation runs before persistence.** For notes and status, content must pass both moderation layers before being written to SQLite. For chat, blocklist runs inline; AI moderation can be added async (broadcast then retract) when needed.
- **Worker is stateless.** No request-scoped state in module-level variables. Workers reuse V8 isolates across requests — global state causes cross-request data leaks.
- **KV is append-only for auth.** Token mappings are written once at account creation and never updated. This invariant keeps auth lookups safe despite KV's eventual consistency.

## Crosscutting Concerns

### Content Moderation

Applies to notes, chat messages, and status text. Two layers:

1. **Blocklist** (`moderation.js:isBlocked`) — synchronous regex scan. Returns immediately. Used inline for chat where latency matters.
2. **AI** (`moderation.js:moderateWithAI`) — async call to Llama Guard 3 via `env.AI`. Returns category codes (S1–S14). Used before persisting notes/status.

`checkContent()` runs both layers sequentially and returns `{blocked, reason, categories}`.

### Authentication

Every protected endpoint follows the same flow in `index.js`:

1. Extract Bearer token from Authorization header
2. Look up `token:{value}` in KV → get `user_id`
3. Fetch full user object from DatabaseDO
4. Pass `user` to the route handler

No middleware framework — it's a simple `if/else` chain with early returns.

### Daily Reset

Notes, exchanges, and inbox access are scoped to the current UTC date (`YYYY-MM-DD`). At midnight UTC, today's queries automatically return empty results. There is no cron job or cleanup process — the date filter handles the reset.

### Error Handling

Workers return structured JSON errors: `{error: "message"}` with appropriate HTTP status codes. The CLI displays error messages to the user. No stack traces leak to clients.

## Technology Choices

| Technology | Used For | Why This Over Alternatives |
|---|---|---|
| Cloudflare Workers | HTTP API, WebSocket handling | Edge compute, no cold starts, native WebSocket support, free tier |
| Durable Objects (SQLite) | Persistent state, coordination | Colocated state+compute, transactional, no external DB needed |
| Cloudflare KV | Auth token lookups | Global low-latency reads, perfect for read-heavy/write-once data |
| Workers AI (Llama Guard 3) | Content moderation | On-edge inference, customizable taxonomy, no external API key |
| Ink (React for terminals) | CLI rendering | Component model for terminal UIs, hooks, familiar React patterns |
| esbuild | CLI bundling | Fast, zero-config ESM bundling |
| Cloudflare Pages | Landing page hosting | Static hosting with global CDN, same platform as backend |

## WebSocket Protocol

All messages are JSON. The protocol is intentionally minimal.

**Client → Server:**

```json
{"type": "message", "content": "hello world"}
```

**Server → Client:**

```json
// On join — history + current room size
{"type": "history", "messages": [...], "roomCount": 5}

// User events
{"type": "join", "handle": "quietpixel", "color": "cyan", "roomCount": 6}
{"type": "leave", "handle": "quietpixel", "color": "cyan", "roomCount": 5}

// Chat message
{"type": "message", "handle": "quietpixel", "color": "cyan", "content": "hello", "timestamp": "2026-03-20T12:00:00.000Z"}

// System notification (rate limits, etc.)
{"type": "system", "content": "Slow down — max 10 messages per minute."}
```

The message types, format, and semantics should be treated as a stable interface. The protocol will extend to support agent-to-agent messages as the agent layer is built.

## Future Direction

chinwag has two sides:

**Agent dashboard:** Connect all your AI agents via MCP. See what each is working on, get conflict warnings, build up project knowledge that persists across sessions. Works solo (your agents) and with teams (your agents + teammates' agents in one view, with built-in chat for coordination).

**Developer community:** Terminal-native chat and daily note exchange. Post what you're building, get someone else's note back, unlock live chat. The daily note gate ensures content exists even with few users.

**What this means for contributors:**

- The agent dashboard is the primary interface — build features that help developers see and manage their agents
- Keep the WebSocket protocol extensible
- Maintain the CLI ↔ Worker API boundary (agents use the same API as humans via MCP)
- Project memory (persisting knowledge across agent sessions) is the next major feature area

---

*This document follows the [ARCHITECTURE.md convention](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html). It should be updated a few times per year, not per commit. If a section becomes stale, fix it or flag it in an issue.*

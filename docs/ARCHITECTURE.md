# Architecture

This document is the high-level map of chinwag: what we are building, how the pieces fit together, and why we made the choices we did. Read it when you need orientation, not on every commit. It should be updated a few times per year, or when a section goes stale (then fix it or open an issue).

---

For product vision, positioning, ICP, and differentiation, see [VISION.md](VISION.md).

## How to read this doc

This document covers system design: how the pieces fit together, where code lives, and why we made the technical choices we did. The backend runs entirely on Cloudflare's edge. The primary interface is the MCP server that runs alongside each agent, not a CLI or GUI.

## System context

At a glance: AI tools on your machine talk to a local MCP server; that server talks to the worker over HTTPS; state lives in Durable Objects and KV is only for auth lookups. Humans can use the CLI or web dashboard, but agents are the main story. Managed CLI agents can be spawned and controlled by the TUI; connected IDE agents join via MCP and coordinate but manage their own lifecycle.

```mermaid
flowchart TB
  subgraph machine["Developer's machine"]
    direction TB
    TUI[chinwag TUI dashboard]
    T1[Claude Code + hooks + channel]
    T2[Cursor]
    T3[Windsurf, Codex, Aider, VS Code, ...]
    MCP[chinwag MCP server]
    TUI -->|spawn/control| T1
    TUI -->|spawn/control| T3
    T1 --> MCP
    T2 --> MCP
    T3 --> MCP
  end

  subgraph cloud["Cloudflare"]
    W[Workers API]
    TE[TeamDO]
    DB[DatabaseDO]
    LO[LobbyDO / RoomDO]
    KV[(KV: token lookups)]
    MCP -->|HTTPS| W
    W --> TE
    W --> DB
    W --> LO
    W --> KV
  end

  H[Web dashboard]
  H -.->|optional| W
```

<details>
<summary>Plain-text diagram (same idea)</summary>

```
┌──────────────────────────────────────────────────────────────────┐
│                          chinwag                                 │
│                                                                  │
│  Developer's machine                                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                    │
│  │ Claude Code │  │   Cursor   │  │  Windsurf  │  ...             │
│  │   + hooks   │  │ (connected)│  │ (connected)│  Codex, Aider    │
│  │   + channel │  │            │  │            │  (managed)       │
│  │  (managed)  │  │            │  │            │                  │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘                    │
│         │               │               │                        │
│         └───────┬───────┴───────┬───────┘                        │
│                 ▼               ▼                                 │
│         ┌─────────────────────────┐                              │
│         │   chinwag MCP server    │  (one per agent connection)   │
│         │   reports activity     │                              │
│         │   checks conflicts     │                              │
│         │   reads/writes memory  │                              │
│         └───────────┬─────────────┘                              │
│                     │ HTTPS                                      │
│  ┌────────────┐     ▼                                            │
│  │ TUI dash   │──→ ┌──────────────────────┐                     │
│  │ [n] new    │    │  Cloudflare Workers  │                     │
│  │ [x] stop   │    │  (API + coordination)│                     │
│  └────────────┘    └──────────┬───────────┘                     │
│                    │                                              │
│          ┌─────────┴─────────┐                                   │
│          │  Durable Objects   │                                 │
│          │  TeamDO: coordination, memory, conflict detection     │
│          │  DatabaseDO: users, auth                             │
│          └─────────┬─────────┘                                   │
│          ┌─────────┴─────────┐                                   │
│          │  Cloudflare KV    │                                   │
│          │  (token lookups)  │                                   │
│          └───────────────────┘                                   │
└──────────────────────────────────────────────────────────────────┘
```

</details>

**AI agents** are the primary users. They interact with chinwag through the MCP server that runs alongside each agent session. Developers interact with chinwag indirectly: their agents are smarter because chinwag is connected.

**The TUI dashboard** is the primary human control surface for managing agentic workflows. It shows all agents (managed and connected) in one place, supports messaging, memory management, and agent lifecycle control for managed agents.

**External dependencies** are limited to Cloudflare's platform: Workers (compute), Durable Objects (state), KV (auth lookups), and Pages (static hosting). No external databases, no Redis, no third-party APIs.

## Two-tier agent model

chinwag supports two tiers of agent integration based on how much lifecycle control chinwag has.

### Managed agents (CLI tools)

Claude Code, Codex, Aider, and other CLI-based AI agents. chinwag can spawn these as child processes, track their lifecycle, and provide full control (start, stop, restart, message). When launched via `chinwag run` or `[n]` in the TUI, chinwag owns the process. Agents started independently still auto-connect via MCP and appear in the dashboard, but without process control.

### Connected agents (IDE tools)

Cursor, Windsurf, and other IDE-embedded agents. These join via MCP and get full coordination (shared memory, conflict detection, messaging, file locks). chinwag cannot control their lifecycle — that's the IDE's domain. Control signals are advisory (messages the agent reads and follows).

### Docker Desktop analogy

chinwag follows the Docker Desktop model: agents appear in the dashboard regardless of how they were started. You can run `claude "refactor auth"` from any terminal tab and it shows up in chinwag. Or you can press `[n]` in the TUI to spawn one. Both work. chinwag does not gate your workflow — it enhances it.

### Control mechanisms by tier

| Mechanism | Managed (CLI) | Connected (IDE) |
|-----------|--------------|-----------------|
| Start/stop | Process control | N/A (IDE owns lifecycle) |
| Pause/resume | Hook-based (Claude Code) | Advisory message |
| Messaging | Enforced delivery | Via MCP context |
| File locks | Full | Full |
| Memory | Full | Full |
| Conflict detection | Full | Full |
| Dashboard visibility | Full | Full |

The dashboard shows both tiers in one unified list. Managed agents get stop/restart controls. Connected agents show activity and coordination data. The user does not need to understand the distinction for coordination to work.

## How agents connect

### Setup (one-time per project)

```
npx chinwag init
```

This single command:

1. Creates an account (if first run): generates token, saves to `~/.chinwag/config.json`
2. Creates a team for the project (or joins existing if `.chinwag` file exists)
3. Writes MCP config files for all detected tools (driven by the shared registry in `packages/shared/tool-registry.js`, re-exported through `packages/cli/lib/tools.js`; the broader discover catalog lives in `packages/worker/src/catalog.js` and is served by `GET /tools/catalog`):
   - `.mcp.json`: Claude Code, Codex, Aider, Amazon Q
   - `.cursor/mcp.json`: Cursor
   - `.windsurf/mcp.json`: Windsurf
   - `.vscode/mcp.json`: VS Code (Copilot, Cline, Continue)
   - `.idea/mcp.json`: JetBrains IDEs
4. For Claude Code: configures hooks (`.claude/settings.json`) and channel

The `.chinwag` file is committed to the repo. When a teammate clones and runs `npx chinwag init`, they auto-join the same team.

### Per-tool integration depth

| Tool | Tier | Integration | How |
|------|------|------------|-----|
| **Claude Code** | Managed | Full: push alerts + enforced conflict prevention | Channels push real-time team state. PreToolUse hooks block conflicting edits. SessionStart hook injects team context. Process control when spawned via TUI. |
| **Codex CLI** | Managed | Basic: tool-based + process control | MCP tools available. Process control when spawned via TUI. |
| **Aider** | Managed | Basic: tool-based + process control | MCP tools available. Shares `.mcp.json`. Process control when spawned via TUI. |
| **Cursor** | Connected | Good: pull-based awareness | MCP `instructions` field + tool descriptions guide the agent to check chinwag. Lifecycle owned by IDE. |
| **Windsurf** | Connected | Good: pull-based awareness | MCP tools + instructions. Same integration model as Cursor. Lifecycle owned by IDE. |
| **VS Code Copilot** | Connected | Good: pull-based awareness | MCP tools + instructions. Also covers Cline and Continue extensions. Lifecycle owned by IDE. |
| **JetBrains** | Connected | Basic: tool-based | MCP tools via `.idea/mcp.json`. Lifecycle owned by IDE. |
| **Amazon Q** | Connected | Basic: tool-based | MCP tools available. Shares `.mcp.json`. |

Claude Code gets the deepest integration because it supports hooks (enforceable interception before file edits), channels (server-initiated push), and is a CLI tool (process control). Other tools improve as their MCP implementations mature. Tool detection and MCP config writing are driven by a declarative shared registry (`packages/shared/tool-registry.js`), surfaced through the CLI (`packages/cli/lib/tools.js`); the broader discover catalog is maintained in the worker (`packages/worker/src/catalog.js`).

## TUI as control surface

The TUI dashboard is the primary interface for managing agentic workflows:

- View all agents (managed + connected) in one unified list
- Send messages to individual agents or broadcast to the team
- Search and manage project memory
- Start new managed agents (`[n]` key or `chinwag run`)
- Stop/restart managed agents (`[x]` key on managed agent rows)

The TUI does not replace each tool's native interface. Agents still run in their own terminals or IDEs. The TUI provides the unified view and control layer across all of them.

## Containers

The monorepo has five packages:

### `packages/mcp/`: MCP Server (the core product)

- **Technology:** Node.js, MCP SDK (stdio transport)
- **Entry point:** `index.js`
- **Responsibility:** The primary interface. Runs locally alongside each AI agent. Reports agent activity to the backend, checks for conflicts before file edits, reads/writes shared project memory. Exposes MCP tools and resources that agents use automatically.
- **Key constraint:** Never `console.log`. Stdio transport uses stdout for JSON-RPC. Use `console.error` for all logging.

### `packages/worker/`: Backend API

- **Technology:** Cloudflare Workers, Durable Objects (SQLite), KV, Workers AI
- **Entry point:** `src/index.js` (HTTP router and auth middleware)
- **Responsibility:** Authentication, team coordination, shared memory storage, conflict detection, agent activity tracking. All business logic lives here.
- **Key constraint:** Stateless at the Worker level. All persistent state lives in Durable Objects. The Worker is a router that authenticates requests and forwards them to the appropriate DO.

### `packages/cli/`: TUI Dashboard + Setup + Process Management

- **Technology:** Node.js 22+, Ink (React for terminals), node-pty, esbuild
- **Entry point:** `cli.jsx` (screen router)
- **Responsibility:** Primary human control surface. Handles `chinwag init`, `chinwag add`, and `chinwag run`. Agent operations dashboard (active agents, conflicts, shared memory, session history). Process management for managed CLI agents (spawn, track, stop, restart). Tool discovery screen. Chat is available but secondary.
- **Key constraint:** The CLI has no knowledge of Durable Objects, room IDs, or server internals. It speaks only the public HTTP/WebSocket API.

### `packages/shared/`: Shared Primitives

- **Technology:** Plain ESM modules shared across packages
- **Responsibility:** Canonical machine-facing definitions and helpers reused by CLI, MCP, web, and worker. Includes the shared tool registry, agent identity helpers, API client factory, and session-registry primitives.
- **Key constraint:** Shared code should stay infrastructural and dependency-light. It exists to eliminate duplicated sources of truth, not to become a grab bag.

### `packages/web/`: Web Dashboard + Landing Page

- **Technology:** React 19, Zustand, CSS Modules, Vite on Cloudflare Pages
- **Entry point:** `dashboard.html` (SPA), `index.html` (static landing page)
- **Responsibility:** Marketing and install instructions; authenticated dashboard at `/dashboard` for cross-project workflow, tool discovery, and team visibility. The web surface gives solo devs a unified view across all projects and gives team leads visibility into their team's AI workflow.
- **Key constraint:** Same API as TUI and MCP server. No special backend endpoints. The web dashboard is a client of the same public API.

## Code Map

### Worker (`packages/worker/src/`)

| File | Responsibility |
|---|---|
| `index.js` | HTTP router. Matches request paths to handlers. Runs Bearer token auth on protected routes via KV lookup. Bridges HTTP/WebSocket to Durable Objects. Hosts the tool catalog (`GET /tools/catalog`). |
| `db.js` | `DatabaseDO`: single instance holding all persistent data. Users, agent profiles, rate limits (`checkRateLimit`). SQLite storage. |
| `team.js` | `TeamDO`: one instance per team. The core coordination DO. Manages team membership, agent activity tracking, file conflict detection, shared project memory, and session observability (start, end, edit recording, history). Exports `VALID_CATEGORIES`. |
| `lobby.js` | `LobbyDO`: single instance managing chat room assignment and global presence. Tracks active rooms and their sizes. Heartbeat-based presence with 60s TTL. |
| `room.js` | `RoomDO`: one instance per chat room. Holds WebSocket connections, broadcasts messages, maintains last 50 messages as history. |
| `moderation.js` | Two-layer content filter. Layer 1: synchronous regex blocklist (under 1 ms). Layer 2: async AI moderation via Llama Guard 3. Used for chat and status text. |

### MCP Server (`packages/mcp/`)

| File | Responsibility |
|---|---|
| `index.js` | MCP server entry point. Loads config and profile, creates the stdio server, and delegates tool/resource registration. Pull-on-any-call preamble. |
| `lib/register-tools.js` | Registers the chinwag MCP tools plus the profile resource. Handles team context, memories, locks, messaging, and related agent coordination flows. |
| `hook.js` | Claude Code hook handler. Three modes: `check-conflict` (PreToolUse: blocks conflicting edits), `report-edit` (PostToolUse: reports file edits + session tracking), `session-start` (SessionStart: injects team context with stuckness insights). |
| `channel.js` | Claude Code channel server. Polls team context every 10s, diffs against previous state, pushes notifications for joins, leaves, file activity, conflicts, stuckness (15min threshold), and new memories. |
| `lib/api.js` | HTTP client with Bearer token auth, 10s fetch timeout, retry with exponential backoff on 5xx/network errors. |
| `lib/team.js` | Team operation wrappers: delegates to backend API for join/leave, context, activity, memory, locks, messaging, and session/history endpoints. |
| `lib/config.js` | Reads `~/.chinwag/config.json` and `.chinwag` team file. |
| `lib/profile.js` | Auto-detects languages, frameworks, tools, and platforms from project files and environment variables. |

### CLI (`packages/cli/`)

| File | Responsibility |
|---|---|
| `cli.jsx` | App shell with error boundary. Screen state machine: loading → welcome → {dashboard, chat, customize, discover}. Loads/validates config on startup. Also handles pre-TUI commands (`init`, `add`, `run`). |
| `lib/dashboard.jsx` | Agent activity dashboard. Shows configured tools, active/offline agents (managed + connected), file conflicts, recent sessions, and team knowledge. 5s polling. Managed agent controls (stop/restart). |
| `lib/process-manager.js` | Spawns CLI agents via node-pty, tracks PIDs, handles kill/restart. Provides lifecycle events for dashboard integration. |
| `lib/discover.jsx` | Tool discovery screen. Shows your configured tools, recommends new tools from the catalog, browse by category, one-key add. |
| `lib/init-command.js` | `chinwag init`: account setup, team creation/join, tool detection via registry, MCP config + hooks writing. |
| `lib/add-command.js` | `chinwag add <tool>`: adds a specific tool's MCP config. Fetches discovery catalog from API. |
| `lib/tools.js` | CLI re-export of the shared MCP tool registry. Discovery catalog lives in the worker API (`GET /tools/catalog`). |
| `lib/chat.jsx` | Live chat. WebSocket connection with exponential backoff reconnect (1s→15s cap). |
| `lib/customize.jsx` | Profile editor. Change handle, cycle through 12-color palette, set status. |
| `lib/api.js` | HTTP client. Wraps fetch with Bearer token auth, 10s timeout, retry with exponential backoff on 5xx/network errors. |
| `lib/colors.js` | Maps chinwag's 12 colors to ANSI terminal colors for Ink rendering. |
| `lib/config.js` | Reads/writes `~/.chinwag/config.json`. Token, handle, color. |

### Shared (`packages/shared/`)

| File | Responsibility |
|---|---|
| `tool-registry.js` | Canonical source of truth for MCP-configurable tools: ids, names, detection, managed-launch metadata, availability checks, and discovery metadata. |
| `agent-identity.js` | Tool detection, deterministic agent IDs, and per-session agent ID generation. |
| `api-client.js` | Shared JSON API client factory used across surfaces. |
| `session-registry.js` | Terminal/session record helpers used for exact session identity and terminal attention. |

## Data Flow

### Setup and Authentication

1. Developer runs `npx chinwag init` in a project directory
2. CLI calls `POST /auth/init` (no auth required)
3. Worker creates user in DatabaseDO: generates UUID, token, random two-word handle, random color
4. Worker writes `token:{bearer-token} → user_id` to KV
5. CLI saves `{token, handle, color}` to `~/.chinwag/config.json`
6. CLI creates team via `POST /teams`, writes `.chinwag` file with team ID
7. CLI writes MCP config files for detected tools (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`)
8. For Claude Code: writes hooks config to `.claude/settings.json`

### Agent Session Lifecycle

1. Developer opens any MCP-compatible tool (Claude Code, Cursor, Windsurf, etc.) in the project, or spawns a managed agent via TUI/`chinwag run`
2. Tool discovers MCP config, starts chinwag MCP server subprocess
3. MCP server reads `~/.chinwag/config.json` for auth token, `.chinwag` for team ID
4. MCP server joins team via backend API, reports agent type and session start
5. **Claude Code (hooks path):** SessionStart hook fires, calls chinwag backend, injects team context into Claude's session ("2 other agents active, Sarah's Cursor editing auth.js")
6. **Claude Code (channel path):** Channel pushes real-time updates as team state changes
7. **All tools (MCP path):** Agent can call `chinwag_check_conflicts` before edits, `chinwag_update_activity` to report what it's working on, `chinwag_get_team_context` for shared memory
8. **Claude Code (hooks enforcement):** PreToolUse hook on Edit/Write calls chinwag API and blocks the edit if another agent is in that file
9. **Managed agents:** TUI tracks the child process. Stop/restart controls available in the dashboard. Process exit triggers cleanup.
10. On session end: MCP server reports disconnect, backend cleans up agent state

### Shared Project Memory

1. Agent discovers a project fact ("tests require Redis", "deploy needs AWS_REGION=us-west-2")
2. Agent calls `chinwag_save_memory` MCP tool with the fact and optional freeform tags
3. MCP server sends to backend, TeamDO persists in SQLite with metadata (source agent, timestamp, tags)
4. Future agent sessions on the same team find memories via `chinwag_search_memory` (text search, tag filter) or receive recent memories in `chinwag_get_team_context`
5. Memories are team knowledge — any team member can update or delete. Agents manage relevance themselves; chinwag stores and retrieves

### Chat (Secondary)

Chat is available but secondary to the agent coordination focus. It exists because the infrastructure supports it, not because it's core to the product.

#### Chat (WebSocket)

1. CLI calls `GET /ws/chat` with Bearer token
2. Worker authenticates, asks LobbyDO for room assignment
3. LobbyDO picks room closest to 20 users (or creates new room if all ≥30)
4. Worker forwards WebSocket upgrade to the assigned RoomDO
5. RoomDO accepts connection, sends message history + room count

## Key Design Decisions

**MCP server is the product, not the CLI.** The primary value is delivered invisibly through agent MCP connections. This is like git: you run `git init` once, then git works in the background. chinwag works the same way: init once, then your agents are smarter.

**Two-tier agent model.** CLI agents (Claude Code, Codex, Aider) are managed: chinwag can spawn, stop, and restart them. IDE agents (Cursor, Windsurf) are connected: they join via MCP and get full coordination, but lifecycle control stays with the IDE. Both tiers appear in the same dashboard. This matches reality — you cannot kill a Cursor agent from outside Cursor, but you can kill a Claude Code process.

**Docker Desktop, not Docker Engine.** Agents show up in the dashboard regardless of how they were started. `chinwag run` and `[n]` in the TUI are convenient launchers, not gatekeepers. An agent started from a random terminal tab auto-connects via MCP the same way.

**Three surfaces, one backend.** MCP server (for agents), TUI (for terminal users), web dashboard (for visual workflow management). All hit the same API. No surface gets special backend endpoints. This means features built for one surface are automatically available to the others.

**One team per project, one account across projects.** The `.chinwag` file (committed to git) scopes a team to a repo. `~/.chinwag/config.json` gives the user a cross-project identity. This enables both team coordination within a repo and solo multi-project visibility across repos. Multi-project is a Coordinate concern (unified identity, user-level API) and an Observe concern (cross-project dashboard to see all agents across all projects).

**Claude Code gets the deepest integration.** Claude Code supports hooks (enforceable interception before file edits), channels (server-initiated push), and is a CLI tool (full process control). This enables conflict prevention that the agent cannot bypass plus managed lifecycle. Other tools get softer integration via MCP instructions and tool descriptions. As tools add hook-like capabilities, their integration deepens.

**Durable Objects over external databases.** Each DO provides single-threaded coordination with embedded SQLite, eliminating the need for external database connections, connection pooling, or cache invalidation. State and compute are colocated at the edge. Trade-off: single-instance bottleneck for DatabaseDO, but adequate for our scale.

**TeamDO is the coordination hub.** One instance per team. Manages membership, agent activity, file conflict detection, and shared project memory. All agent coordination flows through TeamDO's single-writer guarantee, which eliminates race conditions in conflict detection.

**KV for auth only.** KV is eventually consistent, which is fine for token→user_id lookups (tokens are write-once). All other data lives in Durable Objects where we need strong consistency.

**`chinwag init` writes config for all detected tools.** Rather than requiring developers to manually configure MCP servers, the init command detects installed tools and writes their config files. This is the zero-friction adoption path: one command, then forget about it.

## Architectural Invariants

These are constraints that should be preserved as the codebase evolves:

- **MCP server is the primary interface.** The MCP server is how agents interact with chinwag. The TUI and web dashboard are human-facing surfaces. Features should be MCP-first, then surfaced in TUI and web.
- **All surfaces share one API.** The MCP server, TUI, and web dashboard must never depend on server internals (DO class names, room IDs, internal data formats). If a client needs something, it should be a documented API endpoint. No surface gets special backend treatment.
- **Durable Objects own their data.** No external system reads DO storage directly. All access goes through the DO's RPC methods. This preserves the single-writer guarantee.
- **Worker is stateless.** No request-scoped state in module-level variables. Workers reuse V8 isolates across requests. Global state causes cross-request data leaks.
- **KV is append-only for auth.** Token mappings are written once at account creation and never updated.
- **MCP server: never `console.log`.** Stdio transport uses stdout for JSON-RPC. Any `console.log` corrupts the protocol. Use `console.error` for all logging.
- **Managed agents are optional.** Process management is a convenience layer. All coordination features work identically for agents started outside chinwag. The system must never require agents to be spawned via `chinwag run` or the TUI.

## Crosscutting Concerns

### Authentication

Every protected endpoint follows the same flow in `index.js`:

1. Extract Bearer token from Authorization header
2. Look up `token:{value}` in KV → get `user_id`
3. Fetch full user object from DatabaseDO
4. Pass `user` to the route handler

No middleware framework: it's a simple `if/else` chain with early returns.

### Content Moderation

Applies to chat messages and status text. Two layers:

1. **Blocklist** (`moderation.js:isBlocked`): synchronous regex scan. Returns immediately. Used inline for chat where latency matters.
2. **AI** (`moderation.js:moderateWithAI`): async call to Llama Guard 3 via `env.AI`. Returns category codes (S1-S14). Used before persisting status.

`checkContent()` runs both layers sequentially and returns `{blocked, reason, categories}`.

### Error Handling

Workers return structured JSON errors: `{error: "message"}` with appropriate HTTP status codes. The CLI and MCP server display error messages. No stack traces leak to clients.

## Technology Choices

| Technology | Used For | Why This Over Alternatives |
|---|---|---|
| Cloudflare Workers | HTTP API, coordination backend | Edge compute, no cold starts, native WebSocket support, free tier |
| Durable Objects (SQLite) | Persistent state, team coordination | Colocated state+compute, transactional, no external DB needed |
| Cloudflare KV | Auth token lookups | Global low-latency reads, perfect for read-heavy/write-once data |
| MCP (Model Context Protocol) | Agent integration | Industry standard (97M+ monthly SDK downloads), supported by Claude Code, Cursor, Windsurf, VS Code, Codex, Aider, JetBrains, Amazon Q, and growing |
| Claude Code Hooks | Enforceable conflict prevention | System-level interception before file edits, cannot be bypassed by agent |
| Claude Code Channels | Real-time push to agents | Server-initiated context injection into running sessions |
| node-pty | Managed agent process control | Pseudo-terminal allocation for CLI agents, cross-platform, captures output |
| Ink (React for terminals) | CLI dashboard rendering | Component model for terminal UIs, hooks, familiar React patterns |
| esbuild | CLI bundling | Fast, zero-config ESM bundling |
| React 19 + Zustand | Web dashboard | Same framework as CLI (Ink), monorepo coherence, best AI code generation, zustand for lightweight state |
| CSS Modules | Dashboard styling | Scoped styles from Vite built-in support, works with existing CSS custom property design system |
| Cloudflare Pages | Landing page + dashboard hosting | Static hosting with global CDN, same platform as backend |

## Current state and future direction

For what's shipped and what's next, see [ROADMAP.md](ROADMAP.md). For product vision and sequencing, see [VISION.md](VISION.md).

**What this means for contributors:**

- The MCP server is the primary interface. Build features that make agents smarter and more coordinated.
- Three surfaces, one backend: TUI, web dashboard, and MCP all hit the same API.
- The web dashboard is designed to work both in a browser and embedded in IDE panels.
- All DO communication uses RPC, not fetch. New features should follow this pattern.
- Maintain the MCP server ↔ Worker API boundary (agents use the same API as the CLI and web).
- Process management is a CLI concern. The backend does not need to know whether an agent was spawned by chinwag or started independently.

---

*This document follows the [ARCHITECTURE.md convention](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html). If a section becomes stale, fix it or flag it in an issue.*

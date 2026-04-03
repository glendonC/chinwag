# Roadmap

What is built and what comes next. For product vision, positioning, and differentiation, see [VISION.md](VISION.md).

---

## What is shipped

### Connect, Remember, Coordinate (pillars 1-3)

`npx chinwag init` in a project, and every agent session shares a brain with the team.

- **`chinwag init`:** Tool detection via registry, MCP config writing, team creation or join, Claude Code hooks and channel
- **Claude Code deep integration:** PreToolUse conflict blocking, PostToolUse edit tracking, SessionStart context injection, channel push with state diffing
- **Shared project memory:** Save and get with categories, deduplication, count-based auto-prune (500 per team)
- **Agent operations dashboard (TUI):** Active agents, file conflicts, recent sessions, team knowledge, 5s polling
- **Cross-tool MCP support:** Instructions field, tool descriptions, pull-on-any-call preamble
- **Session observability:** Lifecycle tracking, edit recording, stuckness detection (15 min threshold)

### Discover (pillar 4)

- **Tool catalog API** (`GET /tools/catalog`): ~25 AI dev tools, single source of truth in the worker
- **TUI discover screen:** Configured tools, recommendations, category browsing
- **`chinwag add <tool>`:** Add MCP config from the CLI; fetches catalog from the API

### Chat (secondary)

Global chat rooms, presence, handle and color customization, content moderation

### Security

Membership checks on all team endpoints, team ID entropy, rate limits, input validation, fetch timeouts, retry with backoff

### Landing page and web dashboard

- **chinwag.dev:** Responsive site, Open Graph and Twitter meta, install command
- **Dashboard** ([chinwag.dev/dashboard](https://chinwag.dev/dashboard)): Authenticated workflow view, embeddable in IDE panels, per-project and cross-project summaries (`GET /me/teams`, `GET /me/dashboard`)

### Process management (two-tier agent model)

Managed CLI agents with full lifecycle control, connected IDE agents with coordination only.

- **`lib/process-manager.js`:** Spawn CLI agents via node-pty, track PIDs, kill/restart
- **`chinwag run "task description"`:** Spawn a managed agent with a task from CLI
- **`[n]` new agent flow in TUI dashboard:** Pick tool, enter task, spawn
- **`[x]` stop on managed agents in dashboard**
- **Managed vs connected agent distinction:** Agent type, spawn source, PID tracking
- **Dashboard unified agent list:** Managed agents show stop/restart controls, connected agents show activity only
- **Process exit handling:** Cleanup on crash, report session end, surface exit status

### Tests and CI

- **Unit tests:** MCP server tools, CLI config generation, worker API endpoints (vitest)
- **GitHub Actions workflow:** Lint, test, build across all packages

---

## What is next

### Phase 1 — Polish: harden what we shipped

The core works. Before adding surface area, make it bulletproof.

- [ ] Test MCP integration with Cursor, Windsurf, VS Code Copilot, Codex CLI, Aider, JetBrains (verify behavior, document quirks)
- [x] Replace polling with WebSocket push (channel and dashboard receive real-time delta events from TeamDO; HTTP polling retained as fallback and reconciliation safety net)
- [ ] CORS origin checking (currently `*`; tighten when dashboard auth hardens)
- [ ] Tool usage telemetry: record which tools users configure to prioritize integrations
- [ ] Publish `chinwag` CLI and `chinwag-mcp` packages to npm
- [ ] End-to-end test: `npm install -g chinwag` → `npx chinwag init` → agent connection

### Phase 2 — Advanced control

- [ ] Hook-based pause/resume for Claude Code agents (PreToolUse hook returns pause signal)
- [ ] Advisory stop signals for connected IDE agents (message via MCP context that agents read and follow)
- [ ] Agent output streaming in TUI (split pane or dedicated view for managed agent stdout)
- [ ] `chinwag spawn` for headless/background agents (no terminal needed, output logged)

---

## Explore later

Revisit once pillars are solid and adoption signals are clear.

- **Workflow intelligence:** Detect redundant work, uncovered areas, smart memory suggestions, cross-project pattern matching
- **Multi-project memory:** User-level preferences that span projects
- **Deeper tool hooks:** As tools beyond Claude Code add hook-like capabilities, deepen integration

## Non-goals

See [VISION.md](VISION.md#what-chinwag-is-not).

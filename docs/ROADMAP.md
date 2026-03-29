# Roadmap

chinwag is the control layer for agentic development. Connect your AI tools, share a brain across all of them, coordinate across teammates, and see your entire workflow in one place. This page tracks what is built and what comes next.

## The five pillars

1. **Connect:** Detect tools, write configs, hook everything up. One command.
2. **Remember:** Shared memory across tools, sessions, and teammates.
3. **Coordinate:** Live awareness, conflict prevention, cross-tool and cross-teammate.
4. **Discover:** Browse AI dev tools, see what fits, add with one action.
5. **Observe:** See what agents are doing across all tools and projects.

## Who it is for

| Audience | What they get |
|----------|----------------|
| **Solo devs** with multiple AI tools | One brain across 1-3 active projects |
| **Small teams (2-5 devs)** on the same repo | Same coordination without changing how anyone works |
| **Team leads** | Visibility into the team's AI workflow |

---

## What is shipped

### Connect, Remember, Coordinate (pillars 1-3)

`npx chinwag init` in a project, and every agent session shares a brain with the team.

- **`chinwag init`:** Tool detection via registry, MCP config writing, team creation or join, Claude Code hooks and channel
- **Claude Code deep integration:** PreToolUse conflict blocking, PostToolUse edit tracking, SessionStart context injection, channel push with state diffing
- **Shared project memory:** Save and get with categories, deduplication, staleness decay, auto-prune
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

---

## What is next

### Phase 1 — Polish: harden what we shipped

The core works. Before adding surface area, make it bulletproof.

- [ ] Test MCP integration with Cursor, Windsurf, VS Code Copilot, Codex CLI, Aider, JetBrains (verify behavior, document quirks)
- [ ] Replace polling with push where possible (channel polls every 10s per agent, dashboard every 5s; evaluate WebSocket push from TeamDO)
- [ ] CORS origin checking (currently `*`; tighten when dashboard auth hardens)
- [ ] Tool usage telemetry: record which tools users configure to prioritize integrations
- [ ] Unit tests for MCP server tools (vitest)
- [ ] Integration tests for `chinwag init` → config generation → tool detection
- [ ] Worker API endpoint tests
- [ ] GitHub Actions workflow: lint, test, build
- [ ] Publish `chinwag` CLI and `chinwag-mcp` packages to npm
- [ ] End-to-end test: `npm install -g chinwag` → `npx chinwag init` → agent connection

### Phase 2 — Process management

Two-tier agent model: managed CLI agents with full lifecycle control, connected IDE agents with coordination only.

- [ ] `lib/process-manager.js`: Spawn CLI agents via node-pty, track PIDs, kill/restart
- [ ] `chinwag run "task description"` CLI command: spawn a managed agent with a task
- [ ] `[n]` new agent flow in TUI dashboard: pick tool, enter task, spawn
- [ ] `[x]` stop on managed agents in dashboard
- [ ] Managed vs connected agent distinction in data model (agent type, spawn source, PID tracking)
- [ ] Dashboard unified agent list: managed agents show stop/restart controls, connected agents show activity only
- [ ] Process exit handling: cleanup on crash, report session end, surface exit status

### Phase 3 — Advanced control

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

- **Not a standalone APM.** Observation supports the workflow, not a separate monitoring product.
- **Not a community platform.** Chat is secondary.
- **Not a replacement for CLAUDE.md or AGENTS.md.** Those are static per-tool instructions; chinwag is dynamic shared memory and real-time coordination.
- **Not an MCP server registry.** Discover is about AI dev tools for your workflow, not arbitrary MCP servers.

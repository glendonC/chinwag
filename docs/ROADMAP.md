# Roadmap

What is built and what comes next. For product vision, positioning, and differentiation, see [VISION.md](VISION.md).

---

## What is shipped

### Connect, Remember, Coordinate

`npx chinmeister init` in a project, and every agent session shares a brain with the team.

- **`chinmeister init`:** Tool detection via registry, MCP config writing, team creation or join, Claude Code hooks and channel
- **Claude Code deep integration:** PreToolUse conflict blocking, PostToolUse edit tracking, SessionStart context injection, channel push with state diffing
- **Shared project memory:** Save and get with categories, deduplication, count-based auto-prune (500 per team)
- **Agent operations dashboard (TUI):** Active agents, file conflicts, recent sessions, team knowledge, 5s polling
- **Cross-tool MCP support:** Instructions field, tool descriptions, pull-on-any-call preamble
- **Session observability:** Lifecycle tracking, edit recording, stuckness detection (15 min threshold)

### Tool Integration

- **Tool catalog API** (`GET /tools/catalog`): AI dev tools, served from worker
- **`chinmeister add <tool>`:** One-command MCP config from the CLI
- **TUI discover screen:** Configured tools, recommendations, category browsing

### Security

Membership checks on all team endpoints, team ID entropy, rate limits, input validation, fetch timeouts, retry with backoff

### Landing page and web dashboard

- **chinmeister.com:** Responsive site, Open Graph and Twitter meta, install command
- **Dashboard** ([chinmeister.com/dashboard](https://chinmeister.com/dashboard)): Authenticated workflow view, embeddable in IDE panels, per-project and cross-project summaries (`GET /me/teams`, `GET /me/dashboard`)

### Process management (two-tier agent model)

Managed CLI agents with full lifecycle control, connected IDE agents with coordination only.

- **`lib/process-manager.js`:** Spawn CLI agents via node-pty, track PIDs, kill/restart
- **`chinmeister run "task description"`:** Spawn a managed agent with a task from CLI
- **`[n]` new agent flow in TUI dashboard:** Pick tool, enter task, spawn
- **`[x]` stop on managed agents in dashboard**
- **Managed vs connected agent distinction:** Agent type, spawn source, PID tracking
- **Dashboard unified agent list:** Managed agents show stop/restart controls, connected agents show activity only
- **Process exit handling:** Cleanup on crash, report session end, surface exit status

### Session Intelligence

The analytics backbone is shipped and wired into the web dashboard.

- **Per-session tracking:** duration, edit count, files touched, conflicts hit, model used, host tool, token consumption, outcome (completed/abandoned/failed), conversation events with sentiment and topic classification
- **Computed analytics:** 36+ metrics across sessions, conversations, memory, coordination, and cost, including completion rates, edit velocity, work type distribution, tool comparison, model performance, stuckness detection, retry patterns, file churn, directory heatmaps, scope complexity, hourly effectiveness, prompt efficiency, and period-over-period comparison
- **Cost estimation:** Approximate session cost from token usage and model pricing
- **Claude Code hooks:** automatic edit capture (PostToolUse), enforced conflict checks (PreToolUse), context injection (SessionStart)
- **Web dashboard:** Cross-project analytics view, per-project analytics tab, per-member breakdowns

### Tests and CI

- **Unit tests:** MCP server tools, CLI config generation, worker API endpoints (vitest)
- **GitHub Actions workflow:** Lint, test, build across all packages

---

## What is next

### Phase 1: Polish shipped behavior

The core workflow is in place. Before adding surface area, harden the shipped behavior.

- [ ] Test MCP integration with Cursor, Windsurf, VS Code Copilot, Codex CLI, Aider, JetBrains (verify behavior, document quirks)
- [x] Replace polling with WebSocket push (channel and dashboard receive real-time delta events from TeamDO; HTTP polling retained as fallback and reconciliation safety net)
- [ ] CORS origin checking (currently `*`; tighten when dashboard auth hardens)
- [ ] Tool usage telemetry: record which tools users configure to prioritize integrations
- [ ] Publish `chinmeister` CLI and `chinmeister-mcp` packages to npm
- [ ] End-to-end test: `npm install -g chinmeister` → `npx chinmeister init` → agent connection

### Phase 2: Workflow Intelligence

The analytics backbone is shipped. Next, connect insights to actions instead of only displaying numbers.

**Agent-level:**

- [ ] Session detail view: click into any session to see conversation, edit timeline, files, outcome, cost
- [ ] Git attribution: link commits to agent sessions by correlating `git log --since` with session windows

**Developer-level:**

- [ ] Personal trend tracking: are my sessions improving over time? completion rate, edit velocity, cost trends with period comparison
- [ ] Tool and model recommendations: surface which tools/models perform best for which work types based on your data
- [ ] Goal-setting: set targets (e.g. completion rate) and track progress

**Team-level:**

- [ ] Team management view: per-member performance dashboard with drill-down into their agent sessions
- [ ] Anomaly detection: surface statistically significant changes ("completion rate dropped 25% this week")
- [ ] Coordination health metrics: file claim coverage, conflict prevention rate, handoff smoothness

**Cross-cutting:**

- [ ] Actionable insights: every analytics section connects to an action, such as spawning an agent, switching a model, or pruning stale memories
- [ ] Project lenses: security, test, architecture, documentation views with action buttons
- [ ] Proactive alerts: threshold-based notifications for metric changes

### Phase 3: Advanced control

- [ ] Hook-based pause/resume for Claude Code agents (PreToolUse hook returns pause signal)
- [ ] Advisory stop signals for connected IDE agents (message via MCP context that agents read and follow)
- [ ] Agent output streaming in TUI (split pane or dedicated view for managed agent stdout)
- [ ] `chinmeister spawn` for headless/background agents (no terminal needed, output logged)
- [ ] `node-pty` capture for web-spawned managed agents (replace detached stdio:ignore spawn with terminal capture)

---

## Explore later

Revisit once intelligence foundation is solid and adoption signals are clear.

- **Multi-project memory:** User-level preferences and patterns that span projects
- **Deeper tool hooks:** As tools beyond Claude Code add hook-like capabilities, deepen integration and analytics coverage
- **Weekly digest:** Auto-generated summary of key metrics, changes, and recommendations, delivered as an MCP tool response or notification

## Non-goals

See [VISION.md](VISION.md#what-chinmeister-is-not).

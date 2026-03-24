# Roadmap

chinwag is the control layer for agentic development. Connect your AI tools, share a brain across all of them, coordinate across teammates, and see your entire workflow in one place. This doc tracks what's built and what's next.

## The five pillars

1. **Connect** — Detect tools, write configs, hook everything up. One command.
2. **Remember** — Shared memory across tools, sessions, and teammates.
3. **Coordinate** — Live awareness, conflict prevention, cross-tool and cross-teammate.
4. **Discover** — Browse AI dev tools, see what fits, add with one action.
5. **Observe** — See what agents are doing across all tools and projects.

## Who it's for

- **Solo devs with multiple AI tools** across 1-3 active projects
- **Small teams (2-5 devs)** sharing a repo, each using their preferred tools
- **Team leads** who need visibility into their team's AI workflow

---

## What's shipped

### Connect + Remember + Coordinate (Pillars 1-3)

`npx chinwag init` in a project, and every agent session shares a brain with the team.

- `chinwag init` — tool detection via registry, MCP config writing, team creation/join, Claude Code hooks + channel
- Claude Code deep integration — PreToolUse conflict blocking, PostToolUse edit tracking, SessionStart context injection, channel push with state diffing
- Shared project memory — save/get with categories, deduplication, staleness decay, auto-prune
- Agent operations dashboard (TUI) — active agents, file conflicts, recent sessions, team knowledge, 5s polling
- Cross-tool MCP support — instructions field, tool descriptions, pull-on-any-call preamble
- Session observability — lifecycle tracking, edit recording, stuckness detection (15min threshold)

### Discover (Pillar 4)

- Tool catalog API (`GET /tools/catalog`) — ~25 AI dev tools, single source of truth in worker
- TUI discover screen — configured tools, recommendations, category browsing
- `chinwag add <tool>` — add MCP config from CLI, fetches catalog from API

### Chat (secondary)

- Global chat rooms, presence, handle/color customization, content moderation

### Security

- Membership checks on all team endpoints, team ID entropy, rate limits, input validation, fetch timeouts, retry with backoff

### Landing page

- chinwag.dev — responsive, OG/Twitter meta, install command

---

## What's next

### Polish — Harden what's shipped

The core works. Before adding surface area, make it bulletproof.

- [ ] Test MCP integration with Cursor, Windsurf, VS Code Copilot, Codex CLI, Aider, JetBrains — verify behavior, document quirks
- [ ] Replace polling with push where possible — channel polls every 10s per agent, dashboard polls every 5s. Evaluate WebSocket push from TeamDO
- [ ] CORS origin checking — currently `*`, needs restriction when dashboard gets auth
- [ ] Tool usage telemetry — record which tools users configure (prioritize integrations)

### Dashboard — Visual workflow surface (shipped)

Web dashboard at chinwag.dev/dashboard — works standalone and embeds in IDE panels.

- [x] Authenticated web dashboard — login via token hash or manual paste
- [x] Per-project view: active agents, file activity, conflicts, shared memory, session history
- [x] Cross-project view: "All projects" overview with summary cards, drill-down to detail
- [x] Embeddable — URL that IDEs can open in their built-in browser panels
- [x] `chinwag init` outputs the dashboard URL after setup
- [x] User-level API: `GET /me/teams`, `GET /me/dashboard` (cross-project summary)

### Ship — Testing, CI, npm

- [ ] Unit tests for MCP server tools (vitest)
- [ ] Integration tests for `chinwag init` → config generation → tool detection
- [ ] Worker API endpoint tests
- [ ] GitHub Actions workflow: lint, test, build
- [ ] Publish `chinwag` CLI + `chinwag-mcp` packages to npm
- [ ] End-to-end test: `npm install -g chinwag` → `npx chinwag init` → agent connection

---

## Explore later

Revisit once pillars are solid and adoption signals are clear.

- **Workflow intelligence** — detect redundant work, uncovered areas, smart memory suggestions, cross-project pattern matching
- **Multi-project memory** — user-level preferences that span projects
- **Deeper tool hooks** — as tools beyond Claude Code add hook-like capabilities, deepen integration

## Non-goals

- **Not an agent orchestrator.** chinwag coordinates agents already running in their native tools — it doesn't spawn or manage them.
- **Not an APM.** Observation supports the workflow, not a separate monitoring product.
- **Not a community platform.** Chat is secondary.
- **Not a replacement for CLAUDE.md/AGENTS.md.** Those are static per-tool instructions; chinwag is dynamic shared memory + real-time coordination.
- **Not an MCP server registry.** Discover is about AI dev tools for your workflow, not arbitrary MCP servers.

# Roadmap

chinwag is your dev home in the terminal: an agent dashboard + a developer community. This doc tracks what's built, what's next, and what's deferred.

---

## What's built

### Developer community (shipped)
- Global chat rooms with auto-sizing (~20 users per room)
- Daily note posting with exchange matching (post → get someone else's note)
- Feed with cursor-based pagination
- Inbox gated behind daily note (must post to unlock)
- Presence heartbeat (30s interval, 60s TTL)
- Handle customization, 12-color palette, status
- Two-layer content moderation (blocklist + Llama Guard 3)
- Daily reset at 00:00 UTC

### Agent infrastructure (shipped)
- MCP server (`packages/mcp/`) — connects AI agents via stdio transport
- Agent profiles in DatabaseDO — auto-detected from environment (languages, frameworks, tools, platforms)
- Team coordination (TeamDO) — membership, activity tracking, file conflict detection, heartbeat
- CLI team commands — `chinwag team create`, `chinwag team join <id>`
- `.chinwag` file for auto-join on MCP server startup
- 9 API routes for agent profile, dashboard stub, full team CRUD

### Skill registry (built, not deployed)
- SkillRegistryDO with FTS5 search, quality signals, ranked matching
- R2 storage for SKILL.md content
- 4 API endpoints (publish, discover, get, signal)
- 4 MCP tools (search, get, publish, report signal)
- 3-layer moderation (blocklist + AI + injection scan)
- Rate limiting (60 queries/min, 10 publications/day, 60 signals/min)

### Landing page (shipped)
- chinwag.dev with install switcher, globe, section navigation
- Updated messaging: "Your dev home in the terminal"

---

## What's next

### 1. Agent dashboard (CLI)
**The primary interface.** Make the agent dashboard the home screen of chinwag.

- [ ] New `lib/dashboard.jsx` screen showing all connected agent sessions
- [ ] Display: agent type (claude-code, cursor, codex), files being edited, task summary
- [ ] Conflict warnings inline when agents touch the same files
- [ ] Make dashboard the default screen (above chat/notes in the menu)
- [ ] Poll team endpoint for live updates

**How it works:** Each agent runs a chinwag MCP server instance. All instances report to the same backend with the same user token. The CLI dashboard polls the team endpoint to show all connected agents.

### 2. Project memory
**Knowledge persists across agent sessions.** Automated CLAUDE.md — your agents stop re-discovering the same things.

- [ ] Define what "project knowledge" looks like (gotchas, patterns, project-specific context)
- [ ] Mechanism for capturing knowledge from agent sessions (MCP tool? automatic extraction?)
- [ ] Storage: per-project entries in a DO or R2
- [ ] MCP resource that injects relevant project knowledge into new agent sessions automatically
- [ ] Dashboard view: what your project's knowledge base contains

**Open question:** How does knowledge get captured? Options:
- Agent calls a `chinwag_save_learning` MCP tool when it discovers something
- Developer manually saves via CLI
- Start with manual, automate later based on what people actually save

### 3. Chat with note gate
**Already built.** Chat unlocked by posting a daily note. No changes needed — this works.

- [ ] Verify note gate still works correctly with dashboard as new home screen
- [ ] Consider: should chat be accessible from the dashboard view directly?

---

## What's deferred

These ideas came up during product design but aren't being built now. Kept here for reference.

### Network memory (cross-user patterns)
Aggregating anonymized signals across all users to produce patterns no individual agent has. Dropped because: privacy model unclear, contribution mechanism unproven, competes with LLM training data for generic patterns. Revisit if chinwag gets enough users that cross-project patterns become feasible.

### Skill network / ClawHub competitor
Publishing and discovering SKILL.md instruction files. Infrastructure is built (SkillRegistryDO, R2, FTS5, MCP tools). Not deployed because: static skill registries are commoditized, differentiator unclear vs. ClawHub (13K skills) and Skills.sh (600K installs). Could be repurposed for project memory storage.

### Passive skill absorption
Agents automatically finding and applying network patterns without searching. Requires: large skill corpus, profile-aware matching, reliable quality signals. Too many dependencies on unbuilt pieces.

### Tech news / project discovery
Expanding the community into curated developer content. Dropped because: content curation is a full-time job, scope creep from the core product.

---

## Architecture notes

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design. Key points for roadmap work:

- **MCP server** (`packages/mcp/`) runs locally per agent. Each instance connects to the same backend with the same user token. This is how multi-agent coordination works without agents talking to each other directly.
- **TeamDO** already handles multi-agent coordination (conflict detection, activity sharing). The dashboard is a CLI view on top of this existing infrastructure.
- **SkillRegistryDO** + R2 could be repurposed for project memory storage (per-project knowledge entries instead of global skills).
- **All DO communication uses RPC**, not fetch. New features should follow this pattern.

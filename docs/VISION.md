# Vision

What chinmeister is, why it exists, and where it's going.

---

## The problem

Every AI coding tool coordinates only with itself. Claude Code coordinates Claude Code sessions. Cursor coordinates Cursor agents. GitHub coordinates GitHub agents. Each platform keeps building deeper multi-agent capabilities — but only for their own tools.

Meanwhile, real development looks like this: you run Claude Code and Cursor on the same project. Your teammate uses Windsurf. During a hackathon, five people each have multiple agents running. There is no shared memory between tools. There is no conflict prevention across them. There is no unified view of what's happening. Agents duplicate work, collide on files, and lose context across tools and sessions.

No vendor is incentivized to build cross-tool coordination — doing so would help their competitors. The space between tools stays empty.

Beyond coordination, there's a deeper gap: no developer has structured visibility into how they develop with AI. How effective are your agent sessions? Where do agents struggle in your codebase? Is your workflow improving over time? The tools themselves don't answer these questions — each session runs and disappears. There's no persistent view, no trend analysis, no feedback loop.

## What chinmeister is

chinmeister is the **control and intelligence layer for agentic development**: vendor-neutral infrastructure that connects AI tools, coordinates agents, and gives you deep visibility into your development workflow — from real-time agent coordination to long-term patterns in how you build with AI.

One command (`npx chinmeister init`) connects your stack. From that point, agents share a brain, coordinate across tools and teammates, and your entire AI-assisted workflow becomes observable and improvable.

## What it does

### Coordination

Cross-vendor, cross-developer, real-time agent coordination.

- **Shared project memory** across all tools and teammates. What one agent learns, every agent knows next session. Memory is infrastructure, not a black box — tagged, queryable, editable, and deletable by agents and humans. Every entry is source-attributed and searchable. Knowledge doesn't rot in flat files or disappear inside opaque tool state.
- **Live awareness** of every agent across every tool. See who is editing what, in real time.
- **Conflict prevention.** Agents know when they're about to collide on a file — before it happens. Enforced on Claude Code via hooks, advisory on other tools via MCP.
- **File locking and activity tracking.** Claim files, report activity, detect conflicts.
- **Cross-machine coordination.** Works across developers on different machines through the shared backend.

### Workflow Intelligence

Four levels of visibility into how you develop with AI — from individual agent sessions to a single codebase to your personal workflow to your entire team.

**Agent-level: observe, measure, control.** Every agent session tracked — duration, edits, files touched, outcome, cost. For managed agents, chinmeister captures the full conversation: how you communicate with agents, where sessions go sideways, what patterns lead to success or failure. Drill into any session to see the timeline. Control managed agents directly — start, stop, restart. Conflict prevention enforced in real time.

**Project-level: what's happening in this codebase.** The repo-axis view. Who's editing what right now, which files are contested, how sessions perform against this specific codebase, what memory has accumulated here. Scoped by the `.chinmeister` file — one view per repo, one coordination atom per project. This is where spawn, file-claim, and the live operational surface belong.

**Developer-level: your personal AI performance.** Your workflow across all projects and tools in one view. Are your sessions improving over time? Which tools and models work best for which types of work? Where does your codebase need attention? chinmeister gives you a feedback loop that individual tools can't — because it sees across all of them.

**Team-level: manage your team's AI workflow.** See how your team develops with AI. Per-member performance, agent utilization across the team, coordination health, shared knowledge lifecycle. Understand where the team is effective and where agents struggle — not as surveillance, but as the same kind of visibility any engineering team has into their development process.

## How it works

**Agents are the primary user.** The MCP server runs invisibly alongside each agent session. After `chinmeister init`, it just works. Developers interact with chinmeister indirectly: their agents are smarter because chinmeister is connected.

**Three surfaces, one backend.** MCP server (for agents), TUI (for terminal users), web dashboard (for visual management). All hit the same API. No surface gets special treatment.

**Two-tier agent model.** CLI agents (Claude Code, Codex, Aider) can be managed: chinmeister spawns, tracks, and controls their lifecycle. IDE agents (Cursor, Windsurf) are connected: full coordination via MCP, but the IDE owns lifecycle. Both appear in the same dashboard.

**One team per project, one account across projects.** The `.chinmeister` file (committed to git) scopes a team to a repo. `~/.chinmeister/config.json` gives each developer a cross-project identity. Teammates auto-join when they run `chinmeister init` in a project that already has a `.chinmeister` file.

**Integration depth scales with the tool.** Tools that support hooks (like Claude Code) get the richest experience: enforced conflict prevention, automatic edit tracking, and full session analytics. Managed agents (spawned through chinmeister) unlock the deepest tier: conversation-level analytics including message sentiment, topic classification, interaction patterns, and correlations between communication style and session outcomes. Tools connected via MCP get coordination, shared memory, and activity awareness. Every tool benefits; deeper integration unlocks deeper intelligence.

**Expand your stack as you go.** `chinmeister add <tool>` integrates any supported AI tool — MCP config, hooks where supported, done.

## What chinmeister is not

- **Not an agent orchestrator.** chinmeister does not spawn, assign, or manage agent reasoning. It coordinates agents already running in their native tools.
- **Not a monitoring dashboard.** Workflow intelligence drives action — every insight connects to something you can do about it. chinmeister is a cockpit, not a display.
- **Not a community platform.** No global chat surface; inter-agent messaging exists for coordination only.
- **Not a replacement for CLAUDE.md or AGENTS.md.** Those are static per-tool instructions. chinmeister is dynamic shared memory and real-time coordination.

---

_For system design and code structure, see [ARCHITECTURE.md](ARCHITECTURE.md). For build status and tasks, see [ROADMAP.md](ROADMAP.md)._

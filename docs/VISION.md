# Vision

What chinmeister is, why it exists, and where it's going.

---

## The problem

Every AI coding tool coordinates only with itself. Claude Code coordinates Claude Code sessions. Cursor coordinates Cursor agents. GitHub coordinates GitHub agents. Each platform keeps building deeper multi-agent capabilities, but only for its own tools.

Meanwhile, real development looks like this: you run Claude Code and Cursor on the same project. Your teammate uses Windsurf. During a hackathon, five people each have multiple agents running. There is no shared memory between tools. There is no conflict prevention across them. There is no unified view of what's happening. Agents duplicate work, collide on files, and lose context across tools and sessions.

No vendor is strongly incentivized to build cross-tool coordination, because doing so also helps competing tools. The space between tools remains underserved.

Beyond coordination, developers lack structured visibility into how they develop with AI. How effective are agent sessions? Where do agents struggle in a codebase? Is the workflow improving over time? Individual tools do not answer these questions across sessions, projects, or vendors. There is no persistent view, trend analysis, or feedback loop.

## What chinmeister is

chinmeister is the **control and intelligence layer for agentic development**: vendor-neutral infrastructure that connects AI tools, coordinates agents, and gives developers visibility into AI-assisted workflows, from real-time coordination to long-term patterns.

One command (`npx chinmeister init`) connects your stack. From that point, agents share project context, coordinate across tools and teammates, and make the AI-assisted workflow easier to observe and improve.

## What it does

### Coordination

Cross-vendor, cross-developer, real-time agent coordination.

- **Shared project memory** across all tools and teammates. What one agent learns is available to later sessions. Memory entries are tagged, queryable, editable, deletable, source-attributed, and searchable by agents and humans.
- **Live awareness** of every agent across every tool. See who is editing what, in real time.
- **Conflict prevention.** Agents can check when they are about to collide on a file before editing. Claude Code enforcement uses hooks; other tools receive advisory checks through MCP.
- **File locking and activity tracking.** Claim files, report activity, detect conflicts.
- **Cross-machine coordination.** Works across developers on different machines through the shared backend.

### Workflow Intelligence

chinmeister provides four levels of visibility into AI-assisted development: individual agent sessions, a single codebase, a personal workflow across projects, and team-level activity.

**Agent-level: observe, measure, control.** Every agent session tracks duration, edits, files touched, outcome, and cost. For managed agents, chinmeister captures conversation events so teams can inspect timelines and understand which interaction patterns correlate with session outcomes. Managed agents can be started, stopped, and restarted directly. Conflict prevention runs in real time.

**Project-level: what's happening in this codebase.** Each repo has a view of active edits, contested files, session performance, and accumulated memory. The `.chinmeister` file scopes one team to one repo, which keeps live coordination and project memory tied to the codebase.

**Developer-level: your personal AI performance.** A developer can see workflow patterns across projects and tools: whether sessions improve over time, which tools and models fit different work types, and where codebases need attention. This feedback loop depends on data across tools, not one vendor's session history.

**Team-level: manage your team's AI workflow.** Teams can review per-member performance, agent utilization, coordination health, and the shared knowledge lifecycle. The goal is operational visibility into AI-assisted development, similar to the visibility teams already have into builds, reviews, and delivery.

## How it works

**Agents are the primary user.** The MCP server runs alongside each agent session. After `chinmeister init`, developers mostly interact with chinmeister through their tools while agents use the shared context and coordination APIs.

**Three surfaces, one backend.** MCP server (for agents), TUI (for terminal users), web dashboard (for visual management). All hit the same API. No surface gets special treatment.

**Two-tier agent model.** CLI agents (Claude Code, Codex, Aider) can be managed: chinmeister spawns, tracks, and controls their lifecycle. IDE agents (Cursor, Windsurf) are connected: full coordination via MCP, but the IDE owns lifecycle. Both appear in the same dashboard.

**One team per project, one account across projects.** The `.chinmeister` file (committed to git) scopes a team to a repo. `~/.chinmeister/config.json` gives each developer a cross-project identity. Teammates auto-join when they run `chinmeister init` in a project that already has a `.chinmeister` file.

**Integration depth scales with the tool.** Tools that support hooks, such as Claude Code, get enforced conflict prevention, automatic edit tracking, and full session analytics. Managed agents spawned through chinmeister also support conversation-level analytics, including message sentiment, topic classification, interaction patterns, and correlations between communication style and session outcomes. Tools connected through MCP get coordination, shared memory, and activity awareness.

**Expand your stack as you go.** `chinmeister add <tool>` integrates supported AI tools by writing MCP config and hooks where supported.

## What chinmeister is not

- **Not an agent orchestrator.** chinmeister does not spawn, assign, or manage agent reasoning. It coordinates agents already running in their native tools.
- **Not a passive monitoring dashboard.** Workflow intelligence should connect observations to actions: spawn an agent, switch a model, prune stale memories, or address coordination issues.
- **Not a community platform.** No global chat surface; inter-agent messaging exists for coordination only.
- **Not a replacement for CLAUDE.md or AGENTS.md.** Those are static per-tool instructions. chinmeister is dynamic shared memory and real-time coordination.

---

_For system design and code structure, see [ARCHITECTURE.md](ARCHITECTURE.md). For build status and tasks, see [ROADMAP.md](ROADMAP.md)._

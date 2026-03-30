# Vision

What chinwag is, why it exists, and where it's going.

---

## The problem

Every AI coding tool coordinates only with itself. Claude Code coordinates Claude Code sessions. Cursor coordinates Cursor agents. GitHub coordinates GitHub agents. Each platform keeps building deeper multi-agent capabilities — but only for their own tools.

Meanwhile, real development looks like this: you run Claude Code and Cursor on the same project. Your teammate uses Windsurf. During a hackathon, five people each have multiple agents running. There is no shared memory between tools. There is no conflict prevention across them. There is no unified view of what's happening. Agents duplicate work, collide on files, and lose context across tools and sessions.

No vendor is incentivized to build cross-tool coordination — doing so would help their competitors. The space between tools stays empty.

## What chinwag is

chinwag is the **control layer for agentic development**: vendor-neutral infrastructure that connects AI tools, shares state across them, coordinates agents across developers, and gives you visibility into the whole system.

One command (`npx chinwag init`) connects your stack. From that point, agents share a brain, coordinate across tools and teammates, and show up in one place.

## What it does

### Coordination

Cross-vendor, cross-developer, real-time agent coordination.

- **Shared project memory** across all tools and teammates. What one agent learns, every agent knows next session.
- **Live awareness** of every agent across every tool. See who is editing what, in real time.
- **Conflict prevention.** Agents know when they're about to collide on a file — before it happens. Enforced on Claude Code via hooks, advisory on other tools via MCP.
- **File locking and activity tracking.** Claim files, report activity, detect conflicts.
- **Cross-machine coordination.** Works across developers on different machines through the shared backend.

### Observability

You can't control what you can't see.

- **Agent activity** across all tools and projects in one view.
- **Session history.** What agents accomplished, where they got stuck.
- **Shared notes** and project knowledge that persist across sessions.
- **Multi-project dashboard.** See your full AI workflow across all repos — which agents are running where, what they're working on.

### Tool discovery

Expand your stack without friction.

- **Curated catalog** of AI dev tools, browsable from the TUI and web dashboard.
- **One-command integration.** `chinwag add <tool>` configures MCP, writes config, done.
- **Where it's going:** Agent-assisted tool research, instant experimentation, and a feedback loop between users and tool makers.

## How it works

**Agents are the primary user.** The MCP server runs invisibly alongside each agent session. After `chinwag init`, it just works. Developers interact with chinwag indirectly: their agents are smarter because chinwag is connected.

**Three surfaces, one backend.** MCP server (for agents), TUI (for terminal users), web dashboard (for visual management). All hit the same API. No surface gets special treatment.

**Two-tier agent model.** CLI agents (Claude Code, Codex, Aider) can be managed: chinwag spawns, tracks, and controls their lifecycle. IDE agents (Cursor, Windsurf) are connected: full coordination via MCP, but the IDE owns lifecycle. Both appear in the same dashboard.

**One team per project, one account across projects.** The `.chinwag` file (committed to git) scopes a team to a repo. `~/.chinwag/config.json` gives each developer a cross-project identity. Teammates auto-join when they run `chinwag init` in a project that already has a `.chinwag` file.

## What chinwag is not

- **Not an agent orchestrator.** chinwag does not spawn, assign, or manage agent reasoning. It coordinates agents already running in their native tools.
- **Not a standalone APM.** Observability supports the workflow, not a separate monitoring product.
- **Not a marketplace.** Tool discovery serves the workflow. chinwag is not competing with Smithery or npm.
- **Not a community platform.** Chat exists but is secondary.
- **Not a replacement for CLAUDE.md or AGENTS.md.** Those are static per-tool instructions. chinwag is dynamic shared memory and real-time coordination.

---

*For system design and code structure, see [ARCHITECTURE.md](ARCHITECTURE.md). For build status and tasks, see [ROADMAP.md](ROADMAP.md).*

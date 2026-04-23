# chinmeister

**The control layer for agentic development.** You run AI coding agents wherever you already do. chinmeister sits in the middle, watching every session, holding the shared memory, and stopping agents from colliding on the same files. Works solo or across a team.

```bash
npx chinmeister init
```

[![CI](https://github.com/glendonC/chinmeister/actions/workflows/ci.yml/badge.svg)](https://github.com/glendonC/chinmeister/actions/workflows/ci.yml) · MIT client · BSL 1.1 backend · Node 22+

### What gets observed

Every session your agents run is recorded: duration, edits, files touched, tokens, cost, outcome. For managed agents, chinmeister also captures the conversation itself, with message sentiment, topic, and patterns that correlate with success or failure. You read the data through four views. Session view drills into a single run (prompts, tool calls, edits, timing). Project view shows what's happening in this repo. Developer view is your personal AI performance across every project. Team view is how your people are doing.

### What gets coordinated

Your agents share a brain. Memory persists across sessions and tools, tagged and queryable, so what one agent figures out the next one starts with. The live activity view shows who's editing what in real time, across every tool. When two agents go for the same file, hooks block the edit on Claude Code; advisory warnings go out on the rest through MCP. Cross-tool, cross-developer, cross-machine.

### What's getting built

Reports turns the data into action. Three foundational reports first: where your agents keep failing and why, where they step on each other (and where tool handoffs break work), what a new person needs to know about the codebase. Each runs on a schedule or on-demand. Autopilot layers one-click fixes on top. Every finding either mutates chinmeister's own state (save a memory, set a routing rule), drafts a file for your review (PR body, doc update), or spawns a pre-loaded task inside your own agent. Your agent, your credits, your repo.

Beyond that, the dashboard finds you. Push notifications for session anomalies. Weekly digests on your phone so you know how your agents did overnight without having to go look.

### Solo or team

The `.chinmeister` file scopes one team to one project. Solo: you get everything except team-scoped views, across as many projects as you want. Team: commit `.chinmeister`, teammates run `npx chinmeister init` and auto-join, and coordination plus memory plus analytics span the whole group. One account across projects, so your developer view follows you into every team you're part of.

### Commands

```bash
npx chinmeister init              # setup
npx chinmeister add <tool>        # add a tool to your setup
npx chinmeister dashboard         # open the web dashboard
npx chinmeister token             # print auth token
npx chinmeister                   # TUI
```

`npm install -g chinmeister` for the bare command.

### Docs

[Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [Contributing](docs/CONTRIBUTING.md) · [Security](SECURITY.md) · [License](LICENSING.md)

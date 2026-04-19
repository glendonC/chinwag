# Licensing

chinwag is **dual-licensed**. Client-side packages are open source (MIT).
Backend packages are source-available under BSL 1.1 and convert to
Apache 2.0 (open source) on 2030-04-10.

> "Source-available" is not the same as "open source." BSL 1.1 is not
> on the [OSI's approved license list](https://opensource.org/licenses).
> Half of chinwag (the client tools) is open source today; the other
> half (the backend) will be open source in 2030.

## MIT License (open source)

The following packages are licensed under the [MIT License](https://opensource.org/licenses/MIT):

- **`packages/mcp/`** — MCP server that runs alongside your AI agents
- **`packages/cli/`** — CLI tool for setup and management
- **`packages/shared/`** — Shared primitives, contracts, tool registry, integration helpers

You can use, modify, and distribute these freely with no restrictions.

## Business Source License 1.1 (source-available)

The following packages are licensed under the [BSL 1.1](https://mariadb.com/bsl11/):

- **`packages/worker/`** — Backend API, analytics, and coordination engine
- **`packages/web/`** — Web dashboard

You can read, modify, and self-host these for internal use. The one
restriction is the Additional Use Grant: you cannot use this code to
offer a competing hosted Agent Coordination Service to third parties.

On **2030-04-10**, these packages automatically convert to the
**Apache License 2.0** — at that point they become OSI-approved open
source with no restrictions.

## Why this split

Client-side packages (`mcp`, `cli`, `shared`) run in your environment,
alongside your agents, and write configuration into your shell. That
code has to be maximally auditable and frictionless — anything less
than a permissive open-source license would be a trust and adoption
barrier. MIT is the right fit.

Backend packages (`worker`, `web`) contain the analytics engine,
conversation intelligence, and the hosted coordination network. BSL
1.1 lets anyone read, fork, and self-host the backend, while
preventing a competitor from directly hosting our code as a rival
SaaS. The Change Date means the non-compete grant is time-bounded:
in 2030 the backend becomes open source too.

## Why `packages/shared` is MIT

`packages/shared` contains the wire contracts between the MCP server,
CLI, web dashboard, and the worker, along with the tool registry and
integration config writers. A reasonable person could argue this is
strategic surface — shouldn't the wire protocol be protected?

We chose MIT deliberately:

- chinwag's moat is the **coordination network**, not the protocol.
  A protocol-compatible alternative backend is a separate island
  with zero users, not a substitute for chinwag.
- The contracts are trivially reverse-engineerable from the MCP
  server's stdio and the public API surface. A more restrictive
  license doesn't prevent clean-room implementation; it just adds
  friction for legitimate third-party integrations.
- Making the contracts MIT signals that chinwag welcomes external
  clients, alternative implementations, and protocol-level ecosystem
  contributions. This is consistent with the product direction around
  tool discovery and integration.
- The commercial protection that matters lives in `worker`/`web`
  (the coordination logic, analytics engine, Durable Objects). None
  of that is in `shared`.

## What this means in practice

- **You can always fork and modify the MIT packages.** There's no
  restriction. You can build your own CLI, your own MCP server, or
  your own alternative backend that speaks the same wire protocol.
- **You can self-host the entire platform for internal use.** Clone
  the repo, deploy the worker to your own Cloudflare account, host
  the dashboard on your own infrastructure. This is allowed.
- **You cannot take the BSL code and run it as a competing commercial
  service** while the BSL grant is in effect. In 2030 this restriction
  expires.
- **chinwag is not "open source" as a whole.** If accurate language
  matters for your compliance, procurement, or philosophy, the correct
  way to describe chinwag is _"dual-licensed: open source client,
  source-available backend (converting to open source in 2030)."_

## Questions

For commercial licensing arrangements that differ from the terms
above, contact hello@chinwag.dev.

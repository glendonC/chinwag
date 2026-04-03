# Security Policy

chinwag takes security seriously. This document describes how to report vulnerabilities, what's in scope, and how we handle disclosures.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

**Preferred:** Use [GitHub Private Vulnerability Reporting](https://github.com/glendonchin/chinwag/security/advisories/new) to submit a report directly through GitHub. This keeps the conversation private and lets us coordinate a fix before public disclosure.

**Fallback:** Email **security@chinwag.dev** with the details below.

### What to Include

- Description of the vulnerability and its potential impact
- Steps to reproduce or a proof of concept
- Affected component(s): `worker`, `cli`, `web`, or infrastructure
- Your assessment of severity (critical, high, medium, low)
- Any suggested fix, if you have one

## Scope and Threat Model

### What chinwag trusts

| Trust boundary              | Reasoning                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare's infrastructure | Workers runtime isolation, network DDoS protection, TLS termination, and Durable Object storage integrity are Cloudflare's responsibility |
| The host operating system   | CLI runs on the user's machine; OS-level compromise is out of scope                                                                       |
| Node.js runtime             | CLI requires Node 22+; vulnerabilities in Node itself should be reported upstream                                                         |

### What chinwag does NOT trust

| Boundary                 | Implication                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| All network input        | Every HTTP request and WebSocket message is treated as untrusted and validated server-side                             |
| User-generated content   | All text (memories, chat messages, status updates) passes through two-layer moderation before persistence or broadcast |
| Authentication tokens    | Bearer tokens are validated on every request via KV lookup; no session cookies, no client-side trust                   |
| WebSocket messages       | Validated for type, length (280 char max), and rate (10/min) on every frame                                            |
| Client-supplied identity | Handle and color are resolved server-side from the authenticated token, never accepted from the client payload         |

### In Scope

- Authentication bypass or token leakage
- Cross-Site WebSocket Hijacking (CSWSH) against the chat endpoint
- Injection attacks through memory content, chat messages, status text, or handle names
- Moderation bypass (both blocklist and AI layer)
- Rate limit bypass (account creation, chat messages)
- Data leakage between Durable Object instances (cross-room, cross-user)
- Unauthorized access to another user's team messages, memories, or profile
- Denial of service achievable by a single authenticated user (resource exhaustion within the Worker)
- Vulnerabilities in the WebSocket upgrade or connection lifecycle
- Sensitive data exposure in error responses or logs

### Out of Scope

- Cloudflare platform vulnerabilities (report to [Cloudflare's bug bounty](https://hackerone.com/cloudflare))
- Node.js runtime vulnerabilities (report to [Node.js security](https://nodejs.org/en/security))
- Denial of service against Cloudflare's network (L3/L4 DDoS)
- Social engineering of maintainers or users
- Attacks requiring physical access to a user's machine
- Content moderation false positives/negatives (these are quality issues, not security; file a regular issue)
- Self-XSS in the terminal CLI (the terminal is the user's own environment)

## Supported Versions

chinwag is deployed as a single live service. Security fixes are applied to the current production deployment.

| Component           | Version                      | Supported |
| ------------------- | ---------------------------- | --------- |
| Worker API          | Production (latest deploy)   | Yes       |
| CLI (`npx chinwag`) | Latest published npm version | Yes       |
| Web (chinwag.dev)   | Production (latest deploy)   | Yes       |

Older CLI versions are not actively supported. Users running `npx chinwag` always get the latest version.

## Response Timeline

| Stage                                  | Target                                |
| -------------------------------------- | ------------------------------------- |
| Acknowledgment                         | Within 48 hours                       |
| Initial triage and severity assessment | Within 7 days                         |
| Fix development                        | Depends on severity (see below)       |
| Disclosure                             | Coordinated, typically within 90 days |

**Severity-based fix targets:**

- **Critical** (auth bypass, data leakage): Patch deployed within 72 hours
- **High** (moderation bypass, rate limit bypass): Patch within 2 weeks
- **Medium** (information disclosure, minor access control): Patch within 30 days
- **Low** (hardening improvements): Addressed in next regular release cycle

These are targets, not guarantees. chinwag is maintained by a small team. We will communicate openly if timelines slip.

## Disclosure Policy

We follow coordinated disclosure:

1. Reporter submits vulnerability through a private channel
2. We acknowledge receipt and begin triage
3. We develop and test a fix
4. We deploy the fix to production
5. We publish a security advisory (via GitHub Security Advisories) crediting the reporter
6. Reporter is free to publish their own writeup after the advisory is live

**Embargo:** We ask reporters to keep vulnerability details private until we've deployed a fix and published an advisory. We target 90 days as the outer bound, consistent with industry norms (Google Project Zero standard). If we cannot meet 90 days, we will negotiate an extension with the reporter.

**Early disclosure:** If we determine a vulnerability is actively exploited in the wild, we may disclose and deploy a fix on an accelerated timeline.

## Safe Harbor

We support security research conducted in good faith. If you comply with this policy:

- We consider your research to be **authorized** under the Computer Fraud and Abuse Act (CFAA) and equivalent international laws. We will not pursue legal action for good-faith security research that follows this policy.
- We consider your research to be **authorized** under anti-circumvention laws (DMCA Section 1201 and equivalents). We will not bring claims for circumvention of technology controls.
- We **waive** any restrictions in our Terms of Service that would conflict with conducting security research under this policy.
- We consider your activities to be **lawful, helpful to the security of the internet at large, and conducted in good faith**.

If at any point you are uncertain whether your research complies with this policy, reach out to us before proceeding. We would rather answer a question than see good research go unreported.

## Security Architecture Notes

For context on how chinwag's security works under the hood:

- **Transport:** All connections use TLS. The CLI connects via `wss://` (WebSocket Secure) and `https://`. Cloudflare terminates TLS at the edge.
- **Authentication:** UUID bearer tokens, generated at account creation, stored in Cloudflare KV for fast lookup. One token per user, with optional refresh rotation. WebSocket connections use short-lived single-use tickets (30s TTL) issued via `POST /auth/ws-ticket` to keep bearer tokens out of URLs, which may be logged by proxies or intermediaries.
- **Isolation:** Each Durable Object (DatabaseDO, TeamDO, RoomDO, LobbyDO) runs in its own single-threaded isolate. Cross-DO access is only possible through explicit stub calls, never shared memory.
- **Content moderation:** Two-layer system: synchronous blocklist (regex, under 1 ms) followed by async AI moderation (Llama Guard 3 on Cloudflare Workers AI). Both layers run before content is persisted for chat and status.
- **Rate limiting:** Account creation (3/IP/day), chat messages (10/min/user), new account chat cooldown (5 minutes).

## Acknowledgments

We will credit security researchers who report valid vulnerabilities (unless they prefer to remain anonymous) in our security advisories.

---

_This policy is adapted from recommendations by [disclose.io](https://disclose.io), the [CISA Vulnerability Disclosure Policy Template](https://www.cisa.gov/vulnerability-disclosure-policy-template), and standards set by [ISO/IEC 29147](https://www.iso.org/standard/72311.html). Last reviewed: March 2026._

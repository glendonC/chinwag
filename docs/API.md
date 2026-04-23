# API Reference

Base URL: `https://chinmeister-api.glendonchin.workers.dev`

## Authentication

All authenticated endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are issued by `POST /auth/init` (CLI/MCP) or the GitHub OAuth flow (web dashboard). They are stored locally in `~/.chinmeister/config.json`.

### Agent Identity Headers

Agent endpoints optionally accept these headers for per-tool identity and telemetry:

| Header              | Format                                          | Description                                       |
| ------------------- | ----------------------------------------------- | ------------------------------------------------- |
| `X-Agent-Id`        | `tool:hash` (1-60 chars, alphanumeric + `:._-`) | Agent identity. Falls back to user ID if omitted. |
| `X-Agent-Host-Tool` | alphanumeric + `_-` (max 50 chars)              | Host tool name (e.g. `cursor`, `claude-code`).    |
| `X-Agent-Surface`   | alphanumeric + `_-` (max 50 chars)              | UI surface (e.g. `editor`, `terminal`).           |
| `X-Agent-Transport` | alphanumeric + `_-` (max 50 chars)              | Transport type (e.g. `stdio`, `sse`).             |
| `X-Agent-Tier`      | alphanumeric + `_-` (max 50 chars)              | Connection tier.                                  |

### Token Lifecycle

| Token Type             | TTL                    | Renewal                                         |
| ---------------------- | ---------------------- | ----------------------------------------------- |
| Access token (CLI/MCP) | 90 days sliding window | Re-authenticated on every use                   |
| Refresh token          | 180 days               | Single-use, rotated on refresh                  |
| Web session token      | 30 days sliding window | Issued via GitHub OAuth                         |
| WebSocket ticket       | 30 seconds             | Single-use, obtained via `POST /auth/ws-ticket` |

### Authentication Flow

**CLI / MCP server (token-based):**

```
1. POST /auth/init              → { token, refresh_token, handle, color }
2. Use token as Bearer header on all subsequent requests
3. When token expires:
   POST /auth/refresh            → { token, refresh_token }
   (old refresh token is invalidated; use the new one next time)
```

**Web dashboard (GitHub OAuth):**

```
1. GET /auth/github              → 302 redirect to GitHub
2. User authorizes on GitHub
3. GitHub redirects to /auth/github/callback
4. Callback redirects to dashboard with #token=<session_token>
5. Use session token as Bearer header
```

**Linking GitHub to existing account:**

```
1. POST /auth/github/link        → { url } (redirect URL to GitHub)
2. User authorizes on GitHub
3. GitHub redirects to /auth/github/callback/link
4. Callback redirects to dashboard with #github_linked=1
```

---

## Error Format

All errors return JSON with an `error` field and an appropriate HTTP status code:

```json
{ "error": "Human-readable error message" }
```

Internal server errors include a reference ID for debugging:

```json
{ "error": "Internal server error (ref: a1b2c3d4)" }
```

### Status Code Mapping

| Code  | Meaning                                                       |
| ----- | ------------------------------------------------------------- |
| `400` | Validation error, bad input                                   |
| `401` | Missing or invalid authentication                             |
| `403` | Not authorized (not a team member, forbidden)                 |
| `404` | Resource not found                                            |
| `409` | Conflict (handle taken, lock held by another agent)           |
| `429` | Rate limit exceeded                                           |
| `500` | Internal server error                                         |
| `503` | Service temporarily unavailable (moderation down, DO timeout) |

---

## Rate Limits

Rate-limited endpoints return `429` with a `Retry-After: 3600` header when the limit is exceeded. All limits reset on a rolling 24-hour window.

### Per-User Limits (authenticated)

| Resource          | Limit        | Applies To                     |
| ----------------- | ------------ | ------------------------------ |
| Account creation  | 3/day per IP | `POST /auth/init`              |
| Token refresh     | 50/day       | `POST /auth/refresh`           |
| Team creation     | 5/day        | `POST /teams`                  |
| Team joins        | 100/day      | `POST /teams/{id}/join`        |
| File reports      | 500/day      | `POST /teams/{id}/file`        |
| Memory saves      | 20/day       | `POST /teams/{id}/memory`      |
| Memory updates    | 50/day       | `PUT /teams/{id}/memory`       |
| Memory deletes    | 50/day       | `DELETE /teams/{id}/memory`    |
| Lock claims       | 100/day      | `POST /teams/{id}/locks`       |
| Messages          | 200/day      | `POST /teams/{id}/messages`    |
| Session starts    | 50/day       | `POST /teams/{id}/sessions`    |
| Edit recordings   | 1000/day     | `POST /teams/{id}/sessionedit` |
| Tool evaluations  | 5/day        | `POST /tools/evaluate`         |
| WebSocket tickets | 100/day      | `POST /auth/ws-ticket`         |

### Per-IP Limits (public)

| Resource       | Limit   | Applies To                   |
| -------------- | ------- | ---------------------------- |
| Stats          | 200/day | `GET /stats`                 |
| Tool catalog   | 200/day | `GET /tools/catalog`         |
| Batch evaluate | 20/day  | `POST /tools/batch-evaluate` |

---

## Public Endpoints

### POST /auth/init

Create a new account. Returns credentials for CLI/MCP authentication.

**Rate limit:** 3/day per IP

**Request:** Empty body or `{}`

**Response** `201`:

```json
{
  "ok": true,
  "handle": "swiftfox",
  "color": "cyan",
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "refresh_token": "rt_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
}
```

**Errors:**

- `429` — Too many accounts created recently

---

### POST /auth/refresh

Exchange a refresh token for a new access token and refresh token. The old refresh token is invalidated (rotation).

**Rate limit:** 50/day per user

**Request:**

```json
{
  "refresh_token": "rt_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
}
```

**Response** `200`:

```json
{
  "ok": true,
  "token": "660e8400-e29b-41d4-a716-446655440001",
  "refresh_token": "rt_b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5"
}
```

**Errors:**

- `400` — `refresh_token` missing or wrong format (must start with `rt_`)
- `401` — Invalid or expired refresh token
- `429` — Token refresh limit reached

---

### GET /auth/github

Initiate GitHub OAuth login. Redirects to GitHub's authorization page.

**Response:** `302` redirect to `https://github.com/login/oauth/authorize?...`

---

### GET /auth/github/callback

GitHub OAuth callback. Exchanges the authorization code for an access token, creates or retrieves the user account, and redirects to the dashboard.

**Response:** `302` redirect to `https://chinmeister.com/dashboard#token=<session_token>`

**Error redirects:**

- `#error=github_denied` — User denied the OAuth request
- `#error=github_invalid` — Missing code or state
- `#error=github_expired` — OAuth state expired (10-minute window)
- `#error=github_token_failed` — GitHub token exchange failed
- `#error=github_profile_failed` — Failed to fetch GitHub profile
- `#error=rate_limited` — Account creation rate limit exceeded
- `#error=account_failed` — Account creation failed

---

### GET /auth/github/callback/link

GitHub OAuth callback for linking an existing account to GitHub. Requires a valid OAuth state that was initiated by `POST /auth/github/link`.

**Response:** `302` redirect to `https://chinmeister.com/dashboard#github_linked=1`

**Error redirects:**

- `#error=github_invalid` — Missing code or state
- `#error=github_expired` — OAuth state expired
- `#error=github_token_failed` — Token exchange failed
- `#error=github_profile_failed` — Profile fetch failed
- `#error=github_already_linked` — GitHub account linked to another user

---

### GET /stats

Global platform statistics.

**Rate limit:** 200/day per IP

**Response** `200`:

```json
{
  "ok": true,
  "totalUsers": 142,
  "online": 8,
  "chatUsers": 3,
  "activeRooms": 1
}
```

---

### GET /tools/catalog

Full AI dev tool catalog. Returns evaluated tools from the integrations catalog, falling back to the static catalog.

**Rate limit:** 200/day per IP

**Response** `200` (cached for 1 hour):

```json
{
  "tools": [
    {
      "id": "cursor",
      "name": "Cursor",
      "description": "AI-native code editor",
      "category": "editors",
      "website": "https://cursor.com",
      "installCmd": "brew install --cask cursor",
      "mcpCompatible": true,
      "featured": true
    }
  ],
  "categories": {
    "editors": "Editors & IDEs",
    "coding_agents": "Coding Agents",
    "mcp_servers": "MCP Servers"
  }
}
```

---

### GET /tools/directory

Browse the tool integrations catalog with filtering and pagination.

**Query parameters:**

| Param         | Type       | Default | Description                  |
| ------------- | ---------- | ------- | ---------------------------- |
| `q`           | string     | —       | Full-text search query       |
| `verdict`     | string     | —       | Filter by evaluation verdict |
| `category`    | string     | —       | Filter by category           |
| `mcp_support` | `0` or `1` | —       | Filter by MCP compatibility  |
| `in_registry` | `0` or `1` | —       | Filter by registry presence  |
| `limit`       | integer    | `50`    | Results per page (1-200)     |
| `offset`      | integer    | `0`     | Pagination offset            |

**Response** `200` (cached for 5 minutes):

```json
{
  "evaluations": [
    {
      "tool_id": "cursor",
      "name": "Cursor",
      "tagline": "AI-native code editor",
      "category": "editors",
      "verdict": "recommended",
      "confidence": 0.92,
      "mcp_support": 1,
      "metadata": { "website": "https://cursor.com" },
      "evaluated_at": "2026-03-15T10:30:00Z"
    }
  ],
  "categories": { "editors": "Editors & IDEs" }
}
```

---

### GET /tools/directory/:id

Get a single tool evaluation by ID.

**Response** `200` (cached for 5 minutes):

```json
{
  "evaluation": {
    "tool_id": "cursor",
    "name": "Cursor",
    "tagline": "AI-native code editor",
    "category": "editors",
    "verdict": "recommended",
    "confidence": 0.92,
    "mcp_support": 1,
    "metadata": {},
    "evaluated_at": "2026-03-15T10:30:00Z"
  }
}
```

**Errors:**

- `404` — Tool not found

---

## Authenticated User Endpoints

All endpoints in this section require `Authorization: Bearer <token>`.

### GET /me

Get the current user's profile.

**Response** `200`:

```json
{
  "handle": "swiftfox",
  "color": "cyan",
  "status": "refactoring auth module",
  "github_id": "12345",
  "github_login": "swiftfox",
  "avatar_url": "https://avatars.githubusercontent.com/u/12345",
  "created_at": "2026-01-15T08:00:00Z",
  "last_active": "2026-04-03T14:22:00Z"
}
```

---

### GET /me/teams

List teams the current user belongs to.

**Response** `200`:

```json
{
  "ok": true,
  "teams": [
    {
      "team_id": "t_a7b3c9d2e1f04856",
      "team_name": "chinmeister",
      "joined_at": "2026-02-10T09:00:00Z"
    }
  ]
}
```

---

### GET /me/dashboard

Cross-project dashboard summary for all the user's teams. Returns lightweight counts for each team.

**Response** `200`:

```json
{
  "teams": [
    {
      "team_id": "t_a7b3c9d2e1f04856",
      "team_name": "chinmeister",
      "active_agents": 2,
      "total_members": 4,
      "conflict_count": 1,
      "memory_count": 15,
      "live_sessions": 2,
      "recent_sessions_24h": 5,
      "tools_configured": [{ "tool": "claude-code", "joins": 12 }],
      "hosts_configured": [{ "host_tool": "claude-code", "joins": 12 }],
      "surfaces_seen": [{ "agent_surface": "terminal", "joins": 8 }],
      "models_seen": [{ "agent_model": "claude-sonnet-4-20250514", "count": 6 }],
      "usage": {}
    }
  ],
  "degraded": false,
  "failed_teams": [],
  "truncated": false
}
```

Capped at 25 teams. If some team summaries fail to load, `degraded` is `true` and `failed_teams` lists them. If all teams fail, returns `503`.

---

### PUT /me/handle

Change the user's handle. Content-moderated.

**Validation:** 3-20 characters, alphanumeric + underscores only. Must be globally unique.

**Request:**

```json
{
  "handle": "rapidotter"
}
```

**Response** `200`:

```json
{
  "ok": true,
  "handle": "rapidotter"
}
```

**Errors:**

- `400` — Invalid format, content blocked, or handle missing
- `409` — Handle already taken
- `503` — Content moderation unavailable

---

### PUT /me/color

Change the user's display color.

**Valid colors:** `red`, `cyan`, `yellow`, `green`, `magenta`, `blue`, `orange`, `lime`, `pink`, `sky`, `lavender`, `white`

**Request:**

```json
{
  "color": "orange"
}
```

**Response** `200`:

```json
{
  "ok": true,
  "color": "orange"
}
```

**Errors:**

- `400` — Invalid color

---

### PUT /status

Set the user's status. Content-moderated. Max 280 characters.

**Request:**

```json
{
  "status": "refactoring auth module"
}
```

**Response** `200`:

```json
{
  "ok": true
}
```

**Errors:**

- `400` — Status missing, too long, or content blocked
- `503` — Content moderation unavailable

---

### DELETE /status

Clear the user's status.

**Response** `200`:

```json
{
  "ok": true
}
```

---

### POST /presence/heartbeat

TUI presence heartbeat. Keeps the user marked as online for the global presence system (60-second window).

**Response** `200`:

```json
{
  "ok": true
}
```

---

### PUT /agent/profile

Register or update the agent's development environment profile.

**Request:**

```json
{
  "framework": "next.js",
  "languages": ["typescript", "python"],
  "frameworks": ["react", "express"],
  "tools": ["eslint", "prettier"],
  "platforms": ["cloudflare", "vercel"]
}
```

All fields are optional. `framework` is capped at 50 characters. Array fields are sanitized (lowercased, trimmed, max 50 items, max 50 chars each).

**Response** `200`:

```json
{
  "ok": true
}
```

---

### POST /tools/evaluate

Trigger an AI evaluation of a dev tool. Returns cached results if evaluated within the last 7 days.

**Rate limit:** 5/day

**Request:**

```json
{
  "name": "cursor"
}
```

Or:

```json
{
  "url": "https://cursor.com"
}
```

At least one of `name` (max 200 chars) or `url` (max 2000 chars) is required.

**Response** `201` (new evaluation):

```json
{
  "evaluation": {
    "tool_id": "cursor",
    "name": "Cursor",
    "tagline": "AI-native code editor",
    "verdict": "recommended",
    "confidence": 0.92,
    "category": "editors",
    "mcp_support": 1,
    "metadata": {},
    "evaluated_at": "2026-04-03T12:00:00Z"
  }
}
```

**Response** `200` (cached):

```json
{
  "evaluation": { ... },
  "cached": true
}
```

---

### POST /auth/ws-ticket

Obtain a single-use WebSocket authentication ticket. Tickets expire after 30 seconds.

**Rate limit:** 100/day

**Response** `200`:

```json
{
  "ticket": "tk_a1b2c3d4e5f6a1b2c3d4e5f6"
}
```

---

### POST /auth/github/link

Initiate linking a GitHub account to the current user. Returns a URL to redirect the user to GitHub for authorization.

**Response** `200`:

```json
{
  "url": "https://github.com/login/oauth/authorize?client_id=...&state=link:..."
}
```

---

### PUT /me/github

Unlink GitHub from the current user's account.

**Response** `200`:

```json
{
  "ok": true
}
```

---

## Team Endpoints

All team endpoints require authentication and use the team ID format `t_` followed by 16 hex characters (e.g., `t_a7b3c9d2e1f04856`). Invalid team IDs return `404`.

### POST /teams

Create a new team.

**Rate limit:** 5/day

**Request:**

```json
{
  "name": "my-project"
}
```

`name` is optional (max 100 characters, content-moderated).

**Response** `201`:

```json
{
  "ok": true,
  "team_id": "t_a7b3c9d2e1f04856"
}
```

---

### POST /teams/{id}/join

Join an existing team.

**Rate limit:** 100/day

**Request:**

```json
{
  "name": "my-project"
}
```

`name` is optional (max 100 characters, content-moderated). Sets or updates the team display name.

**Response** `200`:

```json
{
  "ok": true
}
```

**Errors:**

- `400` — Already a member, or join failed
- `503` — Content moderation unavailable

---

### POST /teams/{id}/leave

Leave a team. Releases all file locks held by the agent.

**Response** `200`:

```json
{
  "ok": true
}
```

---

### GET /teams/{id}/context

Full team state snapshot. Returns members, activity, conflicts, locks, memories, messages, sessions, and telemetry. Automatically bumps the calling agent's heartbeat.

**Response** `200`:

```json
{
  "ok": true,
  "members": [
    {
      "agent_id": "claude-code:a1b2c3",
      "handle": "swiftfox",
      "tool": "claude-code",
      "host_tool": "claude-code",
      "agent_surface": "terminal",
      "transport": "stdio",
      "agent_model": "claude-sonnet-4-20250514",
      "status": "active",
      "framework": "next.js",
      "session_minutes": 45,
      "seconds_since_update": 30,
      "minutes_since_update": 0,
      "signal_tier": "websocket",
      "activity": {
        "files": ["src/index.ts", "src/utils.ts"],
        "summary": "refactoring auth module",
        "updated_at": "2026-04-03T14:20:00Z"
      }
    }
  ],
  "conflicts": [
    {
      "file": "src/index.ts",
      "agents": ["swiftfox (claude-code)", "rapidotter (cursor)"]
    }
  ],
  "locks": [
    {
      "file_path": "src/auth.ts",
      "owner_handle": "swiftfox",
      "tool": "claude-code",
      "host_tool": "claude-code",
      "agent_surface": "terminal",
      "minutes_held": 12
    }
  ],
  "memories": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "text": "Auth tokens use sliding-window expiry",
      "tags": ["auth", "architecture"],
      "handle": "swiftfox",
      "host_tool": "claude-code",
      "agent_surface": "terminal",
      "agent_model": "claude-sonnet-4-20250514",
      "created_at": "2026-04-02T10:00:00Z",
      "updated_at": "2026-04-02T10:00:00Z"
    }
  ],
  "messages": [
    {
      "from_handle": "rapidotter",
      "from_tool": "cursor",
      "from_host_tool": "cursor",
      "from_agent_surface": "editor",
      "text": "starting work on the payments module",
      "created_at": "2026-04-03T14:15:00Z"
    }
  ],
  "recentSessions": [
    {
      "agent_id": "claude-code:a1b2c3",
      "owner_handle": "swiftfox",
      "framework": "next.js",
      "tool": "claude-code",
      "host_tool": "claude-code",
      "agent_surface": "terminal",
      "transport": "stdio",
      "agent_model": "claude-sonnet-4-20250514",
      "started_at": "2026-04-03T13:30:00Z",
      "ended_at": null,
      "edit_count": 23,
      "files_touched": ["src/auth.ts", "src/middleware.ts"],
      "conflicts_hit": 1,
      "memories_saved": 2,
      "duration_minutes": 52
    }
  ],
  "tools_configured": [{ "tool": "claude-code", "joins": 12 }],
  "hosts_configured": [{ "host_tool": "claude-code", "joins": 12 }],
  "surfaces_seen": [{ "agent_surface": "terminal", "joins": 8 }],
  "models_seen": [{ "agent_model": "claude-sonnet-4-20250514", "count": 6 }],
  "usage": { "conflict_checks": 15, "messages_sent": 42 }
}
```

**Errors:**

- `403` — Not a member of this team

---

### POST /teams/{id}/heartbeat

Agent heartbeat. Keeps the agent marked as active (60-second window). Agents that miss heartbeats for 15 minutes are evicted.

**Response** `200`:

```json
{
  "ok": true
}
```

**Errors:**

- `403` — Not a member of this team

---

## Activity Endpoints

### PUT /teams/{id}/activity

Report current working files and a summary of what the agent is doing.

**Request:**

```json
{
  "files": ["src/auth.ts", "src/middleware.ts"],
  "summary": "refactoring auth module"
}
```

**Validation:**

- `files`: non-empty array of strings, max 50 items, each max 500 chars, no absolute paths, no backslashes, no null bytes
- `summary`: string, max 280 characters, content-moderated

**Response** `200`:

```json
{
  "ok": true
}
```

---

### POST /teams/{id}/conflicts

Check which of your working files overlap with other active agents.

**Request:**

```json
{
  "files": ["src/auth.ts", "src/utils.ts"]
}
```

**Validation:** Same as `files` in activity.

**Response** `200`:

```json
{
  "ok": true,
  "conflicts": [
    {
      "owner_handle": "rapidotter",
      "tool": "cursor",
      "files": ["src/auth.ts"],
      "summary": "adding OAuth support"
    }
  ],
  "locked": [
    {
      "file": "src/utils.ts",
      "held_by": "swiftfox",
      "tool": "claude-code",
      "claimed_at": "2026-04-03T14:00:00Z"
    }
  ]
}
```

---

### POST /teams/{id}/file

Report a single file edit. Appends to the agent's file list.

**Rate limit:** 500/day

**Request:**

```json
{
  "file": "src/auth.ts"
}
```

**Validation:** Non-empty string, max 500 characters.

**Response** `200`:

```json
{
  "ok": true
}
```

---

## Memory Endpoints

Memories are shared project knowledge stored per team. Free-form tags, ordered by recency. Max 500 memories per team (oldest are evicted).

### POST /teams/{id}/memory

Save a new memory.

**Rate limit:** 20/day

**Request:**

```json
{
  "text": "Auth tokens use sliding-window expiry with 90-day TTL",
  "tags": ["auth", "architecture"]
}
```

**Validation:**

- `text`: required, max 2000 characters, content-moderated
- `tags`: optional array, max 10 tags, each max 50 characters, lowercased, content-moderated

**Response** `201`:

```json
{
  "ok": true,
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

If saving this memory causes older memories to be pruned (beyond the 500 cap):

```json
{
  "ok": true,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "evicted": 1
}
```

---

### GET /teams/{id}/memory

Search team memories.

**Query parameters:**

| Param   | Type    | Default | Description                         |
| ------- | ------- | ------- | ----------------------------------- |
| `q`     | string  | —       | Text search (substring match)       |
| `tags`  | string  | —       | Comma-separated tag list (OR match) |
| `limit` | integer | `20`    | Max results (1-50)                  |

**Example:** `GET /teams/t_a7b3c9d2e1f04856/memory?tags=auth,security&limit=10`

**Response** `200`:

```json
{
  "ok": true,
  "memories": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "text": "Auth tokens use sliding-window expiry",
      "tags": ["auth", "architecture"],
      "handle": "swiftfox",
      "host_tool": "claude-code",
      "agent_surface": "terminal",
      "agent_model": "claude-sonnet-4-20250514",
      "created_at": "2026-04-02T10:00:00Z",
      "updated_at": "2026-04-02T10:00:00Z"
    }
  ]
}
```

---

### PUT /teams/{id}/memory

Update an existing memory's text and/or tags. Any team member can update any memory.

**Rate limit:** 50/day

**Request:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Auth tokens use sliding-window expiry with 90-day TTL",
  "tags": ["auth", "tokens"]
}
```

`id` is required. At least one of `text` or `tags` must be provided. Same validation as save.

**Response** `200`:

```json
{
  "ok": true
}
```

**Errors:**

- `404` — Memory not found

---

### DELETE /teams/{id}/memory

Delete a memory. Any team member can delete any memory.

**Rate limit:** 50/day

**Request:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response** `200`:

```json
{
  "ok": true
}
```

**Errors:**

- `404` — Memory not found

---

## Lock Endpoints

Advisory file locks. Locks are tied to the agent's active heartbeat/WebSocket connection and are automatically released when the agent disconnects or goes stale.

### POST /teams/{id}/locks

Claim advisory locks on files.

**Rate limit:** 100/day

**Request:**

```json
{
  "files": ["src/auth.ts", "src/middleware.ts"]
}
```

**Validation:** Non-empty array, max 20 files, each max 500 chars, no absolute paths.

**Response** `200`:

```json
{
  "ok": true,
  "claimed": ["src/auth.ts"],
  "blocked": [
    {
      "file": "src/middleware.ts",
      "held_by": "rapidotter",
      "tool": "cursor",
      "host_tool": "cursor",
      "agent_surface": "editor",
      "claimed_at": "2026-04-03T14:00:00Z"
    }
  ]
}
```

---

### DELETE /teams/{id}/locks

Release file locks. Omit `files` to release all locks held by the agent.

**Request:**

```json
{
  "files": ["src/auth.ts"]
}
```

Or release all:

```json
{}
```

**Response** `200`:

```json
{
  "ok": true
}
```

---

### GET /teams/{id}/locks

List all active file locks in the team (only from agents with active heartbeats or WebSocket connections).

**Response** `200`:

```json
{
  "ok": true,
  "locks": [
    {
      "file_path": "src/auth.ts",
      "agent_id": "claude-code:a1b2c3",
      "handle": "swiftfox",
      "host_tool": "claude-code",
      "agent_surface": "terminal",
      "claimed_at": "2026-04-03T14:00:00Z",
      "minutes_held": 12
    }
  ]
}
```

---

## Message Endpoints

Ephemeral agent-to-agent messages. Messages auto-expire after 1 hour.

### POST /teams/{id}/messages

Send a message to the team or a specific agent.

**Rate limit:** 200/day

**Request:**

```json
{
  "text": "starting work on the payments module",
  "target": "cursor:b2c3d4"
}
```

**Validation:**

- `text`: required, max 500 characters, content-moderated
- `target`: optional string, routes the message to a specific agent ID

**Response** `201`:

```json
{
  "ok": true,
  "id": "660e8400-e29b-41d4-a716-446655440001"
}
```

---

### GET /teams/{id}/messages

Get recent messages visible to the calling agent (broadcast messages + messages targeted to this agent). Max 50 results.

**Query parameters:**

| Param   | Type               | Default    | Description                          |
| ------- | ------------------ | ---------- | ------------------------------------ |
| `since` | ISO 8601 timestamp | 1 hour ago | Only return messages after this time |

**Response** `200`:

```json
{
  "ok": true,
  "messages": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "handle": "swiftfox",
      "host_tool": "claude-code",
      "agent_surface": "terminal",
      "target_agent": null,
      "text": "starting work on the payments module",
      "created_at": "2026-04-03T14:15:00Z"
    }
  ]
}
```

---

## Session Endpoints

Sessions track agent work periods for observability. Each agent has at most one active session at a time.

### POST /teams/{id}/sessions

Start a new session. Automatically closes any previous active session for this agent.

**Rate limit:** 50/day

**Request:**

```json
{
  "framework": "next.js"
}
```

`framework` is optional (max 50 characters, defaults to `"unknown"`).

**Response** `201`:

```json
{
  "ok": true,
  "session_id": "770e8400-e29b-41d4-a716-446655440002"
}
```

---

### POST /teams/{id}/sessionend

End the active session.

**Request:**

```json
{
  "session_id": "770e8400-e29b-41d4-a716-446655440002"
}
```

**Response** `200`:

```json
{
  "ok": true
}
```

**Errors:**

- `404` — Session not found or not owned by this agent

---

### POST /teams/{id}/sessionedit

Record a file edit within the active session. Increments the edit counter and appends the file to the session's `files_touched` list.

**Rate limit:** 1000/day

**Request:**

```json
{
  "file": "src/auth.ts"
}
```

**Validation:** Non-empty string, max 500 characters.

**Response** `200`:

```json
{
  "ok": true
}
```

If no active session exists, the edit is silently skipped:

```json
{
  "ok": true,
  "skipped": true
}
```

---

### PUT /teams/{id}/sessionmodel

Enrich the active session and member record with model information (e.g., after model detection).

**Request:**

```json
{
  "model": "claude-sonnet-4-20250514"
}
```

**Validation:** Non-empty string, max 50 characters.

**Response** `200`:

```json
{
  "ok": true
}
```

---

### GET /teams/{id}/history

Get session history for the team.

**Query parameters:**

| Param  | Type    | Default | Description            |
| ------ | ------- | ------- | ---------------------- |
| `days` | integer | `7`     | Lookback period (1-30) |

**Response** `200`:

```json
{
  "ok": true,
  "sessions": [
    {
      "owner_handle": "swiftfox",
      "framework": "next.js",
      "host_tool": "claude-code",
      "agent_surface": "terminal",
      "transport": "stdio",
      "agent_model": "claude-sonnet-4-20250514",
      "started_at": "2026-04-03T13:30:00Z",
      "ended_at": "2026-04-03T14:15:00Z",
      "edit_count": 23,
      "files_touched": ["src/auth.ts", "src/middleware.ts"],
      "conflicts_hit": 1,
      "memories_saved": 2,
      "duration_minutes": 45
    }
  ]
}
```

---

## WebSocket Endpoints

### GET /ws/chat

Global chat room WebSocket. Requires authentication via Bearer token or ticket query parameter.

**Connection:** `wss://chinmeister-api.glendonchin.workers.dev/ws/chat?ticket=<ticket>`

**Query parameters:**

| Param     | Type   | Description                                               |
| --------- | ------ | --------------------------------------------------------- |
| `ticket`  | string | Single-use WebSocket ticket (from `POST /auth/ws-ticket`) |
| `shuffle` | `1`    | Request assignment to a different room                    |

**Restrictions:** New accounts must wait 5 minutes before joining chat.

**Room sizing:** 5-30 users per room, targeting 20. Users are auto-assigned to rooms by the lobby.

#### Client-to-Server Messages

```json
{
  "type": "message",
  "content": "hello everyone"
}
```

`content` max 280 characters, content-moderated. Rate limited to 10 messages per minute.

#### Server-to-Client Messages

**On connect — chat history:**

```json
{
  "type": "history",
  "messages": [
    {
      "type": "message",
      "handle": "swiftfox",
      "color": "cyan",
      "content": "hello",
      "timestamp": "2026-04-03T14:15:00.000Z"
    }
  ],
  "roomCount": 8
}
```

**Chat message:**

```json
{
  "type": "message",
  "handle": "swiftfox",
  "color": "cyan",
  "content": "hello everyone",
  "timestamp": "2026-04-03T14:16:00.000Z"
}
```

**User joined:**

```json
{
  "type": "join",
  "handle": "rapidotter",
  "color": "orange",
  "roomCount": 9
}
```

**User left:**

```json
{
  "type": "leave",
  "handle": "rapidotter",
  "roomCount": 8
}
```

**System message (rate limit, moderation):**

```json
{
  "type": "system",
  "content": "Slow down — max 10 messages per minute."
}
```

---

### GET /teams/{id}/ws

Team coordination WebSocket. Provides real-time updates for team activity, member status, locks, and more. Requires authentication via Bearer token or ticket.

**Connection:** `wss://chinmeister-api.glendonchin.workers.dev/teams/t_a7b3c9d2e1f04856/ws?ticket=<ticket>&role=agent`

**Query parameters:**

| Param    | Type                 | Default   | Description                                                                          |
| -------- | -------------------- | --------- | ------------------------------------------------------------------------------------ |
| `ticket` | string               | —         | Single-use WebSocket ticket                                                          |
| `role`   | `agent` or `watcher` | `watcher` | `agent` = MCP server (connection is presence). `watcher` = dashboard (observe only). |

**On connect:** The server sends the full team context as the first message:

```json
{
  "type": "context",
  "data": { ... }
}
```

The `data` field has the same shape as the `GET /teams/{id}/context` response.

#### Client-to-Server Messages

**Ping/heartbeat:**

```json
{
  "type": "ping",
  "lastToolUseAt": "2026-04-03T14:20:00.000Z"
}
```

`lastToolUseAt` is optional. Server responds with `{"type": "pong"}`.

**Activity update (agent role only):**

```json
{
  "type": "activity",
  "files": ["src/auth.ts"],
  "summary": "refactoring auth"
}
```

**File report (agent role only):**

```json
{
  "type": "file",
  "file": "src/auth.ts"
}
```

#### Server-to-Client Messages (broadcast to all connected clients)

**Member joined:**

```json
{
  "type": "member_joined",
  "agent_id": "claude-code:a1b2c3",
  "handle": "swiftfox",
  "tool": "claude-code"
}
```

**Member left:**

```json
{
  "type": "member_left",
  "agent_id": "claude-code:a1b2c3"
}
```

**Status change:**

```json
{
  "type": "status_change",
  "agent_id": "claude-code:a1b2c3",
  "status": "active"
}
```

**Activity update:**

```json
{
  "type": "activity",
  "agent_id": "claude-code:a1b2c3",
  "files": ["src/auth.ts"],
  "summary": "refactoring auth"
}
```

**File report:**

```json
{
  "type": "file",
  "agent_id": "claude-code:a1b2c3",
  "file": "src/auth.ts"
}
```

**Lock change:**

```json
{
  "type": "lock_change",
  "action": "claim",
  "agent_id": "claude-code:a1b2c3",
  "files": ["src/auth.ts"]
}
```

```json
{
  "type": "lock_change",
  "action": "release",
  "agent_id": "claude-code:a1b2c3",
  "files": ["src/auth.ts"]
}
```

```json
{
  "type": "lock_change",
  "action": "release_all",
  "agent_id": "claude-code:a1b2c3"
}
```

**Heartbeat (debounced, max once per 3 seconds per agent):**

```json
{
  "type": "heartbeat",
  "agent_id": "claude-code:a1b2c3",
  "ts": 1712153400000
}
```

**Memory saved:**

```json
{
  "type": "memory",
  "text": "Auth uses sliding-window tokens",
  "tags": ["auth"]
}
```

**Message sent:**

```json
{
  "type": "message",
  "from_handle": "swiftfox",
  "text": "starting payments work"
}
```

**Error:**

```json
{
  "type": "error",
  "message": "Failed to load initial context"
}
```

---

## Admin Endpoints

These endpoints are secured by a server-side admin key, not user authentication.

### POST /tools/batch-evaluate

Batch-evaluate multiple tools. Admin-only, secured by key in request body.

**Rate limit:** 20/day per IP

**Request:**

```json
{
  "admin_key": "<secret>",
  "tools": ["cursor", "windsurf", "zed"]
}
```

Max 50 tools per batch.

**Response** `200`:

```json
{
  "results": [
    { "name": "Cursor", "verdict": "recommended", "confidence": 0.92 },
    { "name": "windsurf", "error": "No evaluation returned" }
  ],
  "evaluated": 1,
  "errors": 1
}
```

---

### POST /tools/admin-delete

Delete tool evaluations by ID. Admin-only.

**Request:**

```json
{
  "admin_key": "<secret>",
  "ids": ["cursor", "old-duplicate"]
}
```

**Response** `200`:

```json
{
  "results": [
    { "id": "cursor", "deleted": true },
    { "id": "old-duplicate", "deleted": false }
  ]
}
```

---

## Team ID Format

`t_` followed by 16 hex characters. Example: `t_a7b3c9d2e1f04856`

Generated as a UUID with dashes removed, truncated to 16 characters.

## Body Size Limit

All request bodies are capped at 50 KB. WebSocket messages are also capped at 50 KB.

## CORS

The API supports CORS for the following origins:

- `https://chinmeister.com`
- `https://www.chinmeister.com`
- Localhost origins in non-production environments

Allowed headers: `Content-Type`, `Authorization`, `X-Agent-Id`, `X-Agent-Host-Tool`, `X-Agent-Surface`, `X-Agent-Transport`, `X-Agent-Tier`

## Timing

### Heartbeat Windows

| Window | Duration   | Effect                                                 |
| ------ | ---------- | ------------------------------------------------------ |
| Active | 60 seconds | Agent is shown as "active" in team context             |
| Stale  | 15 minutes | Agent is evicted, locks released, sessions auto-closed |

### Data Retention

| Data          | Retention                           |
| ------------- | ----------------------------------- |
| Messages      | 1 hour                              |
| Sessions      | 30 days                             |
| Memories      | Indefinite (capped at 500 per team) |
| Context cache | 5 seconds (server-side)             |

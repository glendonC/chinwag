# API Reference

Base URL: `https://chinwag-api.glendonchin.workers.dev`

All authenticated endpoints require `Authorization: Bearer <token>` header. Tokens are created via `POST /auth/init` and stored in `~/.chinwag/config.json`.

Agent endpoints also accept `X-Agent-Id` header (format: `tool:hash`) for per-tool identity.

## Public

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/init` | Create account. Returns `{handle, color, token}`. Rate limited: 3/day per IP. |
| GET | `/stats` | Global stats (online users, chat rooms). |
| GET | `/tools/catalog` | Full AI dev tool catalog. Cached 1hr. |

## User

| Method | Path | Description |
|--------|------|-------------|
| GET | `/me` | Current user profile. |
| GET | `/me/teams` | List user's teams. |
| GET | `/me/dashboard` | Cross-project summary (all teams). |
| PUT | `/me/handle` | Change handle. Body: `{handle}`. |
| PUT | `/me/color` | Change color. Body: `{color}`. |
| PUT | `/status` | Set status. Body: `{status}`. Content-moderated. |
| DELETE | `/status` | Clear status. |
| POST | `/presence/heartbeat` | TUI presence heartbeat. |
| PUT | `/agent/profile` | Register agent profile. Body: `{framework, languages, frameworks, tools, platforms}`. |

## Teams

| Method | Path | Description | Rate Limit |
|--------|------|-------------|------------|
| POST | `/teams` | Create team. Body: `{name?}`. | 5/day |
| POST | `/teams/{id}/join` | Join team. Body: `{name?}`. | — |
| POST | `/teams/{id}/leave` | Leave team. | — |
| GET | `/teams/{id}/context` | Full team state: members, conflicts, locks, messages, memories, sessions. | — |
| PUT | `/teams/{id}/activity` | Report files + summary. Body: `{files, summary}`. | — |
| POST | `/teams/{id}/conflicts` | Check file conflicts. Body: `{files}`. | — |
| POST | `/teams/{id}/heartbeat` | Agent heartbeat. | — |
| POST | `/teams/{id}/file` | Report single file edit. Body: `{file}`. | 500/day |
| POST | `/teams/{id}/memory` | Save memory. Body: `{text, category}`. | 20/day |
| GET | `/teams/{id}/memory` | Search memories. Query: `?q=&category=&limit=`. | — |
| PUT | `/teams/{id}/memory` | Update memory. Body: `{id, text?, category?}`. | — |
| DELETE | `/teams/{id}/memory` | Delete memory. Body: `{id}`. | — |
| POST | `/teams/{id}/locks` | Claim file locks. Body: `{files}`. | 100/day |
| DELETE | `/teams/{id}/locks` | Release file locks. Body: `{files?}`. | — |
| GET | `/teams/{id}/locks` | List active locks. | — |
| POST | `/teams/{id}/messages` | Send message. Body: `{text, target?}`. | 200/day |
| GET | `/teams/{id}/messages` | Get messages. Query: `?since=`. | — |
| POST | `/teams/{id}/sessions` | Start session. Body: `{framework?}`. | 50/day |
| POST | `/teams/{id}/sessionend` | End session. Body: `{session_id}`. | — |
| POST | `/teams/{id}/sessionedit` | Record edit in session. Body: `{file}`. | 1000/day |
| GET | `/teams/{id}/history` | Session history. Query: `?days=7`. | — |

## WebSocket

| Path | Description |
|------|-------------|
| GET | `/ws/chat` | Chat WebSocket. Query: `?shuffle=1` for room reassignment. 5-minute cooldown for new accounts. |

## Error Format

All errors return JSON: `{"error": "message"}` with appropriate HTTP status code. Rate-limited endpoints return `429`.

## Memory Categories

`gotcha`, `pattern`, `config`, `decision`, `reference`

## Team ID Format

`t_` followed by 16 hex characters (e.g., `t_a7b3c9d2e1f04856`).

// Shared JSDoc type definitions for the worker package.
// These types document the contracts between route handlers and Durable Objects.
//
// Import with: /** @import { DOResult, User, ... } from './types.js' */

// ── DO Result pattern ──
// Every DO method returns { ok: true, ...data } on success or { error: string } on failure.
// Route handlers check `.error` and map to the appropriate HTTP status.

/**
 * Successful DO response. May contain `ok: true` plus arbitrary data fields,
 * or may contain just data fields (e.g. `{ memories: [...] }`).
 * @typedef {Record<string, any>} DOSuccess
 */

/**
 * @typedef {{ error: string, code?: string }} DOError
 */

/**
 * Standard DO method return type. Check `.error` to distinguish success from failure.
 * @typedef {DOSuccess | DOError} DOResult
 */

// ── User ──

/**
 * @typedef {object} User
 * @property {string} id
 * @property {string} handle
 * @property {string} color
 * @property {string | null} status
 * @property {string | null} [github_id]
 * @property {string | null} [github_login]
 * @property {string | null} [avatar_url]
 * @property {string} created_at
 * @property {string} last_active
 */

/**
 * @typedef {object} NewUser
 * @property {string} id
 * @property {string} handle
 * @property {string} color
 * @property {string} token
 */

// ── Agent Runtime ──

/**
 * Normalized runtime metadata extracted from request headers.
 * @typedef {object} AgentRuntime
 * @property {string} agentId
 * @property {string} hostTool
 * @property {string | null} agentSurface
 * @property {string | null} transport
 * @property {string | null} tier
 */

/**
 * Normalized runtime metadata for DO submodules (no agentId).
 * @typedef {object} RuntimeMetadata
 * @property {string} hostTool
 * @property {string | null} agentSurface
 * @property {string | null} transport
 * @property {string | null} tier
 * @property {string | null} model
 */

// ── Team membership ──

/**
 * @typedef {object} TeamMember
 * @property {string} agent_id
 * @property {string} handle
 * @property {string} tool
 * @property {string} host_tool
 * @property {string | null} agent_surface
 * @property {string | null} transport
 * @property {string | null} agent_model
 * @property {'active' | 'offline'} status
 * @property {string | null} framework
 * @property {number | null} session_minutes
 * @property {number | null} seconds_since_update
 * @property {number | null} minutes_since_update
 * @property {'websocket' | 'http' | 'none'} signal_tier
 * @property {TeamActivity | null} activity
 */

/**
 * @typedef {object} TeamActivity
 * @property {string[]} files
 * @property {string} summary
 * @property {string} updated_at
 */

// ── Conflicts ──

/**
 * @typedef {object} FileConflict
 * @property {string} handle
 * @property {string} host_tool
 * @property {string[]} files
 * @property {string} summary
 */

/**
 * @typedef {object} LockedFile
 * @property {string} file
 * @property {string} handle
 * @property {string} host_tool
 * @property {string} claimed_at
 */

/**
 * @typedef {object} ConflictResult
 * @property {FileConflict[]} conflicts
 * @property {LockedFile[]} locked
 */

// ── Memory ──

/**
 * Memory entry as returned by searchMemories (memory.js).
 * Column names reflect the current schema: `handle`, `host_tool`, `agent_surface`, `agent_model`.
 *
 * The composite context query (queryTeamContext in context.js) also returns these rows with
 * backward-compatible SQL aliases: `source_handle`, `source_tool`, `source_host_tool`,
 * `source_agent_surface`, `source_model`. Consumers of the context endpoint may see both
 * the new names and the aliased names on the same object.
 *
 * @typedef {object} Memory
 * @property {string} id
 * @property {string} text
 * @property {string[]} tags — JSON-parsed from stored JSON array
 * @property {string} handle — user handle of the memory author
 * @property {string} host_tool — host tool that created this memory (e.g. "claude-code")
 * @property {string | null} agent_surface — agent surface if known
 * @property {string | null} agent_model — model identifier if known
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} [source_handle] - context query alias for `handle` (backward compat)
 * @property {string} [source_tool] - context query alias for `host_tool` (backward compat)
 * @property {string} [source_host_tool] - context query alias for `host_tool` (backward compat)
 * @property {string | null} [source_agent_surface] - context query alias for `agent_surface` (backward compat)
 * @property {string | null} [source_model] - context query alias for `agent_model` (backward compat)
 */

// ── Locks ──

/**
 * Result of claimFiles (locks.js). Contains the files successfully claimed
 * and any that were blocked by another agent's existing lock.
 * @typedef {object} LockClaim
 * @property {boolean} ok
 * @property {string[]} claimed — file paths successfully locked
 * @property {BlockedLock[]} blocked — files held by other agents
 */

/**
 * A lock that blocked a claim attempt, as returned by claimFiles (locks.js).
 * Note: uses `held_by` (not `handle`) for the owning agent's handle.
 * @typedef {object} BlockedLock
 * @property {string} file — the contested file path
 * @property {string} held_by — handle of the agent holding the lock
 * @property {string} tool — alias for host_tool (backward compat)
 * @property {string} host_tool — host tool of the lock holder
 * @property {string | null} agent_surface — agent surface of the lock holder
 * @property {string} claimed_at
 */

/**
 * Lock entry as returned by getLockedFiles (locks.js).
 * Uses the current schema column names: `handle`, `host_tool`.
 *
 * The composite context query (queryTeamContext in context.js) returns a different shape
 * with SQL aliases: `handle AS owner_handle`, `host_tool AS tool`, plus `host_tool`.
 * See ContextLockEntry for that shape.
 *
 * @typedef {object} LockEntry
 * @property {string} file_path
 * @property {string} agent_id
 * @property {string} handle — user handle of the lock owner
 * @property {string} host_tool — host tool of the lock owner
 * @property {string | null} agent_surface
 * @property {string} claimed_at
 * @property {number} minutes_held — computed elapsed time since claim
 */

/**
 * Lock entry as returned by queryTeamContext (context.js).
 * Uses SQL aliases for backward compatibility: `owner_handle`, `tool`.
 * @typedef {object} ContextLockEntry
 * @property {string} file_path
 * @property {string} owner_handle — alias for `handle` (backward compat)
 * @property {string} tool — alias for `host_tool` (backward compat)
 * @property {string} host_tool
 * @property {string | null} agent_surface
 * @property {number} minutes_held
 */

// ── Sessions ──

/**
 * Session entry as returned by getSessionHistory (sessions.js) and queryTeamContext (context.js).
 * Both use the SQL alias `handle AS owner_handle`, so `owner_handle` is the standard name
 * across all consumers. The underlying column is `handle`.
 *
 * queryTeamContext also enriches each row with a `tool` field (inferred from host_tool or agent_id).
 *
 * @typedef {object} SessionInfo
 * @property {string} owner_handle — alias for `handle` column (the session owner's handle)
 * @property {string} framework
 * @property {string} host_tool
 * @property {string | null} agent_surface
 * @property {string | null} transport
 * @property {string | null} agent_model
 * @property {string} started_at
 * @property {string | null} ended_at
 * @property {number} edit_count
 * @property {string[]} files_touched — JSON-parsed from stored JSON array
 * @property {number} conflicts_hit
 * @property {number} memories_saved
 * @property {number} duration_minutes — computed elapsed time
 * @property {string | null} [tool] - present in context query responses, inferred from host_tool/agent_id
 */

// ── Messages ──

/**
 * Agent message as returned by getMessages (messages.js).
 * Column names reflect the current schema: `handle`, `host_tool`, `agent_surface`.
 *
 * Note: the old `from_handle`, `from_tool`, `from_host_tool`, `from_agent_surface` names
 * are no longer used. The schema was renamed to drop the `from_` prefix.
 *
 * @typedef {object} AgentMessage
 * @property {string} id
 * @property {string} handle — sender's user handle
 * @property {string} host_tool — sender's host tool (e.g. "claude-code")
 * @property {string | null} agent_surface — sender's agent surface if known
 * @property {string | null} target_agent — recipient agent_id, or null for broadcast
 * @property {string} text
 * @property {string} created_at
 */

// ── Team context ──

/**
 * Full team context as returned by queryTeamContext (context.js).
 * Memories and locks in this response use backward-compatible SQL aliases
 * (see Memory and ContextLockEntry docs). Messages are NOT included here —
 * they are fetched separately via getMessages per-agent.
 *
 * @typedef {object} TeamContext
 * @property {TeamMember[]} members
 * @property {Array<{file: string, agents: string[]}>} conflicts
 * @property {ContextLockEntry[]} locks — uses aliased names (owner_handle, tool)
 * @property {Memory[]} memories — includes both new and aliased field names
 * @property {SessionInfo[]} recentSessions — includes extra `tool` field
 * @property {Array<{tool: string, joins: number}>} tools_configured
 * @property {Array<{host_tool: string, joins: number}>} hosts_configured
 * @property {Array<{agent_surface: string, joins: number}>} surfaces_seen
 * @property {Array<{agent_model: string, count: number}>} models_seen
 * @property {Record<string, number>} usage
 */

/**
 * @typedef {object} TeamSummary
 * @property {number} active_agents
 * @property {number} total_members
 * @property {number} conflict_count
 * @property {number} memory_count
 * @property {number} live_sessions
 * @property {number} recent_sessions_24h
 */

// ── Rate limiting ──

/**
 * @typedef {object} RateLimitCheck
 * @property {boolean} allowed
 * @property {number} count
 */

// ── Web session ──

/**
 * @typedef {object} WebSession
 * @property {string} token
 * @property {string} user_id
 * @property {string} expires_at
 * @property {string} last_used
 * @property {string | null} user_agent
 * @property {number} revoked
 */

// ── User teams ──

/**
 * @typedef {object} UserTeam
 * @property {string} team_id
 * @property {string | null} team_name
 * @property {string} joined_at
 */

// ── Agent profile ──

/**
 * @typedef {object} AgentProfile
 * @property {string | null} framework
 * @property {string[]} languages
 * @property {string[]} frameworks
 * @property {string[]} tools
 * @property {string[]} platforms
 */

// ── Moderation ──

/**
 * @typedef {object} ModerationResult
 * @property {boolean} blocked
 * @property {string} [reason]
 * @property {string[]} [categories]
 * @property {boolean} [degraded] - true when AI moderation was unavailable (blocklist still ran)
 */

// ── Worker environment bindings (from wrangler.toml) ──

/**
 * @typedef {object} Env
 * @property {DurableObjectNamespace} DATABASE
 * @property {DurableObjectNamespace} LOBBY
 * @property {DurableObjectNamespace} ROOM
 * @property {DurableObjectNamespace} TEAM
 * @property {KVNamespace} AUTH_KV
 * @property {any} AI
 * @property {string} ENVIRONMENT
 * @property {string} DASHBOARD_URL
 * @property {string} [GITHUB_CLIENT_ID]
 * @property {string} [GITHUB_CLIENT_SECRET]
 * @property {string} [EXA_API_KEY]
 */

// ── Parsed request body (from parseBody) ──

/**
 * @typedef {{ _parseError: string } | Record<string, any>} ParsedBody
 */

// ── Team path parse result ──

/**
 * @typedef {object} TeamPathResult
 * @property {string} teamId
 * @property {string} action
 */

export {};

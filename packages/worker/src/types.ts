// Shared type definitions for the worker package.
// These types document the contracts between route handlers and Durable Objects.
//
// Import with: import type { DOResult, User, ... } from './types.js'

// Forward-reference DO classes for Env typing.
// import type is erased at compile time, avoiding circular dependency issues.
// Phase 3 complete: DO classes are .ts with generic DurableObjectNamespace<T>, and
// lib/env.ts returns fully parameterized DurableObjectStub<T>. Route handlers call
// DO methods directly without `as any` casts.
import type { DatabaseDO } from './dos/database/index.js';
import type { LobbyDO } from './lobby.js';
import type { RoomDO } from './room.js';
import type { TeamDO } from './dos/team/index.js';

// ── DO Result pattern ──
// Every DO method returns { ok: true, ...data } on success or { error: string } on failure.
// Route handlers check `.error` and map to the appropriate HTTP status.

export type DOSuccess = Record<string, unknown>;

export interface DOError {
  error: string;
  code?: string;
}

/** Standard DO method return type. Check `.error` to distinguish success from failure. */
export type DOResult<T = DOSuccess> = T | DOError;

/** Type guard for the DO error shape. */
export function isDOError(value: unknown): value is DOError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as DOError).error === 'string'
  );
}

// ── User ──

export interface User {
  id: string;
  handle: string;
  color: string;
  status: string | null;
  github_id?: string | null;
  github_login?: string | null;
  avatar_url?: string | null;
  created_at: string;
  last_active: string;
}

export interface NewUser {
  id: string;
  handle: string;
  color: string;
  token: string;
}

// ── Agent Runtime ──

/** Normalized runtime metadata extracted from request headers. */
export interface AgentRuntime {
  [key: string]: unknown;
  agentId: string;
  hostTool: string;
  agentSurface: string | null;
  transport: string | null;
  tier: string | null;
}

/** Normalized runtime metadata for DO submodules (no agentId). */
export interface RuntimeMetadata {
  hostTool: string;
  agentSurface: string | null;
  transport: string | null;
  tier: string | null;
  model: string | null;
}

// ── Team membership ──

export interface TeamMember {
  agent_id: string;
  handle: string;
  tool: string;
  host_tool: string;
  agent_surface: string | null;
  transport: string | null;
  agent_model: string | null;
  status: 'active' | 'offline';
  framework: string | null;
  session_minutes: number | null;
  seconds_since_update: number | null;
  minutes_since_update: number | null;
  signal_tier: 'websocket' | 'http' | 'none';
  activity: TeamActivity | null;
}

export interface TeamActivity {
  files: string[];
  summary: string;
  updated_at: string;
}

// ── Conflicts ──

export interface FileConflict {
  handle: string;
  host_tool: string;
  files: string[];
  summary: string;
}

export interface LockedFile {
  file: string;
  handle: string;
  host_tool: string;
  claimed_at: string;
}

export interface ConflictResult {
  conflicts: FileConflict[];
  locked: LockedFile[];
}

// ── Memory ──

/**
 * Memory entry as returned by searchMemories.
 * Column names reflect the current schema: `handle`, `host_tool`, `agent_surface`, `agent_model`.
 */
export interface Memory {
  id: string;
  text: string;
  /** JSON-parsed from stored JSON array */
  tags: string[];
  /** User handle of the memory author */
  handle: string;
  /** Host tool that created this memory (e.g. "claude-code") */
  host_tool: string;
  agent_surface: string | null;
  agent_model: string | null;
  created_at: string;
  updated_at: string;
}

// ── Locks ──

/**
 * Result of claimFiles. Contains the files successfully claimed
 * and any that were blocked by another agent's existing lock.
 */
export interface LockClaim {
  ok: boolean;
  /** File paths successfully locked */
  claimed: string[];
  /** Files held by other agents */
  blocked: BlockedLock[];
}

/**
 * A lock that blocked a claim attempt, as returned by claimFiles.
 * Note: uses `held_by` (not `handle`) for the owning agent's handle.
 */
export interface BlockedLock {
  /** The contested file path */
  file: string;
  /** Handle of the agent holding the lock */
  held_by: string;
  /** Alias for host_tool (backward compat) */
  tool: string;
  /** Host tool of the lock holder */
  host_tool: string;
  /** Agent surface of the lock holder */
  agent_surface: string | null;
  claimed_at: string;
}

/**
 * Lock entry as returned by getLockedFiles.
 * Uses the current schema column names: `handle`, `host_tool`.
 *
 * The composite context query (queryTeamContext) returns a different shape
 * with SQL aliases: `handle AS owner_handle`, `host_tool AS tool`, plus `host_tool`.
 * See ContextLockEntry for that shape.
 */
export interface LockEntry {
  file_path: string;
  agent_id: string;
  /** User handle of the lock owner */
  handle: string;
  /** Host tool of the lock owner */
  host_tool: string;
  agent_surface: string | null;
  claimed_at: string;
  /** Computed elapsed time since claim */
  minutes_held: number;
}

/**
 * Lock entry as returned by queryTeamContext.
 * Uses SQL aliases for backward compatibility: `owner_handle`, `tool`.
 */
export interface ContextLockEntry {
  file_path: string;
  /** Alias for `handle` (backward compat) */
  owner_handle: string;
  /** Alias for `host_tool` (backward compat) */
  tool: string;
  host_tool: string;
  agent_surface: string | null;
  minutes_held: number;
}

// ── Sessions ──

/**
 * Session entry as returned by getSessionHistory and queryTeamContext.
 * Both use the SQL alias `handle AS owner_handle`, so `owner_handle` is the standard name
 * across all consumers. The underlying column is `handle`.
 *
 * queryTeamContext also enriches each row with a `tool` field (inferred from host_tool or agent_id).
 */
export interface SessionInfo {
  /** Alias for `handle` column (the session owner's handle) */
  owner_handle: string;
  framework: string;
  host_tool: string;
  agent_surface: string | null;
  transport: string | null;
  agent_model: string | null;
  started_at: string;
  ended_at: string | null;
  edit_count: number;
  /** JSON-parsed from stored JSON array */
  files_touched: string[];
  conflicts_hit: number;
  memories_saved: number;
  /** Computed elapsed time */
  duration_minutes: number;
  /** Present in context query responses, inferred from host_tool/agent_id */
  tool?: string | null;
}

// ── Messages ──

/**
 * Agent message as returned by getMessages.
 * Column names reflect the current schema: `handle`, `host_tool`, `agent_surface`.
 */
export interface AgentMessage {
  id: string;
  /** Sender's user handle */
  handle: string;
  /** Sender's host tool (e.g. "claude-code") */
  host_tool: string;
  /** Sender's agent surface if known */
  agent_surface: string | null;
  /** Recipient agent_id, or null for broadcast */
  target_agent: string | null;
  text: string;
  created_at: string;
}

// ── Team context ──

/**
 * Full team context as returned by queryTeamContext.
 * Memories and locks in this response use backward-compatible SQL aliases
 * (see Memory and ContextLockEntry docs). Messages are NOT included here --
 * they are fetched separately via getMessages per-agent.
 */
export interface TeamContext {
  members: TeamMember[];
  conflicts: Array<{ file: string; agents: string[] }>;
  /** Uses aliased names (owner_handle, tool) */
  locks: ContextLockEntry[];
  /** Includes both new and aliased field names */
  memories: Memory[];
  /** Includes extra `tool` field */
  recentSessions: SessionInfo[];
  tools_configured: Array<{ tool: string; joins: number }>;
  hosts_configured: Array<{ host_tool: string; joins: number }>;
  surfaces_seen: Array<{ agent_surface: string; joins: number }>;
  models_seen: Array<{ agent_model: string; count: number }>;
  usage: Record<string, number>;
}

export interface TeamSummary {
  active_agents: number;
  total_members: number;
  conflict_count: number;
  memory_count: number;
  live_sessions: number;
  recent_sessions_24h: number;
}

// ── Rate limiting ──

export interface RateLimitCheck {
  allowed: boolean;
  count: number;
}

// ── Web session ──

export interface WebSession {
  token: string;
  user_id: string;
  expires_at: string;
  last_used: string;
  user_agent: string | null;
  revoked: number;
}

// ── User teams ──

export interface UserTeam {
  team_id: string;
  team_name: string | null;
  joined_at: string;
}

// ── Agent profile ──

export interface AgentProfile {
  framework: string | null;
  languages: string[];
  frameworks: string[];
  tools: string[];
  platforms: string[];
}

// ── Moderation ──

export interface ModerationResult {
  blocked: boolean;
  reason?: string;
  categories?: string[];
  /** True when AI moderation was unavailable (content blocked as fail-safe) */
  degraded?: boolean;
}

// ── Worker environment bindings (from wrangler.toml) ──

export interface Env {
  DATABASE: DurableObjectNamespace<DatabaseDO>;
  LOBBY: DurableObjectNamespace<LobbyDO>;
  ROOM: DurableObjectNamespace<RoomDO>;
  TEAM: DurableObjectNamespace<TeamDO>;
  AUTH_KV: KVNamespace;
  AI: Ai;
  ENVIRONMENT: string;
  DASHBOARD_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  EXA_API_KEY?: string;
}

// ── Parsed request body (from parseBody) ──

export type ParsedBody = { _parseError: string } | Record<string, unknown>;

// ── Team path parse result ──

export interface TeamPathResult {
  teamId: string;
  action: string;
}

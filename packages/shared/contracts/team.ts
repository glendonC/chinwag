/**
 * Core team entity types — members, conflicts, locks, memory, messages, sessions.
 *
 * Naming convention: snake_case for API-persisted fields (database columns),
 * camelCase for ephemeral runtime identity (MCP process-internal).
 */

import { z } from 'zod';

export const agentStatusSchema = z.enum(['active', 'idle', 'offline']);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

/** Runtime-safe constants for AgentStatus comparisons. */
export const AGENT_STATUS = {
  ACTIVE: 'active',
  IDLE: 'idle',
  OFFLINE: 'offline',
} as const satisfies Record<string, AgentStatus>;

export const runtimeIdentityContractSchema = z.object({
  hostTool: z.string(),
  agentSurface: z.string().nullable(),
  transport: z.string(),
  tier: z.enum(['managed', 'connected']),
  capabilities: z.array(z.string()),
  detectionSource: z.enum(['explicit', 'mcp-client-info', 'parent-process', 'fallback']),
  detectionConfidence: z.number(),
});
export type RuntimeIdentityContract = z.infer<typeof runtimeIdentityContractSchema>;

export const memberActivitySchema = z.object({
  files: z.array(z.string()),
  summary: z.string().nullable(),
  updated_at: z.string().nullable().optional(),
});
export type MemberActivity = z.infer<typeof memberActivitySchema>;

/**
 * Common agent metadata attached to team resources.
 * Extracted to avoid duplicating these four fields across every interface.
 */
export const agentMetadataSchema = z.object({
  host_tool: z.string().nullable().optional(),
  agent_surface: z.string().nullable().optional(),
  transport: z.string().nullable().optional(),
  agent_model: z.string().nullable().optional(),
});
export type AgentMetadata = z.infer<typeof agentMetadataSchema>;

export const teamMemberSchema = agentMetadataSchema.extend({
  agent_id: z.string(),
  handle: z.string(),
  tool: z.string().nullable().optional(),
  host_tool: z.string(),
  status: agentStatusSchema,
  framework: z.string().nullable().optional(),
  session_minutes: z.number().nullable().optional(),
  seconds_since_update: z.number().nullable().optional(),
  minutes_since_update: z.number().nullable().optional(),
  signal_tier: z.string().nullable().optional(),
  activity: memberActivitySchema.nullable(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const teamConflictSchema = z.object({
  file: z.string(),
  agents: z.array(z.string()),
});
export type TeamConflict = z.infer<typeof teamConflictSchema>;

export const conflictMatchSchema = z.object({
  handle: z.string(),
  host_tool: z.string(),
  files: z.array(z.string()),
  summary: z.string(),
});
export type ConflictMatch = z.infer<typeof conflictMatchSchema>;

export const lockedConflictSchema = z.object({
  file: z.string(),
  handle: z.string(),
  host_tool: z.string(),
  claimed_at: z.string(),
});
export type LockedConflict = z.infer<typeof lockedConflictSchema>;

export const teamLockSchema = agentMetadataSchema.extend({
  file_path: z.string(),
  agent_id: z.string(),
  handle: z.string().nullable().optional(),
  owner_handle: z.string().nullable().optional(),
  tool: z.string().nullable().optional(),
  claimed_at: z.string().optional(),
  minutes_held: z.number().nullable().optional(),
});
export type TeamLock = z.infer<typeof teamLockSchema>;

export const teamMemorySchema = agentMetadataSchema.extend({
  id: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
  categories: z.array(z.string()),
  handle: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  last_accessed_at: z.string().nullable().optional(),
});
export type TeamMemory = z.infer<typeof teamMemorySchema>;

export const memoryCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string().nullable(),
  created_at: z.string(),
});
export type MemoryCategory = z.infer<typeof memoryCategorySchema>;

export const teamMessageSchema = agentMetadataSchema.extend({
  id: z.string().optional(),
  agent_id: z.string().nullable().optional(),
  handle: z.string().optional(),
  from_handle: z.string().optional(),
  from_tool: z.string().nullable().optional(),
  from_host_tool: z.string().nullable().optional(),
  from_agent_surface: z.string().nullable().optional(),
  text: z.string(),
  created_at: z.string(),
});
export type TeamMessage = z.infer<typeof teamMessageSchema>;

export const teamSessionSchema = agentMetadataSchema.extend({
  id: z.string().optional(),
  agent_id: z.string(),
  handle: z.string().optional(),
  owner_handle: z.string(),
  framework: z.string().nullable().optional(),
  host_tool: z.string(),
  tool: z.string().nullable().optional(),
  started_at: z.string(),
  ended_at: z.string().nullable().optional(),
  edit_count: z.number().optional(),
  files_touched: z.array(z.string()).optional(),
  conflicts_hit: z.number().optional(),
  memories_saved: z.number().optional(),
  duration_minutes: z.number().nullable().optional(),
  outcome: z.string().nullable().optional(),
  outcome_summary: z.string().nullable().optional(),
  outcome_tags: z.array(z.string()).optional(),
  lines_added: z.number().optional(),
  lines_removed: z.number().optional(),
  first_edit_at: z.string().nullable().optional(),
  got_stuck: z.boolean().optional(),
  memories_searched: z.number().optional(),
  input_tokens: z.number().nullable().optional(),
  output_tokens: z.number().nullable().optional(),
});
export type TeamSession = z.infer<typeof teamSessionSchema>;

export const conflictCheckResponseSchema = z.object({
  conflicts: z.array(conflictMatchSchema),
  locked: z.array(lockedConflictSchema),
});
export type ConflictCheckResponse = z.infer<typeof conflictCheckResponseSchema>;

/**
 * WebSocket event types for real-time dashboard updates.
 */

import { z } from 'zod';

import { agentStatusSchema } from './team.js';
import { teamContextSchema } from './dashboard.js';

export const heartbeatEventSchema = z.object({
  type: z.literal('heartbeat'),
  agent_id: z.string(),
});
export type HeartbeatEvent = z.infer<typeof heartbeatEventSchema>;

export const activityEventSchema = z.object({
  type: z.literal('activity'),
  agent_id: z.string(),
  files: z.array(z.string()).optional(),
  summary: z.string().nullable().optional(),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;

export const fileEventSchema = z.object({
  type: z.literal('file'),
  agent_id: z.string(),
  file: z.string(),
});
export type FileEvent = z.infer<typeof fileEventSchema>;

export const memberJoinedEventSchema = z.object({
  type: z.literal('member_joined'),
  agent_id: z.string(),
  handle: z.string().optional(),
  host_tool: z.string().optional(),
});
export type MemberJoinedEvent = z.infer<typeof memberJoinedEventSchema>;

export const memberLeftEventSchema = z.object({
  type: z.literal('member_left'),
  agent_id: z.string(),
});
export type MemberLeftEvent = z.infer<typeof memberLeftEventSchema>;

export const statusChangeEventSchema = z.object({
  type: z.literal('status_change'),
  agent_id: z.string(),
  status: agentStatusSchema,
});
export type StatusChangeEvent = z.infer<typeof statusChangeEventSchema>;

export const lockChangeEventSchema = z.object({
  type: z.literal('lock_change'),
  action: z.enum(['claim', 'release', 'release_all']),
  agent_id: z.string(),
  files: z.array(z.string()).optional(),
});
export type LockChangeEvent = z.infer<typeof lockChangeEventSchema>;

export const messageEventSchema = z.object({
  type: z.literal('message'),
  handle: z.string(),
  text: z.string(),
  created_at: z.string().optional(),
});
export type MessageEvent = z.infer<typeof messageEventSchema>;

export const memoryDeltaEventSchema = z.object({
  type: z.literal('memory'),
  id: z.string().optional(),
  text: z.string(),
  tags: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  handle: z.string().optional(),
  host_tool: z.string().optional(),
  created_at: z.string().optional(),
});
export type MemoryDeltaEvent = z.infer<typeof memoryDeltaEventSchema>;

export const commandStatusEventSchema = z.object({
  type: z.literal('command_status'),
  id: z.string(),
  status: z.string(),
  command_type: z.string().optional(),
  sender_handle: z.string().optional(),
  claimed_by: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});
export type CommandStatusEvent = z.infer<typeof commandStatusEventSchema>;

export const contextEventSchema = z.object({
  type: z.literal('context'),
  data: teamContextSchema,
});
export type ContextEvent = z.infer<typeof contextEventSchema>;

export type DashboardDeltaEvent =
  | HeartbeatEvent
  | ActivityEvent
  | FileEvent
  | MemberJoinedEvent
  | MemberLeftEvent
  | StatusChangeEvent
  | LockChangeEvent
  | MessageEvent
  | MemoryDeltaEvent
  | CommandStatusEvent;

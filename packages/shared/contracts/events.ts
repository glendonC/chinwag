/**
 * WebSocket event types for real-time dashboard updates.
 */

import type { AgentStatus } from './team.js';
import type { TeamContext } from './dashboard.js';

export interface HeartbeatEvent {
  type: 'heartbeat';
  agent_id: string;
}

export interface ActivityEvent {
  type: 'activity';
  agent_id: string;
  files?: string[];
  summary?: string | null;
}

export interface FileEvent {
  type: 'file';
  agent_id: string;
  file: string;
}

export interface MemberJoinedEvent {
  type: 'member_joined';
  agent_id: string;
  handle?: string;
  host_tool?: string;
}

export interface MemberLeftEvent {
  type: 'member_left';
  agent_id: string;
}

export interface StatusChangeEvent {
  type: 'status_change';
  agent_id: string;
  status: AgentStatus;
}

export interface LockChangeEvent {
  type: 'lock_change';
  action: 'claim' | 'release' | 'release_all';
  agent_id: string;
  files?: string[];
}

export interface MessageEvent {
  type: 'message';
  handle: string;
  text: string;
  created_at?: string;
}

export interface MemoryDeltaEvent {
  type: 'memory';
  id?: string;
  text: string;
  tags?: string[];
  categories?: string[];
  handle?: string;
  host_tool?: string;
  created_at?: string;
}

export interface CommandStatusEvent {
  type: 'command_status';
  id: string;
  status: string;
  command_type?: string;
  sender_handle?: string;
  claimed_by?: string;
  result?: Record<string, unknown>;
}

export interface ContextEvent {
  type: 'context';
  data: TeamContext;
}

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

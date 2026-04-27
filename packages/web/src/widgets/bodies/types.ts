import type { ComponentType } from 'react';
import type {
  UserAnalytics,
  ConversationAnalytics,
  Lock,
  TeamSummaryLive,
} from '../../lib/apiSchemas.js';
import type { LiveAgent } from '../types.js';

export interface WidgetBodyProps {
  analytics: UserAnalytics;
  conversationData: ConversationAnalytics;
  summaries: TeamSummaryLive[];
  liveAgents: LiveAgent[];
  /** File claims from the team context. Empty in cross-project (Overview) scope. */
  locks: Lock[];
  /**
   * True when the server hit MAX_DASHBOARD_TEAMS and dropped projects from the
   * summary. Only meaningful on Overview; omitted for Project-scope renders.
   */
  truncated?: boolean;
  selectTeam: (teamId: string) => void;
}

export type WidgetBody = ComponentType<WidgetBodyProps>;
export type WidgetRegistry = Record<string, WidgetBody>;

import type { ComponentType } from 'react';
import type { UserAnalytics, ConversationAnalytics } from '../../lib/apiSchemas.js';
import type { Lock } from '../../lib/apiSchemas.js';
import type { LiveAgent } from '../types.js';

export interface WidgetBodyProps {
  analytics: UserAnalytics;
  conversationData: ConversationAnalytics;
  summaries: Array<Record<string, unknown>>;
  liveAgents: LiveAgent[];
  /** File claims from the team context. Empty in cross-project (Overview) scope. */
  locks: Lock[];
  selectTeam: (teamId: string) => void;
}

export type WidgetBody = ComponentType<WidgetBodyProps>;
export type WidgetRegistry = Record<string, WidgetBody>;

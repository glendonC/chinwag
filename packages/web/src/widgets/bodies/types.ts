import type { ComponentType } from 'react';
import type { UserAnalytics, ConversationAnalytics } from '../../../lib/apiSchemas.js';
import type { LiveAgent } from '../useOverviewData.js';

export interface WidgetBodyProps {
  analytics: UserAnalytics;
  conversationData: ConversationAnalytics;
  summaries: Array<Record<string, unknown>>;
  liveAgents: LiveAgent[];
  selectTeam: (teamId: string) => void;
}

export type WidgetBody = ComponentType<WidgetBodyProps>;
export type WidgetRegistry = Record<string, WidgetBody>;

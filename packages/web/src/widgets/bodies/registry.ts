import type { WidgetRegistry } from './types.js';
import { liveWidgets } from './LiveWidgets.js';
import { usageWidgets } from './UsageWidgets.js';
import { outcomeWidgets } from './OutcomeWidgets.js';
import { trendWidgets } from './TrendWidgets.js';
import { activityWidgets } from './ActivityWidgets.js';
import { codebaseWidgets } from './CodebaseWidgets.js';
import { toolWidgets } from './ToolWidgets.js';
import { conversationWidgets } from './ConversationWidgets.js';
import { memoryWidgets } from './MemoryWidgets.js';
import { teamWidgets } from './TeamWidgets.js';

export const widgetBodies: WidgetRegistry = {
  ...liveWidgets,
  ...usageWidgets,
  ...outcomeWidgets,
  ...trendWidgets,
  ...activityWidgets,
  ...codebaseWidgets,
  ...toolWidgets,
  ...conversationWidgets,
  ...memoryWidgets,
  ...teamWidgets,
};

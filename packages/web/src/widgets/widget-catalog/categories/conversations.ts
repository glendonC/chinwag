import type { WidgetDef } from '../types.js';

export const CONVERSATIONS_WIDGETS: WidgetDef[] = [
  {
    id: 'topics',
    name: 'topics',
    description:
      'What your prompts are about. Classified from conversation content, so it tracks intent (what you asked for) — not code changes (what landed).',
    category: 'conversations',
    scope: 'both',
    viz: 'topic-bars',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['conversation'],
    fitContent: true,
  },
  {
    id: 'prompt-clarity',
    name: 'prompt clarity',
    description:
      'How phrasing quality correlates with session outcomes. Re-asks and confused prompts often mean the agent needs more memory or scope.',
    category: 'conversations',
    scope: 'both',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['conversation'],
  },
  {
    id: 'conversation-depth',
    name: 'conversation depth',
    description:
      'Edit output and completion rate bucketed by session turn count. Snapshot view of the current period — see prompt-efficiency for the same axis trended over time.',
    category: 'conversations',
    scope: 'both',
    viz: 'bucket-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['conversation_edit_correlation'],
  },
];

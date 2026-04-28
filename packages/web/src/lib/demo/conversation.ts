// Healthy baseline for ConversationAnalytics. Derives the capture
// denominator from the baseline tool profiles so conversations-widgets and
// analytics-widgets tell a coherent story (same tools contributing
// conversation logs across both surfaces).

import type { ConversationAnalytics } from '../apiSchemas.js';
import { TOOL_PROFILES } from './profiles.js';

export function createBaselineConversation(): ConversationAnalytics {
  // Assume ~68% of sessions on conversation-capable tools capture transcripts
  // in practice (the other ~32% bail before the first assistant turn, fail
  // the parser spec, or come from a managed agent that never handed off a
  // completion record).
  const captureRate = 0.68;
  // Rough session count across conversation-capable tools. Matches
  // TOTAL_SESSIONS (184) split by TOOL_PROFILES share on conversation-capable
  // tools (Claude Code, Codex, Aider, Cline). Kept as a stand-alone constant
  // so this module doesn't import baseline.ts (circularity).
  const convoCapableSessions = Math.round(
    TOOL_PROFILES.filter((t) => t.conversationLogs).reduce((s, t) => s + t.sessionShare, 0) * 184,
  );
  const sessions_with_conversations = Math.round(convoCapableSessions * captureRate);

  // Message counts: ~42 messages/session on captured sessions, ~60% assistant
  // (tool use, large responses) / 40% user.
  const total_messages = Math.round(sessions_with_conversations * 42);
  const assistant_messages = Math.round(total_messages * 0.6);
  const user_messages = total_messages - assistant_messages;

  // Sentiment distribution across captured user messages. Skew heavily toward
  // neutral/positive so the healthy scenario reads as working-well; the
  // partial-coverage and negative-delta scenarios will tilt this.
  const userMessagesForSentiment = user_messages;
  const sentimentShares: Array<[string, number]> = [
    ['neutral', 0.54],
    ['positive', 0.22],
    ['confused', 0.11],
    ['frustrated', 0.08],
    ['negative', 0.03],
    ['unclassified', 0.02],
  ];
  const sentiment_distribution = sentimentShares
    .map(([sentiment, share]) => ({
      sentiment,
      count: Math.round(userMessagesForSentiment * share),
    }))
    .filter((s) => s.count > 0);

  // Topic distribution on captured conversations. Labels cover the typical
  // spread in a codebase of this size - implementation, debugging, review,
  // planning, and meta-coordination prompts.
  const topic_distribution = [
    { topic: 'implementation', count: Math.round(sessions_with_conversations * 0.42) },
    { topic: 'debugging', count: Math.round(sessions_with_conversations * 0.28) },
    { topic: 'refactor', count: Math.round(sessions_with_conversations * 0.16) },
    { topic: 'review', count: Math.round(sessions_with_conversations * 0.1) },
    { topic: 'planning', count: Math.round(sessions_with_conversations * 0.08) },
    { topic: 'docs', count: Math.round(sessions_with_conversations * 0.06) },
    { topic: 'testing', count: Math.round(sessions_with_conversations * 0.05) },
  ].filter((t) => t.count > 0);

  // Dominant-sentiment × outcome correlation. Completion rates taper as the
  // session drifts from clear-positive through confused to pushback - this
  // is the "prompt clarity" story the widget reframes from sentiment data.
  const sentiment_outcome_correlation = [
    {
      dominant_sentiment: 'positive',
      sessions: Math.round(sessions_with_conversations * 0.26),
      completed: Math.round(sessions_with_conversations * 0.26 * 0.85),
      abandoned: Math.round(sessions_with_conversations * 0.26 * 0.1),
      failed: Math.round(sessions_with_conversations * 0.26 * 0.05),
      completion_rate: 85,
    },
    {
      dominant_sentiment: 'neutral',
      sessions: Math.round(sessions_with_conversations * 0.48),
      completed: Math.round(sessions_with_conversations * 0.48 * 0.74),
      abandoned: Math.round(sessions_with_conversations * 0.48 * 0.18),
      failed: Math.round(sessions_with_conversations * 0.48 * 0.08),
      completion_rate: 74,
    },
    {
      dominant_sentiment: 'confused',
      sessions: Math.round(sessions_with_conversations * 0.14),
      completed: Math.round(sessions_with_conversations * 0.14 * 0.52),
      abandoned: Math.round(sessions_with_conversations * 0.14 * 0.34),
      failed: Math.round(sessions_with_conversations * 0.14 * 0.14),
      completion_rate: 52,
    },
    {
      dominant_sentiment: 'frustrated',
      sessions: Math.round(sessions_with_conversations * 0.09),
      completed: Math.round(sessions_with_conversations * 0.09 * 0.38),
      abandoned: Math.round(sessions_with_conversations * 0.09 * 0.42),
      failed: Math.round(sessions_with_conversations * 0.09 * 0.2),
      completion_rate: 38,
    },
    {
      dominant_sentiment: 'negative',
      sessions: Math.round(sessions_with_conversations * 0.03),
      completed: Math.round(sessions_with_conversations * 0.03 * 0.22),
      abandoned: Math.round(sessions_with_conversations * 0.03 * 0.5),
      failed: Math.round(sessions_with_conversations * 0.03 * 0.28),
      completion_rate: 22,
    },
  ].filter((s) => s.sessions > 0);

  return {
    ok: true,
    period_days: 30,
    total_messages,
    user_messages,
    assistant_messages,
    sentiment_distribution,
    topic_distribution,
    sentiment_outcome_correlation,
    sessions_with_conversations,
    tool_coverage: {
      supported_tools: TOOL_PROFILES.filter((t) => t.conversationLogs).map((t) => t.id),
      unsupported_tools: TOOL_PROFILES.filter((t) => !t.conversationLogs).map((t) => t.id),
    },
  };
}

/**
 * Conversation intelligence types — message analysis, sentiment, and topic tracking.
 */

import { z } from 'zod';

export const conversationEventSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  agent_id: z.string(),
  handle: z.string(),
  host_tool: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  char_count: z.number(),
  sentiment: z.string().nullable(),
  topic: z.string().nullable(),
  sequence: z.number(),
  created_at: z.string(),
  input_tokens: z.number().nullable().default(null),
  output_tokens: z.number().nullable().default(null),
  cache_read_tokens: z.number().nullable().default(null),
  cache_creation_tokens: z.number().nullable().default(null),
  model: z.string().nullable().default(null),
  stop_reason: z.string().nullable().default(null),
});
export type ConversationEvent = z.infer<typeof conversationEventSchema>;

export const sentimentDistributionSchema = z.object({
  sentiment: z.string(),
  count: z.number(),
});
export type SentimentDistribution = z.infer<typeof sentimentDistributionSchema>;

export const topicDistributionSchema = z.object({
  topic: z.string(),
  count: z.number(),
});
export type TopicDistribution = z.infer<typeof topicDistributionSchema>;

export const sentimentOutcomeCorrelationSchema = z.object({
  dominant_sentiment: z.string(),
  sessions: z.number(),
  completed: z.number(),
  abandoned: z.number(),
  failed: z.number(),
  completion_rate: z.number(),
});
export type SentimentOutcomeCorrelation = z.infer<typeof sentimentOutcomeCorrelationSchema>;

export const sessionConversationStatsSchema = z.object({
  session_id: z.string(),
  message_count: z.number(),
  user_message_count: z.number(),
  assistant_message_count: z.number(),
  avg_user_msg_length: z.number(),
  avg_assistant_msg_length: z.number(),
  dominant_sentiment: z.string().nullable(),
  sentiment_shift: z.enum(['stable', 'improving', 'degrading']).nullable(),
  topics: z.array(z.string()),
});
export type SessionConversationStats = z.infer<typeof sessionConversationStatsSchema>;

export const conversationToolCoverageSchema = z.object({
  /** Tools that support conversation analytics. */
  supported_tools: z.array(z.string()),
  /** Tools active in this team that DON'T support conversation analytics. */
  unsupported_tools: z.array(z.string()),
});
export type ConversationToolCoverage = z.infer<typeof conversationToolCoverageSchema>;

export const conversationAnalyticsSchema = z.object({
  ok: z.literal(true),
  period_days: z.number(),
  total_messages: z.number(),
  user_messages: z.number(),
  assistant_messages: z.number(),
  sentiment_distribution: z.array(sentimentDistributionSchema),
  topic_distribution: z.array(topicDistributionSchema),
  sentiment_outcome_correlation: z.array(sentimentOutcomeCorrelationSchema),
  sessions_with_conversations: z.number(),
  /** Which tools in this team have/lack conversation support. */
  tool_coverage: conversationToolCoverageSchema,
});
export type ConversationAnalytics = z.infer<typeof conversationAnalyticsSchema>;

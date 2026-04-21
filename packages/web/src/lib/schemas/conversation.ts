// Conversation intelligence schemas.
// Base shapes imported from @chinwag/shared/contracts/conversation.js;
// client-specific .default() values applied for resilient UI rendering.

import { z } from 'zod';

import {
  sentimentDistributionSchema as baseSentimentDistributionSchema,
  topicDistributionSchema as baseTopicDistributionSchema,
  sentimentOutcomeCorrelationSchema as baseSentimentOutcomeCorrelationSchema,
  conversationToolCoverageSchema as baseConversationToolCoverageSchema,
  conversationAnalyticsSchema as baseConversationAnalyticsSchema,
} from '@chinwag/shared/contracts/conversation.js';

const sentimentDistributionSchema = baseSentimentDistributionSchema.extend({
  count: z.number().default(0),
});

const topicDistributionSchema = baseTopicDistributionSchema.extend({
  count: z.number().default(0),
});

const sentimentOutcomeCorrelationSchema = baseSentimentOutcomeCorrelationSchema.extend({
  sessions: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
  completion_rate: z.number().default(0),
});

const conversationToolCoverageSchema = baseConversationToolCoverageSchema.extend({
  supported_tools: z.array(z.string()).default([]),
  unsupported_tools: z.array(z.string()).default([]),
});

export const conversationAnalyticsSchema = baseConversationAnalyticsSchema.extend({
  total_messages: z.number().default(0),
  user_messages: z.number().default(0),
  assistant_messages: z.number().default(0),
  sentiment_distribution: z.array(sentimentDistributionSchema).default([]),
  topic_distribution: z.array(topicDistributionSchema).default([]),
  sentiment_outcome_correlation: z.array(sentimentOutcomeCorrelationSchema).default([]),
  sessions_with_conversations: z.number().default(0),
  tool_coverage: conversationToolCoverageSchema.default({
    supported_tools: [],
    unsupported_tools: [],
  }),
});

export type ConversationAnalytics = z.infer<typeof conversationAnalyticsSchema>;
export type SentimentDistribution = z.infer<typeof sentimentDistributionSchema>;
export type TopicDistribution = z.infer<typeof topicDistributionSchema>;
export type SentimentOutcomeCorrelation = z.infer<typeof sentimentOutcomeCorrelationSchema>;
export type ConversationToolCoverage = z.infer<typeof conversationToolCoverageSchema>;

export function createEmptyConversationAnalytics(): ConversationAnalytics {
  return {
    ok: true,
    period_days: 30,
    total_messages: 0,
    user_messages: 0,
    assistant_messages: 0,
    sentiment_distribution: [],
    topic_distribution: [],
    sentiment_outcome_correlation: [],
    sessions_with_conversations: 0,
    tool_coverage: { supported_tools: [], unsupported_tools: [] },
  };
}

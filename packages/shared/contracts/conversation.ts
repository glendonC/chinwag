/**
 * Conversation intelligence types — message analysis, sentiment, and topic tracking.
 */

export interface ConversationEvent {
  id: string;
  session_id: string;
  agent_id: string;
  handle: string;
  host_tool: string;
  role: 'user' | 'assistant';
  content: string;
  char_count: number;
  sentiment: string | null;
  topic: string | null;
  sequence: number;
  created_at: string;
}

export interface SentimentDistribution {
  sentiment: string;
  count: number;
}

export interface TopicDistribution {
  topic: string;
  count: number;
}

export interface CharCountTrend {
  sequence: number;
  avg_char_count: number;
}

export interface SentimentOutcomeCorrelation {
  dominant_sentiment: string;
  sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  completion_rate: number;
}

export interface SessionConversationStats {
  session_id: string;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  avg_user_msg_length: number;
  avg_assistant_msg_length: number;
  dominant_sentiment: string | null;
  sentiment_shift: 'stable' | 'improving' | 'degrading' | null;
  topics: string[];
}

export interface ConversationToolCoverage {
  /** Tools that support conversation analytics. */
  supported_tools: string[];
  /** Tools active in this team that DON'T support conversation analytics. */
  unsupported_tools: string[];
}

export interface ConversationAnalytics {
  ok: true;
  period_days: number;
  total_messages: number;
  user_messages: number;
  assistant_messages: number;
  avg_user_char_count: number;
  avg_assistant_char_count: number;
  sentiment_distribution: SentimentDistribution[];
  topic_distribution: TopicDistribution[];
  sentiment_outcome_correlation: SentimentOutcomeCorrelation[];
  sessions_with_conversations: number;
  /** Which tools in this team have/lack conversation support. */
  tool_coverage: ConversationToolCoverage;
}

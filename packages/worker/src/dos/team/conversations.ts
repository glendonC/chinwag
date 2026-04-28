// Conversation intelligence - store and analyze parsed messages from managed agent sessions.
// Captures user/assistant messages for sentiment tracking, message length trends,
// topic classification, and correlation with session outcomes.

import { createLogger } from '../../lib/logger.js';
import { row, rows as mapRows } from '../../lib/row.js';
import type {
  ConversationEvent,
  SentimentDistribution,
  TopicDistribution,
  SentimentOutcomeCorrelation,
  SessionConversationStats,
  ConversationAnalytics,
  ConversationToolCoverage,
} from '@chinmeister/shared/contracts/conversation.js';
import { getToolsWithCapability } from '@chinmeister/shared/tool-registry.js';
import { type AnalyticsScope, buildScopeFilter, withScope } from './analytics/scope.js';

const log = createLogger('TeamDO.conversations');

const ANALYTICS_MAX_DAYS = 90;
const BATCH_MAX_EVENTS = 500;
const MAX_CONTENT_LENGTH = 50000;

// -- Write operations --

export interface ConversationEventInput {
  role: 'user' | 'assistant';
  content: string;
  sentiment?: string | null;
  topic?: string | null;
  sequence: number;
  created_at?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_creation_tokens?: number | null;
  model?: string | null;
  stop_reason?: string | null;
}

export function recordConversationEvent(
  sql: SqlStorage,
  sessionId: string,
  agentId: string,
  handle: string,
  hostTool: string,
  event: ConversationEventInput,
): { ok: true; id: string } {
  const id = crypto.randomUUID();
  const content = event.content.slice(0, MAX_CONTENT_LENGTH);
  const charCount = content.length;

  sql.exec(
    `INSERT INTO conversation_events (id, session_id, agent_id, handle, host_tool, role, content, char_count, sentiment, topic, sequence, created_at, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model, stop_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?)`,
    id,
    sessionId,
    agentId,
    handle,
    hostTool || 'unknown',
    event.role,
    content,
    charCount,
    event.sentiment || null,
    event.topic || null,
    event.sequence,
    event.created_at || null,
    event.input_tokens ?? null,
    event.output_tokens ?? null,
    event.cache_read_tokens ?? null,
    event.cache_creation_tokens ?? null,
    event.model || null,
    event.stop_reason || null,
  );

  return { ok: true, id };
}

export function batchRecordConversationEvents(
  sql: SqlStorage,
  sessionId: string,
  agentId: string,
  handle: string,
  hostTool: string,
  events: ConversationEventInput[],
  transact: <T>(fn: () => T) => T,
): { ok: true; count: number } {
  if (events.length > BATCH_MAX_EVENTS) {
    log.warn(
      `batch truncated: ${events.length} events capped to ${BATCH_MAX_EVENTS} for session ${sessionId}`,
    );
  }
  const capped = events.slice(0, BATCH_MAX_EVENTS);

  transact(() => {
    for (const event of capped) {
      recordConversationEvent(sql, sessionId, agentId, handle, hostTool, event);
    }
  });

  return { ok: true, count: capped.length };
}

// -- Read operations --

export function getConversationForSession(
  sql: SqlStorage,
  sessionId: string,
): { ok: true; events: ConversationEvent[] } {
  const rows = sql
    .exec(
      `SELECT id, session_id, agent_id, handle, host_tool, role, content, char_count, sentiment, topic, sequence, created_at, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model, stop_reason
       FROM conversation_events
       WHERE session_id = ?
       ORDER BY sequence ASC
       LIMIT 1000`,
      sessionId,
    )
    .toArray();

  return {
    ok: true,
    events: mapRows(rows, (r) => ({
      id: r.string('id'),
      session_id: r.string('session_id'),
      agent_id: r.string('agent_id'),
      handle: r.string('handle'),
      host_tool: r.string('host_tool'),
      role: r.string('role') as 'user' | 'assistant',
      content: r.string('content'),
      char_count: r.number('char_count'),
      sentiment: r.nullableString('sentiment') || null,
      topic: r.nullableString('topic') || null,
      sequence: r.number('sequence'),
      created_at: r.string('created_at'),
      input_tokens: r.nullableNumber('input_tokens'),
      output_tokens: r.nullableNumber('output_tokens'),
      cache_read_tokens: r.nullableNumber('cache_read_tokens'),
      cache_creation_tokens: r.nullableNumber('cache_creation_tokens'),
      model: r.nullableString('model') || null,
      stop_reason: r.nullableString('stop_reason') || null,
    })),
  };
}

// -- Analytics queries --

export function getConversationAnalytics(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ConversationAnalytics {
  const periodDays = Math.max(1, Math.min(days, ANALYTICS_MAX_DAYS));

  return {
    ok: true,
    period_days: periodDays,
    ...queryMessageCounts(sql, scope, periodDays),
    sentiment_distribution: querySentimentDistribution(sql, scope, periodDays),
    topic_distribution: queryTopicDistribution(sql, scope, periodDays),
    sentiment_outcome_correlation: querySentimentOutcomeCorrelation(sql, scope, periodDays),
    sessions_with_conversations: querySessionsWithConversations(sql, scope, periodDays),
    tool_coverage: queryToolCoverage(sql, scope, periodDays),
  };
}

function queryMessageCounts(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): {
  total_messages: number;
  user_messages: number;
  assistant_messages: number;
} {
  try {
    const { sql: q, params } = withScope(
      `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_msgs,
           SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant_msgs
         FROM conversation_events
         WHERE created_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const rows = sql.exec(q, ...params).toArray();

    if (rows.length === 0) return { total_messages: 0, user_messages: 0, assistant_messages: 0 };

    const r = row(rows[0]);
    return {
      total_messages: r.number('total'),
      user_messages: r.number('user_msgs'),
      assistant_messages: r.number('assistant_msgs'),
    };
  } catch (err) {
    log.warn(`messageCounts query failed: ${err}`);
    return { total_messages: 0, user_messages: 0, assistant_messages: 0 };
  }
}

function querySentimentDistribution(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): SentimentDistribution[] {
  try {
    const f = buildScopeFilter(scope);
    const rows = sql
      .exec(
        `SELECT COALESCE(sentiment, 'unclassified') AS sentiment, COUNT(*) AS count
         FROM conversation_events
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND role = 'user'${f.sql}
         GROUP BY sentiment
         ORDER BY count DESC`,
        days,
        ...f.params,
      )
      .toArray();

    return mapRows(rows, (r) => ({
      sentiment: r.string('sentiment'),
      count: r.number('count'),
    }));
  } catch (err) {
    log.warn(`sentimentDistribution query failed: ${err}`);
    return [];
  }
}

function queryTopicDistribution(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): TopicDistribution[] {
  try {
    const f = buildScopeFilter(scope);
    const rows = sql
      .exec(
        `SELECT COALESCE(topic, 'unclassified') AS topic, COUNT(*) AS count
         FROM conversation_events
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND role = 'user'${f.sql}
         GROUP BY topic
         ORDER BY count DESC
         LIMIT 20`,
        days,
        ...f.params,
      )
      .toArray();

    return mapRows(rows, (r) => ({
      topic: r.string('topic'),
      count: r.number('count'),
    }));
  } catch (err) {
    log.warn(`topicDistribution query failed: ${err}`);
    return [];
  }
}

/**
 * Correlate user sentiment with session outcomes.
 * For each session, determine the dominant user sentiment,
 * then group sessions by that sentiment and show outcome rates.
 *
 * Scope handling: filtering ce.handle in the CTE restricts the universe of
 * sessions the JOIN can lift in, so the caller's data is the only data
 * surfaced. No second filter on `s` is needed.
 */
function querySentimentOutcomeCorrelation(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): SentimentOutcomeCorrelation[] {
  try {
    const f = buildScopeFilter(scope, { handleColumn: 'ce.handle' });
    const rows = sql
      .exec(
        `WITH session_sentiment AS (
           SELECT ce.session_id,
                  ce.sentiment,
                  COUNT(*) AS cnt,
                  ROW_NUMBER() OVER (PARTITION BY ce.session_id ORDER BY COUNT(*) DESC) AS rn
           FROM conversation_events ce
           WHERE ce.created_at > datetime('now', '-' || ? || ' days')
             AND ce.role = 'user'
             AND ce.sentiment IS NOT NULL${f.sql}
           GROUP BY ce.session_id, ce.sentiment
         ),
         dominant AS (
           SELECT session_id, sentiment AS dominant_sentiment
           FROM session_sentiment
           WHERE rn = 1
         )
         SELECT d.dominant_sentiment,
                COUNT(*) AS sessions,
                SUM(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN s.outcome = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
                SUM(CASE WHEN s.outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
                ROUND(100.0 * SUM(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 1) AS completion_rate
         FROM dominant d
         JOIN sessions s ON s.id = d.session_id
         GROUP BY d.dominant_sentiment
         ORDER BY sessions DESC`,
        days,
        ...f.params,
      )
      .toArray();

    return mapRows(rows, (r) => ({
      dominant_sentiment: r.string('dominant_sentiment'),
      sessions: r.number('sessions'),
      completed: r.number('completed'),
      abandoned: r.number('abandoned'),
      failed: r.number('failed'),
      completion_rate: r.number('completion_rate'),
    }));
  } catch (err) {
    log.warn(`sentimentOutcomeCorrelation query failed: ${err}`);
    return [];
  }
}

function querySessionsWithConversations(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): number {
  try {
    const { sql: q, params } = withScope(
      `SELECT COUNT(DISTINCT session_id) AS count
         FROM conversation_events
         WHERE created_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const rows = sql.exec(q, ...params).toArray();
    return rows.length > 0 ? row(rows[0]).number('count') : 0;
  } catch (err) {
    log.warn(`sessionsWithConversations query failed: ${err}`);
    return 0;
  }
}

/**
 * Report which tools in this team support conversation analytics and which don't.
 * Scoped: when called per-user, lists tools the *caller* has used. When
 * called team-wide, lists tools any teammate has used.
 */
function queryToolCoverage(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ConversationToolCoverage {
  const capableTools = new Set(getToolsWithCapability('conversationLogs'));

  try {
    const { sql: q, params } = withScope(
      `SELECT DISTINCT host_tool
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'`,
      [days],
      scope,
    );
    const rows = sql.exec(q, ...params).toArray();

    const activeTools = mapRows(rows, (r) => r.string('host_tool'));
    const supported = activeTools.filter((t) => capableTools.has(t));
    const unsupported = activeTools.filter((t) => !capableTools.has(t));

    return { supported_tools: supported, unsupported_tools: unsupported };
  } catch (err) {
    log.warn(`toolCoverage query failed: ${err}`);
    return { supported_tools: [], unsupported_tools: [] };
  }
}

/**
 * Per-session conversation stats for a list of sessions.
 * Used by the session detail view to show interaction patterns alongside edit data.
 */
export function getSessionConversationStats(
  sql: SqlStorage,
  sessionIds: string[],
): SessionConversationStats[] {
  if (sessionIds.length === 0) return [];

  const placeholders = sessionIds.map(() => '?').join(',');

  try {
    const rows = sql
      .exec(
        `SELECT session_id,
                COUNT(*) AS message_count,
                SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_count,
                SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant_count,
                ROUND(AVG(CASE WHEN role = 'user' THEN char_count END), 0) AS avg_user_len,
                ROUND(AVG(CASE WHEN role = 'assistant' THEN char_count END), 0) AS avg_assistant_len,
                GROUP_CONCAT(DISTINCT topic) AS topics
         FROM conversation_events
         WHERE session_id IN (${placeholders})
         GROUP BY session_id`,
        ...sessionIds,
      )
      .toArray();

    // For each session, also determine dominant sentiment and sentiment shift
    return mapRows(rows, (r) => {
      const sid = r.string('session_id');

      // Get sentiment progression for this session
      const sentiments = mapRows(
        sql
          .exec(
            `SELECT sentiment FROM conversation_events
           WHERE session_id = ? AND role = 'user' AND sentiment IS NOT NULL
           ORDER BY sequence ASC`,
            sid,
          )
          .toArray(),
        (s) => s.string('sentiment'),
      );

      const dominant = getDominantSentiment(sentiments);
      const shift = getSentimentShift(sentiments);
      const topicStr = r.string('topics');

      return {
        session_id: sid,
        message_count: r.number('message_count'),
        user_message_count: r.number('user_count'),
        assistant_message_count: r.number('assistant_count'),
        avg_user_msg_length: r.number('avg_user_len'),
        avg_assistant_msg_length: r.number('avg_assistant_len'),
        dominant_sentiment: dominant,
        sentiment_shift: shift,
        topics: topicStr ? topicStr.split(',').filter(Boolean) : [],
      };
    });
  } catch (err) {
    log.warn(`sessionConversationStats query failed: ${err}`);
    return [];
  }
}

// -- Helpers --

// Valence scores for sentiment shift detection.
// Must cover all sentiments from conversation-classify.ts VALID_SENTIMENTS.
// Unknown sentiments fall back to 0 via ?? in getSentimentShift.
const SENTIMENT_VALENCE: Record<string, number> = {
  positive: 1,
  neutral: 0,
  confused: -0.5,
  frustrated: -1,
  negative: -1,
};

function getDominantSentiment(sentiments: string[]): string | null {
  const first = sentiments[0];
  if (!first) return null;
  const counts: Record<string, number> = {};
  for (const s of sentiments) {
    counts[s] = (counts[s] || 0) + 1;
  }
  let max = 0;
  let dominant = first;
  for (const [sentiment, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      dominant = sentiment;
    }
  }
  return dominant;
}

function getSentimentShift(sentiments: string[]): 'stable' | 'improving' | 'degrading' | null {
  if (sentiments.length < 3) return null;

  const mid = Math.floor(sentiments.length / 2);
  const firstHalf = sentiments.slice(0, mid);
  const secondHalf = sentiments.slice(mid);

  const avgFirst =
    firstHalf.reduce((sum, s) => sum + (SENTIMENT_VALENCE[s] ?? 0), 0) / firstHalf.length;
  const avgSecond =
    secondHalf.reduce((sum, s) => sum + (SENTIMENT_VALENCE[s] ?? 0), 0) / secondHalf.length;

  const delta = avgSecond - avgFirst;
  if (Math.abs(delta) < 0.3) return 'stable';
  return delta > 0 ? 'improving' : 'degrading';
}

// Conversation intelligence routes - upload and query conversation events.

import type { RouteDefinition } from '../../lib/router.js';
import { rpc } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { teamJsonRoute, teamRoute, doResult } from '../../lib/middleware.js';
import { teamErrorStatus } from '../../lib/request-utils.js';
import { withRateLimit } from '../../lib/validation.js';
import { createLogger } from '../../lib/logger.js';
import { classifyConversationMessages } from '../../lib/conversation-classify.js';

const log = createLogger('routes.conversations');

const ANALYTICS_DEFAULT_DAYS = 7;
const ANALYTICS_MAX_DAYS = 90;
const MAX_EVENTS_PER_REQUEST = 500;
const MAX_CONTENT_LENGTH = 50000;
const RATE_LIMIT_CONVERSATION_UPLOADS = 200;
const VALID_ROLES = new Set(['user', 'assistant']);
const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'frustrated', 'confused', 'negative']);
const VALID_TOPICS = new Set([
  'bug-fix',
  'feature',
  'refactor',
  'testing',
  'documentation',
  'debugging',
  'configuration',
  'question',
  'review',
  'other',
]);

/**
 * POST /teams/:tid/conversations
 * Upload conversation events for a session.
 * User messages are classified with sentiment and topic via Workers AI (non-critical).
 */
export const handleTeamRecordConversation = teamJsonRoute(
  async ({ body, user, env, db, agentId, team }) => {
    const { session_id, events } = body;

    if (typeof session_id !== 'string' || !session_id.trim()) {
      return json({ error: 'session_id is required' }, 400);
    }

    if (!Array.isArray(events) || events.length === 0) {
      return json({ error: 'events must be a non-empty array' }, 400);
    }

    if (events.length > MAX_EVENTS_PER_REQUEST) {
      return json({ error: `events array exceeds maximum of ${MAX_EVENTS_PER_REQUEST}` }, 400);
    }

    // Validate each event
    for (let i = 0; i < events.length; i++) {
      const event = events[i] as Record<string, unknown>;
      if (!event || typeof event !== 'object') {
        return json({ error: `events[${i}] must be an object` }, 400);
      }
      if (!VALID_ROLES.has(event.role as string)) {
        return json({ error: `events[${i}].role must be 'user' or 'assistant'` }, 400);
      }
      if (typeof event.content !== 'string' || !event.content.trim()) {
        return json({ error: `events[${i}].content must be a non-empty string` }, 400);
      }
      if ((event.content as string).length > MAX_CONTENT_LENGTH) {
        return json(
          { error: `events[${i}].content exceeds maximum length of ${MAX_CONTENT_LENGTH}` },
          400,
        );
      }
      if (typeof event.sequence !== 'number' || event.sequence < 0) {
        return json({ error: `events[${i}].sequence must be a non-negative number` }, 400);
      }
    }

    // Classify user messages with sentiment and topic via Workers AI (non-critical)
    const typedEvents = events as Array<{
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
    }>;

    // Strip invalid sentiment/topic values from client-supplied events
    for (const event of typedEvents) {
      if (event.sentiment && !VALID_SENTIMENTS.has(event.sentiment)) event.sentiment = null;
      if (event.topic && !VALID_TOPICS.has(event.topic)) event.topic = null;
    }

    const userMessages = typedEvents
      .map((e, i) => ({ content: e.content, index: i }))
      .filter((_, i) => typedEvents[i]?.role === 'user');

    if (userMessages.length > 0) {
      try {
        const classifications = await classifyConversationMessages(userMessages, env);
        for (const c of classifications) {
          const target = typedEvents[c.index];
          if (!target) continue;
          if (c.sentiment) target.sentiment = c.sentiment;
          if (c.topic) target.topic = c.topic;
        }
      } catch (err) {
        // Non-critical: store events without classification
        log.warn(`conversation classification skipped: ${err}`);
      }
    }

    return withRateLimit(
      db,
      `conversation:${user.id}`,
      RATE_LIMIT_CONVERSATION_UPLOADS,
      'Conversation upload limit reached. Try again tomorrow.',
      async () => {
        const result = rpc(
          await team.recordConversationEvents(
            agentId,
            session_id as string,
            user.handle,
            (body.host_tool as string) || 'unknown',
            typedEvents,
            user.id,
          ),
        );
        if ('error' in result) {
          log.warn(`recordConversationEvents failed: ${result.error}`);
          return json({ error: result.error }, teamErrorStatus(result));
        }
        return json(result, 201);
      },
    );
  },
);

/**
 * GET /teams/:tid/conversations?session_id=xxx
 * Get conversation events for a session.
 */
export const handleTeamGetConversation = teamRoute(async ({ request, agentId, team, user }) => {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) return json({ error: 'session_id query parameter is required' }, 400);

  return doResult(team.getConversation(agentId, sessionId, user.id), 'getConversation');
});

/**
 * GET /teams/:tid/conversations/analytics?days=7
 * Get conversation analytics (sentiment, topics, correlations).
 */
export const handleTeamConversationAnalytics = teamRoute(
  async ({ request, agentId, team, user }) => {
    const url = new URL(request.url);
    const parsed = parseInt(url.searchParams.get('days') || String(ANALYTICS_DEFAULT_DAYS), 10);
    const days = Math.max(
      1,
      Math.min(isNaN(parsed) ? ANALYTICS_DEFAULT_DAYS : parsed, ANALYTICS_MAX_DAYS),
    );

    // Privacy-by-default: scope conversation analytics to the caller's own
    // messages. Aggregating across teammates exposed sentiment/topic/length
    // distributions and outcome correlations that should stay personal.
    // Team-tier admin views, when they ship, must build a separate route
    // that explicitly passes an empty scope and gates on a role check.
    return doResult(
      team.getConversationAnalytics(agentId, days, user.id, { handle: user.handle }),
      'getConversationAnalytics',
    );
  },
);

/**
 * Conversation upload, query, and analytics routes.
 */
export function registerConversationsRoutes(TID: string): RouteDefinition[] {
  return [
    { method: 'POST', path: `/teams/${TID}/conversations`, handler: handleTeamRecordConversation },
    { method: 'GET', path: `/teams/${TID}/conversations`, handler: handleTeamGetConversation },
    {
      method: 'GET',
      path: `/teams/${TID}/conversations/analytics`,
      handler: handleTeamConversationAnalytics,
    },
  ];
}

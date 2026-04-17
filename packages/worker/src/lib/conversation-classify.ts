// AI-powered conversation classification using Cloudflare Workers AI.
// Runs sentiment and topic classification on conversation messages.
// Non-critical: gracefully degrades when AI is unavailable.

import type { Env } from '../types.js';
import { createLogger } from './logger.js';
import { chatCompletion } from './ai.js';

const log = createLogger('conversation-classify');

export interface ClassifiedMessage {
  index: number;
  sentiment: string | null;
  topic: string | null;
}

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

// Classify up to this many messages per batch to stay within token limits
const BATCH_SIZE = 20;

/**
 * Classify user messages with sentiment and topic using Workers AI.
 * Returns classifications indexed by position in the input array.
 * Non-critical: returns empty array if AI is unavailable.
 */
export async function classifyConversationMessages(
  messages: Array<{ content: string; index: number }>,
  env: Env,
): Promise<ClassifiedMessage[]> {
  if (!env.AI) {
    log.warn('conversation classification degraded: env.AI binding unavailable');
    return [];
  }

  if (messages.length === 0) return [];

  const results: ClassifiedMessage[] = [];

  // Process in batches to stay within token limits
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const batchResults = await classifyBatch(batch, env);
    results.push(...batchResults);
  }

  return results;
}

async function classifyBatch(
  messages: Array<{ content: string; index: number }>,
  env: Env,
): Promise<ClassifiedMessage[]> {
  // Build a prompt that asks for structured classification of multiple messages
  const numberedMessages = messages
    .map((m, i) => `[${i + 1}] ${m.content.slice(0, 500)}`)
    .join('\n\n');

  const prompt = `Classify each user message below with a sentiment and topic.

Sentiments: positive, neutral, frustrated, confused, negative
Topics: bug-fix, feature, refactor, testing, documentation, debugging, configuration, question, review, other

Reply ONLY with one line per message in this exact format:
[number] sentiment topic

Messages:
${numberedMessages}`;

  const output = await chatCompletion(env.AI, {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: messages.length * 20,
  });

  if (!output) {
    log.warn('conversation classification: empty or failed response from model');
    return messages.map((m) => ({ index: m.index, sentiment: null, topic: null }));
  }

  return parseClassificationResponse(output, messages);
}

function parseClassificationResponse(
  output: string,
  messages: Array<{ content: string; index: number }>,
): ClassifiedMessage[] {
  const lines = output.split('\n').filter(Boolean);

  // Build a lookup from line number → parsed classification
  const byNumber = new Map<number, { sentiment: string; topic: string }>();
  for (const line of lines) {
    const match = line.match(/\[(\d+)\]\s+(\S+)\s+(\S+)/);
    if (match && match[1] && match[2] && match[3]) {
      byNumber.set(parseInt(match[1], 10), {
        sentiment: match[2].toLowerCase(),
        topic: match[3].toLowerCase(),
      });
    }
  }

  // Map each message to its classification by 1-based number
  return messages.map((msg, i) => {
    const parsed = byNumber.get(i + 1);
    if (!parsed) return { index: msg.index, sentiment: null, topic: null };

    return {
      index: msg.index,
      sentiment: VALID_SENTIMENTS.has(parsed.sentiment) ? parsed.sentiment : null,
      topic: VALID_TOPICS.has(parsed.topic) ? parsed.topic : null,
    };
  });
}

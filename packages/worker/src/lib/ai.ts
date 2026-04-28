/**
 * Typed wrappers for Cloudflare Workers AI operations.
 *
 * Centralizes the model-name type workaround: CF's Ai type union
 * doesn't include every available model, so we cast the model string
 * once here instead of scattering `as any` across consumers.
 */

import { createLogger } from './logger.js';

const log = createLogger('ai');

// Cloudflare's Ai type doesn't export a union of all valid model names,
// so custom/newer models need a cast. Isolate that cast here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AiModel = any;

const EMBEDDING_MODEL: AiModel = '@cf/baai/bge-small-en-v1.5';
const CHAT_MODEL: AiModel = '@cf/meta/llama-4-scout-17b-16e-instruct';

/**
 * Generate a 384-dim embedding vector for semantic similarity.
 * Returns null on failure - embedding is non-critical for all callers.
 *
 * Logs at warn so recurring AI outages are visible in production logs:
 * silent null returns degrade memory dedup quality without any signal.
 *
 * Uses cls pooling explicitly: Cloudflare's bge-small-en-v1.5 endpoint
 * defaults to mean pooling for backcompat, but the upstream HF model card
 * is calibrated for cls. Mean pooling silently degrades quality by several
 * MTEB points, especially on longer inputs. Always pass `pooling: 'cls'`.
 */
export async function generateEmbedding(text: string, ai: Ai): Promise<ArrayBuffer | null> {
  try {
    const result = await ai.run(EMBEDDING_MODEL, { text: [text], pooling: 'cls' });
    if (result?.data?.[0]) {
      return new Float32Array(result.data[0]).buffer as ArrayBuffer;
    }
    log.warn('embedding generation returned empty result', { model: EMBEDDING_MODEL });
    return null;
  } catch (err) {
    log.warn('embedding generation failed', {
      model: EMBEDDING_MODEL,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface ChatOptions {
  messages: ChatMessage[];
  max_tokens?: number;
}

/**
 * Run a chat completion against the default LLM.
 * Returns the response string, or null on failure.
 */
export async function chatCompletion(ai: Ai, options: ChatOptions): Promise<string | null> {
  try {
    const response = await ai.run(CHAT_MODEL, options);
    const raw = (response as { response?: string })?.response;
    return typeof raw === 'string' ? raw.trim() : null;
  } catch (err) {
    log.warn('chat completion failed', {
      model: CHAT_MODEL,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

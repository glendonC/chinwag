/**
 * Approximate model pricing for cost estimation.
 * Prices in USD per 1M tokens. Updated periodically — estimates only.
 * Uses normalized model names from runtime.ts (lowercase, no date suffixes).
 */

interface ModelPricing {
  input_per_1m: number;
  output_per_1m: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4': { input_per_1m: 15.0, output_per_1m: 75.0 },
  'claude-sonnet-4': { input_per_1m: 3.0, output_per_1m: 15.0 },
  'claude-sonnet-3-5': { input_per_1m: 3.0, output_per_1m: 15.0 },
  'claude-haiku-3-5': { input_per_1m: 0.8, output_per_1m: 4.0 },
  'claude-opus-3': { input_per_1m: 15.0, output_per_1m: 75.0 },
  'claude-sonnet-3': { input_per_1m: 3.0, output_per_1m: 15.0 },
  'claude-haiku-3': { input_per_1m: 0.25, output_per_1m: 1.25 },

  // OpenAI
  'gpt-4o': { input_per_1m: 2.5, output_per_1m: 10.0 },
  'gpt-4o-mini': { input_per_1m: 0.15, output_per_1m: 0.6 },
  'gpt-4-turbo': { input_per_1m: 10.0, output_per_1m: 30.0 },
  'gpt-4': { input_per_1m: 30.0, output_per_1m: 60.0 },
  'gpt-4.1': { input_per_1m: 2.0, output_per_1m: 8.0 },
  'gpt-4.1-mini': { input_per_1m: 0.4, output_per_1m: 1.6 },
  'gpt-4.1-nano': { input_per_1m: 0.1, output_per_1m: 0.4 },
  o3: { input_per_1m: 2.0, output_per_1m: 8.0 },
  'o3-mini': { input_per_1m: 1.1, output_per_1m: 4.4 },
  'o4-mini': { input_per_1m: 1.1, output_per_1m: 4.4 },

  // Google
  'gemini-2.5-pro': { input_per_1m: 1.25, output_per_1m: 10.0 },
  'gemini-2.5-flash': { input_per_1m: 0.15, output_per_1m: 0.6 },
  'gemini-2.0-flash': { input_per_1m: 0.1, output_per_1m: 0.4 },
  'gemini-1.5-pro': { input_per_1m: 1.25, output_per_1m: 5.0 },

  // xAI
  'grok-3': { input_per_1m: 3.0, output_per_1m: 15.0 },
  'grok-3-mini': { input_per_1m: 0.3, output_per_1m: 0.5 },

  // DeepSeek
  'deepseek-v3': { input_per_1m: 0.27, output_per_1m: 1.1 },
  'deepseek-r1': { input_per_1m: 0.55, output_per_1m: 2.19 },
};

/**
 * Estimate session cost from token counts and normalized model name.
 * Returns null for unknown models — callers should handle gracefully.
 */
export function estimateSessionCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (!model) return null;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (
    (inputTokens / 1_000_000) * pricing.input_per_1m +
    (outputTokens / 1_000_000) * pricing.output_per_1m
  );
}

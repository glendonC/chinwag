/**
 * Spec validation pipeline.
 *
 * Validates a candidate ParserSpec against sample log data.
 * Used after AI-generated spec healing to ensure the candidate
 * actually produces valid, non-empty, correctly-typed output
 * before hot-swapping.
 */

import { readFile } from 'fs/promises';
import { extract } from './engine.js';
import type { ParserSpec, ExtractionResult } from './types.js';
import { createLogger } from '@chinwag/shared';

const log = createLogger('spec-validator');

export interface ValidationResult {
  valid: boolean;
  conversationsExtracted: number;
  tokensExtracted: boolean;
  toolCallsExtracted: number;
  errors: string[];
}

/**
 * Validate a candidate spec against a sample file.
 *
 * Checks:
 * 1. Spec has required fields (version, tool, format, discovery)
 * 2. Extraction produces non-empty output for at least one phase
 * 3. Output matches expected cardinality (non-zero if file has data)
 * 4. Token values are non-negative
 */
export async function validateSpec(
  candidate: ParserSpec,
  sampleFilePath: string,
  cwd: string,
): Promise<ValidationResult> {
  const errors: string[] = [];

  // Structural validation
  if (candidate.version !== 1) errors.push(`unsupported spec version: ${candidate.version}`);
  if (!candidate.tool) errors.push('missing tool field');
  if (!candidate.format) errors.push('missing format field');
  if (!candidate.discovery) errors.push('missing discovery field');
  if (!candidate.extractions) errors.push('missing extractions field');

  if (errors.length > 0) {
    return {
      valid: false,
      conversationsExtracted: 0,
      tokensExtracted: false,
      toolCallsExtracted: 0,
      errors,
    };
  }

  // Check if the sample file has content
  let sampleContent: string;
  try {
    sampleContent = await readFile(sampleFilePath, 'utf-8');
  } catch {
    errors.push(`cannot read sample file: ${sampleFilePath}`);
    return {
      valid: false,
      conversationsExtracted: 0,
      tokensExtracted: false,
      toolCallsExtracted: 0,
      errors,
    };
  }

  const hasContent = sampleContent.trim().length > 0;
  if (!hasContent) {
    errors.push('sample file is empty');
    return {
      valid: false,
      conversationsExtracted: 0,
      tokensExtracted: false,
      toolCallsExtracted: 0,
      errors,
    };
  }

  // Run extraction
  let result: ExtractionResult;
  try {
    // Use a very old startedAt to ensure the sample file is picked up
    result = await extract(candidate, cwd, 0);
  } catch (err) {
    errors.push(`extraction threw: ${err}`);
    return {
      valid: false,
      conversationsExtracted: 0,
      tokensExtracted: false,
      toolCallsExtracted: 0,
      errors,
    };
  }

  // Cardinality checks: if spec declares an extraction and file has data, expect output
  if (candidate.extractions.conversation && result.conversations.length === 0) {
    errors.push('conversation extraction declared but produced 0 events from non-empty file');
  }
  if (candidate.extractions.tokens && !result.tokens) {
    errors.push('token extraction declared but produced null from non-empty file');
  }
  if (candidate.extractions.toolCalls && result.toolCalls.length === 0) {
    errors.push('tool call extraction declared but produced 0 calls from non-empty file');
  }

  // Token sanity checks
  if (result.tokens) {
    const t = result.tokens;
    if (
      t.input_tokens < 0 ||
      t.output_tokens < 0 ||
      t.cache_read_tokens < 0 ||
      t.cache_creation_tokens < 0
    ) {
      errors.push('token values must be non-negative');
    }
    if (
      t.input_tokens === 0 &&
      t.output_tokens === 0 &&
      t.cache_read_tokens === 0 &&
      t.cache_creation_tokens === 0
    ) {
      errors.push('all token values are zero despite extraction declaring token support');
    }
  }

  // Conversation sanity checks
  for (const ev of result.conversations) {
    if (!ev.role || !ev.content) {
      errors.push('conversation event missing role or content');
      break;
    }
  }

  return {
    valid: errors.length === 0,
    conversationsExtracted: result.conversations.length,
    tokensExtracted: result.tokens !== null,
    toolCallsExtracted: result.toolCalls.length,
    errors,
  };
}

/**
 * Compare two candidate specs for consensus (maker-checker pattern).
 * Both must produce output with matching cardinality and structure
 * to be considered in agreement.
 */
export function checkConsensus(a: ValidationResult, b: ValidationResult): boolean {
  if (!a.valid || !b.valid) return false;

  // Conversations: both must extract, counts should be within 10% of each other
  if (a.conversationsExtracted > 0 || b.conversationsExtracted > 0) {
    const max = Math.max(a.conversationsExtracted, b.conversationsExtracted);
    const min = Math.min(a.conversationsExtracted, b.conversationsExtracted);
    if (max > 0 && min / max < 0.9) return false;
  }

  // Tokens: both must agree on whether tokens are available
  if (a.tokensExtracted !== b.tokensExtracted) return false;

  // Tool calls: both must extract, counts should be within 10%
  if (a.toolCallsExtracted > 0 || b.toolCallsExtracted > 0) {
    const max = Math.max(a.toolCallsExtracted, b.toolCallsExtracted);
    const min = Math.min(a.toolCallsExtracted, b.toolCallsExtracted);
    if (max > 0 && min / max < 0.9) return false;
  }

  return true;
}

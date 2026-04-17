/**
 * Self-healing orchestrator for parser specs.
 *
 * When the health monitor detects extraction failure (success rate drops
 * below 50% over 5+ sessions), this module:
 *
 * 1. Collects ~10KB of sample log data from the failing tool
 * 2. Constructs a prompt with sample + current spec + target schema
 * 3. Calls Claude API twice independently (maker-checker pattern)
 * 4. Validates both candidates against the samples
 * 5. If consensus + validation passes: hot-swaps the spec
 * 6. If not: keeps old spec, logs the failure for manual review
 *
 * Rate-limited to 1 heal attempt per tool per day.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createLogger } from '@chinwag/shared';
import { loadSpec } from './loader.js';
import { diagnose, markHealed } from './health.js';
import { validateSpec, checkConsensus } from './validator.js';
import { writeFileAtomicSync } from '@chinwag/shared/fs-atomic.js';
import type { ParserSpec } from './types.js';

const log = createLogger('spec-healer');

const HEALED_SPECS_DIR = join(homedir(), '.chinwag', 'specs');
const HEAL_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 day

export interface HealResult {
  healed: boolean;
  tool: string;
  reason: string;
  specPath?: string;
}

/**
 * Check if a tool needs healing and attempt it if so.
 * Returns null if no healing was needed.
 */
export async function checkAndHeal(
  toolId: string,
  cwd: string,
  sampleFilePath: string | null,
  callLLM?: (prompt: string) => Promise<string>,
): Promise<HealResult | null> {
  const diagnosis = diagnose(toolId);

  if (!diagnosis.needsHealing) return null;

  // Rate limit: 1 attempt per tool per day
  if (diagnosis.lastHealedAt) {
    const elapsed = Date.now() - new Date(diagnosis.lastHealedAt).getTime();
    if (elapsed < HEAL_COOLDOWN_MS) {
      return {
        healed: false,
        tool: toolId,
        reason: `heal cooldown active (${Math.round((HEAL_COOLDOWN_MS - elapsed) / 3600000)}h remaining)`,
      };
    }
  }

  if (!sampleFilePath) {
    return { healed: false, tool: toolId, reason: 'no sample file available for healing' };
  }

  if (!callLLM) {
    log.warn(
      `${toolId} needs healing (${(diagnosis.successRate * 100).toFixed(0)}% success rate) ` +
        `but no LLM function provided. Configure Claude API to enable self-healing.`,
    );
    return { healed: false, tool: toolId, reason: 'no LLM function configured' };
  }

  log.info(
    `${toolId} extraction health degraded (${(diagnosis.successRate * 100).toFixed(0)}% success). ` +
      `Attempting spec heal...`,
  );

  try {
    const result = await attemptHeal(toolId, cwd, sampleFilePath, callLLM);
    markHealed(toolId);
    return result;
  } catch (err) {
    markHealed(toolId); // Record attempt even on failure (rate limit)
    return { healed: false, tool: toolId, reason: `heal failed: ${err}` };
  }
}

async function attemptHeal(
  toolId: string,
  cwd: string,
  sampleFilePath: string,
  callLLM: (prompt: string) => Promise<string>,
): Promise<HealResult> {
  // Load current (broken) spec
  const currentSpec = await loadSpec(toolId);
  if (!currentSpec) {
    return { healed: false, tool: toolId, reason: 'no existing spec to heal from' };
  }

  // Collect sample data (~10KB)
  let sampleData: string;
  try {
    const raw = readFileSync(sampleFilePath, 'utf-8');
    sampleData = raw.slice(0, 10_000);
  } catch {
    return { healed: false, tool: toolId, reason: 'cannot read sample file' };
  }

  // Build the prompt
  const prompt = buildHealPrompt(currentSpec, sampleData);

  // Maker call
  const makerResponse = await callLLM(prompt);
  const makerSpec = parseSpecFromResponse(makerResponse, toolId);
  if (!makerSpec) {
    return { healed: false, tool: toolId, reason: 'maker LLM returned unparseable spec' };
  }

  // Checker call (different framing)
  const checkerPrompt = buildCheckerPrompt(currentSpec, sampleData);
  const checkerResponse = await callLLM(checkerPrompt);
  const checkerSpec = parseSpecFromResponse(checkerResponse, toolId);
  if (!checkerSpec) {
    return { healed: false, tool: toolId, reason: 'checker LLM returned unparseable spec' };
  }

  // Validate both against samples
  const makerValidation = await validateSpec(makerSpec, sampleFilePath, cwd);
  const checkerValidation = await validateSpec(checkerSpec, sampleFilePath, cwd);

  if (!makerValidation.valid) {
    return {
      healed: false,
      tool: toolId,
      reason: `maker spec invalid: ${makerValidation.errors.join(', ')}`,
    };
  }
  if (!checkerValidation.valid) {
    return {
      healed: false,
      tool: toolId,
      reason: `checker spec invalid: ${checkerValidation.errors.join(', ')}`,
    };
  }

  // Consensus check
  if (!checkConsensus(makerValidation, checkerValidation)) {
    return {
      healed: false,
      tool: toolId,
      reason: 'maker and checker specs disagree on output cardinality',
    };
  }

  // Hot-swap: write healed spec
  const specPath = writeHealedSpec(toolId, makerSpec);

  log.info(
    `healed ${toolId} spec: ${makerValidation.conversationsExtracted} conversations, ` +
      `tokens=${makerValidation.tokensExtracted}, ${makerValidation.toolCallsExtracted} tool calls`,
  );

  return { healed: true, tool: toolId, reason: 'consensus achieved, validation passed', specPath };
}

function writeHealedSpec(toolId: string, spec: ParserSpec): string {
  const specPath = join(HEALED_SPECS_DIR, `${toolId}.json`);

  if (existsSync(specPath)) {
    const backupPath = join(HEALED_SPECS_DIR, `${toolId}.backup.json`);
    try {
      const existing = readFileSync(specPath, 'utf-8');
      writeFileAtomicSync(backupPath, existing);
    } catch {
      // Non-critical backup failure
    }
  }

  const healedSpec: ParserSpec = {
    ...spec,
    source: 'ai-healed',
    generatedAt: new Date().toISOString(),
  };

  writeFileAtomicSync(specPath, JSON.stringify(healedSpec, null, 2));
  return specPath;
}

function parseSpecFromResponse(response: string, toolId: string): ParserSpec | null {
  // Extract JSON from LLM response (may be wrapped in markdown code blocks)
  const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const raw = jsonMatch ? jsonMatch[1] : response;

  try {
    const parsed = JSON.parse(raw.trim()) as ParserSpec;
    if (!parsed.version || !parsed.format || !parsed.discovery || !parsed.extractions) {
      return null;
    }
    parsed.tool = toolId;
    return parsed;
  } catch {
    return null;
  }
}

function buildHealPrompt(currentSpec: ParserSpec, sampleData: string): string {
  return `You are a data extraction engineer. A parser spec for the "${currentSpec.tool}" tool has stopped extracting data correctly. The tool likely updated its log format.

Current (broken) spec:
${JSON.stringify(currentSpec, null, 2)}

Sample of recent log data (first ~10KB):
${sampleData}

Generate a corrected ParserSpec JSON that extracts conversations, tokens, and tool calls from this log format. The spec must:
1. Use the same version (1) and format
2. Update field paths to match the actual log structure
3. Preserve the discovery strategy (how to find log files)
4. Map fields correctly to the chinwag canonical schema

Return ONLY the JSON spec, no explanation.`;
}

function buildCheckerPrompt(currentSpec: ParserSpec, sampleData: string): string {
  return `Analyze this tool log data and create a ParserSpec JSON for extracting structured data from it.

Tool: ${currentSpec.tool}
Log format: ${currentSpec.format}

Sample data:
${sampleData}

The spec must extract:
- Conversations: role (user/assistant), content text, timestamps
- Tokens: input tokens, output tokens, cache read/creation tokens
- Tool calls: tool name, timing, errors, input preview

The target schema uses dot-notation paths for field resolution. Return ONLY the JSON spec.`;
}

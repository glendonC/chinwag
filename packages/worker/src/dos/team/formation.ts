// Shadow-mode formation pass - after each successful memory save, an LLM
// looks at the new memory alongside top-K cosine-similar neighbours and
// classifies it as keep / merge / evolve / discard. The recommendation is
// recorded but NEVER applied automatically.
//
// Why shadow-mode and not auto-apply: Mem0 reversed write-time
// auto-classification in v3 (Apr 2025) explicitly because auto-merge ate
// agent context too often. Same-model maker-checker is variance reduction,
// not bias reduction - both calls hallucinate the same way. Production
// memory systems converged on "append-only writes, defer disambiguation
// to retrieval / consolidation review." This module honors that.
//
// Formation observations are useful as: (a) audit trail of LLM judgment
// for tuning the deterministic consolidation funnel, (b) future input to
// per-team opt-in enforcement, (c) signal for the dashboard about which
// writes look risky.

import type { DOResult, Env } from '../../types.js';
import { createLogger } from '../../lib/logger.js';
import { chatCompletion } from '../../lib/ai.js';
import { row, rows } from '../../lib/row.js';

const log = createLogger('TeamDO.formation');

const FORMATION_TOP_K = 5;
const FORMATION_REASON_MAX = 200;
const FORMATION_TEXT_PREVIEW = 400; // per memory in prompt
const FORMATION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

export type FormationRecommendation = 'keep' | 'merge' | 'evolve' | 'discard';

interface FormationDecision {
  recommendation: FormationRecommendation;
  target_id: string | null;
  confidence: number | null;
  reason: string;
}

/** Cosine similarity between two equal-length Float32Arrays. */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Strip a value down to a structured recommendation. Returns null if the
 * LLM output couldn't be parsed into something usable; caller logs and
 * skips. We deliberately don't fail-open or fail-closed - formation is
 * advisory and a missing observation is fine.
 */
export function parseFormationDecision(raw: string): FormationDecision | null {
  if (!raw) return null;
  // Strip markdown code fences the model sometimes wraps JSON in
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  // Find the first { ... } block in case there's surrounding prose
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const rec = String(obj.recommendation ?? '').toLowerCase();
  if (rec !== 'keep' && rec !== 'merge' && rec !== 'evolve' && rec !== 'discard') {
    return null;
  }
  const target = obj.target_id;
  const targetId = typeof target === 'string' && target.length > 0 ? target : null;
  // merge / evolve require a target; if missing, downgrade to keep
  if ((rec === 'merge' || rec === 'evolve') && !targetId) {
    return {
      recommendation: 'keep',
      target_id: null,
      confidence: null,
      reason: 'LLM proposed merge/evolve without a target id - downgraded to keep',
    };
  }
  const confRaw = obj.confidence;
  const confidence = typeof confRaw === 'number' && confRaw >= 0 && confRaw <= 1 ? confRaw : null;
  const reason = String(obj.reason ?? '').slice(0, FORMATION_REASON_MAX);
  return { recommendation: rec, target_id: targetId, confidence, reason };
}

/**
 * Run formation classification on a freshly-saved memory and write the
 * recommendation as an observation. Designed to be invoked from
 * ctx.waitUntil() - fire and forget; never throws.
 */
export async function runFormationPass(sql: SqlStorage, env: Env, memoryId: string): Promise<void> {
  try {
    if (!env.AI) return;

    const newRowRaw = sql
      .exec(
        'SELECT id, text, embedding FROM memories WHERE id = ? AND merged_into IS NULL AND invalid_at IS NULL',
        memoryId,
      )
      .toArray()[0];
    if (!newRowRaw) return;
    const newRow = row(newRowRaw);
    const embedBlob = newRow.raw('embedding') as ArrayBuffer | null;
    if (!embedBlob) return; // no embedding -> can't pick neighbours
    const newVec = new Float32Array(embedBlob);

    // Pull all candidate memories with embeddings (excluding the new one
    // and any merged memories) and rank by cosine. At MEMORY_MAX_COUNT
    // this is fast.
    const candidates = sql
      .exec(
        `SELECT id, text, embedding
         FROM memories
         WHERE id != ? AND embedding IS NOT NULL AND merged_into IS NULL AND invalid_at IS NULL
         ORDER BY created_at DESC`,
        memoryId,
      )
      .toArray();

    type Scored = { id: string; text: string; sim: number };
    const scored: Scored[] = [];
    for (const cRaw of candidates) {
      const c = row(cRaw);
      const buf = c.raw('embedding') as ArrayBuffer | null;
      if (!buf) continue;
      const v = new Float32Array(buf);
      if (v.length !== newVec.length) continue;
      scored.push({ id: c.string('id'), text: c.string('text'), sim: cosineSimilarity(newVec, v) });
    }
    scored.sort((a, b) => b.sim - a.sim);
    const top = scored.slice(0, FORMATION_TOP_K);

    // No nearby memories -> trivially "keep". Record so the dashboard
    // surfaces "every save was novel" as a signal.
    if (top.length === 0) {
      sql.exec(
        `INSERT INTO formation_observations (id, memory_id, recommendation, llm_reason)
         VALUES (?, ?, 'keep', 'no similar memories found')`,
        crypto.randomUUID(),
        memoryId,
      );
      return;
    }

    const prompt = buildFormationPrompt(newRow.string('text'), top);
    const response = await chatCompletion(env.AI, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
    });
    if (!response) {
      log.warn('formation classification returned no response', { memoryId });
      return;
    }

    const decision = parseFormationDecision(response);
    if (!decision) {
      log.warn('formation classification unparseable', {
        memoryId,
        raw: response.slice(0, 200),
      });
      return;
    }

    // Validate target_id: if the LLM picked one, it must be in the top-K
    // we showed it. Defensive - if it hallucinated an id, downgrade to keep.
    if (decision.target_id && !top.some((t) => t.id === decision.target_id)) {
      log.warn('formation hallucinated target_id; downgrading to keep', {
        memoryId,
        proposedTarget: decision.target_id,
      });
      decision.recommendation = 'keep';
      decision.target_id = null;
    }

    sql.exec(
      `INSERT INTO formation_observations (id, memory_id, recommendation, target_id, confidence, llm_reason, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      memoryId,
      decision.recommendation,
      decision.target_id,
      decision.confidence,
      decision.reason,
      FORMATION_MODEL,
    );
  } catch (err) {
    log.warn('formation pass threw - skipping observation', {
      memoryId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function buildFormationPrompt(
  newText: string,
  neighbours: Array<{ id: string; text: string; sim: number }>,
): string {
  const newClipped = newText.slice(0, FORMATION_TEXT_PREVIEW);
  const neighbourLines = neighbours
    .map(
      (n) =>
        `[id: ${n.id}] (cosine ${n.sim.toFixed(3)}) ${n.text.slice(0, FORMATION_TEXT_PREVIEW)}`,
    )
    .join('\n');
  return `You are auditing a freshly saved memory in a developer-knowledge store. Decide whether the new memory should be:
- "keep": distinct knowledge, save as-is
- "merge": same fact / paraphrase of an existing one (pick its id)
- "evolve": refines or supersedes an existing fact (pick its id)
- "discard": low-value (greeting, command output, trivial)

Respond with ONLY a single JSON object on one line:
{"recommendation": "keep" | "merge" | "evolve" | "discard", "target_id": "<id or null>", "confidence": 0.0-1.0, "reason": "<one sentence>"}

NEW MEMORY:
${newClipped}

EXISTING NEIGHBOURS (top ${neighbours.length} by cosine similarity):
${neighbourLines}

JSON response:`;
}

/**
 * Sweep the N most recent memories that don't yet have a formation
 * observation and run formation on each. Designed to be called from a
 * cron, dashboard, or explicit MCP invocation - auditor mode.
 *
 * Caps the per-invocation work to avoid runaway Workers AI usage when
 * many memories accumulate.
 */
export async function runFormationOnRecent(
  sql: SqlStorage,
  env: Env,
  limit: number = 20,
): Promise<{ processed: number; skipped: number }> {
  const cap = Math.min(Math.max(1, limit), 50);
  const candidates = rows(
    sql
      .exec(
        `SELECT m.id FROM memories m
       LEFT JOIN formation_observations fo ON fo.memory_id = m.id
       WHERE m.merged_into IS NULL AND invalid_at IS NULL AND m.embedding IS NOT NULL AND fo.id IS NULL
       ORDER BY m.created_at DESC
       LIMIT ?`,
        cap,
      )
      .toArray(),
    (r) => ({ id: r.string('id') }),
  );

  let processed = 0;
  let skipped = 0;
  for (const c of candidates) {
    try {
      await runFormationPass(sql, env, c.id);
      processed++;
    } catch (err) {
      skipped++;
      log.warn('formation pass failed during sweep', {
        memoryId: c.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { processed, skipped };
}

// --- Read-side helpers for the review dashboard / MCP tool ---

export interface FormationObservation {
  id: string;
  memory_id: string;
  recommendation: FormationRecommendation;
  target_id: string | null;
  confidence: number | null;
  llm_reason: string | null;
  model: string | null;
  created_at: string;
}

export function listFormationObservations(
  sql: SqlStorage,
  filter: { recommendation?: FormationRecommendation; limit?: number } = {},
): DOResult<{ ok: true; observations: FormationObservation[] }> {
  const limit = Math.min(Math.max(1, filter.limit || 50), 200);
  let rawRows: unknown[];
  if (filter.recommendation) {
    rawRows = sql
      .exec(
        `SELECT id, memory_id, recommendation, target_id, confidence, llm_reason, model, created_at
         FROM formation_observations
         WHERE status = 'observed' AND recommendation = ?
         ORDER BY created_at DESC LIMIT ?`,
        filter.recommendation,
        limit,
      )
      .toArray();
  } else {
    rawRows = sql
      .exec(
        `SELECT id, memory_id, recommendation, target_id, confidence, llm_reason, model, created_at
         FROM formation_observations
         WHERE status = 'observed'
         ORDER BY created_at DESC LIMIT ?`,
        limit,
      )
      .toArray();
  }
  const observations = rows<FormationObservation>(rawRows, (r) => ({
    id: r.string('id'),
    memory_id: r.string('memory_id'),
    recommendation: r.string('recommendation') as FormationRecommendation,
    target_id: r.nullableString('target_id'),
    confidence: r.nullableNumber('confidence'),
    llm_reason: r.nullableString('llm_reason'),
    model: r.nullableString('model'),
    created_at: r.string('created_at'),
  }));
  return { ok: true, observations };
}

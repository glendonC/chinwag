// Background consolidation pass — identifies near-duplicate memories using
// the Graphiti funnel pattern (cosine recall → Jaccard structural → tag
// agreement) and writes propose-only candidates to the review queue. The
// agent or operator applies a proposal explicitly via apply_consolidation;
// nothing merges automatically.
//
// Hard rules:
//   - never merges memories whose tag sets carry contradictory signals
//     (decision:rejected vs decision:accepted) regardless of cosine
//   - never auto-applies; the proposal sits in the queue until reviewed
//   - merge writes are reversible via unmerge_memory()

import type { DOResult } from '../../types.js';
import { createLogger } from '../../lib/logger.js';
import { safeParse } from '../../lib/safe-parse.js';

const log = createLogger('TeamDO.consolidation');

// Graphiti uses 0.6 as a recall gate; we lift to 0.85 because chinmeister has
// a smaller corpus where the cost of wrong merges is concentrated. Real
// near-dup territory for bge-small-en-v1.5 is 0.92+, but the structural
// gate (Jaccard) and tag-agreement gate are the actual decision points.
const COSINE_RECALL = 0.85;
// Jaccard on character trigrams. ≥0.6 catches paraphrased duplicates while
// rejecting "same gotcha for different file" pairs that happen to share
// embedding space because the prose pattern is similar.
const JACCARD_FLOOR = 0.6;
// Tag-set decision-marker conflicts that block merge regardless of other
// signals. If both memories carry one of these and they disagree (or one
// has accepted/the other has rejected), they stay separate.
const CONTRADICTORY_MARKERS: Array<[string, string]> = [
  ['accepted', 'rejected'],
  ['approved', 'declined'],
  ['kept', 'reverted'],
];

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

/** Character-trigram set for Jaccard. Lowercased, whitespace-collapsed. */
function trigrams(text: string): Set<string> {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (norm.length < 3) return new Set([norm]);
  const out = new Set<string>();
  for (let i = 0; i <= norm.length - 3; i++) {
    out.add(norm.slice(i, i + 3));
  }
  return out;
}

export function jaccardTrigrams(a: string, b: string): number {
  const sa = trigrams(a);
  const sb = trigrams(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let intersect = 0;
  for (const t of sa) if (sb.has(t)) intersect++;
  const union = sa.size + sb.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export function tagsAgree(tagsA: string[], tagsB: string[]): boolean {
  const setA = new Set(tagsA.map((t) => t.toLowerCase()));
  const setB = new Set(tagsB.map((t) => t.toLowerCase()));
  for (const [x, y] of CONTRADICTORY_MARKERS) {
    if ((setA.has(x) && setB.has(y)) || (setA.has(y) && setB.has(x))) {
      return false;
    }
  }
  return true;
}

interface ConsolidationStats {
  memoriesScanned: number;
  pairsConsidered: number;
  proposalsCreated: number;
  proposalsAlreadyExisted: number;
  proposalsBlockedByJaccard: number;
  proposalsBlockedByTags: number;
}

/**
 * Pairwise scan over the un-merged memory corpus for the team. For every
 * pair above the cosine recall threshold, run Jaccard + tag-agreement
 * gates and record passing pairs as pending proposals.
 *
 * O(n^2) over the full corpus. At MEMORY_MAX_COUNT=2000 with embedding
 * size 384, this is ~2M comparisons of 1.5KB BLOBs — runs in seconds on
 * a DO. If the corpus grows beyond ~5K rows, pre-bucket by cosine LSH or
 * limit the scan to the most-recent N writes since the last consolidation.
 */
export function consolidateMemories(sql: SqlStorage): DOResult<{ ok: true } & ConsolidationStats> {
  const stats: ConsolidationStats = {
    memoriesScanned: 0,
    pairsConsidered: 0,
    proposalsCreated: 0,
    proposalsAlreadyExisted: 0,
    proposalsBlockedByJaccard: 0,
    proposalsBlockedByTags: 0,
  };

  // Pull all live (un-merged) memories with embeddings. Sort by access
  // count desc so the canonical (winner) tends to be the well-used one
  // when we record proposals.
  const rows = sql
    .exec(
      `SELECT id, text, tags, embedding, access_count, created_at
       FROM memories
       WHERE merged_into IS NULL AND invalid_at IS NULL AND embedding IS NOT NULL
       ORDER BY access_count DESC, created_at DESC`,
    )
    .toArray() as Record<string, unknown>[];

  stats.memoriesScanned = rows.length;
  if (rows.length < 2) return { ok: true, ...stats };

  // Pre-deserialize embeddings once
  type Mem = { id: string; text: string; tags: string[]; embedding: Float32Array };
  const memos: Mem[] = [];
  for (const r of rows) {
    const buf = r.embedding as ArrayBuffer | null;
    if (!buf) continue;
    const parsedTags = safeParse(
      (r.tags as string) || '[]',
      `consolidate memory=${r.id} tags`,
      [],
      log,
    ) as string[];
    memos.push({
      id: r.id as string,
      text: r.text as string,
      tags: parsedTags,
      embedding: new Float32Array(buf),
    });
  }

  // Existing proposals so we don't re-create
  const existing = sql
    .exec("SELECT source_id, target_id FROM consolidation_proposals WHERE status = 'pending'")
    .toArray() as Record<string, unknown>[];
  const existingPairs = new Set(
    existing.map((p) => `${p.source_id as string}::${p.target_id as string}`),
  );

  for (let i = 0; i < memos.length; i++) {
    for (let j = i + 1; j < memos.length; j++) {
      const a = memos[i]!;
      const b = memos[j]!;
      // Vector lengths must match (different embedding versions would mix)
      if (a.embedding.length !== b.embedding.length) continue;
      const cosine = cosineSimilarity(a.embedding, b.embedding);
      if (cosine < COSINE_RECALL) continue;

      stats.pairsConsidered++;

      const jaccard = jaccardTrigrams(a.text, b.text);
      if (jaccard < JACCARD_FLOOR) {
        stats.proposalsBlockedByJaccard++;
        continue;
      }

      if (!tagsAgree(a.tags, b.tags)) {
        stats.proposalsBlockedByTags++;
        continue;
      }

      // Source = the one we'd merge; target = canonical winner. Sorted by
      // access_count desc, so a (lower index) is canonical.
      const targetId = a.id;
      const sourceId = b.id;
      const pairKey = `${sourceId}::${targetId}`;
      if (existingPairs.has(pairKey)) {
        stats.proposalsAlreadyExisted++;
        continue;
      }

      try {
        sql.exec(
          `INSERT INTO consolidation_proposals (id, source_id, target_id, cosine, jaccard)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(source_id, target_id) DO NOTHING`,
          crypto.randomUUID(),
          sourceId,
          targetId,
          cosine,
          jaccard,
        );
        stats.proposalsCreated++;
      } catch (e) {
        log.warn('failed to record consolidation proposal', {
          source: sourceId,
          target: targetId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return { ok: true, ...stats };
}

// ── Bi-temporal supersession (Graphiti-derived) ────────────────────────────
//
// Port of the contradiction-resolution algorithm from
// getzep/graphiti `edge_operations.py:537-572` (Apache-2.0). Pure temporal
// interval algebra — no LLM, no graph. Given a newer memory and an older
// candidate, decides whether the older memory should be invalidated and at
// what timestamp.
//
// Contract: the older memory's `invalid_at` becomes the newer memory's
// `valid_at` iff the two temporal intervals overlap AND the older fact
// genuinely started earlier. If the older memory already ended before the
// newer one began, or the newer one ends before the older one starts, no
// invalidation is proposed.
//
// Both memories MUST have non-null `valid_at` — enforced by the save-time
// default in memory.ts and migration 023's backfill. `invalid_at` is
// nullable on either side; null = open-ended ("still valid").

export interface SupersessionCandidate {
  id: string;
  valid_at: string;
  invalid_at: string | null;
}

export interface SupersessionDecision {
  shouldInvalidate: boolean;
  /** ISO timestamp to assign to candidate.invalid_at when shouldInvalidate is true. */
  newInvalidAt: string | null;
}

/**
 * Decide whether `candidate` (the older fact) is superseded by `incoming`
 * (the newer fact) given their temporal intervals.
 *
 * Returns `shouldInvalidate: true` only when:
 *   1. Both intervals overlap (neither candidate.invalid_at <= incoming.valid_at
 *      nor incoming.invalid_at <= candidate.valid_at),
 *   2. Candidate started strictly before incoming (candidate.valid_at
 *      < incoming.valid_at).
 *
 * When true, the returned `newInvalidAt` is the string-valued
 * `incoming.valid_at` — assigning it to `candidate.invalid_at` truncates
 * the candidate's validity at the exact moment the superseding fact began.
 */
export function resolveSupersession(
  incoming: SupersessionCandidate,
  candidate: SupersessionCandidate,
): SupersessionDecision {
  const incomingValid = new Date(incoming.valid_at).getTime();
  const candidateValid = new Date(candidate.valid_at).getTime();
  if (Number.isNaN(incomingValid) || Number.isNaN(candidateValid)) {
    // Corrupt timestamps — refuse to make a supersession call rather than
    // guess. The caller keeps the candidate active.
    return { shouldInvalidate: false, newInvalidAt: null };
  }

  const candidateInvalid = candidate.invalid_at
    ? new Date(candidate.invalid_at).getTime()
    : Number.POSITIVE_INFINITY;
  const incomingInvalid = incoming.invalid_at
    ? new Date(incoming.invalid_at).getTime()
    : Number.POSITIVE_INFINITY;

  // Non-overlap: the two intervals don't share any wall-clock moment.
  if (candidateInvalid <= incomingValid) return { shouldInvalidate: false, newInvalidAt: null };
  if (incomingInvalid <= candidateValid) return { shouldInvalidate: false, newInvalidAt: null };

  // Overlap exists. Only invalidate if candidate is strictly older — a
  // newer candidate overlapping with an even-newer incoming is not
  // supersession, it's concurrent knowledge.
  if (candidateValid >= incomingValid) return { shouldInvalidate: false, newInvalidAt: null };

  return { shouldInvalidate: true, newInvalidAt: incoming.valid_at };
}

/**
 * List pending consolidation proposals for review. Newest first — agents
 * triaging the queue see most recent proposals at the top.
 */
export interface ProposalRow {
  id: string;
  source_id: string;
  target_id: string;
  source_text: string;
  target_text: string;
  cosine: number;
  jaccard: number;
  proposed_at: string;
  /** 'merge' (soft-delete source into target) or 'invalidate' (supersede target). */
  kind: 'merge' | 'invalidate';
  source_valid_at: string;
  target_valid_at: string;
}

export function listConsolidationProposals(
  sql: SqlStorage,
  limit: number = 50,
): DOResult<{ ok: true; proposals: ProposalRow[] }> {
  const rows = sql
    .exec(
      `SELECT p.id, p.source_id, p.target_id, p.cosine, p.jaccard, p.proposed_at, p.kind,
              s.text as source_text, t.text as target_text,
              s.valid_at as source_valid_at, t.valid_at as target_valid_at
       FROM consolidation_proposals p
       JOIN memories s ON s.id = p.source_id
       JOIN memories t ON t.id = p.target_id
       WHERE p.status = 'pending'
         AND s.merged_into IS NULL AND s.invalid_at IS NULL
         AND t.merged_into IS NULL AND t.invalid_at IS NULL
       ORDER BY p.proposed_at DESC
       LIMIT ?`,
      Math.min(Math.max(1, limit), 200),
    )
    .toArray() as unknown as ProposalRow[];
  return { ok: true, proposals: rows };
}

/**
 * Apply a pending proposal. Dispatches on `kind`:
 *
 * - `kind = 'merge'` (existing, default) sets `source.merged_into = target`,
 *   soft-deleting source while target absorbs its content. Reversible via
 *   `unmergeMemory(source_id)`.
 * - `kind = 'invalidate'` (migration 023) sets `target.invalid_at = source.valid_at`,
 *   truncating the target's validity interval at the moment the superseding
 *   source became true. Target stays in the DB queryable as history but
 *   falls out of default search. Reversible via `unmergeMemory(target_id)`,
 *   which clears both `merged_into` and `invalid_at`.
 *
 * Proposals without a `kind` column (pre-migration-023 rows) are treated as
 * 'merge' for back-compat.
 */
export function applyConsolidationProposal(
  sql: SqlStorage,
  proposalId: string,
  reviewerHandle: string,
): DOResult<{ ok: true; applied: true; source_id: string; target_id: string; kind: string }> {
  const proposal = sql
    .exec(
      'SELECT source_id, target_id, status, kind FROM consolidation_proposals WHERE id = ?',
      proposalId,
    )
    .toArray()[0] as Record<string, unknown> | undefined;
  if (!proposal) return { error: 'Proposal not found', code: 'NOT_FOUND' };
  if (proposal.status !== 'pending') {
    return { error: `Proposal already ${proposal.status as string}`, code: 'INVALID_STATE' };
  }

  const sourceId = proposal.source_id as string;
  const targetId = proposal.target_id as string;
  const kind = ((proposal.kind as string) || 'merge') as 'merge' | 'invalidate';

  if (kind === 'invalidate') {
    // For supersession: the source is the newer fact, target is the older
    // one being invalidated. Apply target.invalid_at = source.valid_at so
    // the target's validity interval closes at the exact moment the source
    // became true. Falls back to NOW if source.valid_at is somehow null
    // (shouldn't happen post-migration-023 but keeps the write total).
    const source = sql.exec('SELECT valid_at FROM memories WHERE id = ?', sourceId).toArray()[0] as
      | Record<string, unknown>
      | undefined;
    const invalidAt = (source?.valid_at as string) || new Date().toISOString();
    sql.exec(
      'UPDATE memories SET invalid_at = ? WHERE id = ? AND invalid_at IS NULL',
      invalidAt,
      targetId,
    );
  } else {
    sql.exec(
      "UPDATE memories SET merged_into = ?, merged_at = datetime('now') WHERE id = ? AND merged_into IS NULL",
      targetId,
      sourceId,
    );
  }

  sql.exec(
    "UPDATE consolidation_proposals SET status = 'applied', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?",
    reviewerHandle,
    proposalId,
  );
  return { ok: true, applied: true, source_id: sourceId, target_id: targetId, kind };
}

export function rejectConsolidationProposal(
  sql: SqlStorage,
  proposalId: string,
  reviewerHandle: string,
): DOResult<{ ok: true; rejected: true }> {
  const proposal = sql
    .exec('SELECT status FROM consolidation_proposals WHERE id = ?', proposalId)
    .toArray()[0] as Record<string, unknown> | undefined;
  if (!proposal) return { error: 'Proposal not found', code: 'NOT_FOUND' };
  if (proposal.status !== 'pending') {
    return { error: `Proposal already ${proposal.status as string}`, code: 'INVALID_STATE' };
  }
  sql.exec(
    "UPDATE consolidation_proposals SET status = 'rejected', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?",
    reviewerHandle,
    proposalId,
  );
  return { ok: true, rejected: true };
}

/**
 * Restore a hidden memory so search picks it up again. Counterpart to
 * applyConsolidationProposal — gives the agent/operator recourse when
 * consolidation absorbed or invalidated something it shouldn't have.
 *
 * Clears whichever hiding mechanism is active:
 * - If the memory was soft-merged (merged_into set), clears merged_into
 *   and merged_at.
 * - If the memory was invalidated by supersession (invalid_at set),
 *   clears invalid_at.
 *
 * If both somehow ended up set via separate paths, both are cleared —
 * restoration should be unambiguous.
 */
export function unmergeMemory(
  sql: SqlStorage,
  memoryId: string,
): DOResult<{ ok: true; unmerged: true; restored: Array<'merged' | 'invalidated'> }> {
  const row = sql
    .exec('SELECT merged_into, invalid_at FROM memories WHERE id = ?', memoryId)
    .toArray()[0] as Record<string, unknown> | undefined;
  if (!row) return { error: 'Memory not found', code: 'NOT_FOUND' };
  const wasMerged = row.merged_into !== null;
  const wasInvalidated = row.invalid_at !== null;
  if (!wasMerged && !wasInvalidated) {
    return { error: 'Memory is not hidden', code: 'INVALID_STATE' };
  }
  const restored: Array<'merged' | 'invalidated'> = [];
  if (wasMerged) restored.push('merged');
  if (wasInvalidated) restored.push('invalidated');
  sql.exec(
    'UPDATE memories SET merged_into = NULL, merged_at = NULL, invalid_at = NULL WHERE id = ?',
    memoryId,
  );
  return { ok: true, unmerged: true, restored };
}

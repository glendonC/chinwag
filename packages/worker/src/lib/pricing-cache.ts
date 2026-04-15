// Isolate-scoped pricing snapshot cache.
//
// Loads the full model_prices table from DatabaseDO lazily on first request
// per Cloudflare Worker isolate, with a short TTL so analytics reads don't
// pay the cross-DO round trip on every call. The 6h cron refresh writes to
// DatabaseDO; each isolate will pick up the new snapshot within TTL_MS of
// the cron tick, which is plenty for pricing (changes once per model launch,
// not per second).
//
// Why not a version counter tied to the cron? Because the simpler TTL model
// is good enough: pricing rarely changes, and the 5-minute window between
// cron and isolate is invisible on a cost dashboard. The complexity of a
// version-invalidated cache is not worth the latency savings for data that
// updates 4 times per day.

import type { Env } from '../types.js';
import { getDB, rpc } from './env.js';
import { createLogger } from './logger.js';
import type { ModelPriceRow } from './model-pricing-v2.js';

const log = createLogger('pricing-cache');

// In-isolate cache lifetime. Refreshed lazily on next access after expiry.
const TTL_MS = 5 * 60 * 1000;

// Age at which pricing data is considered stale (the read path returns null
// for costs beyond this threshold rather than serving misleading numbers).
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PricingSnapshot {
  /** Canonical LiteLLM name -> price row. */
  byName: Map<string, ModelPriceRow>;
  /** ISO timestamp of the last successful cron refresh, null if never. */
  fetchedAt: string | null;
  /** True if fetchedAt is older than STALE_MS or missing entirely. */
  isStale: boolean;
  /** Number of models in the snapshot. */
  modelsCount: number;
  /** Epoch ms when this isolate loaded the snapshot (for TTL checks). */
  loadedAt: number;
}

let cached: PricingSnapshot | null = null;
let inFlight: Promise<PricingSnapshot> | null = null;

/**
 * Return the pricing snapshot for this isolate. Loads from DatabaseDO on the
 * first call per isolate and whenever TTL_MS has elapsed. Concurrent callers
 * during a refresh all join the same in-flight promise rather than racing
 * multiple cross-DO fetches.
 */
export async function getPricingCache(env: Env): Promise<PricingSnapshot> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < TTL_MS) {
    return cached;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = loadSnapshot(env).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function loadSnapshot(env: Env): Promise<PricingSnapshot> {
  try {
    const db = getDB(env);
    const result = rpc(await db.getModelPricesSnapshot());
    const { rows, metadata } = result.snapshot;

    const byName = new Map<string, ModelPriceRow>();
    for (const row of rows) {
      byName.set(row.canonical_name, {
        canonical_name: row.canonical_name,
        input_per_1m: row.input_per_1m,
        output_per_1m: row.output_per_1m,
        cache_creation_per_1m: row.cache_creation_per_1m,
        cache_read_per_1m: row.cache_read_per_1m,
        input_per_1m_above_200k: row.input_per_1m_above_200k,
        output_per_1m_above_200k: row.output_per_1m_above_200k,
        max_input_tokens: row.max_input_tokens,
        max_output_tokens: row.max_output_tokens,
      });
    }

    const fetchedAt = metadata?.fetched_at ?? null;
    const ageMs = fetchedAt ? Date.now() - Date.parse(fetchedAt) : Infinity;
    const isStale = !Number.isFinite(ageMs) || ageMs > STALE_MS;

    cached = {
      byName,
      fetchedAt,
      isStale,
      modelsCount: byName.size,
      loadedAt: Date.now(),
    };

    if (isStale) {
      log.warn(
        `pricing snapshot is stale (fetched_at ${fetchedAt ?? 'null'}, age ${Math.round(ageMs / 3600000)}h)`,
      );
    }

    return cached;
  } catch (err) {
    log.error(`failed to load pricing snapshot: ${err instanceof Error ? err.message : err}`);
    // Return an empty-but-valid snapshot so callers can still iterate and
    // will all hit the "models_without_pricing" path. The cache intentionally
    // does NOT store this error-state result, so the next call retries.
    return {
      byName: new Map(),
      fetchedAt: null,
      isStale: true,
      modelsCount: 0,
      loadedAt: Date.now(),
    };
  }
}

/**
 * Reset the in-isolate cache. Exposed for tests and for the scheduled
 * handler (if we ever want to force a reload after a successful refresh).
 */
export function resetPricingCache(): void {
  cached = null;
  inFlight = null;
}

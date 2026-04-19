// Team memory routes — save, search, update, delete memory.

import { checkContent, isBlocked } from '../../moderation.js';
import { json } from '../../lib/http.js';
import { teamJsonRoute, teamRoute, doResult } from '../../lib/middleware.js';
import { createLogger } from '../../lib/logger.js';
import { requireString, validateTagsArray, withTeamRateLimit } from '../../lib/validation.js';
import { generateEmbedding } from '../../lib/ai.js';
import { detectSecrets } from '@chinwag/shared/secret-detector.js';
import { isLiteralQuery } from '../../dos/team/memory.js';
import {
  MAX_MEMORY_TEXT_LENGTH,
  MAX_TAGS_PER_MEMORY,
  RATE_LIMIT_MEMORIES,
  RATE_LIMIT_MEMORY_UPDATES,
  RATE_LIMIT_MEMORY_DELETES,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  MEMORY_SEARCH_MAX_LIMIT,
  MEMORY_SEARCH_MAX_TAGS,
  MEMORY_SEARCH_MAX_QUERY_LENGTH,
} from '../../lib/constants.js';

const log = createLogger('routes.memory');

export const handleTeamSaveMemory = teamJsonRoute(async ({ body, user, env, teamId, request }) => {
  const text = requireString(body, 'text');
  if (!text) return json({ error: 'text is required' }, 400);
  if (text.length > MAX_MEMORY_TEXT_LENGTH)
    return json({ error: `text must be ${MAX_MEMORY_TEXT_LENGTH} characters or less` }, 400);

  // Secret detection: block writes containing recognised credential formats.
  // Memory is team-shared and durable; one leaked credential reaches everyone
  // until explicit deletion. Caller can pass `force: true` to override for
  // legitimate "documenting the pattern" memories (logged for audit).
  const force = body.force === true;
  if (!force) {
    const secrets = detectSecrets(text);
    if (secrets.length > 0) {
      // Telemetry: record the block so the dashboard can surface "X writes
      // blocked this week" as signal that the filter is doing work. Done
      // before returning so the metric increments even on rejected writes.
      const teamStub = env.TEAM.get(env.TEAM.idFromName(teamId));
      try {
        await teamStub.recordTelemetry('secrets_blocked');
      } catch {
        /* non-critical */
      }
      return json(
        {
          error: 'Memory contains potential secret(s); refusing to store',
          code: 'SECRET_DETECTED',
          secrets: secrets.map((s) => ({ type: s.type, preview: s.preview })),
          hint: 'If this is intentional documentation, retry with force: true',
        },
        422,
      );
    }
  } else {
    const secrets = detectSecrets(text);
    if (secrets.length > 0) {
      log.warn('memory save with force=true bypassed secret detection', {
        handle: user.handle,
        types: secrets.map((s) => s.type),
        count: secrets.length,
      });
    }
  }

  // Validate tags before moderation — no point running AI on invalid input
  const tagsResult = validateTagsArray(body.tags, MAX_TAGS_PER_MEMORY);
  if (tagsResult.error) return json({ error: tagsResult.error }, 400);
  const tags = tagsResult.tags!;
  // Tags are short — blocklist is sufficient
  if (tags.some((t) => isBlocked(t))) return json({ error: 'Content blocked' }, 400);

  // Validate categories (string array, optional)
  let categories: string[] | null = null;
  if (body.categories !== undefined) {
    if (!Array.isArray(body.categories)) return json({ error: 'categories must be an array' }, 400);
    categories = body.categories.filter(
      (c: unknown): c is string => typeof c === 'string' && c.trim().length > 0,
    );
  }

  const modResult = await checkContent(text, env);
  if (modResult.blocked) {
    if (modResult.reason === 'moderation_unavailable') {
      log.warn('content moderation unavailable: blocking memory save as fail-safe');
      return json(
        { error: 'Content moderation is temporarily unavailable. Please try again.' },
        503,
      );
    }
    return json({ error: 'Content blocked' }, 400);
  }

  // Compute text hash for exact dedup (SHA-256 of normalized text)
  let textHash: string | null = null;
  try {
    const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
    const data = new TextEncoder().encode(normalized);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    textHash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Non-critical — proceed without hash dedup
  }

  // Generate embedding for near-dedup (bge-small-en-v1.5, 384 dims)
  const embedding = await generateEmbedding(text, env.AI);

  return withTeamRateLimit({
    request,
    user,
    env,
    teamId,
    rateLimitKey: 'memory',
    rateLimitMax: RATE_LIMIT_MEMORIES,
    rateLimitMsg: 'Memory save limit reached (20/day). Try again tomorrow.',
    successStatus: 201,
    action: (team, agentId, runtime) =>
      team.saveMemory(
        agentId,
        text,
        tags,
        categories,
        user.handle,
        runtime,
        user.id,
        textHash,
        embedding,
      ),
  });
});

export const handleTeamSearchMemory = teamRoute(async ({ request, agentId, team, user, env }) => {
  const url = new URL(request.url);
  const rawQuery = url.searchParams.get('q') || null;
  if (rawQuery && rawQuery.length > MEMORY_SEARCH_MAX_QUERY_LENGTH) {
    return json(
      { error: `search query must be ${MEMORY_SEARCH_MAX_QUERY_LENGTH} characters or less` },
      400,
    );
  }
  const query = rawQuery;
  const parsedLimit = parseInt(
    url.searchParams.get('limit') || String(MEMORY_SEARCH_DEFAULT_LIMIT),
    10,
  );
  const limit = Math.max(
    1,
    Math.min(
      isNaN(parsedLimit) ? MEMORY_SEARCH_DEFAULT_LIMIT : parsedLimit,
      MEMORY_SEARCH_MAX_LIMIT,
    ),
  );

  const tagsParam = url.searchParams.get('tags');
  const tags = tagsParam
    ? tagsParam
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MEMORY_SEARCH_MAX_TAGS)
    : null;

  const categoriesParam = url.searchParams.get('categories');
  const categories = categoriesParam
    ? categoriesParam
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    : null;

  // Richer filters: session_id, agent_id, handle, date range
  const sessionId = url.searchParams.get('session_id') || null;
  const filterAgentId = url.searchParams.get('agent_id') || null;
  const filterHandle = url.searchParams.get('handle') || null;
  const after = url.searchParams.get('after') || null;
  const before = url.searchParams.get('before') || null;
  // Decay-aware ranking is on by default; clients pass `decay=off` for
  // recency-only ordering when running broad "show me everything" queries.
  const decay = url.searchParams.get('decay') === 'off' ? 'off' : 'on';
  // Compact format strips text down to a 160-char preview so an agent can
  // scan many results without paying for full text on each. Detail is
  // default for back-compat.
  const format = url.searchParams.get('format') === 'compact' ? 'compact' : 'detail';

  // Hybrid retrieval: generate a query embedding for non-literal queries.
  // Literal-shaped queries (paths, SHAs, identifiers) are strictly better
  // served by FTS5 alone — embeddings semantically conflate similar paths.
  // The DO will detect literal queries and skip vector regardless, but
  // skipping the embedding call here saves a Workers AI round-trip.
  let queryEmbedding: ArrayBuffer | null = null;
  let degraded = false;
  if (query && !isLiteralQuery(query)) {
    queryEmbedding = await generateEmbedding(query, env.AI);
    if (!queryEmbedding) degraded = true;
  }

  const result = await team.searchMemories(agentId, query, tags, categories, limit, user.id, {
    sessionId,
    agentId: filterAgentId,
    handle: filterHandle,
    after,
    before,
    decay,
    format,
    queryEmbedding,
  });
  // Tag the response with degraded:true when the route asked for hybrid
  // retrieval but couldn't generate a query embedding (Workers AI failed).
  // Lets callers retry with backoff or surface a quality warning.
  if (degraded && result && typeof result === 'object' && 'ok' in result) {
    (result as { degraded?: boolean }).degraded = true;
  }
  return doResult(Promise.resolve(result), 'searchMemories');
});

export const handleTeamUpdateMemory = teamJsonRoute(
  async ({ body, user, env, teamId, request }) => {
    const id = requireString(body, 'id');
    if (!id) return json({ error: 'id is required' }, 400);

    let text: string | undefined;
    if (body.text !== undefined) {
      const parsed = requireString(body, 'text');
      if (!parsed) return json({ error: 'text must be a non-empty string' }, 400);
      if (parsed.length > MAX_MEMORY_TEXT_LENGTH)
        return json({ error: `text must be ${MAX_MEMORY_TEXT_LENGTH} characters or less` }, 400);
      text = parsed;
    }
    // Secret detection (same policy as save). force: true bypasses with audit log.
    const force = body.force === true;
    if (text !== undefined && !force) {
      const secrets = detectSecrets(text);
      if (secrets.length > 0) {
        const teamStub = env.TEAM.get(env.TEAM.idFromName(teamId));
        try {
          await teamStub.recordTelemetry('secrets_blocked');
        } catch {
          /* non-critical */
        }
        return json(
          {
            error: 'Memory contains potential secret(s); refusing to update',
            code: 'SECRET_DETECTED',
            secrets: secrets.map((s) => ({ type: s.type, preview: s.preview })),
            hint: 'If this is intentional documentation, retry with force: true',
          },
          422,
        );
      }
    } else if (text !== undefined && force) {
      const secrets = detectSecrets(text);
      if (secrets.length > 0) {
        log.warn('memory update with force=true bypassed secret detection', {
          handle: user.handle,
          types: secrets.map((s) => s.type),
          count: secrets.length,
        });
      }
    }

    // Moderation: full AI check on updated text (same pattern as save)
    if (text !== undefined) {
      const modResult = await checkContent(text, env);
      if (modResult.blocked) {
        if (modResult.reason === 'moderation_unavailable') {
          log.warn('content moderation unavailable: blocking memory update as fail-safe');
          return json(
            { error: 'Content moderation is temporarily unavailable. Please try again.' },
            503,
          );
        }
        return json({ error: 'Content blocked' }, 400);
      }
    }

    let tags: string[] | undefined;
    if (body.tags !== undefined) {
      const tagsResult = validateTagsArray(body.tags, MAX_TAGS_PER_MEMORY);
      if (tagsResult.error) return json({ error: tagsResult.error }, 400);
      tags = tagsResult.tags!;
      // Moderation: check updated tag content
      if (tags.some((t) => isBlocked(t))) return json({ error: 'Content blocked' }, 400);
    }

    if (text === undefined && tags === undefined) {
      return json({ error: 'text or tags required' }, 400);
    }

    return withTeamRateLimit({
      request,
      user,
      env,
      teamId,
      rateLimitKey: 'memory_update',
      rateLimitMax: RATE_LIMIT_MEMORY_UPDATES,
      rateLimitMsg: 'Memory update limit reached (50/day). Try again tomorrow.',
      action: (team, agentId) => team.updateMemory(agentId, id, text, tags, user.id),
    });
  },
);

export const handleTeamDeleteMemory = teamJsonRoute(
  async ({ body, user, env, teamId, request }) => {
    const id = requireString(body, 'id');
    if (!id) return json({ error: 'id is required' }, 400);

    return withTeamRateLimit({
      request,
      user,
      env,
      teamId,
      rateLimitKey: 'memory_delete',
      rateLimitMax: RATE_LIMIT_MEMORY_DELETES,
      rateLimitMsg: 'Memory delete limit reached (50/day). Try again tomorrow.',
      action: (team, agentId) => team.deleteMemory(agentId, id, user.id),
    });
  },
);

// --- Consolidation review queue ---
//
// Background consolidation runs the Graphiti funnel (cosine recall →
// Jaccard structural → tag-set agreement) and writes propose-only
// candidates. Nothing merges automatically; the agent or operator must
// review and apply explicitly. Every merge is reversible via unmerge.

export const handleTeamRunConsolidation = teamRoute(async ({ team }) => {
  return doResult(team.runConsolidation(), 'runConsolidation');
});

export const handleTeamListConsolidationProposals = teamRoute(
  async ({ request, agentId, team, user }) => {
    const url = new URL(request.url);
    const parsedLimit = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(1, isNaN(parsedLimit) ? 50 : parsedLimit), 200);
    return doResult(
      team.listConsolidationProposals(agentId, limit, user.id),
      'listConsolidationProposals',
    );
  },
);

export const handleTeamApplyConsolidation = teamJsonRoute(async ({ body, user, team, agentId }) => {
  const proposalId = requireString(body, 'proposal_id');
  if (!proposalId) return json({ error: 'proposal_id is required' }, 400);
  return doResult(
    team.applyConsolidationProposal(agentId, proposalId, user.handle, user.id),
    'applyConsolidationProposal',
  );
});

export const handleTeamRejectConsolidation = teamJsonRoute(
  async ({ body, user, team, agentId }) => {
    const proposalId = requireString(body, 'proposal_id');
    if (!proposalId) return json({ error: 'proposal_id is required' }, 400);
    return doResult(
      team.rejectConsolidationProposal(agentId, proposalId, user.handle, user.id),
      'rejectConsolidationProposal',
    );
  },
);

export const handleTeamUnmergeMemory = teamJsonRoute(async ({ body, user, team, agentId }) => {
  const memoryId = requireString(body, 'memory_id');
  if (!memoryId) return json({ error: 'memory_id is required' }, 400);
  return doResult(team.unmergeMemory(agentId, memoryId, user.id), 'unmergeMemory');
});

// --- Shadow-mode formation (auditor) ---
//
// Formation is the LLM-side counterpart to consolidation: it classifies a
// memory as keep / merge / evolve / discard against top-K cosine
// neighbours. Recommendations land in formation_observations as
// observability — never auto-applied. Surfaces in the dashboard so the
// reviewer can decide whether to tighten consolidation thresholds or
// (eventually) opt-in to enforcement.

export const handleTeamRunFormationSweep = teamJsonRoute(async ({ body, team }) => {
  const limit = typeof body.limit === 'number' ? body.limit : 20;
  return doResult(team.runFormationOnRecent(limit), 'runFormationOnRecent');
});

export const handleTeamRunFormationOne = teamJsonRoute(async ({ body, team }) => {
  const memoryId = requireString(body, 'memory_id');
  if (!memoryId) return json({ error: 'memory_id is required' }, 400);
  return doResult(team.runFormationOnMemory(memoryId), 'runFormationOnMemory');
});

export const handleTeamListFormationObservations = teamRoute(
  async ({ request, agentId, team, user }) => {
    const url = new URL(request.url);
    const recParam = url.searchParams.get('recommendation');
    const allowed = ['keep', 'merge', 'evolve', 'discard'] as const;
    const recommendation =
      recParam && (allowed as readonly string[]).includes(recParam)
        ? (recParam as (typeof allowed)[number])
        : undefined;
    const parsedLimit = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(1, isNaN(parsedLimit) ? 50 : parsedLimit), 200);
    const filter: { recommendation?: 'keep' | 'merge' | 'evolve' | 'discard'; limit?: number } = {
      limit,
    };
    if (recommendation) filter.recommendation = recommendation;
    return doResult(
      team.listFormationObservations(agentId, filter, user.id),
      'listFormationObservations',
    );
  },
);

export const handleTeamDeleteMemoryBatch = teamJsonRoute(
  async ({ body, user, env, teamId, request }) => {
    const filter: Record<string, unknown> = {};

    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((id: unknown): id is string => typeof id === 'string');
      if (ids.length === 0) return json({ error: 'ids array must not be empty' }, 400);
      if (ids.length > 100) return json({ error: 'Maximum 100 ids per batch delete' }, 400);
      filter.ids = ids;
    }
    if (Array.isArray(body.tags)) {
      filter.tags = body.tags.filter((t: unknown): t is string => typeof t === 'string');
    }
    if (typeof body.before === 'string') {
      filter.before = body.before;
    }

    if (!filter.ids && !filter.tags && !filter.before) {
      return json({ error: 'At least one filter required (ids, tags, or before)' }, 400);
    }

    return withTeamRateLimit({
      request,
      user,
      env,
      teamId,
      rateLimitKey: 'memory_delete',
      rateLimitMax: RATE_LIMIT_MEMORY_DELETES,
      rateLimitMsg: 'Memory delete limit reached (50/day). Try again tomorrow.',
      action: (team, agentId) => team.deleteMemoriesBatch(agentId, filter, user.id),
    });
  },
);

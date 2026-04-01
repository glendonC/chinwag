import { isBlocked } from '../moderation.js';
import { getDB, getTeam } from '../lib/env.js';
import { json, parseBody } from '../lib/http.js';
import { getAgentRuntime, teamErrorStatus } from '../lib/request-utils.js';
import { requireJson, validateFileArray, validateTagsArray, withRateLimit } from '../lib/validation.js';

export async function handleTeamJoin(request, user, env, teamId) {
  let name = null;
  try {
    const body = await request.json();
    name = typeof body.name === 'string' ? body.name.slice(0, 100).trim() || null : null;
  } catch {}

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(db, `join:${user.id}`, 100, 'Team join limit reached (100/day). Try again tomorrow.', async () => {
    const result = await team.join(agentId, user.id, user.handle, runtime);
    if (result.error) return json({ error: result.error }, 400);

    try {
      await db.addUserTeam(user.id, teamId, name);
    } catch (err) {
      console.error(`[chinwag] Failed to sync joined team ${teamId} for user ${user.id}:`, err);
    }

    return json(result);
  });
}

export async function handleTeamLeave(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.leave(agentId, user.id);
  if (result.error) return json({ error: result.error }, 400);

  const db = getDB(env);
  try {
    await db.removeUserTeam(user.id, teamId);
  } catch (err) {
    console.error(`[chinwag] Failed to remove team ${teamId} for user ${user.id}:`, err);
  }

  return json(result);
}

export async function handleTeamContext(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getContext(agentId, user.id);
  if (result.error) return json({ error: result.error }, 403);

  const db = getDB(env);
  try {
    await db.addUserTeam(user.id, teamId);
  } catch (err) {
    console.error(`[chinwag] Failed to backfill team ${teamId} for user ${user.id}:`, err);
  }

  return json(result);
}

export async function handleTeamActivity(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { files, summary } = body;
  const fileErr = validateFileArray(files, 50);
  if (fileErr) return json({ error: fileErr }, 400);

  if (typeof summary !== 'string') return json({ error: 'summary must be a string' }, 400);
  if (summary.length > 280) return json({ error: 'summary must be 280 characters or less' }, 400);
  if (summary && isBlocked(summary)) return json({ error: 'Content blocked' }, 400);

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.updateActivity(agentId, files, summary, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamConflicts(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { files } = body;
  const fileErr = validateFileArray(files, 50);
  if (fileErr) return json({ error: fileErr }, 400);

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.checkConflicts(agentId, files, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamHeartbeat(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.heartbeat(agentId, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamFile(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { file } = body;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file must be a non-empty string' }, 400);
  }
  if (file.length > 500) {
    return json({ error: 'file path too long' }, 400);
  }

  const db = getDB(env);
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);

  return withRateLimit(db, `file:${user.id}`, 500, 'File report limit reached (500/day). Try again tomorrow.', async () => {
    const result = await team.reportFile(agentId, file, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result);
  });
}

export async function handleTeamSaveMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { text } = body;
  if (typeof text !== 'string' || !text.trim()) {
    return json({ error: 'text is required' }, 400);
  }
  if (text.length > 2000) {
    return json({ error: 'text must be 2000 characters or less' }, 400);
  }
  if (isBlocked(text)) return json({ error: 'Content blocked' }, 400);

  const tagsResult = validateTagsArray(body.tags, 10);
  if (tagsResult.error) return json({ error: tagsResult.error }, 400);
  const tags = tagsResult.tags;

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(db, `memory:${user.id}`, 20, 'Memory save limit reached (20/day). Try again tomorrow.', async () => {
    const result = await team.saveMemory(agentId, text.trim(), tags, user.handle, runtime, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result, 201);
  });
}

export async function handleTeamSearchMemory(request, user, env, teamId) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || null;
  const parsedLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.max(1, Math.min(isNaN(parsedLimit) ? 20 : parsedLimit, 50));

  const tagsParam = url.searchParams.get('tags');
  const tags = tagsParam
    ? tagsParam.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : null;

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.searchMemories(agentId, query, tags, limit, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamUpdateMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { id, text } = body;
  if (typeof id !== 'string' || !id.trim()) {
    return json({ error: 'id is required' }, 400);
  }
  if (text !== undefined && (typeof text !== 'string' || !text.trim())) {
    return json({ error: 'text must be a non-empty string' }, 400);
  }
  if (text !== undefined && text.length > 2000) {
    return json({ error: 'text must be 2000 characters or less' }, 400);
  }

  let tags = body.tags;
  if (tags !== undefined) {
    const tagsResult = validateTagsArray(tags, 10);
    if (tagsResult.error) return json({ error: tagsResult.error }, 400);
    tags = tagsResult.tags;
  }

  if (text === undefined && tags === undefined) {
    return json({ error: 'text or tags required' }, 400);
  }

  const db = getDB(env);
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);

  return withRateLimit(db, `memory_update:${user.id}`, 50, 'Memory update limit reached (50/day). Try again tomorrow.', async () => {
    const result = await team.updateMemory(agentId, id, text, tags, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result);
  });
}

export async function handleTeamDeleteMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { id } = body;
  if (typeof id !== 'string' || !id.trim()) {
    return json({ error: 'id is required' }, 400);
  }

  const db = getDB(env);
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);

  return withRateLimit(db, `memory_delete:${user.id}`, 50, 'Memory delete limit reached (50/day). Try again tomorrow.', async () => {
    const result = await team.deleteMemory(agentId, id, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result);
  });
}

export async function handleTeamClaimFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { files } = body;
  const fileErr = validateFileArray(files, 20);
  if (fileErr) return json({ error: fileErr }, 400);

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(db, `locks:${user.id}`, 100, 'Lock claim limit reached (100/day). Try again tomorrow.', async () => {
    const result = await team.claimFiles(agentId, files, user.handle, runtime, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result);
  });
}

export async function handleTeamReleaseFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const files = body.files || null;
  if (files !== null && !Array.isArray(files)) return json({ error: 'files must be an array' }, 400);
  if (files && files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.releaseFiles(agentId, files, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamGetLocks(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getLockedFiles(agentId, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamSendMessage(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { text, target } = body;
  if (typeof text !== 'string' || !text.trim()) return json({ error: 'text is required' }, 400);
  if (text.length > 500) return json({ error: 'text must be 500 characters or less' }, 400);
  if (isBlocked(text)) return json({ error: 'Content blocked' }, 400);
  if (target !== undefined && typeof target !== 'string') return json({ error: 'target must be a string' }, 400);

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(db, `messages:${user.id}`, 200, 'Message limit reached (200/day). Try again tomorrow.', async () => {
    const result = await team.sendMessage(agentId, user.handle, runtime, text.trim(), target || null, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result, 201);
  });
}

export async function handleTeamGetMessages(request, user, env, teamId) {
  const url = new URL(request.url);
  const since = url.searchParams.get('since') || null;

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getMessages(agentId, since, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamStartSession(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const framework = typeof body.framework === 'string' ? body.framework.slice(0, 50) : 'unknown';

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(db, `session:${user.id}`, 50, 'Session limit reached. Try again tomorrow.', async () => {
    const result = await team.startSession(agentId, user.handle, framework, runtime, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result, 201);
  });
}

export async function handleTeamEndSession(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { session_id } = body;
  if (typeof session_id !== 'string') {
    return json({ error: 'session_id is required' }, 400);
  }

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.endSession(agentId, session_id, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamSessionEdit(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { file } = body;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file is required' }, 400);
  }
  if (file.length > 500) return json({ error: 'file path too long' }, 400);

  const db = getDB(env);
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);

  return withRateLimit(db, `edit:${user.id}`, 1000, 'Edit recording limit reached. Try again tomorrow.', async () => {
    const result = await team.recordEdit(agentId, file, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result);
  });
}

export async function handleTeamHistory(request, user, env, teamId) {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || '7', 10);
  const days = Math.max(1, Math.min(isNaN(parsed) ? 7 : parsed, 30));

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getHistory(agentId, days, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamEnrichModel(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { model } = body;
  if (typeof model !== 'string' || !model.trim()) {
    return json({ error: 'model is required' }, 400);
  }
  if (model.length > 50) {
    return json({ error: 'model must be 50 characters or less' }, 400);
  }

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.enrichModel(agentId, model.trim(), user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

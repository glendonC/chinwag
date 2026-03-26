import { isBlocked } from '../moderation.js';
import { VALID_CATEGORIES } from '../team.js';
import { getDB, getTeam } from '../lib/env.js';
import { json, parseBody } from '../lib/http.js';
import { getAgentId, getToolFromAgentId, teamErrorStatus } from '../lib/request-utils.js';

export async function handleTeamJoin(request, user, env, teamId) {
  let name = null;
  try {
    const body = await request.json();
    name = typeof body.name === 'string' ? body.name.slice(0, 100).trim() || null : null;
  } catch {}

  const agentId = getAgentId(request, user);
  const tool = getToolFromAgentId(agentId);
  const team = getTeam(env, teamId);
  const result = await team.join(agentId, user.id, user.handle, tool);
  if (result.error) return json({ error: result.error }, 400);

  const db = getDB(env);
  try { await db.addUserTeam(user.id, teamId, name); } catch {}

  return json(result);
}

export async function handleTeamLeave(request, user, env, teamId) {
  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.leave(agentId, user.id);
  if (result.error) return json({ error: result.error }, 400);

  const db = getDB(env);
  try { await db.removeUserTeam(user.id, teamId); } catch {}

  return json(result);
}

export async function handleTeamContext(request, user, env, teamId) {
  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getContext(agentId, user.id);
  if (result.error) return json({ error: result.error }, 403);

  const db = getDB(env);
  try { await db.addUserTeam(user.id, teamId); } catch {}

  return json(result);
}

export async function handleTeamActivity(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { files, summary } = body;
  if (!Array.isArray(files) || files.length === 0) return json({ error: 'files must be a non-empty array' }, 400);
  if (files.length > 50) return json({ error: 'too many files (max 50)' }, 400);
  if (files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);
  if (typeof summary !== 'string') return json({ error: 'summary must be a string' }, 400);
  if (summary.length > 280) return json({ error: 'summary must be 280 characters or less' }, 400);
  if (summary && isBlocked(summary)) return json({ error: 'Content blocked' }, 400);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.updateActivity(agentId, files, summary, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamConflicts(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { files } = body;
  if (!Array.isArray(files) || files.length === 0) return json({ error: 'files must be a non-empty array' }, 400);
  if (files.length > 50) return json({ error: 'too many files (max 50)' }, 400);
  if (files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.checkConflicts(agentId, files, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamHeartbeat(request, user, env, teamId) {
  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.heartbeat(agentId, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamFile(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { file } = body;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file must be a non-empty string' }, 400);
  }
  if (file.length > 500) {
    return json({ error: 'file path too long' }, 400);
  }

  const db = getDB(env);
  const fileLimit = await db.checkRateLimit(`file:${user.id}`, 500);
  if (!fileLimit.allowed) return json({ error: 'File report limit reached (500/day). Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.reportFile(agentId, file, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  await db.consumeRateLimit(`file:${user.id}`);
  return json(result);
}

export async function handleTeamSaveMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { text, category } = body;
  if (typeof text !== 'string' || !text.trim()) {
    return json({ error: 'text is required' }, 400);
  }
  if (text.length > 2000) {
    return json({ error: 'text must be 2000 characters or less' }, 400);
  }
  if (isBlocked(text)) return json({ error: 'Content blocked' }, 400);
  if (!VALID_CATEGORIES.includes(category)) {
    return json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, 400);
  }

  const db = getDB(env);
  const memLimit = await db.checkRateLimit(`memory:${user.id}`, 20);
  if (!memLimit.allowed) {
    return json({ error: 'Memory save limit reached (20/day). Try again tomorrow.' }, 429);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.saveMemory(agentId, text.trim(), category, user.handle, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));

  await db.consumeRateLimit(`memory:${user.id}`);
  return json(result, 201);
}

export async function handleTeamSearchMemory(request, user, env, teamId) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || null;
  const category = url.searchParams.get('category') || null;
  const parsedLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.max(1, Math.min(isNaN(parsedLimit) ? 20 : parsedLimit, 50));

  if (category && !VALID_CATEGORIES.includes(category)) {
    return json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, 400);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.searchMemories(agentId, query, category, limit, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamUpdateMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { id, text, category } = body;
  if (typeof id !== 'string' || !id.trim()) {
    return json({ error: 'id is required' }, 400);
  }
  if (text !== undefined && (typeof text !== 'string' || !text.trim())) {
    return json({ error: 'text must be a non-empty string' }, 400);
  }
  if (text !== undefined && text.length > 2000) {
    return json({ error: 'text must be 2000 characters or less' }, 400);
  }
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    return json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, 400);
  }
  if (text === undefined && category === undefined) {
    return json({ error: 'text or category required' }, 400);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.updateMemory(agentId, id, text, category, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamDeleteMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { id } = body;
  if (typeof id !== 'string' || !id.trim()) {
    return json({ error: 'id is required' }, 400);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.deleteMemory(agentId, id, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamClaimFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { files } = body;
  if (!Array.isArray(files) || files.length === 0) return json({ error: 'files must be a non-empty array' }, 400);
  if (files.length > 20) return json({ error: 'too many files (max 20)' }, 400);
  if (files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);

  const db = getDB(env);
  const lockLimit = await db.checkRateLimit(`locks:${user.id}`, 100);
  if (!lockLimit.allowed) return json({ error: 'Lock claim limit reached (100/day). Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const tool = getToolFromAgentId(agentId);
  const team = getTeam(env, teamId);
  const result = await team.claimFiles(agentId, files, user.handle, tool, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  await db.consumeRateLimit(`locks:${user.id}`);
  return json(result);
}

export async function handleTeamReleaseFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const files = body.files || null;
  if (files !== null && !Array.isArray(files)) return json({ error: 'files must be an array' }, 400);
  if (files && files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.releaseFiles(agentId, files, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamGetLocks(request, user, env, teamId) {
  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getLockedFiles(agentId, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamSendMessage(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { text, target } = body;
  if (typeof text !== 'string' || !text.trim()) return json({ error: 'text is required' }, 400);
  if (text.length > 500) return json({ error: 'text must be 500 characters or less' }, 400);
  if (isBlocked(text)) return json({ error: 'Content blocked' }, 400);
  if (target !== undefined && typeof target !== 'string') return json({ error: 'target must be a string' }, 400);

  const db = getDB(env);
  const msgLimit = await db.checkRateLimit(`messages:${user.id}`, 200);
  if (!msgLimit.allowed) return json({ error: 'Message limit reached (200/day). Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const tool = getToolFromAgentId(agentId);
  const team = getTeam(env, teamId);
  const result = await team.sendMessage(agentId, user.handle, tool, text.trim(), target || null, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  await db.consumeRateLimit(`messages:${user.id}`);
  return json(result, 201);
}

export async function handleTeamGetMessages(request, user, env, teamId) {
  const url = new URL(request.url);
  const since = url.searchParams.get('since') || null;

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getMessages(agentId, since, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamStartSession(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const framework = typeof body.framework === 'string' ? body.framework.slice(0, 50) : 'unknown';

  const db = getDB(env);
  const limit = await db.checkRateLimit(`session:${user.id}`, 50);
  if (!limit.allowed) return json({ error: 'Session limit reached. Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.startSession(agentId, user.handle, framework, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));

  await db.consumeRateLimit(`session:${user.id}`);
  return json(result, 201);
}

export async function handleTeamEndSession(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { session_id } = body;
  if (typeof session_id !== 'string') {
    return json({ error: 'session_id is required' }, 400);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.endSession(agentId, session_id, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamSessionEdit(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { file } = body;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file is required' }, 400);
  }
  if (file.length > 500) return json({ error: 'file path too long' }, 400);

  const db = getDB(env);
  const editLimit = await db.checkRateLimit(`edit:${user.id}`, 1000);
  if (!editLimit.allowed) return json({ error: 'Edit recording limit reached. Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.recordEdit(agentId, file, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  await db.consumeRateLimit(`edit:${user.id}`);
  return json(result);
}

export async function handleTeamHistory(request, user, env, teamId) {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || '7', 10);
  const days = Math.max(1, Math.min(isNaN(parsed) ? 7 : parsed, 30));

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getHistory(agentId, days, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

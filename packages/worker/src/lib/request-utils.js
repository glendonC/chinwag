export function getAgentId(request, user) {
  const agentId = request.headers.get('X-Agent-Id');
  if (agentId && typeof agentId === 'string' && agentId.length > 0 && agentId.length <= 60) {
    return agentId;
  }
  return user.id;
}

export function getToolFromAgentId(agentId) {
  const idx = agentId.indexOf(':');
  return idx > 0 ? agentId.slice(0, idx) : 'unknown';
}

export function sanitizeTags(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(t => typeof t === 'string')
    .map(t => t.slice(0, 50).toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function parseTeamPath(path) {
  const match = path.match(/^\/teams\/(t_[a-f0-9]{16})\/([a-z]+)$/);
  if (!match) return null;
  return { teamId: match[1], action: match[2] };
}

export function teamErrorStatus(msg) {
  return msg?.includes('Not a member') || msg?.includes('Not your agent') || msg?.includes('Only the author')
    ? 403
    : 400;
}

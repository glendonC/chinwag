// WebSocket delta application for dashboards.
// Pure functions that merge server-pushed events into existing context state.
// Shared by CLI (Ink) and web (React) dashboards.

/**
 * Apply a delta event from the TeamDO WebSocket to the current context.
 * Returns a new context object (immutable update).
 */
export function applyDelta(context, event) {
  if (!context || !event?.type) return context;

  switch (event.type) {
    case 'heartbeat':
      return applyHeartbeat(context, event);
    case 'activity':
      return applyActivity(context, event);
    case 'file':
      return applyFileReport(context, event);
    case 'member_joined':
      return applyMemberJoined(context, event);
    case 'member_left':
      return applyMemberLeft(context, event);
    case 'status_change':
      return applyStatusChange(context, event);
    case 'lock_change':
      return applyLockChange(context, event);
    case 'message':
      return applyMessage(context, event);
    case 'memory':
      return applyMemory(context, event);
    default:
      return context;
  }
}

function applyHeartbeat(ctx, event) {
  const members = (ctx.members || []).map(m => {
    if (m.agent_id !== event.agent_id) return m;
    return { ...m, status: 'active', seconds_since_update: 0 };
  });
  return { ...ctx, members };
}

function applyActivity(ctx, event) {
  const members = (ctx.members || []).map(m => {
    if (m.agent_id !== event.agent_id) return m;
    return {
      ...m,
      status: 'active',
      seconds_since_update: 0,
      activity: { files: event.files || [], summary: event.summary || null },
    };
  });
  return { ...ctx, members };
}

function applyFileReport(ctx, event) {
  const members = (ctx.members || []).map(m => {
    if (m.agent_id !== event.agent_id) return m;
    const existingFiles = m.activity?.files || [];
    const files = existingFiles.includes(event.file)
      ? existingFiles
      : [...existingFiles, event.file];
    return {
      ...m,
      status: 'active',
      seconds_since_update: 0,
      activity: { ...m.activity, files },
    };
  });
  return { ...ctx, members };
}

function applyMemberJoined(ctx, event) {
  const existing = (ctx.members || []).find(m => m.agent_id === event.agent_id);
  if (existing) {
    const members = ctx.members.map(m => {
      if (m.agent_id !== event.agent_id) return m;
      return { ...m, status: 'active', handle: event.handle || m.handle, tool: event.tool || m.tool };
    });
    return { ...ctx, members };
  }
  const newMember = {
    agent_id: event.agent_id,
    handle: event.handle || 'unknown',
    tool: event.tool || 'unknown',
    status: 'active',
    seconds_since_update: 0,
    minutes_since_update: 0,
    activity: null,
  };
  return { ...ctx, members: [...(ctx.members || []), newMember] };
}

function applyMemberLeft(ctx, event) {
  const members = (ctx.members || []).filter(m => m.agent_id !== event.agent_id);
  return { ...ctx, members };
}

function applyStatusChange(ctx, event) {
  const members = (ctx.members || []).map(m => {
    if (m.agent_id !== event.agent_id) return m;
    return { ...m, status: event.status };
  });
  return { ...ctx, members };
}

function applyLockChange(ctx, event) {
  let locks = ctx.locks || [];
  if (event.action === 'claim') {
    const newLocks = (event.files || []).map(file => ({
      file_path: file,
      agent_id: event.agent_id,
    }));
    locks = [...locks, ...newLocks];
  } else if (event.action === 'release') {
    const released = new Set(event.files || []);
    locks = locks.filter(l => !(l.agent_id === event.agent_id && released.has(l.file_path)));
  } else if (event.action === 'release_all') {
    locks = locks.filter(l => l.agent_id !== event.agent_id);
  }
  return { ...ctx, locks };
}

function applyMessage(ctx, event) {
  const newMsg = {
    from_handle: event.from_handle,
    text: event.text,
    created_at: new Date().toISOString(),
  };
  const messages = [...(ctx.messages || []), newMsg].slice(-50);
  return { ...ctx, messages };
}

function applyMemory(ctx, event) {
  const newMem = {
    text: event.text,
    tags: event.tags || [],
    created_at: new Date().toISOString(),
  };
  const memories = [newMem, ...(ctx.memories || [])].slice(0, 100);
  return { ...ctx, memories };
}

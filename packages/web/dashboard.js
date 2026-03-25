// chinwag dashboard
// Token: URL hash (#token=xxx) → sessionStorage → manual input.

const API_URL = 'https://chinwag-api.glendonchin.workers.dev';
const POLL_MS = 5000;
const TOKEN_KEY = 'chinwag_token';

let token = null;
let user = null;
let teams = [];
let activeTeamId = null;
let allProjectsMode = false;
let pollTimer = null;
let prevContextJson = '';
let prevSummaryJson = '';
let consecutiveFailures = 0;
const MEMORY_CATEGORIES = new Set(['gotcha', 'config', 'decision', 'pattern', 'reference']);
const joinedTeams = new Set();

const $ = (s) => document.querySelector(s);
const connectScreen = $('#connect-screen');
const appScreen = $('#app');
const tokenInput = $('#token-input');
const tokenSubmit = $('#token-submit');
const connectError = $('#connect-error');
const projectSelect = $('#project-select');
const userBadge = $('#user-badge');
const logoutBtn = $('#logout-btn');
const detailView = $('#detail-view');
const allProjectsView = $('#all-projects-view');
const agentCount = $('#agent-count');
const agentsList = $('#agents-list');
const conflictsCard = $('#conflicts-card');
const conflictsList = $('#conflicts-list');
const memoryList = $('#memory-list');
const sessionsList = $('#sessions-list');
const statusText = $('#status-text');
const lastUpdate = $('#last-update');

// ── API ──

async function api(method, path, body = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_URL}${path}`, opts);
    let data;
    try { data = await res.json(); } catch {
      const parseErr = new Error(`HTTP ${res.status} (server error)`);
      parseErr.status = res.status;
      throw parseErr;
    }
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Request timed out');
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Auth ──

function readTokenFromHash() {
  const hash = window.location.hash;
  if (!hash.includes('token=')) return null;
  const match = hash.match(/token=([^&]+)/);
  if (!match) return null;
  history.replaceState(null, '', window.location.pathname);
  return match[1];
}

async function authenticate(t) {
  token = t;
  try {
    user = await api('GET', '/me');
    sessionStorage.setItem(TOKEN_KEY, token);
    return true;
  } catch (err) {
    console.error('[chinwag] Auth failed:', err);
    token = null;
    sessionStorage.removeItem(TOKEN_KEY);
    // Re-throw so caller can show the actual error
    throw err;
  }
}

function logout() {
  token = null;
  user = null;
  teams = [];
  activeTeamId = null;
  prevContextJson = '';
  prevSummaryJson = '';
  consecutiveFailures = 0;
  sessionStorage.removeItem(TOKEN_KEY);
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  appScreen.hidden = true;
  connectScreen.hidden = false;
  connectError.hidden = true;
  tokenInput.value = '';
  agentsList.innerHTML = '';
  memoryList.innerHTML = '';
  sessionsList.innerHTML = '';
  conflictsList.innerHTML = '';
  allProjectsView.innerHTML = '';
  userBadge.textContent = '';
}

// ── Boot ──

async function boot() {
  try {
    const hashToken = readTokenFromHash();
    if (hashToken) { await authenticate(hashToken); return startApp(); }

    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (stored) { await authenticate(stored); return startApp(); }
  } catch (err) {
    console.error('[chinwag] Boot auth failed:', err);
  }

  connectScreen.hidden = false;
}

// ── Connect UI ──

tokenSubmit.addEventListener('click', tryConnect);
tokenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryConnect(); });
logoutBtn.addEventListener('click', logout);

async function tryConnect() {
  const t = tokenInput.value.trim();
  if (!t) {
    connectError.textContent = 'Paste your token from ~/.chinwag/config.json';
    connectError.hidden = false;
    return;
  }

  tokenSubmit.textContent = 'Connecting...';
  tokenSubmit.disabled = true;
  connectError.hidden = true;

  try {
    await authenticate(t);
    await startApp();
  } catch (err) {
    console.error('[chinwag] tryConnect error:', err);
    const msg = err.message || 'Connection failed';
    connectError.textContent = msg.includes('Failed to fetch')
      ? 'Cannot reach server. Check your connection.'
      : `Failed: ${msg}`;
    connectError.hidden = false;
  }

  tokenSubmit.textContent = 'Connect';
  tokenSubmit.disabled = false;
}

// ── App ──

async function startApp() {
  connectScreen.hidden = true;
  appScreen.hidden = false;
  userBadge.textContent = user.handle;
  try {
    await loadTeams();
  } catch (err) {
    console.error('[chinwag] loadTeams error:', err);
    statusText.textContent = err.message || 'Failed to load projects';
  }
  startPolling();
}

async function loadTeams() {
  try {
    const result = await api('GET', '/me/teams');
    teams = result.teams || [];
  } catch {
    teams = [];
  }

  projectSelect.innerHTML = '';

  if (teams.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No projects';
    opt.disabled = true;
    projectSelect.appendChild(opt);
    statusText.textContent = 'Run chinwag init in a project to get started.';
    return;
  }

  // "All projects" overview when user has 2+ teams
  if (teams.length > 1) {
    const allOpt = document.createElement('option');
    allOpt.value = '__all__';
    allOpt.textContent = 'All projects';
    projectSelect.appendChild(allOpt);
  }

  for (const t of teams) {
    const opt = document.createElement('option');
    opt.value = t.team_id;
    opt.textContent = t.team_name || t.team_id;
    projectSelect.appendChild(opt);
  }

  if (teams.length > 1) {
    // Default to overview for multi-project users
    allProjectsMode = true;
    activeTeamId = null;
    projectSelect.value = '__all__';
    showAllProjectsView();
    await fetchDashboardSummary();
  } else {
    allProjectsMode = false;
    activeTeamId = teams[0].team_id;
    projectSelect.value = activeTeamId;
    showDetailView();
    await fetchContext();
  }
}

projectSelect.addEventListener('change', () => {
  prevContextJson = '';
  prevSummaryJson = '';
  const val = projectSelect.value;
  if (val === '__all__') {
    allProjectsMode = true;
    activeTeamId = null;
    showAllProjectsView();
    fetchDashboardSummary();
  } else {
    allProjectsMode = false;
    activeTeamId = val;
    showDetailView();
    fetchContext();
  }
});

function showDetailView() {
  detailView.hidden = false;
  allProjectsView.hidden = true;
}

function showAllProjectsView() {
  detailView.hidden = true;
  allProjectsView.hidden = false;
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const delay = consecutiveFailures >= 3 ? 30000 : POLL_MS;
  pollTimer = setInterval(() => {
    if (allProjectsMode) fetchDashboardSummary();
    else fetchContext();
  }, delay);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  } else if (token && user) {
    if (allProjectsMode) fetchDashboardSummary();
    else fetchContext();
    startPolling();
  }
});

// ── All Projects ──

async function fetchDashboardSummary() {
  const wasAllMode = allProjectsMode;
  try {
    const data = await api('GET', '/me/dashboard');
    if (!allProjectsMode || allProjectsMode !== wasAllMode) return;
    const sumJson = JSON.stringify(data);
    if (sumJson === prevSummaryJson) return;
    prevSummaryJson = sumJson;

    const summaries = data.teams || [];
    renderAllProjects(summaries);

    const totalActive = summaries.reduce((sum, t) => sum + t.active_agents, 0);
    const conflicts = summaries.reduce((sum, t) => sum + t.conflict_count, 0);
    let status = `${totalActive} active across ${summaries.length} project${summaries.length !== 1 ? 's' : ''}`;
    if (conflicts) status += ` · ${conflicts} conflict${conflicts !== 1 ? 's' : ''}`;
    statusText.textContent = status;
    lastUpdate.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (consecutiveFailures > 0) { consecutiveFailures = 0; startPolling(); }
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    consecutiveFailures++;
    if (consecutiveFailures >= 3) startPolling();
    statusText.textContent = err.message;
  }
}

function renderAllProjects(summaries) {
  if (summaries.length === 0) {
    allProjectsView.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;padding:40px 0;text-align:center;">
        <p class="empty-text">No projects</p>
        <p class="empty-hint">Run chinwag init in a project to get started.</p>
      </div>`;
    return;
  }

  allProjectsView.innerHTML = summaries.map(t => `
    <div class="project-card" data-team-id="${esc(t.team_id)}" role="button" tabindex="0"
         aria-label="${esc(t.team_name || t.team_id)}: ${t.active_agents} active agents">
      <div class="project-card-header">
        <span class="project-card-name">${esc(t.team_name || t.team_id)}</span>
        ${t.conflict_count ? `<span class="project-card-alert">${t.conflict_count} conflict${t.conflict_count > 1 ? 's' : ''}</span>` : ''}
      </div>
      <div class="project-card-stats">
        <div>
          <div class="project-card-stat-value">${t.active_agents}</div>
          <div class="project-card-stat-label">active</div>
        </div>
        <div>
          <div class="project-card-stat-value">${t.live_sessions}</div>
          <div class="project-card-stat-label">sessions</div>
        </div>
        <div>
          <div class="project-card-stat-value">${t.memory_count}</div>
          <div class="project-card-stat-label">memories</div>
        </div>
        <div>
          <div class="project-card-stat-value">${t.recent_sessions_24h}</div>
          <div class="project-card-stat-label">24h activity</div>
        </div>
      </div>
    </div>
  `).join('');

  // Click/keyboard to drill into a specific project
  allProjectsView.querySelectorAll('.project-card').forEach(card => {
    const handler = () => {
      const teamId = card.dataset.teamId;
      projectSelect.value = teamId;
      allProjectsMode = false;
      activeTeamId = teamId;
      showDetailView();
      fetchContext();
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
}

// ── Fetch & Render (single team) ──

async function fetchContext() {
  if (!activeTeamId) return;
  const teamId = activeTeamId;
  try {
    if (!joinedTeams.has(teamId)) {
      try { await api('POST', `/teams/${teamId}/join`, {}); joinedTeams.add(teamId); } catch {}
    }
    const ctx = await api('GET', `/teams/${teamId}/context`);
    if (activeTeamId !== teamId) return;
    const ctxJson = JSON.stringify(ctx);
    if (ctxJson === prevContextJson) return;
    prevContextJson = ctxJson;

    renderAgents(ctx.members || []);
    renderConflicts(ctx.members || []);
    renderLocks(ctx.locks || []);
    renderMessages(ctx.messages || []);
    renderMemory(ctx.memories || []);
    renderSessions(ctx.recentSessions || []);
    const active = (ctx.members || []).filter(m => m.status === 'active').length;
    statusText.textContent = active ? `${active} active` : 'No active agents';
    lastUpdate.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (consecutiveFailures > 0) { consecutiveFailures = 0; startPolling(); }
  } catch (err) {
    if (err.status === 401) { logout(); return; }
    consecutiveFailures++;
    if (consecutiveFailures >= 3) startPolling();
    statusText.textContent = err.message;
  }
}

function renderAgents(members) {
  if (members.length === 0) {
    agentsList.innerHTML = '<div class="empty-state"><p class="empty-text">No agents connected</p><p class="empty-hint">Open an AI tool in a chinwag project to see activity here.</p></div>';
    agentCount.textContent = '';
    return;
  }

  const active = members.filter(m => m.status === 'active');
  const offline = members.filter(m => m.status === 'offline');
  agentCount.textContent = active.length ? `${active.length} active` : '';

  agentsList.innerHTML = [...active, ...offline].map(m => {
    const cls = m.status === 'active' ? 'agent-indicator--active' : 'agent-indicator--offline';
    const toolLabel = m.tool && m.tool !== 'unknown' ? m.tool : m.framework || '';
    const files = m.activity?.files?.join(', ') || '';
    const dur = formatDuration(m.session_minutes);
    return `<div class="agent-row">
      <span class="agent-indicator ${cls}"></span>
      <span class="agent-name">${esc(m.handle)}</span>
      ${toolLabel ? `<span class="agent-framework">${esc(toolLabel)}</span>` : ''}
      <div class="agent-meta">
        ${files ? `<span class="agent-files" title="${esc(files)}">${esc(files)}</span>` : ''}
        ${dur ? `<span class="agent-time">${dur}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderConflicts(members) {
  const owners = new Map();
  for (const m of members) {
    if (m.status !== 'active' || !m.activity?.files) continue;
    const label = m.tool && m.tool !== 'unknown' ? `${m.handle} (${m.tool})` : m.handle;
    for (const f of m.activity.files) {
      if (!owners.has(f)) owners.set(f, []);
      owners.get(f).push(label);
    }
  }
  const conflicts = [...owners.entries()].filter(([, o]) => o.length > 1);

  if (!conflicts.length) { conflictsCard.hidden = true; return; }
  conflictsCard.hidden = false;
  conflictsList.innerHTML = conflicts.map(([file, who]) =>
    `<div class="conflict-row">
      <span class="conflict-file">${esc(file)}</span>
      <span class="conflict-owners">${who.map(esc).join(' & ')}</span>
    </div>`
  ).join('');
}

function renderMemory(memories) {
  if (!memories.length) {
    memoryList.innerHTML = '<div class="empty-state"><p class="empty-text">No shared knowledge</p><p class="empty-hint">Agents save project facts here as they work.</p></div>';
    return;
  }
  memoryList.innerHTML = memories.map(m =>
    `<div class="memory-row">
      <span class="memory-tag memory-tag--${MEMORY_CATEGORIES.has(m.category) ? m.category : 'reference'}">${esc(m.category)}</span>
      <span class="memory-text">${esc(m.text)}</span>
    </div>`
  ).join('');
}

function renderSessions(sessions) {
  if (!sessions.length) {
    sessionsList.innerHTML = '<div class="empty-state"><p class="empty-text">No recent sessions</p><p class="empty-hint">Session history appears after agents connect.</p></div>';
    return;
  }
  sessionsList.innerHTML = sessions.slice(0, 12).map(s => {
    const dur = formatDuration(s.duration_minutes);
    const live = !s.ended_at;
    const files = s.files_touched?.length || 0;
    return `<div class="session-row">
      <span class="session-handle">${esc(s.owner_handle)}</span>
      <span class="session-framework">${esc(s.framework)}</span>
      ${live ? '<span class="session-live">live</span>' : ''}
      <span class="session-stats">${dur} &middot; ${s.edit_count} edits &middot; ${files} files</span>
    </div>`;
  }).join('');
}

function renderLocks(locks) {
  const locksCard = $('#locks-card');
  const locksList = $('#locks-list');
  if (!locksCard || !locksList) return;
  if (!locks || !locks.length) { locksCard.hidden = true; return; }
  locksCard.hidden = false;
  locksList.innerHTML = locks.map(l => {
    const who = l.tool && l.tool !== 'unknown' ? `${esc(l.owner_handle)} (${esc(l.tool)})` : esc(l.owner_handle);
    const dur = l.minutes_held != null ? formatDuration(l.minutes_held) : '';
    return `<div class="lock-row">
      <span class="lock-file">${esc(l.file_path)}</span>
      <span class="lock-owner">${who}</span>
      ${dur ? `<span class="lock-time">${dur}</span>` : ''}
    </div>`;
  }).join('');
}

function renderMessages(messages) {
  const messagesCard = $('#messages-card');
  const messagesList = $('#messages-list');
  if (!messagesCard || !messagesList) return;
  if (!messages || !messages.length) { messagesCard.hidden = true; return; }
  messagesCard.hidden = false;
  messagesList.innerHTML = messages.map(m => {
    const from = m.from_tool && m.from_tool !== 'unknown' ? `${esc(m.from_handle)} (${esc(m.from_tool)})` : esc(m.from_handle);
    return `<div class="message-row">
      <span class="message-from">${from}</span>
      <span class="message-text">${esc(m.text)}</span>
    </div>`;
  }).join('');
}

// ── Helpers ──

function formatDuration(m) {
  if (m == null || typeof m !== 'number' || m <= 0) return '<1m';
  if (m >= 60) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${Math.round(m)}m`;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

boot();

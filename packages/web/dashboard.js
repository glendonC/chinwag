// chinwag dashboard
// Token: URL hash (#token=xxx) → localStorage → manual input.

const API_URL = 'https://chinwag-api.glendonchin.workers.dev';
const POLL_MS = 5000;
const TOKEN_KEY = 'chinwag_token';

let token = null;
let user = null;
let teams = [];
let activeTeamId = null;
let allProjectsMode = false;
let pollTimer = null;

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

async function api(method, path) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
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
    localStorage.setItem(TOKEN_KEY, token);
    return true;
  } catch {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    return false;
  }
}

function logout() {
  token = null;
  user = null;
  teams = [];
  activeTeamId = null;
  localStorage.removeItem(TOKEN_KEY);
  if (pollTimer) clearInterval(pollTimer);
  appScreen.hidden = true;
  connectScreen.hidden = false;
  connectError.hidden = true;
  tokenInput.value = '';
}

// ── Boot ──

async function boot() {
  const hashToken = readTokenFromHash();
  if (hashToken && await authenticate(hashToken)) return startApp();

  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored && await authenticate(stored)) return startApp();

  connectScreen.hidden = false;
}

// ── Connect UI ──

tokenSubmit.addEventListener('click', tryConnect);
tokenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryConnect(); });
logoutBtn.addEventListener('click', logout);

async function tryConnect() {
  const t = tokenInput.value.trim();
  if (!t) return;
  tokenSubmit.disabled = true;
  connectError.hidden = true;

  if (await authenticate(t)) {
    startApp();
  } else {
    connectError.textContent = 'Invalid token.';
    connectError.hidden = false;
  }
  tokenSubmit.disabled = false;
}

// ── App ──

async function startApp() {
  connectScreen.hidden = true;
  appScreen.hidden = false;
  userBadge.textContent = user.handle;
  await loadTeams();
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
  pollTimer = setInterval(() => {
    if (allProjectsMode) fetchDashboardSummary();
    else fetchContext();
  }, POLL_MS);
}

// ── All Projects ──

async function fetchDashboardSummary() {
  try {
    const data = await api('GET', '/me/dashboard');
    const summaries = data.teams || [];
    renderAllProjects(summaries);

    const totalActive = summaries.reduce((sum, t) => sum + t.active_agents, 0);
    const conflicts = summaries.reduce((sum, t) => sum + t.conflict_count, 0);
    let status = `${totalActive} active across ${summaries.length} project${summaries.length !== 1 ? 's' : ''}`;
    if (conflicts) status += ` · ${conflicts} conflict${conflicts !== 1 ? 's' : ''}`;
    statusText.textContent = status;
    lastUpdate.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
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
  try {
    const ctx = await api('GET', `/teams/${activeTeamId}/context`);
    renderAgents(ctx.members || []);
    renderConflicts(ctx.members || []);
    renderMemory(ctx.memories || []);
    renderSessions(ctx.recentSessions || []);
    const active = (ctx.members || []).filter(m => m.status === 'active').length;
    statusText.textContent = active ? `${active} active` : 'No active agents';
    lastUpdate.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    if (err.status === 401) { logout(); return; }
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
    const fw = m.framework || '';
    const files = m.activity?.files?.join(', ') || '';
    const dur = formatDuration(m.session_minutes);
    return `<div class="agent-row">
      <span class="agent-indicator ${cls}"></span>
      <span class="agent-name">${esc(m.handle)}</span>
      ${fw ? `<span class="agent-framework">${esc(fw)}</span>` : ''}
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
    for (const f of m.activity.files) {
      if (!owners.has(f)) owners.set(f, []);
      owners.get(f).push(m.handle);
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
      <span class="memory-tag memory-tag--${esc(m.category)}">${esc(m.category)}</span>
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

// ── Helpers ──

function formatDuration(m) {
  if (m == null) return '';
  if (m >= 60) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${Math.round(m)}m`;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

boot();

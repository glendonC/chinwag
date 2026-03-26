const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const API_BASE = 'https://chinwag-api.glendonchin.workers.dev';

let panel = null;
let pollInterval = null;

function activate(context) {
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(radio-tower) chinwag';
  statusItem.tooltip = 'Open chinwag dashboard';
  statusItem.command = 'chinwag.openDashboard';
  statusItem.show();
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('chinwag.openDashboard', async () => {
      if (panel) { panel.reveal(vscode.ViewColumn.Beside); return; }

      const token = readToken();
      if (!token) {
        vscode.window.showErrorMessage('chinwag: No config found. Run `npx chinwag init` first.');
        return;
      }
      const teamId = readTeamId();
      if (!teamId) {
        vscode.window.showErrorMessage('chinwag: No .chinwag file found in this workspace.');
        return;
      }

      panel = vscode.window.createWebviewPanel(
        'chinwagDashboard', 'chinwag', vscode.ViewColumn.Beside,
        { enableScripts: false, retainContextWhenHidden: true }
      );
      panel.webview.html = page('<p class="dim">Connecting...</p>');

      try { await apiPost(`/teams/${teamId}/join`, {}, token); } catch {}
      await refresh(token, teamId);
      pollInterval = setInterval(() => refresh(token, teamId), 5000);

      panel.onDidDispose(() => {
        panel = null;
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
      });
    })
  );
}

async function refresh(token, teamId) {
  if (!panel) return;
  try {
    const ctx = await apiGet(`/teams/${teamId}/context`, token);
    if (ctx.error) { panel.webview.html = page(`<p class="err">${esc(ctx.error)}</p>`); return; }
    panel.webview.html = page(renderCtx(ctx));
  } catch (e) {
    panel.webview.html = page(`<p class="err">${esc(e.message)}</p>`);
  }
}

// --- Config ---

function readToken() {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.chinwag', 'config.json'), 'utf-8')).token || null;
  } catch { return null; }
}

function readTeamId() {
  for (const f of vscode.workspace.workspaceFolders || []) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(f.uri.fsPath, '.chinwag'), 'utf-8'));
      if (d.team) return d.team;
    } catch {}
  }
  return null;
}

// --- API ---

function apiGet(endpoint, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(`${API_BASE}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad response')); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function apiPost(endpoint, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

// --- Render ---

function renderCtx(ctx) {
  const agents = (ctx.members || []).filter(m => m.status === 'active' && m.tool && m.tool !== 'unknown');
  const memories = ctx.memories || [];
  const conflicts = ctx.conflicts || [];
  const locks = ctx.locks || [];
  const messages = ctx.messages || [];
  const sessions = (ctx.recentSessions || []).filter(s => s.edit_count > 0 || (s.files_touched?.length > 0));
  const dur = m => m == null ? '' : m >= 60 ? `${Math.floor(m/60)}h ${Math.round(m%60)}m` : `${Math.round(m)}m`;

  let h = '';

  // Agents
  h += `<h2>Agents <span class="cnt">${agents.length} running</span></h2>`;
  if (!agents.length) {
    h += `<p class="empty">No agents running. Start an AI tool to see it here.</p>`;
  }
  for (const a of agents) {
    h += `<div class="agent"><span class="dot"></span><span class="tool">${esc(a.tool)}</span>`;
    if (a.handle) h += ` <span class="dim">${esc(a.handle)}</span>`;
    const d = dur(a.session_minutes);
    if (d) h += ` <span class="dim">${d}</span>`;
    h += `</div>`;
    if (a.activity?.files?.length) h += `<div class="sub">${a.activity.files.map(f => esc(f)).join(', ')}</div>`;
    if (a.activity?.summary && !/^editing\s/i.test(a.activity.summary)) h += `<div class="sub">"${esc(a.activity.summary)}"</div>`;
  }

  // Conflicts
  if (conflicts.length) {
    h += `<h2>Conflicts</h2>`;
    for (const c of conflicts) h += `<div class="err">! ${esc(c.file)} — ${c.agents.map(esc).join(' & ')}</div>`;
  }

  // Locks
  if (locks.length) {
    h += `<h2>Locked Files</h2>`;
    for (const l of locks) h += `<div class="dim">${esc(l.file_path)} — ${esc(l.owner_handle)} (${Math.round(l.minutes_held)}m)</div>`;
  }

  // Messages
  if (messages.length) {
    h += `<h2>Messages</h2>`;
    for (const m of messages) h += `<div><strong>${esc(m.from_handle)}</strong>: ${esc(m.text)}</div>`;
  }

  // Memory
  h += `<h2>Memory <span class="cnt">${memories.length} saved</span></h2>`;
  if (!memories.length) {
    h += `<p class="empty">No memories yet. Agents save project knowledge here.</p>`;
  }
  for (const m of memories) h += `<div class="mem"><span class="cat">[${esc(m.category)}]</span> ${esc(m.text)}</div>`;

  // Sessions
  if (sessions.length) {
    h += `<h2>Recent Sessions</h2>`;
    for (const s of sessions) {
      h += `<div>${esc(s.tool || 'Agent')} <span class="dim">${esc(s.owner_handle)} · ${dur(s.duration_minutes)} · ${s.edit_count} edits · ${s.files_touched?.length || 0} files</span></div>`;
    }
  }

  h += `<p class="foot">Auto-refreshes every 5s</p>`;
  return h;
}

function page(body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:var(--vscode-font-family,-apple-system,sans-serif);font-size:var(--vscode-font-size,13px);color:var(--vscode-foreground,#ccc);background:var(--vscode-editor-background,#1e1e1e);padding:16px 20px;margin:0;line-height:1.6}
h2{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;opacity:.55;margin:28px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--vscode-widget-border,#333)}
h2:first-child{margin-top:0}
.cnt{font-weight:400}
.agent{margin:10px 0 2px}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--vscode-testing-iconPassed,#4caf50);margin-right:6px;vertical-align:middle}
.tool{font-weight:600}
.dim{opacity:.5}
.sub{margin-left:20px;font-size:12px;opacity:.6;margin-top:1px}
.mem{margin:6px 0}
.cat{color:var(--vscode-terminal-ansiYellow,#e5c07b);font-weight:600;margin-right:4px}
.err{color:var(--vscode-errorForeground,#e06c75)}
.empty{opacity:.35;font-style:italic}
.foot{opacity:.25;font-size:11px;margin-top:32px}
</style></head><body>${body}</body></html>`;
}

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

function deactivate() {
  if (panel) panel.dispose();
  if (pollInterval) clearInterval(pollInterval);
}

module.exports = { activate, deactivate };

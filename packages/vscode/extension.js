import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import { join, basename, isAbsolute } from 'path';
import { homedir } from 'os';
import https from 'https';
import {
  buildDashboardView,
  formatDuration,
  smartSummary,
  shortAgentId,
  MEMORY_CATEGORIES,
} from '../cli/lib/dashboard-view.js';

const API_BASE = 'https://chinwag-api.glendonchin.workers.dev';

let panel = null;
let pollInterval = null;
let extensionDir = null;

// ─── Activation ──────────────────────────────────────────────

export function activate(context) {
  extensionDir = context.extensionPath;

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
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.iconPath = vscode.Uri.file(join(extensionDir, 'logo-mark.svg'));
      panel.webview.html = buildPage();

      // Handle interactive commands from webview
      panel.webview.onDidReceiveMessage(async (msg) => {
        if (!panel) return;
        try {
          switch (msg.type) {
            case 'openFile': {
              const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
              if (!root) break;
              const abs = isAbsolute(msg.path) ? msg.path : join(root, msg.path);
              try {
                const doc = await vscode.workspace.openTextDocument(abs);
                await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
              } catch {
                panel.webview.postMessage({ type: 'flash', text: 'File not found: ' + msg.path });
              }
              break;
            }
            case 'deleteMemory': {
              const res = await apiDelete('/teams/' + teamId + '/memory', { id: msg.id }, token);
              panel.webview.postMessage({ type: 'flash', text: res.error || 'Memory deleted' });
              if (!res.error) await refresh(token, teamId);
              break;
            }
            case 'releaseLock': {
              const res = await apiDelete('/teams/' + teamId + '/locks', { files: [msg.file] }, token);
              panel.webview.postMessage({ type: 'flash', text: res.error || 'Lock released' });
              if (!res.error) await refresh(token, teamId);
              break;
            }
            case 'copyText': {
              await vscode.env.clipboard.writeText(msg.text);
              panel.webview.postMessage({ type: 'flash', text: 'Copied to clipboard' });
              break;
            }
          }
        } catch (e) {
          if (panel) panel.webview.postMessage({ type: 'flash', text: e.message });
        }
      });

      try { await apiPost('/teams/' + teamId + '/join', {}, token); } catch {}
      await refresh(token, teamId);
      pollInterval = setInterval(function () { refresh(token, teamId); }, 5000);

      panel.onDidDispose(function () {
        panel = null;
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
      });
    })
  );
}

// ─── Data processing (shared with TUI) ──────────────────────

async function refresh(token, teamId) {
  if (!panel) return;
  try {
    const ctx = await apiGet('/teams/' + teamId + '/context', token);
    if (!panel) return;
    if (ctx.error) {
      panel.webview.postMessage({ type: 'error', message: ctx.error });
      return;
    }

    // Process through shared data logic — same function the TUI uses
    const vm = buildDashboardView({ context: ctx, detectedTools: [], memoryFilter: null, cols: 100 });

    // Serialize to a view model the webview can render directly
    panel.webview.postMessage({
      type: 'update',
      data: {
        agents: vm.visibleAgents.map(a => ({
          toolName: vm.getToolName(a.tool) || a.tool || 'Unknown',
          handle: a.handle,
          duration: formatDuration(a.session_minutes),
          files: (a.activity?.files || []).map(f => ({ path: f, name: basename(f) })),
          summary: smartSummary(a.activity),
          shortId: shortAgentId(a.agent_id),
          showShortId: vm.toolCounts.get(a.tool) > 1,
        })),
        agentOverflow: vm.agentOverflow,
        conflicts: vm.conflicts.map(([file, owners]) => ({ file, agents: owners })),
        locks: (ctx.locks || []).map(l => ({
          file_path: l.file_path,
          name: basename(l.file_path),
          owner_handle: l.owner_handle,
          minutes_held: Math.round(l.minutes_held),
        })),
        memories: vm.memories.map(m => ({
          id: m.id,
          category: m.category,
          text: m.text,
          source_handle: m.source_handle,
        })),
        messages: vm.messages.slice(0, 5).map(m => ({
          from: m.from_tool && m.from_tool !== 'unknown'
            ? m.from_handle + ' (' + m.from_tool + ')'
            : m.from_handle,
          text: m.text,
        })),
        messageOverflow: Math.max(0, vm.messages.length - 5),
        sessions: vm.showRecent ? vm.recentSessions.slice(0, 5).map(s => ({
          toolName: vm.getToolName(s.tool) || s.tool || 'Agent',
          owner_handle: s.owner_handle,
          duration: formatDuration(s.duration_minutes),
          edit_count: s.edit_count,
          file_count: s.files_touched?.length || 0,
        })) : [],
        usage: vm.usage,
        toolsConfigured: vm.toolsConfigured,
        isTeam: vm.isTeam,
      },
    });
  } catch (e) {
    if (panel) panel.webview.postMessage({ type: 'error', message: e.message });
  }
}

// ─── Config ──────────────────────────────────────────────────

function readToken() {
  try {
    return JSON.parse(readFileSync(join(homedir(), '.chinwag', 'config.json'), 'utf-8')).token || null;
  } catch { return null; }
}

function readTeamId() {
  for (const f of vscode.workspace.workspaceFolders || []) {
    try {
      const d = JSON.parse(readFileSync(join(f.uri.fsPath, '.chinwag'), 'utf-8'));
      if (d.team) return d.team;
    } catch {}
  }
  return null;
}

// ─── API ─────────────────────────────────────────────────────

function apiGet(endpoint, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(API_BASE + endpoint, {
      headers: { 'Authorization': 'Bearer ' + token }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('API error (' + res.statusCode + ')')); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function apiRequest(method, endpoint, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(API_BASE + endpoint, {
      method: method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
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

function apiPost(endpoint, body, token) { return apiRequest('POST', endpoint, body, token); }
function apiDelete(endpoint, body, token) { return apiRequest('DELETE', endpoint, body, token); }

// ─── Webview Script (runs inside the webview, not in extension host) ─────

function webviewMain() {
  var vsc = acquireVsCodeApi();

  var state = null;
  var collapsed = {};
  var confirmDeleteId = null;
  var confirmTimer = null;
  var memSearch = '';
  var memFilter = '';

  function esc(s) {
    return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
  }
  function escA(s) {
    return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
  }
  function showFlash(text) {
    var el = document.getElementById('flash');
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(function () { el.style.display = 'none'; }, 2500);
  }

  // ── Messages from extension host ──

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'update') {
      state = msg.data;
      render();
    } else if (msg.type === 'error') {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'none';
      var err = document.getElementById('error-display');
      err.style.display = 'block';
      err.innerHTML = '<p class="err-text">' + esc(msg.message) + '</p>';
    } else if (msg.type === 'flash') {
      showFlash(msg.text);
    }
  });

  // ── Event delegation ──

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    if (action === 'toggle') {
      var el = document.getElementById(btn.dataset.section + '-section');
      if (el) {
        el.classList.toggle('collapsed');
        collapsed[btn.dataset.section] = el.classList.contains('collapsed');
      }
    } else if (action === 'open-file') {
      vsc.postMessage({ type: 'openFile', path: btn.dataset.path });
    } else if (action === 'delete-memory') {
      var id = btn.dataset.id;
      if (confirmDeleteId === id) {
        vsc.postMessage({ type: 'deleteMemory', id: id });
        confirmDeleteId = null;
        if (confirmTimer) clearTimeout(confirmTimer);
      } else {
        confirmDeleteId = id;
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(function () { confirmDeleteId = null; renderMemory(); }, 3000);
        renderMemory();
      }
    } else if (action === 'copy-memory') {
      var mem = (state && state.memories || []).find(function (m) { return m.id === btn.dataset.id; });
      if (mem) vsc.postMessage({ type: 'copyText', text: mem.text });
    } else if (action === 'release-lock') {
      vsc.postMessage({ type: 'releaseLock', file: btn.dataset.file });
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'mem-search') {
      memSearch = e.target.value;
      renderMemory();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'mem-filter') {
      memFilter = e.target.value;
      renderMemory();
    }
  });

  // ── Render (thin layer — all data pre-processed by extension host) ──

  function render() {
    if (!state) return;

    document.getElementById('loading').style.display = 'none';
    document.getElementById('error-display').style.display = 'none';
    document.getElementById('content').style.display = 'block';

    // Agents
    var agents = state.agents || [];
    document.getElementById('agents-count').textContent = agents.length + ' running';
    document.getElementById('agents-body').innerHTML = agents.length
      ? agents.map(renderAgent).join('')
        + (state.agentOverflow > 0 ? '<p class="empty">+ ' + state.agentOverflow + ' more</p>' : '')
      : '<p class="empty">No agents running — start an AI tool to see it here.</p>';

    // Conflicts
    var conflicts = state.conflicts || [];
    var cs = document.getElementById('conflicts-section');
    if (conflicts.length) {
      cs.style.display = 'block';
      document.getElementById('conflicts-body').innerHTML = conflicts.map(function (c) {
        return '<div class="conflict-row">' +
          '<svg class="conflict-icon" width="14" height="14" viewBox="0 0 16 16"><path d="M8 1L1 14h14L8 1z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 6v4M8 11.5v.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> ' +
          '<span class="file-link" data-action="open-file" data-path="' + escA(c.file) + '">' + esc(c.file) + '</span>' +
          ' <span class="dim">' + c.agents.map(esc).join(' & ') + '</span></div>';
      }).join('');
    } else { cs.style.display = 'none'; }

    // Locks
    var locks = state.locks || [];
    var ls = document.getElementById('locks-section');
    if (locks.length) {
      ls.style.display = 'block';
      document.getElementById('locks-body').innerHTML = locks.map(function (l) {
        return '<div class="lock-row">' +
          '<span class="file-link" data-action="open-file" data-path="' + escA(l.file_path) + '">' + esc(l.name) + '</span>' +
          '<span class="dim">' + esc(l.owner_handle) + ' · ' + l.minutes_held + 'm</span>' +
          '<button class="ghost-btn" data-action="release-lock" data-file="' + escA(l.file_path) + '">Release</button>' +
          '</div>';
      }).join('');
    } else { ls.style.display = 'none'; }

    // Messages (passive — matches TUI behavior)
    var messages = state.messages || [];
    var ms = document.getElementById('messages-section');
    if (messages.length) {
      ms.style.display = 'block';
      document.getElementById('messages-count').textContent = messages.length + (state.messageOverflow > 0 ? '+' : '');
      document.getElementById('messages-body').innerHTML = messages.map(function (m) {
        return '<div class="msg-row"><strong>' + esc(m.from) + '</strong> ' + esc(m.text) + '</div>';
      }).join('') + (state.messageOverflow > 0 ? '<p class="empty">+ ' + state.messageOverflow + ' more</p>' : '');
    } else { ms.style.display = 'none'; }

    // Memory
    renderMemory();

    // Sessions (shown when no agents running, matches TUI)
    var sessions = state.sessions || [];
    var ss = document.getElementById('sessions-section');
    if (sessions.length) {
      ss.style.display = 'block';
      document.getElementById('sessions-body').innerHTML = sessions.map(function (s) {
        return '<div class="session-row">' + esc(s.toolName) +
          ' <span class="dim">' + esc(s.owner_handle) + ' · ' + (s.duration || '0m') +
          ' · ' + s.edit_count + ' edits · ' + s.file_count + ' files</span></div>';
      }).join('');
    } else { ss.style.display = 'none'; }

    // Restore collapsed states
    Object.keys(collapsed).forEach(function (key) {
      var el = document.getElementById(key + '-section');
      if (el) {
        if (collapsed[key]) el.classList.add('collapsed');
        else el.classList.remove('collapsed');
      }
    });
  }

  function renderAgent(a) {
    // All data pre-processed: toolName, duration, summary, files with names
    var h = '<div class="agent-row"><span class="dot"></span>';
    h += '<span class="tool-name">' + esc(a.toolName) + '</span>';
    if (a.showShortId && a.shortId) h += ' <span class="dim">#' + esc(a.shortId) + '</span>';
    if (state.isTeam && a.handle) h += ' <span class="dim">' + esc(a.handle) + '</span>';
    if (a.duration) h += ' <span class="dim">' + esc(a.duration) + '</span>';
    h += '</div>';
    if (a.files.length) {
      h += '<div class="agent-files">' + a.files.map(function (f) {
        return '<span class="file-link" data-action="open-file" data-path="' + escA(f.path) + '">' + esc(f.name) + '</span>';
      }).join(', ') + '</div>';
    }
    if (a.summary) {
      h += '<div class="agent-summary">"' + esc(a.summary) + '"</div>';
    }
    return h;
  }

  function renderMemory() {
    var memories = state ? (state.memories || []) : [];
    // Local filtering for responsive search UX
    var filtered = memories.filter(function (m) {
      if (memFilter && m.category !== memFilter) return false;
      if (memSearch && m.text.toLowerCase().indexOf(memSearch.toLowerCase()) === -1) return false;
      return true;
    });

    document.getElementById('memory-count').textContent = memories.length + ' saved';

    if (!filtered.length) {
      document.getElementById('memory-body').innerHTML = memories.length
        ? '<p class="empty">No matches.</p>'
        : '<p class="empty">No memories yet — agents save project knowledge here.</p>';
      return;
    }

    document.getElementById('memory-body').innerHTML = filtered.map(function (m) {
      var isConfirm = confirmDeleteId === m.id;
      return '<div class="mem-row">' +
        '<span class="mem-tag tag-' + esc(m.category) + '">' + esc(m.category) + '</span>' +
        '<span class="mem-text">' + esc(m.text) + '</span>' +
        '<span class="mem-author dim">' + esc(m.source_handle) + '</span>' +
        '<span class="mem-actions">' +
        '<button class="icon-btn" data-action="copy-memory" data-id="' + escA(m.id) + '" title="Copy">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 11V3a1 1 0 011-1h8" stroke="currentColor" stroke-width="1.2"/></svg>' +
        '</button>' +
        '<button class="icon-btn' + (isConfirm ? ' confirm-delete' : '') + '" data-action="delete-memory" data-id="' + escA(m.id) + '" title="' + (isConfirm ? 'Click again to confirm' : 'Delete') + '">' +
        (isConfirm
          ? '<span class="confirm-text">Delete?</span>'
          : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5M4 4l.8 9a1 1 0 001 .9h4.4a1 1 0 001-.9L12 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        ) +
        '</button>' +
        '</span></div>';
    }).join('');
  }
}

// ─── CSS ─────────────────────────────────────────────────────

const PAGE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  font-weight: 300;
  color: var(--vscode-foreground, #ccc);
  background: var(--vscode-editor-background, #1e1e1e);
  padding: 16px 24px 32px;
  line-height: 1.7;
}

/* ── Sections ── */

.section { margin-bottom: 28px; }

.section-header {
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1px;
  opacity: 0.45;
  padding-bottom: 8px;
  position: relative;
  user-select: none;
}

.section-header[data-action] { cursor: pointer; }

.section-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, #d49aae, #a896d4, #8ec0a4);
  opacity: 0.3;
}

.section.collapsed .section-body,
.section.collapsed .section-controls { display: none; }

.chevron {
  display: inline-block;
  font-size: 8px;
  margin-right: 4px;
  transition: transform 0.15s ease;
}

.section:not(.collapsed) .chevron { transform: rotate(90deg); }

.count { font-weight: 300; }
.section-body { padding-top: 12px; }
.section-controls { padding-top: 10px; }

/* ── Agents ── */

.agent-row { margin: 8px 0 2px; }

.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--vscode-testing-iconPassed, #4caf50);
  margin-right: 6px;
  vertical-align: middle;
}

.tool-name { font-weight: 500; }
.dim { opacity: 0.45; }

.agent-files {
  margin-left: 20px;
  font-size: 12px;
  opacity: 0.6;
  margin-top: 2px;
}

.agent-summary {
  margin-left: 20px;
  font-size: 12px;
  opacity: 0.45;
  font-style: italic;
  margin-top: 1px;
}

.file-link {
  cursor: pointer;
  color: var(--vscode-textLink-foreground, #61afef);
  text-decoration: none;
}

.file-link:hover { text-decoration: underline; }

/* ── Conflicts ── */

.err-text { color: var(--vscode-errorForeground, #e06c75); }

.conflict-row {
  color: var(--vscode-errorForeground, #e06c75);
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
}

.conflict-icon { flex-shrink: 0; }

/* ── Locks ── */

.lock-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0;
}

/* ── Messages ── */

.msg-row { margin: 8px 0; }
.msg-row strong { font-weight: 500; }

/* ── Memory ── */

.mem-controls {
  display: flex;
  gap: 8px;
}

.mem-controls input,
.mem-controls select {
  background: var(--vscode-input-background, #2d2d2d);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.mem-controls input { flex: 1; }

.mem-controls input:focus,
.mem-controls select:focus {
  border-color: var(--vscode-focusBorder, #007fd4);
}

.mem-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 6px 0;
  padding: 6px 0;
}

.mem-tag {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-top: 3px;
}

.tag-gotcha    { color: #e5c07b; background: rgba(229,192,123,0.1); }
.tag-pattern   { color: #c678dd; background: rgba(198,120,221,0.1); }
.tag-config    { color: #61afef; background: rgba(97,175,239,0.1); }
.tag-decision  { color: #8ec0a4; background: rgba(142,192,164,0.1); }
.tag-reference { color: #abb2bf; background: rgba(171,178,191,0.1); }

.mem-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
}

.mem-author {
  font-size: 11px;
  white-space: nowrap;
  margin-top: 3px;
}

.mem-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.mem-row:hover .mem-actions { opacity: 1; }

.icon-btn {
  background: none;
  border: none;
  color: var(--vscode-foreground, #ccc);
  opacity: 0.4;
  cursor: pointer;
  padding: 4px;
  border-radius: 3px;
  display: flex;
  align-items: center;
}

.icon-btn:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
}

.confirm-delete {
  opacity: 1 !important;
  color: var(--vscode-errorForeground, #e06c75) !important;
}

.confirm-text { font-size: 11px; font-weight: 500; }

/* ── Ghost button ── */

.ghost-btn {
  background: none;
  border: 1px solid var(--vscode-input-border, #444);
  color: var(--vscode-foreground, #ccc);
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  opacity: 0.5;
  transition: opacity 0.15s;
}

.ghost-btn:hover {
  opacity: 1;
  border-color: var(--vscode-focusBorder, #007fd4);
}

/* ── Sessions ── */

.session-row {
  margin: 6px 0;
  font-weight: 400;
}

/* ── States ── */

.empty {
  opacity: 0.3;
  font-style: italic;
  font-size: 12px;
  padding: 4px 0;
}

#error-display { padding: 20px 0; }

/* ── Flash ── */

#flash {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding: 8px 20px;
  background: linear-gradient(90deg, rgba(212,154,174,0.12), rgba(168,150,212,0.12), rgba(142,192,164,0.12));
  font-size: 12px;
  text-align: center;
  display: none;
  z-index: 100;
  animation: flashIn 0.2s ease;
}

@keyframes flashIn {
  from { opacity: 0; transform: translateY(-100%); }
  to { opacity: 1; transform: translateY(0); }
}
`;

// ─── HTML ────────────────────────────────────────────────────

const PAGE_HTML = `
<div id="flash"></div>

<div id="loading">
  <p class="empty">Connecting...</p>
</div>

<div id="error-display" style="display:none"></div>

<div id="content" style="display:none">

  <div class="section" id="agents-section">
    <div class="section-header" data-action="toggle" data-section="agents">
      <span class="chevron">&#9656;</span>
      AGENTS <span class="count" id="agents-count"></span>
    </div>
    <div class="section-body" id="agents-body"></div>
  </div>

  <div class="section" id="conflicts-section" style="display:none">
    <div class="section-header err-text">CONFLICTS</div>
    <div class="section-body" id="conflicts-body"></div>
  </div>

  <div class="section" id="locks-section" style="display:none">
    <div class="section-header">LOCKED FILES</div>
    <div class="section-body" id="locks-body"></div>
  </div>

  <div class="section" id="messages-section" style="display:none">
    <div class="section-header">
      MESSAGES <span class="count" id="messages-count"></span>
    </div>
    <div class="section-body" id="messages-body"></div>
  </div>

  <div class="section" id="memory-section">
    <div class="section-header" data-action="toggle" data-section="memory">
      <span class="chevron">&#9656;</span>
      MEMORY <span class="count" id="memory-count"></span>
    </div>
    <div class="section-controls">
      <div class="mem-controls">
        <input id="mem-search" type="text" placeholder="Search memories..." spellcheck="false">
        <select id="mem-filter">
          <option value="">All</option>
          {{CATEGORY_OPTIONS}}
        </select>
      </div>
    </div>
    <div class="section-body" id="memory-body"></div>
  </div>

  <div class="section" id="sessions-section" style="display:none">
    <div class="section-header" data-action="toggle" data-section="sessions">
      <span class="chevron">&#9656;</span>
      RECENT SESSIONS
    </div>
    <div class="section-body" id="sessions-body"></div>
  </div>

</div>
`;

function buildPage() {
  // Generate category options from shared constant
  const catOptions = MEMORY_CATEGORIES
    .filter(c => c !== null)
    .map(c => '<option value="' + c + '">' + c + '</option>')
    .join('\n          ');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'
    + PAGE_CSS + '</style></head><body>'
    + PAGE_HTML.replace('{{CATEGORY_OPTIONS}}', catOptions)
    + '<script>(' + webviewMain.toString() + ')()</script>'
    + '</body></html>';
}

// ─── Deactivate ──────────────────────────────────────────────

export function deactivate() {
  if (panel) panel.dispose();
  if (pollInterval) clearInterval(pollInterval);
}

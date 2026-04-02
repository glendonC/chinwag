import { useState, useEffect, useRef, useCallback } from 'react';
import { api, getApiUrl } from '../api.js';
import { detectTools } from '../mcp-config.js';
import { getProjectContext } from '../project.js';
import { SPINNER } from './utils.js';
import { applyDelta } from '../../../shared/dashboard-ws.js';

function classifyError(err) {
  const msg = err.message || '';
  const status = err.status;
  if (status === 401) return { state: 'offline', detail: 'Session expired. Re-run chinwag init.', fatal: true };
  if (status === 403) return { state: 'offline', detail: 'Access denied. You may have been removed from this team.' };
  if (status === 404) return { state: 'offline', detail: 'Team not found. The .chinwag file may be stale.' };
  if (status === 429) return { state: 'reconnecting', detail: 'Rate limited. Retrying shortly.' };
  if (status >= 500) return { state: 'reconnecting', detail: 'Server error. Retrying...' };
  if (status === 408 || msg.includes('timed out')) return { state: 'reconnecting', detail: 'Request timed out. Retrying...' };
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].some(c => msg.includes(c))) {
    return { state: 'offline', detail: 'Cannot reach server. Check your connection.' };
  }
  return { state: 'reconnecting', detail: msg || 'Connection issue. Retrying...' };
}

// Minimal fingerprint of context for change detection (avoids JSON.stringify on every poll)
function contextFingerprint(ctx) {
  if (!ctx) return '';
  const members = (ctx.members || []).map(m =>
    `${m.agent_id}:${m.status}:${m.activity?.summary || ''}:${(m.activity?.files || []).length}`
  ).join('|');
  const memCount = (ctx.memories || []).length;
  const msgCount = (ctx.messages || []).length;
  const lockCount = (ctx.locks || []).length;
  return `${members};${memCount};${msgCount};${lockCount}`;
}

export function useDashboardConnection({ config, stdout }) {
  // Project state
  const [teamId, setTeamId] = useState(null);
  const [teamName, setTeamName] = useState(null);
  const [projectRoot, setProjectRoot] = useState(process.cwd());
  const [detectedTools, setDetectedTools] = useState([]);

  // Connection state
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [connState, setConnState] = useState('connecting');
  const [connDetail, setConnDetail] = useState(null);
  const consecutiveFailures = useRef(0);
  const unchangedPolls = useRef(0);
  const lastFingerprint = useRef('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Terminal
  const [cols, setCols] = useState(stdout?.columns || 80);

  // ── Spinner ──────────────────────────────────────────
  useEffect(() => {
    if (connState === 'connected' || connState === 'offline') return;
    const t = setInterval(() => setSpinnerFrame(f => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(t);
  }, [connState]);

  // ── Terminal resize ──────────────────────────────────
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns);
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  // ── .chinwag file discovery ──────────────────────────
  useEffect(() => {
    const project = getProjectContext(process.cwd());
    if (!project) {
      setError('No .chinwag file found. Run `npx chinwag init` first.');
      return;
    }
    if (project.error) {
      setError(project.error);
      return;
    }

    setTeamId(project.teamId);
    setTeamName(project.teamName);
    setProjectRoot(project.root);

    try {
      setDetectedTools(detectTools(project.root));
    } catch {}
  }, []);

  // ── WebSocket connection with polling fallback ───
  const wsRef = useRef(null);

  useEffect(() => {
    if (!teamId) return;
    const dashboardAgentId = `dashboard:${(config?.token || '').slice(0, 8)}`;
    const client = api(config, { agentId: dashboardAgentId });
    const joined = { current: false };
    let pollInterval = null;
    let reconcileInterval = null;
    let destroyed = false;

    async function fetchContextOnce() {
      if (!joined.current) {
        try {
          await client.post(`/teams/${teamId}/join`, { name: teamName });
        } catch (joinErr) {
          if (joinErr.status !== 429) throw joinErr;
        }
        joined.current = true;
      }
      const ctx = await client.get(`/teams/${teamId}/context`);
      setContext(ctx);
      consecutiveFailures.current = 0;
      setConnState('connected');
      setConnDetail(null);

      // Track whether context changed for idle backoff
      const fp = contextFingerprint(ctx);
      if (fp === lastFingerprint.current) {
        unchangedPolls.current++;
      } else {
        unchangedPolls.current = 0;
        lastFingerprint.current = fp;
      }
    }

    function handleFetchError(err) {
      if (err.message?.includes('Not a member')) joined.current = false;
      consecutiveFailures.current++;
      const classified = classifyError(err);
      if (consecutiveFailures.current >= 6 && classified.state === 'reconnecting') {
        setConnState('offline');
        setConnDetail(classified.detail.replace('Retrying...', 'Press [r] to retry.').replace('Retrying shortly.', 'Press [r] to retry.'));
      } else {
        setConnState(classified.state);
        setConnDetail(classified.detail);
      }
    }

    // ── Polling fallback ──────────────────────────
    function getPollInterval() {
      if (consecutiveFailures.current >= 6) return 30_000;
      if (consecutiveFailures.current >= 3) return 15_000;
      // Progressive backoff when context is unchanged (idle team)
      const idle = unchangedPolls.current;
      if (idle >= 60) return 60_000;   // 5+ min idle → poll every 60s
      if (idle >= 12) return 30_000;   // 1+ min idle → poll every 30s
      if (idle >= 6) return 15_000;    // 30s idle → poll every 15s
      return 5_000;
    }

    function startPolling() {
      if (destroyed || pollInterval) return;
      function schedulePoll() {
        pollInterval = setTimeout(async () => {
          if (destroyed) return;
          try { await fetchContextOnce(); }
          catch (err) { handleFetchError(err); }
          if (!destroyed) schedulePoll();
        }, getPollInterval());
      }
      schedulePoll();
    }

    function stopPolling() {
      if (pollInterval) { clearTimeout(pollInterval); pollInterval = null; }
    }

    // ── WebSocket connection ──────────────────────
    async function connect() {
      // Join team + fetch initial context via HTTP
      try { await fetchContextOnce(); }
      catch (err) { handleFetchError(err); startPolling(); return; }

      // Fetch short-lived ticket — keeps real token out of WS URL
      let wsTicket;
      try {
        const ticketData = await client.post('/auth/ws-ticket');
        wsTicket = ticketData.ticket;
      } catch {
        startPolling();
        return;
      }

      const wsBase = getApiUrl().replace(/^http/, 'ws');
      const wsUrl = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(dashboardAgentId)}&ticket=${encodeURIComponent(wsTicket)}`;

      try {
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (destroyed) { ws.close(); return; }
          stopPolling();
          setConnState('connected');
          setConnDetail(null);
          // Full reconciliation every 60s to correct drift
          if (reconcileInterval) clearInterval(reconcileInterval);
          reconcileInterval = setInterval(async () => {
            try { await fetchContextOnce(); } catch { /* non-critical */ }
          }, 60_000);
        };

        ws.onmessage = (evt) => {
          if (destroyed) return;
          try {
            const event = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
            if (event.type === 'context') {
              setContext(event.data);
            } else {
              setContext(prev => prev ? applyDelta(prev, event) : prev);
            }
          } catch { /* malformed event */ }
        };

        ws.onclose = () => {
          if (destroyed) return;
          wsRef.current = null;
          if (reconcileInterval) { clearInterval(reconcileInterval); reconcileInterval = null; }
          startPolling();
        };

        ws.onerror = () => { /* onclose fires after onerror */ };

        wsRef.current = ws;
      } catch {
        startPolling();
      }
    }

    connect();

    return () => {
      destroyed = true;
      stopPolling();
      if (reconcileInterval) clearInterval(reconcileInterval);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [teamId, teamName, refreshKey, config?.token]);

  function retry() {
    setError(null);
    setConnState('connecting');
    consecutiveFailures.current = 0;
    unchangedPolls.current = 0;
    lastFingerprint.current = '';
    setRefreshKey(k => k + 1);
  }

  function bumpRefreshKey() {
    setRefreshKey(k => k + 1);
  }

  return {
    teamId,
    teamName,
    projectRoot,
    detectedTools,
    context,
    error,
    connState,
    connDetail,
    spinnerFrame,
    cols,
    consecutiveFailures,
    retry,
    bumpRefreshKey,
    setError,
    setConnState,
  };
}

import { useState, useEffect, useRef } from 'react';
import { applyDelta } from '@chinwag/shared/dashboard-ws.js';
import { api, getApiUrl } from '../api.js';
import { detectTools } from '../mcp-config.js';
import { getProjectContext } from '../project.js';
import { SPINNER } from './utils.js';
import { classifyError } from '../utils/errors.js';

// ── Constants ───────────────────────────────────────
const SPINNER_INTERVAL_MS = 80;
const OFFLINE_THRESHOLD = 6; // consecutive failures before going offline
const POLL_FAST_MS = 5_000;
const POLL_MEDIUM_MS = 15_000;
const POLL_SLOW_MS = 30_000;
const POLL_IDLE_MS = 60_000;
const BACKOFF_MAX_MS = 60_000;
const IDLE_TIER_1 = 6; // 30s idle -> medium poll
const IDLE_TIER_2 = 12; // 1min idle -> slow poll
const IDLE_TIER_3 = 60; // 5min idle -> idle poll
const RECONCILE_INTERVAL_MS = 60_000;
const WS_CONNECT_TIMEOUT_MS = 10_000;

// Minimal fingerprint of context for change detection (avoids JSON.stringify on every poll)
function contextFingerprint(ctx) {
  if (!ctx) return '';
  const members = (ctx.members || [])
    .map(
      (m) =>
        `${m.agent_id}:${m.status}:${m.activity?.summary || ''}:${(m.activity?.files || []).length}`,
    )
    .join('|');
  const memCount = (ctx.memories || []).length;
  const msgCount = (ctx.messages || []).length;
  const lockCount = (ctx.locks || []).length;
  return `${members};${memCount};${msgCount};${lockCount}`;
}

export function useDashboardConnection({ config, stdout }) {
  // Connection state
  const [context, setContext] = useState(null);
  // ── .chinwag file discovery (computed once at mount) ──
  const initProject = () => {
    const project = getProjectContext(process.cwd());
    if (!project) return { error: 'No .chinwag file found. Run `npx chinwag init` first.' };
    if (project.error) return { error: project.error };
    let tools = [];
    try {
      tools = detectTools(project.root);
    } catch {
      /* detection failed */
    }
    return { teamId: project.teamId, teamName: project.teamName, root: project.root, tools };
  };
  const [initState] = useState(initProject);

  const [error, setError] = useState(initState.error || null);
  const [connState, setConnState] = useState('connecting');
  const [connDetail, setConnDetail] = useState(null);
  const consecutiveFailures = useRef(0);
  const unchangedPolls = useRef(0);
  const lastFingerprint = useRef('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  const [teamId, _setTeamId] = useState(initState.teamId || null);
  const [teamName, _setTeamName] = useState(initState.teamName || null);
  const [projectRoot, _setProjectRoot] = useState(initState.root || null);
  const [detectedTools, _setDetectedTools] = useState(initState.tools || []);

  // Terminal
  const [cols, setCols] = useState(stdout?.columns || 80);

  // ── Spinner ──────────────────────────────────────────
  useEffect(() => {
    if (connState === 'connected' || connState === 'offline') return;
    const t = setInterval(
      () => setSpinnerFrame((f) => (f + 1) % SPINNER.length),
      SPINNER_INTERVAL_MS,
    );
    return () => clearInterval(t);
  }, [connState]);

  // ── Terminal resize ──────────────────────────────────
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns);
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  // ── WebSocket connection with polling fallback ───
  const wsRef = useRef(null);

  useEffect(() => {
    if (!teamId) return;
    const dashboardAgentId = `dashboard:${(config?.token || '').slice(0, 8)}`;
    const client = api(config, { agentId: dashboardAgentId });
    const joined = { current: false };
    let pollInterval = null;
    let reconcileInterval = null;
    let wsConnectTimeout = null;
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
      if (consecutiveFailures.current >= OFFLINE_THRESHOLD && classified.state === 'reconnecting') {
        setConnState('offline');
        setConnDetail(
          classified.detail
            .replace('Retrying...', 'Press [r] to retry.')
            .replace('Retrying shortly.', 'Press [r] to retry.'),
        );
      } else {
        setConnState(classified.state);
        setConnDetail(classified.detail);
      }
    }

    // ── Polling fallback ──────────────────────────
    function getPollInterval() {
      const failures = consecutiveFailures.current;
      if (failures >= 3) {
        // Exponential backoff during error states: base * 2^(failures-3), capped at 60s
        const base = failures >= OFFLINE_THRESHOLD ? POLL_SLOW_MS : POLL_MEDIUM_MS;
        return Math.min(base * Math.pow(2, failures - 3), BACKOFF_MAX_MS);
      }
      // Progressive backoff when context is unchanged (idle team)
      const idle = unchangedPolls.current;
      if (idle >= IDLE_TIER_3) return POLL_IDLE_MS;
      if (idle >= IDLE_TIER_2) return POLL_SLOW_MS;
      if (idle >= IDLE_TIER_1) return POLL_MEDIUM_MS;
      return POLL_FAST_MS;
    }

    function startPolling() {
      if (destroyed || pollInterval) return;
      function schedulePoll() {
        pollInterval = setTimeout(async () => {
          if (destroyed) return;
          try {
            await fetchContextOnce();
          } catch (err) {
            handleFetchError(err);
          }
          if (!destroyed) schedulePoll();
        }, getPollInterval());
      }
      schedulePoll();
    }

    function stopPolling() {
      if (pollInterval) {
        clearTimeout(pollInterval);
        pollInterval = null;
      }
    }

    // ── WebSocket connection ──────────────────────
    async function connect() {
      // Join team + fetch initial context via HTTP
      try {
        await fetchContextOnce();
      } catch (err) {
        handleFetchError(err);
        startPolling();
        return;
      }

      // Fetch short-lived ticket — keeps real token out of WS URL
      let wsTicket;
      try {
        const ticketData = await client.post('/auth/ws-ticket');
        wsTicket = ticketData.ticket;
      } catch (err) {
        console.error('[chinwag]', err?.message || err);
        startPolling();
        return;
      }

      const wsBase = getApiUrl().replace(/^http/, 'ws');
      const wsUrl = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(dashboardAgentId)}&ticket=${encodeURIComponent(wsTicket)}`;

      try {
        const ws = new WebSocket(wsUrl);

        // Timeout: if still CONNECTING after 10s, close and fall back to polling
        wsConnectTimeout = setTimeout(() => {
          if (ws.readyState === WebSocket.CONNECTING) {
            ws.close();
            startPolling();
          }
        }, WS_CONNECT_TIMEOUT_MS);

        ws.onopen = () => {
          if (wsConnectTimeout) {
            clearTimeout(wsConnectTimeout);
            wsConnectTimeout = null;
          }
          if (destroyed) {
            ws.close();
            return;
          }
          stopPolling();
          setConnState('connected');
          setConnDetail(null);
          // Full reconciliation every 60s to correct drift
          if (reconcileInterval) clearInterval(reconcileInterval);
          reconcileInterval = setInterval(async () => {
            try {
              await fetchContextOnce();
            } catch (err) {
              console.error('[chinwag]', err?.message || err);
            }
          }, RECONCILE_INTERVAL_MS);
        };

        ws.onmessage = (evt) => {
          if (destroyed) return;
          try {
            const event = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
            if (event.type === 'context') {
              setContext(event.data);
            } else {
              setContext((prev) => (prev ? applyDelta(prev, event) : prev));
            }
          } catch (err) {
            console.error('[chinwag]', err?.message || err);
          }
        };

        ws.onclose = () => {
          if (destroyed) return;
          wsRef.current = null;
          if (reconcileInterval) {
            clearInterval(reconcileInterval);
            reconcileInterval = null;
          }
          startPolling();
        };

        ws.onerror = () => {
          /* onclose fires after onerror */
        };

        wsRef.current = ws;
      } catch (err) {
        console.error('[chinwag]', err?.message || err);
        startPolling();
      }
    }

    connect();

    return () => {
      destroyed = true;
      stopPolling();
      if (wsConnectTimeout) {
        clearTimeout(wsConnectTimeout);
        wsConnectTimeout = null;
      }
      if (reconcileInterval) clearInterval(reconcileInterval);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (err) {
          console.error('[chinwag]', err?.message || err);
        }
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
    setRefreshKey((k) => k + 1);
  }

  function bumpRefreshKey() {
    setRefreshKey((k) => k + 1);
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

import { useState, useEffect, useRef } from 'react';
import { api } from './api.js';
import { detectTools } from './mcp-config.js';
import { getProjectContext } from './project.js';
import { SPINNER } from './dashboard-utils.js';

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

  // ── API polling ──────────────────────────────────────
  useEffect(() => {
    if (!teamId) return;
    const dashboardAgentId = `dashboard:${(config?.token || '').slice(0, 8)}`;
    const client = api(config, { agentId: dashboardAgentId });
    let joined = false;

    async function fetchContext() {
      try {
        if (!joined) {
          try {
            await client.post(`/teams/${teamId}/join`, { name: teamName });
          } catch (joinErr) {
            // Rate limit or transient failure — still try getContext in case
            // the agent is already a member from a previous join
            if (joinErr.status === 429) {
              // Don't block context fetch; agent may still be active
            } else {
              throw joinErr;
            }
          }
          joined = true;
        }
        const ctx = await client.get(`/teams/${teamId}/context`);
        setContext(ctx);
        consecutiveFailures.current = 0;
        setConnState('connected');
        setConnDetail(null);
      } catch (err) {
        if (err.message?.includes('Not a member')) joined = false;
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
    }

    fetchContext();
    const interval = setInterval(fetchContext,
      consecutiveFailures.current >= 6 ? 30_000
        : consecutiveFailures.current >= 3 ? 15_000
        : 5000);
    return () => clearInterval(interval);
  }, [teamId, teamName, refreshKey, config?.token]);

  function retry() {
    setError(null);
    setConnState('connecting');
    consecutiveFailures.current = 0;
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

import { useState, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { applyDelta } from '@chinwag/shared/dashboard-ws.js';
import { api, getApiUrl } from '../api.js';
import { detectTools } from '../mcp-config.js';
import { getProjectContext } from '../project.js';
import { SPINNER } from './utils.js';
import { SPINNER_INTERVAL_MS } from './constants.js';
import { useTimerRegistry } from './use-timer-registry.js';
import { classifyError } from '../utils/errors.js';
import { hasError } from '../utils/type-guards.js';
import type { ChinwagConfig } from '../config.js';
import type { TeamContext } from './view.js';
import type { HostIntegration } from '@chinwag/shared/integration-model.js';
import type { WebSocketTicketResponse } from '@chinwag/shared/contracts.js';
import { formatError, createLogger } from '@chinwag/shared';
import {
  POLL_FAST_MS,
  POLL_MEDIUM_MS,
  POLL_SLOW_MS,
  POLL_IDLE_MS,
  BACKOFF_MAX_MS,
  OFFLINE_THRESHOLD,
  IDLE_TIER_1,
  IDLE_TIER_2,
  IDLE_TIER_3,
  RECONCILE_INTERVAL_MS,
  WS_CONNECT_TIMEOUT_MS,
} from '../constants/timings.js';

const log = createLogger('dashboard-connection');

interface ContextLike {
  members?: Array<{
    agent_id: string;
    status: string;
    activity?: { summary?: string; files?: string[] };
  }>;
  memories?: unknown[];
  messages?: unknown[];
  locks?: unknown[];
}

// Minimal fingerprint of context for change detection (avoids JSON.stringify on every poll)
export function contextFingerprint(ctx: ContextLike | null): string {
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

/**
 * Compute the polling interval based on failure count and idle state.
 * Extracted to module scope for testability.
 */
export function getPollInterval(consecutiveFailures: number, unchangedPolls: number): number {
  if (consecutiveFailures >= 3) {
    const base = consecutiveFailures >= OFFLINE_THRESHOLD ? POLL_SLOW_MS : POLL_MEDIUM_MS;
    return Math.min(base * Math.pow(2, consecutiveFailures - 3), BACKOFF_MAX_MS);
  }
  if (unchangedPolls >= IDLE_TIER_3) return POLL_IDLE_MS;
  if (unchangedPolls >= IDLE_TIER_2) return POLL_SLOW_MS;
  if (unchangedPolls >= IDLE_TIER_1) return POLL_MEDIUM_MS;
  return POLL_FAST_MS;
}

interface StdoutLike {
  columns?: number;
  rows?: number;
  on: (event: string, listener: () => void) => void;
  off: (event: string, listener: () => void) => void;
}

interface UseDashboardConnectionParams {
  config: ChinwagConfig | null;
  stdout: StdoutLike | null;
}

interface InitProjectState {
  error?: string;
  teamId?: string;
  teamName?: string;
  root?: string;
  tools?: HostIntegration[];
}

export interface UseDashboardConnectionReturn {
  teamId: string | null;
  teamName: string | null;
  projectRoot: string | null;
  detectedTools: HostIntegration[];
  context: TeamContext | null;
  error: string | null;
  connState: string;
  connDetail: string | null;
  spinnerFrame: number;
  cols: number;
  consecutiveFailures: MutableRefObject<number>;
  retry: () => void;
  bumpRefreshKey: () => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setConnState: Dispatch<SetStateAction<string>>;
}

export function useDashboardConnection({
  config,
  stdout,
}: UseDashboardConnectionParams): UseDashboardConnectionReturn {
  // Connection state
  const [context, setContext] = useState<TeamContext | null>(null);
  // ── .chinwag file discovery (computed once at mount) ──
  const initProject = (): InitProjectState => {
    const project = getProjectContext(process.cwd());
    if (!project) return { error: 'No .chinwag file found. Run `npx chinwag init` first.' };
    if (hasError(project)) return { error: project.error };
    let tools: HostIntegration[] = [];
    try {
      tools = detectTools(project.root);
    } catch {
      /* detection failed */
    }
    return { teamId: project.teamId, teamName: project.teamName, root: project.root, tools };
  };
  const [initState] = useState<InitProjectState>(initProject);

  const [error, setError] = useState<string | null>(initState.error || null);
  const [connState, setConnState] = useState<string>('connecting');
  const [connDetail, setConnDetail] = useState<string | null>(null);
  const consecutiveFailures = useRef<number>(0);
  const unchangedPolls = useRef<number>(0);
  const lastFingerprint = useRef<string>('');
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [spinnerFrame, setSpinnerFrame] = useState<number>(0);

  const [teamId, _setTeamId] = useState<string | null>(initState.teamId || null);
  const [teamName, _setTeamName] = useState<string | null>(initState.teamName || null);
  const [projectRoot, _setProjectRoot] = useState<string | null>(initState.root || null);
  const [detectedTools, _setDetectedTools] = useState<HostIntegration[]>(initState.tools || []);

  // Terminal
  const [cols, setCols] = useState<number>(stdout?.columns || 80);

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
    const onResize = (): void => setCols(stdout.columns || 80);
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  // ── WebSocket connection with polling fallback ───
  const wsRef = useRef<WebSocket | null>(null);
  const timers = useTimerRegistry();

  useEffect(() => {
    if (!teamId) return;
    const dashboardAgentId = `dashboard:${(config?.token || '').slice(0, 8)}`;
    const client = api(config, { agentId: dashboardAgentId });
    const joined = { current: false };
    let pollInterval: ReturnType<typeof setTimeout> | null = null;
    let reconcileInterval: ReturnType<typeof setInterval> | null = null;
    let wsConnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    async function fetchContextOnce(): Promise<void> {
      if (!joined.current) {
        try {
          await client.post(`/teams/${teamId}/join`, { name: teamName });
        } catch (joinErr: unknown) {
          if ((joinErr as { status?: number }).status !== 429) throw joinErr;
        }
        joined.current = true;
      }
      const ctx = (await client.get(`/teams/${teamId}/context`)) as TeamContext;
      setContext(ctx);
      consecutiveFailures.current = 0;
      setConnState('connected');
      setConnDetail(null);

      // Track whether context changed for idle backoff
      // ctx shares the same shape as ContextLike (members/memories/messages/locks)
      const fp = contextFingerprint(ctx as ContextLike);
      if (fp === lastFingerprint.current) {
        unchangedPolls.current++;
      } else {
        unchangedPolls.current = 0;
        lastFingerprint.current = fp;
      }
    }

    function handleFetchError(err: unknown): void {
      const error = err as { message?: string; status?: number };
      if (error.message?.includes('Not a member')) joined.current = false;
      consecutiveFailures.current++;
      const classified = classifyError(error);
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
    function getLocalPollInterval(): number {
      return getPollInterval(consecutiveFailures.current, unchangedPolls.current);
    }

    function startPolling(): void {
      if (destroyed || pollInterval) return;
      function schedulePoll(): void {
        pollInterval = timers.setTimeout(async () => {
          if (destroyed) return;
          try {
            await fetchContextOnce();
          } catch (err: unknown) {
            handleFetchError(err);
          }
          if (!destroyed) schedulePoll();
        }, getLocalPollInterval());
      }
      schedulePoll();
    }

    function stopPolling(): void {
      if (pollInterval) {
        timers.clearTimeout(pollInterval);
        pollInterval = null;
      }
    }

    // ── WebSocket connection ──────────────────────
    async function connect(): Promise<void> {
      // Join team + fetch initial context via HTTP
      try {
        await fetchContextOnce();
      } catch (err: unknown) {
        handleFetchError(err);
        startPolling();
        return;
      }

      // Fetch short-lived ticket — keeps real token out of WS URL
      let wsTicket: string;
      try {
        const ticketData = await client.post<WebSocketTicketResponse>('/auth/ws-ticket');
        wsTicket = ticketData.ticket;
      } catch (err: unknown) {
        log.error(formatError(err));
        startPolling();
        return;
      }

      const wsBase = getApiUrl().replace(/^http/, 'ws');
      const wsUrl = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(dashboardAgentId)}&ticket=${encodeURIComponent(wsTicket)}`;

      try {
        const ws = new WebSocket(wsUrl);

        // Timeout: if still CONNECTING after 10s, close and fall back to polling
        wsConnectTimeout = timers.setTimeout(() => {
          if (ws.readyState === WebSocket.CONNECTING) {
            ws.close();
            startPolling();
          }
        }, WS_CONNECT_TIMEOUT_MS);

        ws.onopen = (): void => {
          if (wsConnectTimeout) {
            timers.clearTimeout(wsConnectTimeout);
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
          if (reconcileInterval) timers.clearInterval(reconcileInterval);
          reconcileInterval = timers.setInterval(async () => {
            try {
              await fetchContextOnce();
            } catch (err: unknown) {
              log.error(formatError(err));
            }
          }, RECONCILE_INTERVAL_MS);
        };

        ws.onmessage = (evt: MessageEvent): void => {
          if (destroyed) return;
          try {
            const event = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
            if (event.type === 'context') {
              setContext(event.data);
            } else {
              setContext((prev) => (prev ? (applyDelta(prev, event) as TeamContext) : prev));
            }
          } catch (err: unknown) {
            log.error(formatError(err));
          }
        };

        ws.onclose = (): void => {
          if (destroyed) return;
          wsRef.current = null;
          if (reconcileInterval) {
            timers.clearInterval(reconcileInterval);
            reconcileInterval = null;
          }
          startPolling();
        };

        ws.onerror = (): void => {
          /* onclose fires after onerror */
        };

        wsRef.current = ws;
      } catch (err: unknown) {
        log.error(formatError(err));
        startPolling();
      }
    }

    connect();

    return () => {
      destroyed = true;
      timers.clearAll();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (err: unknown) {
          log.error(formatError(err));
        }
        wsRef.current = null;
      }
    };
  }, [teamId, teamName, refreshKey, config, timers]);

  function retry(): void {
    setError(null);
    setConnState('connecting');
    consecutiveFailures.current = 0;
    unchangedPolls.current = 0;
    lastFingerprint.current = '';
    setRefreshKey((k) => k + 1);
  }

  function bumpRefreshKey(): void {
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

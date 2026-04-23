/**
 * Subscribe to managed-process exits and run post-session analytics collection.
 *
 * The collectors in packages/cli/lib/process/conversation-collector.ts need a
 * config, teamId, and sessionId to upload. The MCP sidecar running inside the
 * agent process owns the sessionId; when it exits it writes a completion
 * record (packages/shared/session-registry.ts) that this hook reads by
 * agentId. Without the handoff, sessionId is lost and collectors silently
 * skip — which is the state the analytics pipeline was stuck in before.
 *
 * Collection runs asynchronously. It must never block the registry's exit
 * callbacks, and any failure is swallowed — logs and tokens are nice-to-have,
 * not load-bearing for the agent lifecycle.
 */
import { useEffect } from 'react';
import {
  readCompletedSession,
  deleteCompletedSession,
  listCompletedSessions,
  type CompletedSession,
} from '@chinmeister/shared/session-registry.js';
import { createLogger } from '@chinmeister/shared';
import { onProcessExit } from '../../process/registry.js';
import {
  collectConversation,
  collectTokenUsage,
  collectToolCalls,
} from '../../process/conversation-collector.js';
import type { ChinmeisterConfig } from '../../config.js';
import type { ManagedProcess } from '../../process/types.js';

const log = createLogger('collector-subscription');

interface UseCollectorSubscriptionParams {
  config: ChinmeisterConfig | null;
  teamId: string | null;
}

/**
 * Max time to wait for the MCP sidecar to flush its completion record.
 * MCP writes the file during its own cleanup path, which runs in parallel
 * with the dashboard observing the parent pty exit. A short retry covers
 * the race without blocking meaningfully.
 */
const COMPLETION_POLL_DELAYS_MS = [0, 250, 1000];

interface RunCollectorsOverrides {
  readCompletedSessionFn?: typeof readCompletedSession;
  deleteCompletedSessionFn?: typeof deleteCompletedSession;
  collectConversationFn?: typeof collectConversation;
  collectTokenUsageFn?: typeof collectTokenUsage;
  collectToolCallsFn?: typeof collectToolCalls;
  /** Poll delays used for integration tests; defaults to production values. */
  pollDelaysMs?: number[];
  /** Custom sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export async function runCollectorsForProcess(
  proc: ManagedProcess,
  config: ChinmeisterConfig,
  overrides: RunCollectorsOverrides = {},
): Promise<void> {
  const readFn = overrides.readCompletedSessionFn || readCompletedSession;
  const deleteFn = overrides.deleteCompletedSessionFn || deleteCompletedSession;
  const collectConv = overrides.collectConversationFn || collectConversation;
  const collectTok = overrides.collectTokenUsageFn || collectTokenUsage;
  const collectCalls = overrides.collectToolCallsFn || collectToolCalls;
  const delays = overrides.pollDelaysMs || COMPLETION_POLL_DELAYS_MS;
  const sleep = overrides.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const resolvedAgentId = proc.agentId;
  if (!resolvedAgentId) return;

  let completed = null;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    completed = readFn(resolvedAgentId);
    if (completed) break;
  }
  if (!completed) {
    // No sessionId available — the MCP either didn't get one or hasn't flushed
    // yet. Skip collection silently; the dashboard's other signals (edits,
    // outcomes, heatmap) still land via the MCP heartbeat path.
    return;
  }

  const teamId = completed.teamId || proc.teamId || null;
  const sessionId = completed.sessionId;
  const procForCollectors: ManagedProcess = {
    ...proc,
    teamId,
    sessionId,
    startedAt: completed.startedAt || proc.startedAt,
  };

  await Promise.all([
    collectConv(procForCollectors, config, teamId, sessionId).catch((err) => {
      log.warn(`collectConversation failed: ${err}`);
    }),
    collectTok(procForCollectors, config, teamId, sessionId).catch((err) => {
      log.warn(`collectTokenUsage failed: ${err}`);
    }),
    collectCalls(procForCollectors, config, teamId, sessionId).catch((err) => {
      log.warn(`collectToolCalls failed: ${err}`);
    }),
  ]);

  deleteFn(resolvedAgentId);
}

export function useCollectorSubscription({ config, teamId }: UseCollectorSubscriptionParams): void {
  useEffect(() => {
    if (!config || !teamId) return undefined;

    const unsubscribe = onProcessExit((proc) => {
      void runCollectorsForProcess(proc, config);
    });

    return unsubscribe;
  }, [config, teamId]);
}

/**
 * Synthesize a minimal ManagedProcess from an on-disk completion record so
 * the existing collector dispatch (which consumes ManagedProcess) can run
 * against externally-launched agents the dashboard never observed exit for.
 * All fields the collectors actually read are supplied from the record;
 * display-only fields (title, pid, status) get placeholder values because
 * the sweep path doesn't render rows for orphaned sessions.
 */
function synthesizeProcessFromRecord(record: CompletedSession): ManagedProcess {
  return {
    id: record.agentId,
    agentId: record.agentId,
    sessionId: record.sessionId,
    teamId: record.teamId,
    toolId: record.toolId,
    // Collectors resolve log paths off cwd (Claude Code's project-hash, etc.),
    // so this is load-bearing. It's the one piece of state the sweep truly
    // depends on — without it the spec engine can't find the right JSONL.
    cwd: record.cwd,
    startedAt: record.startedAt,
    // Display-only below; collectors don't touch these.
    title: '',
    pid: 0,
    status: 'exited',
  } as unknown as ManagedProcess;
}

/**
 * One-shot sweep of orphaned completion records on dashboard mount. Closes
 * the external-agent cost-coverage gap: a user running `claude-code` outside
 * chinmeister's managed flow still produces `<agentId>.completed.json` via MCP
 * cleanup, but the dashboard never observes the exit and the collectors
 * never run. Sweeping on mount means any later dashboard session — even
 * days after the external run — picks up the stranded record and uploads.
 *
 * Scope guard: only records whose teamId matches the currently-authenticated
 * team are processed. Records from other teams stay on disk so a future
 * session that auths to that team can handle them.
 */
export function useOrphanCollectorSweep({ config, teamId }: UseCollectorSubscriptionParams): void {
  useEffect(() => {
    if (!config || !teamId) return;
    let cancelled = false;
    void (async () => {
      let records: ReturnType<typeof listCompletedSessions>;
      try {
        records = listCompletedSessions();
      } catch (err) {
        log.warn(`orphan sweep: failed to list completion records: ${err}`);
        return;
      }
      for (const { record } of records) {
        if (cancelled) return;
        if (record.teamId !== teamId) continue;
        const proc = synthesizeProcessFromRecord(record);
        await runCollectorsForProcess(proc, config).catch((err) => {
          log.warn(`orphan sweep: collector run failed for ${record.agentId}: ${err}`);
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, teamId]);
}

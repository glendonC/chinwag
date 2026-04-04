/**
 * Process tracking state and logic: spawned agent list, status tracking,
 * duration ticker, and exit detection with failure classification.
 */
import type { Dispatch, SetStateAction } from 'react';
import { useState, useEffect, useRef } from 'react';
import { getAgents, getOutput, onUpdate } from '../../process-manager.js';
import type { AgentInfo } from '../../process-manager.js';
import { classifyManagedAgentFailure, listManagedAgentTools } from '../../managed-agents.js';
import type { ManagedTool, ManagedToolState } from '../../managed-agents.js';
import type { NoticeTone } from '../reducer.js';
import { DURATION_TICK_MS, MAX_OUTPUT_LINES } from '../../constants/timings.js';

interface UseManagedAgentsParams {
  flash: (text: string, options?: { tone?: NoticeTone }) => void;
}

export interface UseManagedAgentsReturn {
  managedAgents: AgentInfo[];
  managedToolStates: Record<string, ManagedToolState>;
  setManagedToolStates: Dispatch<SetStateAction<Record<string, ManagedToolState>>>;
  managedToolStatusTick: number;
  setManagedToolStatusTick: Dispatch<SetStateAction<number>>;
  installedCliAgents: ManagedTool[];
  mountedRef: React.MutableRefObject<boolean>;
}

/**
 * Hook for process manager sync: subscribes to process updates,
 * ticks the duration display, and detects agent exits.
 */
export function useManagedAgents({ flash }: UseManagedAgentsParams): UseManagedAgentsReturn {
  // Process manager state
  const [managedAgents, setManagedAgents] = useState<AgentInfo[]>([]);
  const previousManagedStatuses = useRef<Map<number, string>>(new Map());
  const [managedToolStates, setManagedToolStates] = useState<Record<string, ManagedToolState>>({});
  const [managedToolStatusTick, setManagedToolStatusTick] = useState(0);

  // CLI agents
  const [installedCliAgents] = useState(() => listManagedAgentTools());

  // ── Process manager sync + duration ticker ───────────
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    setManagedAgents(getAgents());
    const unsub = onUpdate(() => {
      if (mountedRef.current) setManagedAgents(getAgents());
    });
    // Tick every 10s to update duration display
    const ticker = setInterval(() => {
      if (mountedRef.current) setManagedAgents(getAgents());
    }, DURATION_TICK_MS);
    return () => {
      mountedRef.current = false;
      unsub();
      clearInterval(ticker);
    };
  }, []);

  // ── Agent exit detection (flash + failure classification) ──
  useEffect(() => {
    const previous = previousManagedStatuses.current;
    for (const agent of managedAgents) {
      const lastStatus = previous.get(agent.id);
      if (lastStatus === 'running' && agent.status !== 'running') {
        const failureStatus =
          agent.status === 'failed'
            ? classifyManagedAgentFailure(
                agent.toolId,
                getOutput(agent.id, MAX_OUTPUT_LINES).join('\n'),
              )
            : null;
        if (failureStatus) {
          setManagedToolStates((prev) => ({
            ...prev,
            [agent.toolId]: failureStatus,
          }));
        }

        const preview = agent.outputPreview ? `: ${agent.outputPreview}` : '';
        flash(
          failureStatus?.detail ||
            (agent.status === 'exited'
              ? `${agent.toolName} finished${preview}`
              : `${agent.toolName} failed${preview}`),
          { tone: agent.status === 'exited' ? 'success' : 'warning' },
        );
      }
      previous.set(agent.id, agent.status);
    }

    const liveIds = new Set(managedAgents.map((agent) => agent.id));
    for (const id of [...previous.keys()]) {
      if (!liveIds.has(id)) previous.delete(id);
    }
  }, [managedAgents]);

  return {
    managedAgents,
    managedToolStates,
    setManagedToolStates,
    managedToolStatusTick,
    setManagedToolStatusTick,
    installedCliAgents,
    mountedRef,
  };
}

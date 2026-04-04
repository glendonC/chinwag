/**
 * Tool checking, availability status, external agent polling,
 * and derived tool state (ready, unavailable, checking).
 */
import type { Dispatch, SetStateAction } from 'react';
import { useState, useEffect, useRef } from 'react';
import {
  getAgents,
  setExternalAgentPid,
  checkExternalAgentLiveness,
} from '../../process-manager.js';
import { readPidFile } from '../../terminal-spawner.js';
import { checkManagedAgentToolAvailability } from '../../managed-agents.js';
import type { ManagedTool, ManagedToolState } from '../../managed-agents.js';
import {
  getSavedLauncherPreference,
  resolvePreferredManagedTool,
} from '../../launcher-preferences.js';
import type { NoticeTone } from '../reducer.js';
import { EXTERNAL_AGENT_POLL_MS, EARLY_EXIT_THRESHOLD_MS } from '../../constants/timings.js';

interface UseToolAvailabilityParams {
  installedCliAgents: ManagedTool[];
  managedToolStates: Record<string, ManagedToolState>;
  setManagedToolStates: Dispatch<SetStateAction<Record<string, ManagedToolState>>>;
  managedToolStatusTick: number;
  setManagedToolStatusTick: Dispatch<SetStateAction<number>>;
  teamId: string | null;
  projectRoot: string;
  flash: (text: string, options?: { tone?: NoticeTone }) => void;
}

export interface UseToolAvailabilityReturn {
  readyCliAgents: ManagedTool[];
  unavailableCliAgents: ManagedTool[];
  checkingCliAgents: ManagedTool[];
  selectedLaunchTool: ManagedTool | null;
  canLaunchSelectedTool: boolean;
  launcherChoices: ManagedTool[];
  launchToolId: string | null;
  setLaunchToolId: Dispatch<SetStateAction<string | null>>;
  preferredLaunchToolId: string | null;
  setPreferredLaunchToolId: Dispatch<SetStateAction<string | null>>;
  toolPickerOpen: boolean;
  setToolPickerOpen: Dispatch<SetStateAction<boolean>>;
  toolPickerIdx: number;
  setToolPickerIdx: Dispatch<SetStateAction<number>>;
  getManagedToolState: (toolId: string) => ManagedToolState;
}

/**
 * Hook for tool availability checking, external agent lifecycle polling,
 * and derived tool state computation.
 */
export function useToolAvailability({
  installedCliAgents,
  managedToolStates,
  setManagedToolStates,
  managedToolStatusTick,
  setManagedToolStatusTick,
  teamId,
  projectRoot,
  flash,
}: UseToolAvailabilityParams): UseToolAvailabilityReturn {
  // Tool picker
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [toolPickerIdx, setToolPickerIdx] = useState(0);

  // Launch tool selection
  const [launchToolId, setLaunchToolId] = useState<string | null>(null);
  const [preferredLaunchToolId, setPreferredLaunchToolId] = useState<string | null>(null);

  // ── Tool availability checking ───────────────────────
  useEffect(() => {
    if (!installedCliAgents.length) return;

    let cancelled = false;

    async function checkManagedTools() {
      if (cancelled) return;

      setManagedToolStates((prev) => {
        const next = { ...prev };
        for (const tool of installedCliAgents) {
          const existing = next[tool.id];
          if (!existing || existing.source !== 'runtime') {
            next[tool.id] = { toolId: tool.id, state: 'checking', detail: 'Checking readiness' };
          }
        }
        return next;
      });

      const results = await Promise.all(
        installedCliAgents.map((tool) =>
          checkManagedAgentToolAvailability(tool, { cwd: projectRoot }),
        ),
      );

      if (cancelled) return;

      setManagedToolStates((prev) => {
        if (cancelled) return prev;
        const next = { ...prev };
        for (const result of results) {
          if (cancelled) break;
          if (next[result.toolId]?.source === 'runtime') continue;
          next[result.toolId] = result;
        }
        return next;
      });
    }

    checkManagedTools();
    return () => {
      cancelled = true;
    };
  }, [installedCliAgents, managedToolStatusTick, projectRoot]);

  // ── Preferred launch tool ────────────────────────────
  useEffect(() => {
    if (!teamId) return;
    setPreferredLaunchToolId(getSavedLauncherPreference(teamId));
  }, [teamId]);

  // ── External agent lifecycle (pidfile polling + liveness) ──
  const externalAgentPrevStatus = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    const interval = setInterval(() => {
      const currentAgents = getAgents();
      for (const agent of currentAgents) {
        if (agent.spawnType !== 'external' || agent.status !== 'running') continue;
        if (!agent.agentId) continue;
        const pid = readPidFile(agent.agentId);
        if (pid) setExternalAgentPid(agent.id, pid);
      }
      const prev = externalAgentPrevStatus.current;
      const changed = checkExternalAgentLiveness();
      if (changed) {
        const now = Date.now();
        const freshAgents = getAgents();
        for (const agent of freshAgents) {
          if (agent.spawnType !== 'external') continue;
          const was = prev.get(agent.id);
          if (was === 'running' && agent.status !== 'running') {
            const age = now - (agent.startedAt || 0);
            if (age < EARLY_EXIT_THRESHOLD_MS && agent.toolId) {
              flash(`${agent.toolName || agent.toolId} exited immediately. Press [f] to fix.`, {
                tone: 'warning',
              });
              setManagedToolStatusTick((t) => t + 1);
            }
          }
        }
      }

      // Update status tracking and prune entries for agents that no longer exist
      const currentIds = new Set<number>();
      for (const agent of getAgents()) {
        if (agent.spawnType === 'external') {
          prev.set(agent.id, agent.status);
          currentIds.add(agent.id);
        }
      }
      for (const id of [...prev.keys()]) {
        if (!currentIds.has(id)) prev.delete(id);
      }
    }, EXTERNAL_AGENT_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  // ── Derived state ────────────────────────────────────

  function getManagedToolState(toolId: string): ManagedToolState {
    return managedToolStates[toolId] || { toolId, state: 'checking', detail: 'Checking readiness' };
  }

  const readyCliAgents = installedCliAgents.filter(
    (tool) => getManagedToolState(tool.id).state === 'ready',
  );
  const unavailableCliAgents = installedCliAgents.filter((tool) => {
    const state = getManagedToolState(tool.id).state;
    return state === 'needs_auth' || state === 'unavailable';
  });
  const checkingCliAgents = installedCliAgents.filter(
    (tool) => getManagedToolState(tool.id).state === 'checking',
  );
  const preferredLaunchTool = resolvePreferredManagedTool(
    readyCliAgents,
    preferredLaunchToolId,
  ) as ManagedTool | null;
  const selectedLaunchTool: ManagedTool | null =
    installedCliAgents.find((tool) => tool.id === launchToolId) ||
    preferredLaunchTool ||
    readyCliAgents[0] ||
    installedCliAgents[0] ||
    null;
  const selectedLaunchToolState = selectedLaunchTool
    ? getManagedToolState(selectedLaunchTool.id)
    : null;
  const canLaunchSelectedTool = selectedLaunchToolState?.state === 'ready';
  const launcherChoices = readyCliAgents.length > 0 ? readyCliAgents : installedCliAgents;

  // ── Launch tool fallback clamping ────────────────────
  useEffect(() => {
    if (launchToolId && installedCliAgents.some((tool) => tool.id === launchToolId)) return;

    const fallbackTool = preferredLaunchTool || readyCliAgents[0] || installedCliAgents[0] || null;
    if (fallbackTool) {
      setLaunchToolId(fallbackTool.id);
    }
  }, [launchToolId, installedCliAgents, preferredLaunchTool, readyCliAgents]);

  return {
    readyCliAgents,
    unavailableCliAgents,
    checkingCliAgents,
    selectedLaunchTool,
    canLaunchSelectedTool,
    launcherChoices,
    launchToolId,
    setLaunchToolId,
    preferredLaunchToolId,
    setPreferredLaunchToolId,
    toolPickerOpen,
    setToolPickerOpen,
    toolPickerIdx,
    setToolPickerIdx,
    getManagedToolState,
  };
}

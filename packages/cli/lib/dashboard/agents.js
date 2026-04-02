import { useState, useEffect, useRef } from 'react';
import {
  spawnAgent, killAgent, getAgents, getOutput, onUpdate,
  removeAgent, registerExternalAgent, setExternalAgentPid,
  checkExternalAgentLiveness,
} from '../process-manager.js';
import { spawnInTerminal, detectTerminalEnvironment, readPidFile } from '../terminal-spawner.js';
import { openCommandInTerminal } from '../open-command-in-terminal.js';
import {
  checkManagedAgentToolAvailability,
  classifyManagedAgentFailure,
  createManagedAgentLaunch,
  createTerminalAgentLaunch,
  listManagedAgentTools,
} from '../managed-agents.js';
import {
  getSavedLauncherPreference,
  resolvePreferredManagedTool,
  saveLauncherPreference,
} from '../launcher-preferences.js';
import { getAgentDisplayLabel } from './agent-display.js';

/**
 * Custom hook for agent lifecycle management.
 * Handles spawning, killing, restarting agents, tool availability checking,
 * and managed tool state tracking.
 */
export function useAgentLifecycle({
  config,
  teamId,
  projectRoot,
  stdout,
  flash,
}) {
  // Process manager state
  const [managedAgents, setManagedAgents] = useState([]);
  const previousManagedStatuses = useRef(new Map());
  const [managedToolStates, setManagedToolStates] = useState({});
  const [managedToolStatusTick, setManagedToolStatusTick] = useState(0);

  // CLI agents
  const [installedCliAgents] = useState(() => listManagedAgentTools());

  // Tool picker
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [toolPickerIdx, setToolPickerIdx] = useState(0);

  // Launch tool selection
  const [launchToolId, setLaunchToolId] = useState(null);
  const [preferredLaunchToolId, setPreferredLaunchToolId] = useState(null);

  // ── Process manager sync + duration ticker ───────────
  useEffect(() => {
    setManagedAgents(getAgents());
    const unsub = onUpdate(() => setManagedAgents(getAgents()));
    // Tick every 10s to update duration display
    const ticker = setInterval(() => setManagedAgents(getAgents()), 10000);
    return () => { unsub(); clearInterval(ticker); };
  }, []);

  // ── Tool availability checking ───────────────────────
  useEffect(() => {
    if (!installedCliAgents.length) return;

    let cancelled = false;

    async function checkManagedTools() {
      setManagedToolStates(prev => {
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
        installedCliAgents.map(tool => checkManagedAgentToolAvailability(tool, { cwd: projectRoot }))
      );

      if (cancelled) return;

      setManagedToolStates(prev => {
        const next = { ...prev };
        for (const result of results) {
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

  // ── Agent exit detection (flash + failure classification) ──
  useEffect(() => {
    const previous = previousManagedStatuses.current;
    for (const agent of managedAgents) {
      const lastStatus = previous.get(agent.id);
      if (lastStatus === 'running' && agent.status !== 'running') {
        const failureStatus = agent.status === 'failed'
          ? classifyManagedAgentFailure(agent.toolId, getOutput(agent.id, 200).join('\n'))
          : null;
        if (failureStatus) {
          setManagedToolStates(prev => ({
            ...prev,
            [agent.toolId]: failureStatus,
          }));
        }

        const preview = agent.outputPreview ? `: ${agent.outputPreview}` : '';
        flash(
          failureStatus?.detail
            || (agent.status === 'exited'
              ? `${agent.toolName} finished${preview}`
              : `${agent.toolName} failed${preview}`),
          { tone: agent.status === 'exited' ? 'success' : 'warning' }
        );
      }
      previous.set(agent.id, agent.status);
    }

    const liveIds = new Set(managedAgents.map(agent => agent.id));
    for (const id of [...previous.keys()]) {
      if (!liveIds.has(id)) previous.delete(id);
    }
  }, [managedAgents]);

  // ── Preferred launch tool ────────────────────────────
  useEffect(() => {
    if (!teamId) return;
    setPreferredLaunchToolId(getSavedLauncherPreference(teamId));
  }, [teamId]);

  // ── External agent lifecycle (pidfile polling + liveness) ──
  const externalAgentPrevStatus = useRef(new Map());
  useEffect(() => {
    const interval = setInterval(() => {
      const agents = getAgents();
      for (const agent of agents) {
        if (agent.spawnType !== 'external' || agent.status !== 'running') continue;
        if (!agent.pid && agent.agentId) {
          const pid = readPidFile(agent.agentId);
          if (pid) setExternalAgentPid(agent.id, pid);
        }
      }
      const prev = externalAgentPrevStatus.current;
      const changed = checkExternalAgentLiveness();
      if (changed) {
        const now = Date.now();
        for (const agent of getAgents()) {
          if (agent.spawnType !== 'external') continue;
          const was = prev.get(agent.id);
          if (was === 'running' && agent.status !== 'running') {
            const age = now - (agent.startedAt || 0);
            if (age < 15000 && agent.toolId) {
              flash(`${agent.toolName || agent.toolId} exited immediately. Press [f] to fix.`, { tone: 'warning' });
              setManagedToolStatusTick(t => t + 1);
            }
          }
        }
      }
      for (const agent of getAgents()) {
        if (agent.spawnType === 'external') prev.set(agent.id, agent.status);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // ── Derived state ────────────────────────────────────

  function getManagedToolState(toolId) {
    return managedToolStates[toolId] || { toolId, state: 'checking', detail: 'Checking readiness' };
  }

  const readyCliAgents = installedCliAgents.filter(tool => getManagedToolState(tool.id).state === 'ready');
  const unavailableCliAgents = installedCliAgents.filter(tool => {
    const state = getManagedToolState(tool.id).state;
    return state === 'needs_auth' || state === 'unavailable';
  });
  const checkingCliAgents = installedCliAgents.filter(tool => getManagedToolState(tool.id).state === 'checking');
  const preferredLaunchTool = resolvePreferredManagedTool(readyCliAgents, preferredLaunchToolId);
  const selectedLaunchTool = installedCliAgents.find(tool => tool.id === launchToolId)
    || preferredLaunchTool
    || readyCliAgents[0]
    || installedCliAgents[0]
    || null;
  const selectedLaunchToolState = selectedLaunchTool ? getManagedToolState(selectedLaunchTool.id) : null;
  const canLaunchSelectedTool = selectedLaunchToolState?.state === 'ready';
  const launcherChoices = readyCliAgents.length > 0 ? readyCliAgents : installedCliAgents;

  // ── Launch tool fallback clamping ────────────────────
  useEffect(() => {
    if (launchToolId && installedCliAgents.some(tool => tool.id === launchToolId)) return;

    const fallbackTool = preferredLaunchTool || readyCliAgents[0] || installedCliAgents[0] || null;
    if (fallbackTool) {
      setLaunchToolId(fallbackTool.id);
    }
  }, [launchToolId, installedCliAgents, preferredLaunchTool, readyCliAgents]);

  // ── Actions ──────────────────────────────────────────

  function rememberLaunchTool(toolId) {
    if (!teamId || !toolId) return;
    if (saveLauncherPreference(teamId, toolId)) {
      setPreferredLaunchToolId(toolId);
    }
  }

  function selectLaunchTool(tool) {
    if (!tool) return;
    setLaunchToolId(tool.id);
  }

  function cycleToolForward() {
    if (launcherChoices.length <= 1) return;
    const currentIdx = launcherChoices.findIndex(t => t.id === launchToolId);
    const nextIdx = (currentIdx + 1) % launcherChoices.length;
    setLaunchToolId(launcherChoices[nextIdx].id);
  }

  function resolveReadyTool(query) {
    if (!query) return null;
    const normalized = query.toLowerCase();
    return readyCliAgents.find((tool) => (
      tool.id === normalized
      || tool.name.toLowerCase() === normalized
      || tool.name.toLowerCase().startsWith(normalized)
      || tool.id.startsWith(normalized)
    )) || null;
  }

  function refreshManagedToolStates({ clearRuntimeFailures = false } = {}) {
    setManagedToolStates(prev => {
      if (!clearRuntimeFailures) return prev;
      const next = {};
      for (const [toolId, status] of Object.entries(prev)) {
        if (status?.source !== 'runtime') next[toolId] = status;
      }
      return next;
    });
    setManagedToolStatusTick(tick => tick + 1);
    flash('Rechecking tools...', { tone: 'info' });
  }

  function handleSpawnAgent(toolInfo, task = '', options = {}) {
    if (!toolInfo) return false;
    const { flashSuccess = true } = options;
    const toolState = getManagedToolState(toolInfo.id);
    if (toolState.state !== 'ready') {
      const detail = toolState.detail || `${toolInfo.name} is not ready`;
      const hint = toolState.recoveryCommand ? ' Press [f] to fix.' : '';
      flash(`${detail}.${hint}`, { tone: 'warning' });
      return false;
    }

    try {
      // Try spawning in a real terminal tab first (full interactive UX)
      const termLaunch = createTerminalAgentLaunch({
        tool: toolInfo,
        task,
        cwd: projectRoot,
        token: config?.token,
      });
      const termResult = spawnInTerminal(termLaunch);
      if (termResult.ok) {
        registerExternalAgent(termLaunch);
        if (flashSuccess) {
          const env = detectTerminalEnvironment();
          flash(`Opened ${toolInfo.name} in ${env.name}`, { tone: 'success' });
        }
        return true;
      }

      // Fallback: spawn via node-pty (captured output, no interactivity)
      const launch = createManagedAgentLaunch({
        tool: toolInfo,
        task,
        cwd: projectRoot,
        token: config?.token,
        cols: stdout?.columns,
        rows: stdout?.rows,
      });
      const result = spawnAgent(launch);
      if (result.status === 'failed') {
        flash(`Failed to start ${toolInfo.name}`, { tone: 'error' });
        return false;
      }
      if (flashSuccess) {
        flash(`Started ${toolInfo.name} in background`, { tone: 'success' });
      }
      return true;
    } catch (err) {
      flash(err?.message || `Failed to start ${toolInfo.name}`, { tone: 'error' });
      return false;
    }
  }

  function launchManagedTask(toolInfo, task, options = {}) {
    const didStart = handleSpawnAgent(toolInfo, task, options);
    if (didStart) {
      rememberLaunchTool(toolInfo.id);
    }
    return didStart;
  }

  function handleKillAgent(agent, liveAgentNameCounts) {
    if (!agent?._managed) return;
    const didKill = killAgent(agent.id);
    if (!didKill) {
      flash(agent._dead ? 'Agent is already stopped' : 'Could not stop agent', { tone: 'error' });
      return;
    }
    flash(`Stopping ${getAgentDisplayLabel(agent, liveAgentNameCounts)}`, { tone: 'info' });
  }

  function handleRemoveAgent(agent, liveAgentNameCounts) {
    if (!agent?._managed) return;
    const removed = removeAgent(agent.id);
    if (removed) {
      flash(`Removed ${getAgentDisplayLabel(agent, liveAgentNameCounts)}`, { tone: 'success' });
    } else {
      flash('Agent removal failed. It may have already exited.', { tone: 'error' });
    }
    return removed;
  }

  function handleRestartAgent(agent) {
    if (!agent?._managed || !agent._dead) return false;
    const removed = removeAgent(agent.id);
    if (!removed) {
      flash('Restart failed. Try stopping and launching a new agent.', { tone: 'error' });
      return false;
    }
    launchManagedTask({
      id: agent.tool,
      name: agent.toolName || agent._display,
      cmd: agent.cmd,
      args: agent.args,
      taskArg: agent.taskArg,
    }, agent.task);
    return true;
  }

  function handleFixLauncher(tool) {
    const fixTool = tool || unavailableCliAgents[0];
    if (!fixTool) {
      flash('No fix action is available', { tone: 'warning' });
      return;
    }

    const status = getManagedToolState(fixTool.id);
    if (!status.recoveryCommand) {
      flash(`${fixTool.name} does not have an automatic fix action`, { tone: 'warning' });
      return;
    }

    const result = openCommandInTerminal(status.recoveryCommand, projectRoot);
    if (result.ok) {
      flash(`Opened ${fixTool.name} fix flow. Run /recheck when done.`, { tone: 'info' });
    } else {
      flash(`Run \`${status.recoveryCommand}\` manually, then /recheck.`, { tone: 'warning' });
    }
  }

  function handleToolPickerSelect(idx) {
    const tools = readyCliAgents.length > 0 ? readyCliAgents : installedCliAgents;
    const tool = tools[idx];
    if (tool) handleSpawnAgent(tool, '', { flashSuccess: true });
    setToolPickerOpen(false);
  }

  function openToolPicker() {
    const tools = readyCliAgents.length > 0 ? readyCliAgents : installedCliAgents;
    if (tools.length === 0) {
      flash('No tools configured. Run chinwag add <tool>.', { tone: 'warning' });
    } else if (tools.length === 1) {
      handleSpawnAgent(tools[0], '', { flashSuccess: true });
    } else {
      setToolPickerIdx(0);
      setToolPickerOpen(true);
    }
  }

  return {
    managedAgents,
    managedToolStates,
    installedCliAgents,
    toolPickerOpen,
    setToolPickerOpen,
    toolPickerIdx,
    setToolPickerIdx,
    launchToolId,
    readyCliAgents,
    unavailableCliAgents,
    checkingCliAgents,
    selectedLaunchTool,
    canLaunchSelectedTool,
    launcherChoices,
    getManagedToolState,
    handleSpawnAgent,
    launchManagedTask,
    handleKillAgent,
    handleRemoveAgent,
    handleRestartAgent,
    handleFixLauncher,
    refreshManagedToolStates,
    resolveReadyTool,
    rememberLaunchTool,
    selectLaunchTool,
    cycleToolForward,
    handleToolPickerSelect,
    openToolPicker,
  };
}

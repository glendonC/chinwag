import { useState, useRef, useEffect } from 'react';
import { spawnAgent, killAgent, getAgents, getOutput, onUpdate, removeAgent } from './process-manager.js';
import {
  checkManagedAgentToolAvailability,
  classifyManagedAgentFailure,
  createManagedAgentLaunch,
  listManagedAgentTools,
} from './managed-agents.js';
import {
  getSavedLauncherPreference,
  resolvePreferredManagedTool,
  saveLauncherPreference,
} from './launcher-preferences.js';
import { openCommandInTerminal } from './open-command-in-terminal.js';
import { formatFiles, shortAgentId } from './dashboard-view.js';

/**
 * Custom hook for agent lifecycle management in the dashboard.
 *
 * Encapsulates:
 * - Managed agent process tracking (spawn, kill, remove, restart)
 * - Tool availability checking
 * - Launcher preference tracking
 * - Agent display helpers
 */
export function useAgentLifecycle({ config, teamId, projectRoot, stdout, onFlash }) {
  // Process manager state
  const [managedAgents, setManagedAgents] = useState([]);
  const previousManagedStatuses = useRef(new Map());
  const [managedToolStates, setManagedToolStates] = useState({});
  const [managedToolStatusTick, setManagedToolStatusTick] = useState(0);

  // CLI agents
  const [installedCliAgents] = useState(() => listManagedAgentTools());

  // Launcher preference
  const [preferredLaunchToolId, setPreferredLaunchToolId] = useState(null);
  const [launchToolId, setLaunchToolId] = useState(null);

  // ── Process manager sync + duration ticker ───────────
  useEffect(() => {
    setManagedAgents(getAgents());
    const unsub = onUpdate(() => setManagedAgents(getAgents()));
    // Tick every 10s to update duration display
    const ticker = setInterval(() => setManagedAgents(getAgents()), 10000);
    return () => { unsub(); clearInterval(ticker); };
  }, []);

  // ── Managed tool availability checking ───────────────
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

  // ── Detect agent status changes → flash notifications ──
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
        onFlash(
          failureStatus?.detail
            || (agent.status === 'exited'
              ? `${agent.toolName} finished${preview}`
              : `${agent.toolName} failed${preview}`),
          { tone: agent.status === 'exited' ? 'success' : 'warning', autoClearMs: 5000 }
        );
      }
      previous.set(agent.id, agent.status);
    }

    const liveIds = new Set(managedAgents.map(agent => agent.id));
    for (const id of [...previous.keys()]) {
      if (!liveIds.has(id)) previous.delete(id);
    }
  }, [managedAgents]);

  // ── Load saved launcher preference ──────────────────
  useEffect(() => {
    if (!teamId) return;
    setPreferredLaunchToolId(getSavedLauncherPreference(teamId));
  }, [teamId]);

  // ── Helpers ─────────────────────────────────────────

  function getManagedToolState(toolId) {
    return managedToolStates[toolId] || { toolId, state: 'checking', detail: 'Checking readiness' };
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
    onFlash('Rechecking tools you can start...', { tone: 'info', autoClearMs: 3000 });
  }

  function rememberLaunchTool(toolId) {
    if (!teamId || !toolId) return;
    if (saveLauncherPreference(teamId, toolId)) {
      setPreferredLaunchToolId(toolId);
    }
  }

  function handleSpawnAgent(toolInfo, task, options = {}) {
    if (!toolInfo || !task.trim()) return false;
    const {
      flashSuccess = true,
      successMessage = `Started ${toolInfo.name}`,
    } = options;
    const toolState = getManagedToolState(toolInfo.id);
    if (toolState.state !== 'ready') {
      const recoveryHint = toolState.recoveryCommand ? ` Run \`${toolState.recoveryCommand}\`.` : '';
      onFlash(`${toolState.detail || `${toolInfo.name} is not ready`}.${recoveryHint}`, { tone: 'warning' });
      return false;
    }

    try {
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
        onFlash(`Failed to start ${toolInfo.name}`, { tone: 'error' });
        return false;
      }
      if (flashSuccess) {
        onFlash(successMessage, { tone: 'success', autoClearMs: 4000 });
      }
      return true;
    } catch (err) {
      onFlash(err?.message || `Failed to start ${toolInfo.name}`, { tone: 'error' });
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

  function handleKillAgent(agent, { getAgentDisplayLabel, view, setView, setFocusedAgent } = {}) {
    if (!agent?._managed) return;
    const didKill = killAgent(agent.id);
    if (!didKill) {
      onFlash(agent._dead ? 'Agent is already stopped' : 'Could not stop agent', { tone: 'error' });
      return;
    }

    const label = getAgentDisplayLabel ? getAgentDisplayLabel(agent) : agent._display || 'agent';
    onFlash(`Stopping ${label}`, { tone: 'info', autoClearMs: 4000 });
    if (view === 'agent-focus' && setView && setFocusedAgent) {
      setView('home');
      setFocusedAgent(null);
    }
  }

  function handleRemoveAgent(agent, { getAgentDisplayLabel, view, setView, setFocusedAgent } = {}) {
    if (!agent?._managed) return;
    const removed = removeAgent(agent.id);
    if (removed) {
      const label = getAgentDisplayLabel ? getAgentDisplayLabel(agent) : agent._display || 'agent';
      onFlash(`Removed ${label}`, { tone: 'success', autoClearMs: 4000 });
      if (view === 'agent-focus' && setView && setFocusedAgent) {
        setView('home');
        setFocusedAgent(null);
      }
    } else {
      onFlash('Could not remove agent', { tone: 'error' });
    }
  }

  function handleRestartAgent(agent, { view, setView, setFocusedAgent } = {}) {
    if (!agent?._managed || !agent._dead) return;

    const removed = removeAgent(agent.id);
    if (!removed) {
      onFlash('Could not restart agent', { tone: 'error' });
      return;
    }

    if (view === 'agent-focus' && setView && setFocusedAgent) {
      setView('home');
      setFocusedAgent(null);
    }

    launchManagedTask({
      id: agent.tool,
      name: agent.toolName || agent._display,
      cmd: agent.cmd,
      args: agent.args,
      taskArg: agent.taskArg,
    }, agent.task);
  }

  function handleFixLauncher(tool) {
    const target = tool || unavailableCliAgents[0];
    if (!target) {
      onFlash('No fix action is available', { tone: 'warning' });
      return;
    }

    const status = getManagedToolState(target.id);
    if (!status.recoveryCommand) {
      onFlash(`${target.name} does not have an automatic fix action`, { tone: 'warning' });
      return;
    }

    const result = openCommandInTerminal(status.recoveryCommand, projectRoot);
    if (result.ok) {
      onFlash(`Opened ${target.name} fix flow. Finish it, then press [u].`, { tone: 'info', autoClearMs: 5000 });
    } else {
      onFlash(`Run \`${status.recoveryCommand}\` manually, then press [u].`, { tone: 'warning' });
    }
  }

  // ── Derived state ───────────────────────────────────

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

  // Clamp launchToolId
  useEffect(() => {
    if (launchToolId && installedCliAgents.some(tool => tool.id === launchToolId)) return;

    const fallbackTool = preferredLaunchTool || readyCliAgents[0] || installedCliAgents[0] || null;
    if (fallbackTool) {
      setLaunchToolId(fallbackTool.id);
    }
  }, [launchToolId, installedCliAgents, preferredLaunchTool, readyCliAgents]);

  // ── Agent display helpers ───────────────────────────

  function isAgentAddressable(agent) {
    if (!agent?.agent_id) return false;
    if (agent._managed) return agent.status === 'running';
    return agent.status === 'active';
  }

  function getAgentTargetLabel(agent) {
    if (!agent) return 'agent';
    if (agent.handle && agent._display) return `${agent.handle} (${agent._display})`;
    return agent.handle || agent._display || 'agent';
  }

  function getAgentIntent(agent) {
    if (!agent) return null;
    if (agent._managed && agent._dead && agent.outputPreview) return agent.outputPreview;
    if (agent._summary) return agent._summary;
    const files = formatFiles(agent.activity?.files || []);
    if (files) return `Working in ${files}`;
    if (agent._managed && agent.task) return `Delegated task: ${agent.task}`;
    return 'Idle';
  }

  function getAgentOriginLabel(agent) {
    if (!agent) return null;
    if (agent._managed) {
      return agent._connected ? 'started here' : 'starting here';
    }
    return 'joined automatically';
  }

  function getAgentDisplayLabel(agent, liveAgentNameCounts) {
    if (!agent) return 'agent';
    const baseLabel = agent._display || agent.toolName || agent.tool || 'agent';
    if ((liveAgentNameCounts.get(baseLabel) || 0) <= 1) return baseLabel;
    const suffix = shortAgentId(agent.agent_id) || String(agent.id || '').slice(-4);
    return suffix ? `${baseLabel} #${suffix}` : baseLabel;
  }

  function getIntentColor(intent) {
    if (!intent) return 'gray';
    if (/idle/i.test(intent)) return 'yellow';
    if (/error|failed|blocked|conflict/i.test(intent)) return 'red';
    return 'cyan';
  }

  function getAgentMeta(agent) {
    if (!agent) return null;

    const parts = [];
    parts.push(getAgentOriginLabel(agent));

    const files = formatFiles(agent.activity?.files || []);
    if (files) parts.push(files);

    if (agent.minutes_since_update != null && agent.minutes_since_update > 0) {
      parts.push(`updated ${Math.round(agent.minutes_since_update)}m ago`);
    }

    return parts.join(' · ');
  }

  function getRecentResultSummary(agent) {
    const status = getManagedToolState(agent.toolId);
    if (agent._failed && status.detail) return status.detail;
    if (agent.outputPreview) return agent.outputPreview;
    if (agent.task) return agent.task;
    return agent._failed ? 'Task failed' : 'Task completed';
  }

  function selectLaunchTool(tool, { startCompose = false, draftText = '', onStartCompose } = {}) {
    if (!tool) return;
    setLaunchToolId(tool.id);
    if (startCompose && onStartCompose) {
      onStartCompose(draftText);
    }
  }

  return {
    managedAgents,
    installedCliAgents,
    readyCliAgents,
    unavailableCliAgents,
    checkingCliAgents,
    preferredLaunchTool,
    selectedLaunchTool,
    selectedLaunchToolState,
    canLaunchSelectedTool,
    launcherChoices,
    launchToolId,
    setLaunchToolId,
    getManagedToolState,
    refreshManagedToolStates,
    handleSpawnAgent,
    launchManagedTask,
    handleKillAgent,
    handleRemoveAgent,
    handleRestartAgent,
    handleFixLauncher,
    selectLaunchTool,
    isAgentAddressable,
    getAgentTargetLabel,
    getAgentIntent,
    getAgentOriginLabel,
    getAgentDisplayLabel,
    getIntentColor,
    getAgentMeta,
    getRecentResultSummary,
  };
}

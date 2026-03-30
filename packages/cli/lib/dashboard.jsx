import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { basename } from 'path';
import { api } from './api.js';
import {
  buildCombinedAgentRows,
  buildDashboardView,
  formatFiles,
  shortAgentId,
} from './dashboard-view.js';
import { openCommandInTerminal } from './open-command-in-terminal.js';
import { spawnAgent, killAgent, getAgents, getOutput, onUpdate, removeAgent, registerExternalAgent, setExternalAgentPid, checkExternalAgentLiveness } from './process-manager.js';
import { spawnInTerminal, detectTerminalEnvironment, readPidFile, cleanPidFile } from './terminal-spawner.js';
import {
  HintRow,
  NoticeLine,
} from './dashboard-ui.jsx';
import {
  KnowledgePanel,
  SessionsPanel,
} from './dashboard-sections.jsx';
import {
  checkManagedAgentToolAvailability,
  classifyManagedAgentFailure,
  createManagedAgentLaunch,
  createTerminalAgentLaunch,
  listManagedAgentTools,
} from './managed-agents.js';
import {
  getSavedLauncherPreference,
  resolvePreferredManagedTool,
  saveLauncherPreference,
} from './launcher-preferences.js';
import { useDashboardConnection } from './dashboard-connection.jsx';
import { AgentFocusView } from './dashboard-agent-focus.jsx';
import {
  MIN_WIDTH, SPINNER,
  openWebDashboard, getVisibleWindow, formatProjectPath,
} from './dashboard-utils.js';
import {
  isAgentAddressable, getAgentTargetLabel, getAgentIntent,
  getAgentDisplayLabel, getIntentColor,
} from './dashboard-agent-display.js';

export function Dashboard({ config, navigate, layout, projectLabel = null, appVersion = '0.1.0', setFooterHints }) {
  const { stdout } = useStdout();
  const viewportRows = layout?.viewportRows || 18;

  // ── Connection + project state (hook) ──────────────
  const connection = useDashboardConnection({ config, stdout });
  const {
    teamId, teamName, projectRoot, detectedTools,
    context, error, connState, connDetail, spinnerFrame, cols,
    consecutiveFailures, retry: connectionRetry, bumpRefreshKey,
    setError, setConnState,
  } = connection;

  // Navigation state
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [mainFocus, setMainFocus] = useState('input');
  const [view, setView] = useState('home');
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  // Hero input bar state
  const [heroInput, setHeroInput] = useState('');
  const [heroInputActive, setHeroInputActive] = useState(false);
  const [commandSelectedIdx, setCommandSelectedIdx] = useState(0);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [toolPickerIdx, setToolPickerIdx] = useState(0);

  // Memory management
  const [memorySelectedIdx, setMemorySelectedIdx] = useState(-1);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState(null);

  // Memory search
  const [memorySearch, setMemorySearch] = useState('');

  // Memory add
  const [memoryInput, setMemoryInput] = useState('');

  // View: 'home' | 'sessions' | 'memory' | 'agent-focus'
  const [focusedAgent, setFocusedAgent] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Composer: null | 'command' | 'targeted' | 'memory-search' | 'memory-add'
  const [composeMode, setComposeMode] = useState(null);
  const [composeText, setComposeText] = useState('');
  const [composeTarget, setComposeTarget] = useState(null);
  const [composeTargetLabel, setComposeTargetLabel] = useState(null);
  const [launchToolId, setLaunchToolId] = useState(null);
  const [preferredLaunchToolId, setPreferredLaunchToolId] = useState(null);

  // Process manager state
  const [managedAgents, setManagedAgents] = useState([]);
  const previousManagedStatuses = useRef(new Map());
  const [managedToolStates, setManagedToolStates] = useState({});
  const [managedToolStatusTick, setManagedToolStatusTick] = useState(0);

  // CLI agents
  const [installedCliAgents] = useState(() => listManagedAgentTools());


  // ── Process manager sync + duration ticker ───────────
  useEffect(() => {
    setManagedAgents(getAgents());
    const unsub = onUpdate(() => setManagedAgents(getAgents()));
    // Tick every 10s to update duration display
    const ticker = setInterval(() => setManagedAgents(getAgents()), 10000);
    return () => { unsub(); clearInterval(ticker); };
  }, []);

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

  useEffect(() => () => {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
  }, []);

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
        // Try to resolve PID from pidfile if we don't have it yet
        if (!agent.pid && agent.agentId) {
          const pid = readPidFile(agent.agentId);
          if (pid) setExternalAgentPid(agent.id, pid);
        }
      }
      // Check liveness of all external agents with known PIDs
      const prev = externalAgentPrevStatus.current;
      const changed = checkExternalAgentLiveness();
      if (changed) {
        // Quick-exit detection: if a terminal agent died within 15s of spawn,
        // it likely hit an auth or config error — re-check that tool's state
        const now = Date.now();
        for (const agent of getAgents()) {
          if (agent.spawnType !== 'external') continue;
          const was = prev.get(agent.id);
          if (was === 'running' && agent.status !== 'running') {
            const age = now - (agent.startedAt || 0);
            if (age < 15000 && agent.toolId) {
              flash(`${agent.toolName || agent.toolId} exited immediately. Press [f] to fix.`, { tone: 'warning' });
              setManagedToolStatusTick(t => t + 1); // triggers re-check
            }
          }
        }
      }
      // Always update tracked status for next tick
      for (const agent of getAgents()) {
        if (agent.spawnType === 'external') prev.set(agent.id, agent.status);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // ── Footer bar commands (pushed to shell) ───────────
  const isComposing = Boolean(composeMode);
  useEffect(() => {
    if (!setFooterHints) return;
    if (isComposing) {
      setFooterHints([{ key: 'esc', label: 'back' }, { key: 'q', label: 'quit', color: 'gray' }]);
    } else {
      const ready = installedCliAgents.filter(t => getManagedToolState(t.id).state === 'ready');
      const primary = ready[0] || installedCliAgents[0];
      const nLabel = primary
        ? (ready.length > 1 ? 'open agent' : `open ${primary.name}`)
        : 'open agent';
      setFooterHints([
        { key: 'n', label: nLabel, color: 'green' },
        { key: 'w', label: 'web' },
        { key: '/', label: 'more' },
        { key: 'q', label: 'quit', color: 'gray' },
      ]);
    }
  }, [isComposing, installedCliAgents, managedToolStates]);

  // ── Helpers ──────────────────────────────────────────

  function flash(msg, opts = {}) {
    const tone = typeof opts === 'object' ? opts.tone || 'info' : 'info';
    // Messages persist until replaced by another flash or cleared by user action.
    // Only auto-clear if explicitly requested via autoClearMs.
    const autoClearMs = typeof opts === 'object' ? opts.autoClearMs : null;

    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }

    setNotice({ text: msg, tone });

    if (autoClearMs && autoClearMs > 0) {
      noticeTimer.current = setTimeout(() => {
        setNotice(current => (current?.text === msg ? null : current));
        noticeTimer.current = null;
      }, autoClearMs);
    }
  }

  function clearCompose() {
    const previousMode = composeMode;
    setComposeMode(null);
    setComposeText('');
    setComposeTarget(null);
    setComposeTargetLabel(null);
    if (previousMode === 'memory-search') {
      setMemorySearch('');
    }
    if (previousMode === 'memory-add') {
      setMemoryInput('');
    }
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

  function getManagedToolState(toolId) {
    return managedToolStates[toolId] || { toolId, state: 'checking', detail: 'Checking readiness' };
  }


  function beginTargetedMessage(agent) {
    if (!isAgentAddressable(agent)) {
      flash('Select a running agent to message directly', { tone: 'warning' });
      return;
    }

    setComposeTarget(agent.agent_id);
    setComposeTargetLabel(getAgentTargetLabel(agent));
    setComposeMode('targeted');
    setComposeText('');
  }

  function beginCommandInput(initialText = '') {
    setComposeMode('command');
    setComposeText(initialText);
    setCommandSelectedIdx(0);
  }

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

  function handleCommandSubmit(rawText) {
    const text = rawText.trim().replace(/^\//, '').trim();
    if (!text) {
      clearCompose();
      return;
    }

    const [verbRaw, ...restParts] = text.split(/\s+/);
    const verb = verbRaw.toLowerCase();
    const rest = restParts.join(' ').trim();

    if (verb === 'new' || verb === 'start') {
      // /new <tool> — launch specific tool
      // /new — launch first ready tool
      const explicitTool = rest ? resolveReadyTool(rest) : null;
      const tool = explicitTool || selectedLaunchTool || readyCliAgents[0];
      if (tool) {
        launchManagedTask(tool, '');
      } else {
        flash('No tools ready. Run /recheck.', { tone: 'warning' });
      }
      clearCompose();
      return;
    }

    if (verb === 'fix') {
      handleFixLauncher();
      clearCompose();
      return;
    }

    if (verb === 'recheck' || verb === 'refresh') {
      refreshManagedToolStates({ clearRuntimeFailures: true });
      clearCompose();
      return;
    }

    if (verb === 'knowledge' || verb === 'memory') {
      setView('memory');
      setMemorySelectedIdx(-1);
      clearCompose();
      return;
    }

    if (verb === 'sessions' || verb === 'agents' || verb === 'history') {
      setView('sessions');
      setSelectedIdx(liveAgents.length > 0 ? 0 : -1);
      clearCompose();
      return;
    }

    if (verb === 'web' || verb === 'dashboard') {
      const result = openWebDashboard(config?.token);
      flash(result.ok ? 'Opened web dashboard' : 'Could not open browser', { tone: result.ok ? 'success' : 'error' });
      clearCompose();
      return;
    }

    if (verb === 'message') {
      if (selectedAgent && isAgentAddressable(selectedAgent)) {
        beginTargetedMessage(selectedAgent);
      } else {
        flash('Select a live agent to message.', { tone: 'warning' });
        clearCompose();
      }
      return;
    }

    if (verb === 'help') {
      flash('Try /new, /recheck, /memory, /web, or /sessions.', { tone: 'info' });
      clearCompose();
      return;
    }

    if (selectedLaunchTool && canLaunchSelectedTool) {
      launchManagedTask(selectedLaunchTool, text);
      clearCompose();
      return;
    }

    setHeroInput(text);
    setHeroInputActive(true);
    setMainFocus('input');
    clearCompose();
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
  const isHomeView = view === 'home';
  const isSessionsView = view === 'sessions';
  const isMemoryView = view === 'memory';
  const isAgentFocusView = view === 'agent-focus';
  const launcherChoices = readyCliAgents.length > 0 ? readyCliAgents : installedCliAgents;

  // ── API actions ──────────────────────────────────────

  function sendMessage(text, target, targetLabel = null) {
    if (!teamId || !text.trim()) return;
    api(config).post(`/teams/${teamId}/messages`, { text: text.trim(), target: target || undefined })
      .then(() => {
        flash(targetLabel ? `Sent to ${targetLabel}` : 'Sent to team', { tone: 'success' });
        bumpRefreshKey();
      })
      .catch(() => flash('Message not sent. Check connection.', { tone: 'error' }));
  }

  function saveMemory(text) {
    if (!teamId || !text.trim()) return;
    api(config).post(`/teams/${teamId}/memory`, { text: text.trim() })
      .then(() => { flash('Saved to shared memory', { tone: 'success' }); bumpRefreshKey(); })
      .catch(() => flash('Memory not saved. Check connection.', { tone: 'error' }));
  }

  function deleteMemoryItem(mem) {
    if (!mem?.id || !teamId) return;
    api(config).del(`/teams/${teamId}/memory`, { id: mem.id })
      .then(() => {
        setDeleteMsg('Deleted');
        setDeleteConfirm(false);
        setMemorySelectedIdx(-1);
        bumpRefreshKey();
        setTimeout(() => setDeleteMsg(null), 2000);
      })
      .catch(() => {
        setDeleteMsg('Delete failed');
        setDeleteConfirm(false);
        setTimeout(() => setDeleteMsg(null), 2000);
      });
  }

  function handleSpawnAgent(toolInfo, task = '', options = {}) {
    if (!toolInfo) return false;
    const {
      flashSuccess = true,
    } = options;
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

  function handleKillAgent(agent) {
    if (!agent?._managed) return;
    const didKill = killAgent(agent.id);
    if (!didKill) {
      flash(agent._dead ? 'Agent is already stopped' : 'Could not stop agent', { tone: 'error' });
      return;
    }

    flash(`Stopping ${getAgentDisplayLabel(agent, liveAgentNameCounts)}`, { tone: 'info' });
    if (view === 'agent-focus') {
      setView('home');
      setFocusedAgent(null);
    }
  }

  function handleRemoveAgent(agent) {
    if (!agent?._managed) return;
    const removed = removeAgent(agent.id);
    if (removed) {
      flash(`Removed ${getAgentDisplayLabel(agent, liveAgentNameCounts)}`, { tone: 'success' });
      if (view === 'agent-focus') {
        setView('home');
        setFocusedAgent(null);
      }
    } else {
      flash('Agent removal failed. It may have already exited.', { tone: 'error' });
    }
  }

  function handleRestartAgent(agent) {
    if (!agent?._managed || !agent._dead) return;

    const removed = removeAgent(agent.id);
    if (!removed) {
      flash('Restart failed. Try stopping and launching a new agent.', { tone: 'error' });
      return;
    }

    if (view === 'agent-focus') {
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

  function handleFixLauncher(tool = unavailableCliAgents[0]) {
    if (!tool) {
      flash('No fix action is available', { tone: 'warning' });
      return;
    }

    const status = getManagedToolState(tool.id);
    if (!status.recoveryCommand) {
      flash(`${tool.name} does not have an automatic fix action`, { tone: 'warning' });
      return;
    }

    const result = openCommandInTerminal(status.recoveryCommand, projectRoot);
    if (result.ok) {
      flash(`Opened ${tool.name} fix flow. Run /recheck when done.`, { tone: 'info' });
    } else {
      flash(`Run \`${status.recoveryCommand}\` manually, then /recheck.`, { tone: 'warning' });
    }
  }

  function handleOpenWebDashboard() {
    const result = openWebDashboard(config?.token);
    flash(
      result.ok ? 'Opened web dashboard' : `Could not open browser${result.error ? `: ${result.error}` : ''}`,
      result.ok ? { tone: 'success' } : { tone: 'error' }
    );
  }

  // ── Data ─────────────────────────────────────────────

  const {
    getToolName,
    conflicts,
    memories,
    filteredMemories,
    visibleMemories,
    visibleAgents,
  } = buildDashboardView({
    context,
    detectedTools,
    memoryFilter: null,
    memorySearch: composeMode === 'memory-search' ? memorySearch : '',
    cols,
    projectDir: teamName || basename(process.cwd()),
  });

  const combinedAgents = buildCombinedAgentRows({
    managedAgents,
    connectedAgents: visibleAgents,
    getToolName,
  });
  const liveAgents = combinedAgents.filter(agent => !agent._dead);
  // Keep recently-finished agents visible so user can see results
  const recentlyFinished = combinedAgents
    .filter(agent => agent._managed && agent._dead)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, 3);
  const allVisibleAgents = [...liveAgents, ...recentlyFinished];
  const recentManagedResults = recentlyFinished;
  const selectedAgent = selectedIdx >= 0 ? allVisibleAgents[selectedIdx] : null;
  const mainSelectedAgent = mainFocus === 'agents' ? selectedAgent : null;
  const knowledgeVisible = view === 'memory' || composeMode === 'memory-search' || composeMode === 'memory-add'
    ? visibleMemories
    : visibleMemories.slice(0, Math.min(1, visibleMemories.length));
  const duplicateIssueToolIds = new Set(unavailableCliAgents.map(tool => tool.id));
  const recentResult = recentManagedResults.find(agent => !duplicateIssueToolIds.has(agent.toolId)) || null;

  const hasLiveAgents = liveAgents.length > 0;
  const hasRecentManagedResults = Boolean(recentResult);
  const hasMemories = memories.length > 0;
  const projectDisplayName = formatProjectPath(projectRoot);
  const liveAgentNameCounts = liveAgents.reduce((counts, agent) => {
    counts.set(agent._display, (counts.get(agent._display) || 0) + 1);
    return counts;
  }, new Map());
  const visibleSessionRows = getVisibleWindow(allVisibleAgents, selectedIdx, Math.max(4, viewportRows - 11));
  const visibleKnowledgeRows = getVisibleWindow(knowledgeVisible, memorySelectedIdx, Math.max(4, viewportRows - 11));
  const commandEntries = [
    { name: '/new', description: 'Open a tool in a new terminal tab' },
    ...(unavailableCliAgents.some(tool => getManagedToolState(tool.id).recoveryCommand)
      ? [{ name: '/fix', description: 'Open the main setup fix flow' }]
      : []),
    ...(installedCliAgents.length > 0
      ? [{ name: '/recheck', description: 'Refresh available tools and setup state' }]
      : []),
    ...(hasMemories
      ? [{ name: '/knowledge', description: 'View shared knowledge' }]
      : []),
    ...(hasLiveAgents
      ? [{ name: '/history', description: 'View past agent activity' }]
      : []),
    { name: '/web', description: 'Open chinwag in browser' },
    ...(selectedAgent && isAgentAddressable(selectedAgent)
      ? [{ name: '/message', description: `Message ${selectedAgent._display}` }]
      : []),
    { name: '/help', description: 'Show command help' },
  ];
  const commandQuery = composeMode === 'command'
    ? composeText.trim().replace(/^\//, '').toLowerCase()
    : '';
  const commandSuggestions = composeMode === 'command'
    ? commandEntries.filter((entry) => {
        if (!commandQuery) return true;
        const normalized = entry.name.slice(1).toLowerCase();
        return normalized.startsWith(commandQuery) || entry.description.toLowerCase().includes(commandQuery);
      })
    : [];

  // Clamp selection indices
  useEffect(() => {
    if (allVisibleAgents.length === 0) {
      if (selectedIdx !== -1) setSelectedIdx(-1);
      if (mainFocus === 'agents') setMainFocus('input');
      return;
    }
    if (selectedIdx >= allVisibleAgents.length) {
      setSelectedIdx(allVisibleAgents.length > 0 ? allVisibleAgents.length - 1 : -1);
    }
  }, [selectedIdx, allVisibleAgents.length, mainFocus]);

  useEffect(() => {
    if (memorySelectedIdx >= visibleMemories.length) {
      setMemorySelectedIdx(visibleMemories.length > 0 ? visibleMemories.length - 1 : -1);
    }
  }, [memorySelectedIdx, visibleMemories.length]);

  useEffect(() => {
    if (launchToolId && installedCliAgents.some(tool => tool.id === launchToolId)) return;

    const fallbackTool = preferredLaunchTool || readyCliAgents[0] || installedCliAgents[0] || null;
    if (fallbackTool) {
      setLaunchToolId(fallbackTool.id);
    }
  }, [launchToolId, installedCliAgents, preferredLaunchTool, readyCliAgents]);

  // ── Input handling ───────────────────────────────────

  useInput((input, key) => {
    if (cols < MIN_WIDTH) {
      if (input === 'q') navigate('quit');
      return;
    }

    // ── Retry on error/loading screens ────────────────
    if (input === 'r' && (error || !context)) {
      connectionRetry();
      return;
    }

    // ── Agent focus mode input ─────────────────────────
    if (isAgentFocusView) {
      if (key.escape) {
        setView('home');
        setFocusedAgent(null);
        setShowDiagnostics(false);
        return;
      }
      if (input === 'x' && focusedAgent?._managed) {
        if (focusedAgent._dead) {
          handleRemoveAgent(focusedAgent);
        } else {
          handleKillAgent(focusedAgent);
        }
        return;
      }
      if (input === 'r' && focusedAgent?._managed && focusedAgent._dead) {
        handleRestartAgent(focusedAgent);
        return;
      }
      if (input === 'l' && focusedAgent?._managed) {
        setShowDiagnostics(prev => !prev);
        return;
      }
      if (input === 'm' && isAgentAddressable(focusedAgent)) {
        setView('home');
        setFocusedAgent(null);
        setShowDiagnostics(false);
        beginTargetedMessage(focusedAgent);
        return;
      }
      return;
    }


    // When composing text in secondary modes
    if (isComposing) {
      if (key.escape) { clearCompose(); return; }
      // Arrow navigation in command palette
      if (composeMode === 'command') {
        if (key.downArrow) {
          setCommandSelectedIdx(i => Math.min(i + 1, Math.min(commandSuggestions.length - 1, 5)));
          return;
        }
        if (key.upArrow) {
          setCommandSelectedIdx(i => Math.max(i - 1, 0));
          return;
        }
      }
      return;
    }

    // ── Tool picker overlay ─────────────────────────────
    if (toolPickerOpen) {
      const tools = readyCliAgents.length > 0 ? readyCliAgents : installedCliAgents;
      if (key.escape) { setToolPickerOpen(false); return; }
      if (key.downArrow) { setToolPickerIdx(i => Math.min(i + 1, tools.length - 1)); return; }
      if (key.upArrow) { setToolPickerIdx(i => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const tool = tools[toolPickerIdx];
        if (tool) handleSpawnAgent(tool, '', { flashSuccess: true });
        setToolPickerOpen(false);
        return;
      }
      return;
    }

    // ── Home view input ───────────────────────────────
    if (isHomeView) {
      // [n] opens tool or tool picker
      if (input === 'n') {
        const tools = readyCliAgents.length > 0 ? readyCliAgents : installedCliAgents;
        if (tools.length === 0) {
          flash('No tools configured. Run chinwag add <tool>.', { tone: 'warning' });
        } else if (tools.length === 1) {
          handleSpawnAgent(tools[0], '', { flashSuccess: true });
        } else {
          setToolPickerIdx(0);
          setToolPickerOpen(true);
        }
        return;
      }

      if (key.downArrow) {
        if (mainFocus === 'input' && allVisibleAgents.length > 0) {
          setMainFocus('agents');
          setSelectedIdx(prev => prev >= 0 ? prev : 0);
          return;
        }
        if (mainFocus === 'agents' && allVisibleAgents.length > 0) {
          setSelectedIdx(prev => Math.min((prev < 0 ? 0 : prev) + 1, allVisibleAgents.length - 1));
          return;
        }
      }
      if (key.upArrow) {
        if (mainFocus === 'agents' && selectedIdx > 0) {
          setSelectedIdx(prev => Math.max(prev - 1, 0));
          return;
        }
        if (mainFocus === 'agents') {
          setMainFocus('input');
          return;
        }
      }
      if (key.return && mainSelectedAgent) {
        setFocusedAgent(mainSelectedAgent);
        setView('agent-focus');
        setShowDiagnostics(false);
        return;
      }
      if (input === 'm' && mainSelectedAgent && isAgentAddressable(mainSelectedAgent)) {
        beginTargetedMessage(mainSelectedAgent);
        return;
      }
      if (input === 'x' && mainSelectedAgent?._managed && !mainSelectedAgent._dead) {
        handleKillAgent(mainSelectedAgent);
        return;
      }
    }

    if (input === 's' && hasLiveAgents) {
      setView('sessions');
      setSelectedIdx(prev => prev >= 0 ? prev : 0);
      return;
    }

    // [w] — open web dashboard
    if (input === 'w') {
      handleOpenWebDashboard();
      return;
    }

    // Knowledge focus toggle
    if (input === 'k' && hasMemories) {
      setView(prev => prev === 'memory' ? 'home' : 'memory');
      setSelectedIdx(-1);
      setMemorySelectedIdx(-1);
      setDeleteConfirm(false);
      return;
    }

    // Agent section navigation
    if (isSessionsView) {
      if (key.downArrow && liveAgents.length > 0) {
        setSelectedIdx(prev => Math.min(prev + 1, liveAgents.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIdx(prev => prev <= 0 ? -1 : prev - 1);
        return;
      }
      if (key.escape) {
        setView('home');
        return;
      }

      // Enter on selected agent -> focus mode
      if (key.return) {
        if (selectedIdx >= 0 && selectedIdx < allVisibleAgents.length) {
          const agent = liveAgents[selectedIdx];
          setFocusedAgent(agent);
          setView('agent-focus');
          setShowDiagnostics(false);
          return;
        }
        return;
      }

      // [x] on selected managed agent -> stop (running) or remove (exited)
      if (input === 'x' && selectedIdx >= 0) {
        const agent = liveAgents[selectedIdx];
        if (agent?._managed) {
          if (agent._dead) {
            handleRemoveAgent(agent);
          } else {
            handleKillAgent(agent);
          }
          return;
        }
      }

      if (input === 'r' && selectedIdx >= 0) {
        const agent = liveAgents[selectedIdx];
        if (agent?._managed && agent._dead) {
          handleRestartAgent(agent);
          return;
        }
      }
    }

    // Memory section navigation
    if (isMemoryView) {
      if (key.downArrow && visibleMemories.length > 0) {
        setMemorySelectedIdx(prev => Math.min(prev + 1, visibleMemories.length - 1));
        setDeleteConfirm(false);
        return;
      }
      if (key.upArrow) {
        setMemorySelectedIdx(prev => prev <= 0 ? -1 : prev - 1);
        setDeleteConfirm(false);
        return;
      }
      if (key.escape) {
        if (deleteConfirm) { setDeleteConfirm(false); return; }
        setView('home');
        return;
      }
    }

    if (input === 'f' && unavailableCliAgents.some(tool => getManagedToolState(tool.id).recoveryCommand)) {
      handleFixLauncher(unavailableCliAgents.find(tool => getManagedToolState(tool.id).recoveryCommand));
      return;
    }

    // [/] — command palette or memory search
    if (input === '/') {
      if (isHomeView || isSessionsView) {
        beginCommandInput('');
        return;
      }
      if (isMemoryView) {
        setComposeMode('memory-search');
        return;
      }
    }

    // [a] — add memory
    if (input === 'a' && isMemoryView) {
      setComposeMode('memory-add');
      setMemoryInput('');
      return;
    }

    // [d] — delete memory
    if (input === 'd' && isMemoryView && memorySelectedIdx >= 0) {
      if (!deleteConfirm) { setDeleteConfirm(true); return; }
      deleteMemoryItem(visibleMemories[memorySelectedIdx]);
      return;
    }

    if (input === 'q') { navigate('quit'); return; }

  });

  // ── Submit handlers ──────────────────────────────────

  function onComposeSubmit() {
    if (composeMode === 'command') {
      // Submit the selected suggestion, or typed text
      const selected = commandSuggestions[commandSelectedIdx] || commandSuggestions[0];
      if (selected) {
        handleCommandSubmit(selected.name);
      } else {
        handleCommandSubmit(composeText);
      }
      return;
    }
    sendMessage(composeText, composeTarget, composeTargetLabel);
    clearCompose();
  }

  function onMemorySubmit() {
    saveMemory(memoryInput);
    setComposeMode(null);
    setMemoryInput('');
  }

  // ── Nav bar builder ──────────────────────────────────

  function buildNavItems() {
    if (isAgentFocusView) {
      const items = [{ key: 'esc', label: 'back', color: 'cyan' }];
      if (focusedAgent?._managed && !focusedAgent._dead) {
        items.push({ key: 'x', label: 'stop', color: 'red' });
      }
      if (focusedAgent?._managed && focusedAgent._dead) {
        items.push({ key: 'r', label: 'restart', color: 'green' });
        items.push({ key: 'x', label: 'remove', color: 'red' });
      }
      if (isAgentAddressable(focusedAgent)) {
        items.push({ key: 'm', label: 'message', color: 'cyan' });
      }
      if (focusedAgent?._managed) {
        items.push({ key: 'l', label: showDiagnostics ? 'hide diagnostics' : 'diagnostics', color: 'yellow' });
      }
      return items;
    }

    if (isComposing) {
      return [
        {
          key: 'enter',
          label: composeMode === 'memory-add' ? 'save' : composeMode === 'memory-search' ? 'search' : 'send',
          color: 'green',
        },
        { key: 'esc', label: 'cancel', color: 'cyan' },
      ];
    }

    return [{ key: 'q', label: 'quit', color: 'gray' }];
  }

  const navItems = buildNavItems();

  const focusBar = (
    <Box paddingX={1} paddingTop={1} borderTop={true} borderColor="gray">
      <HintRow hints={navItems.map(item => ({
        commandKey: item.key,
        label: item.label,
        color: item.color || 'cyan',
      }))} />
    </Box>
  );

  function renderSectionIntro(title, summary, color = 'cyan') {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text color={color} bold>{title}</Text>
        {summary ? <Text dimColor>{summary}</Text> : null}
      </Box>
    );
  }

  // ── Guards ───────────────────────────────────────────

  if (cols < MIN_WIDTH) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>Terminal too narrow ({cols} cols). Widen to at least {MIN_WIDTH}.</Text>
        <Text>{''}</Text>
        <Text><Text color="cyan" bold>[q]</Text><Text dimColor> quit</Text></Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text color="red" bold>{error}</Text>
        <Text>{''}</Text>
        <Text dimColor>
          {error.includes('chinwag init') ? 'Set up this project first, then relaunch.'
            : error.includes('expired') ? 'Your auth token is no longer valid.'
            : 'Check the issue above and try again.'}
        </Text>
        <HintRow hints={[
          ...(error.includes('expired') || error.includes('.chinwag')
            ? []
            : [{ commandKey: 'r', label: 'retry', color: 'cyan' }]),
          { commandKey: 'q', label: 'quit', color: 'gray' },
        ]} />
      </Box>
    );
  }

  if (!context) {
    const isAutoRetrying = connState === 'connecting' || connState === 'reconnecting';
    const spin = SPINNER[spinnerFrame];
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {isAutoRetrying ? (
          <Text>
            <Text color="cyan">{spin} </Text>
            <Text color="cyan">{connState === 'connecting' ? 'Connecting to team' : (connDetail || 'Reconnecting')}</Text>
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text color="red">{connDetail || 'Cannot reach server.'}</Text>
            <Text>{''}</Text>
            <HintRow hints={[
              { commandKey: 'r', label: 'retry now', color: 'cyan' },
              { commandKey: 'q', label: 'quit', color: 'gray' },
            ]} />
          </Box>
        )}
      </Box>
    );
  }

  // ── Agent focus view ─────────────────────────────────

  if (isAgentFocusView && focusedAgent) {
    return (
      <AgentFocusView
        focusedAgent={focusedAgent}
        combinedAgents={combinedAgents}
        conflicts={conflicts}
        notice={notice}
        showDiagnostics={showDiagnostics}
        liveAgentNameCounts={liveAgentNameCounts}
        navHints={navItems.map(item => ({
          commandKey: item.key,
          label: item.label,
          color: item.color || 'cyan',
        }))}
      />
    );
  }

  // ── Input bars (compose/search/add) ──────────────────

  const inputBars = (
    <>
      {composeMode === 'command' && (() => {
        const maxNameLen = Math.max(...commandSuggestions.map(e => e.name.length), 0);
        return (
          <Box flexDirection="column">
            <Box>
              <Text color="cyan">{'> '}</Text>
              <TextInput
                value={composeText}
                onChange={v => { setComposeText(v); setCommandSelectedIdx(0); }}
                onSubmit={onComposeSubmit}
                placeholder="type a command"
              />
            </Box>
            {commandSuggestions.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {commandSuggestions.slice(0, 6).map((entry, idx) => {
                  const sel = idx === commandSelectedIdx;
                  return (
                    <Text key={entry.name}>
                      <Text color={sel ? 'cyan' : 'gray'}>{sel ? '› ' : '  '}</Text>
                      <Text color={sel ? 'cyan' : 'white'}>{entry.name.padEnd(maxNameLen)}</Text>
                      <Text dimColor>  {entry.description}</Text>
                    </Text>
                  );
                })}
              </Box>
            )}
          </Box>
        );
      })()}

      {composeMode === 'targeted' && (
        <Box>
          <Text color="cyan">{'@'}{composeTargetLabel || 'agent'}{' '}</Text>
          <TextInput
            value={composeText}
            onChange={setComposeText}
            onSubmit={onComposeSubmit}
            placeholder="send a message"
          />
        </Box>
      )}

      {composeMode === 'memory-search' && (
        <Box>
          <Text color="yellow">{'search '}</Text>
          <TextInput value={memorySearch} onChange={setMemorySearch} placeholder="search shared knowledge" />
        </Box>
      )}

      {composeMode === 'memory-add' && (
        <Box>
          <Text color="green">{'save '}</Text>
          <TextInput value={memoryInput} onChange={setMemoryInput} onSubmit={onMemorySubmit} placeholder="save to shared knowledge" />
        </Box>
      )}
    </>
  );

  const commandBar = (
    <Box paddingX={1} paddingTop={1} flexDirection="column">
      <Box borderStyle="round" borderColor={isComposing ? 'cyan' : 'gray'} paddingX={1} flexDirection="column">
        {inputBars}
        {!isComposing && (
          <Text dimColor>  {'>'} Press / for commands</Text>
        )}
      </Box>
      <NoticeLine notice={notice} />
      <Box paddingTop={1}>
        <HintRow hints={
          isAgentFocusView
            ? []
            : isMemoryView
              ? [
                  { commandKey: '/', label: 'search', color: 'cyan' },
                  { commandKey: 'a', label: 'add', color: 'green' },
                  ...(memorySelectedIdx >= 0 ? [{ commandKey: 'd', label: 'delete', color: 'red' }] : []),
                  { commandKey: 'esc', label: 'back', color: 'cyan' },
                  { commandKey: 'q', label: 'quit', color: 'gray' },
                ]
              : [
                  ...(isSessionsView ? [{ commandKey: '↑↓', label: 'select', color: 'cyan' }] : []),
                  { commandKey: 'q', label: 'quit', color: 'gray' },
                ]
        } />
      </Box>
    </Box>
  );

  const hasMultipleTools = launcherChoices.length > 1;

  // ── Build hint bars: contextual (top) + global (bottom) ─────
  // Contextual hints change with mode (shown only when relevant)
  const contextHints = [];
  if (mainSelectedAgent) {
    contextHints.push({ commandKey: 'enter', label: 'inspect', color: 'cyan' });
    if (isAgentAddressable(mainSelectedAgent)) contextHints.push({ commandKey: 'm', label: 'message', color: 'cyan' });
    if (mainSelectedAgent._managed && !mainSelectedAgent._dead) contextHints.push({ commandKey: 'x', label: 'stop', color: 'red' });
  }
  // ── Home view (prompt-first) ─────────────────────────

  const activeAgents = liveAgents.filter(a => !a._dead);
  const idleAgents = liveAgents.filter(a => {
    const intent = getAgentIntent(a);
    return !intent || /idle/i.test(intent);
  });

  const mainPane = (
    <Box flexDirection="column" paddingTop={1}>
      {/* Status line */}
      <Text>
        <Text color="magenta" bold>chinwag</Text>
        <Text dimColor>  {projectDisplayName}</Text>
        {connState === 'reconnecting' && <Text color="yellow">  {SPINNER[spinnerFrame]} reconnecting</Text>}
        {connState === 'offline' && <Text color="red">  offline</Text>}
      </Text>

      {/* Connection banner */}
      {connState !== 'connected' && connDetail && (
        <Text color={connState === 'offline' ? 'red' : 'yellow'}>{connDetail}</Text>
      )}


      {/* Agents section */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>
          {'agents'}
          <Text dimColor>  {activeAgents.length} connected</Text>
          {idleAgents.length > 0 && activeAgents.length > idleAgents.length && (
            <Text dimColor>{' · '}{activeAgents.length - idleAgents.length} working</Text>
          )}
        </Text>
        {allVisibleAgents.length === 0 ? (
          <Text dimColor>  No agents connected. Press [n] to open one.</Text>
        ) : (() => {
          const toolColWidth = Math.max(4, ...allVisibleAgents.map(a => getAgentDisplayLabel(a, liveAgentNameCounts).length)) + 1;
          return (
            <Box flexDirection="column" marginTop={1}>
              {/* Header */}
              <Text dimColor>
                {'  '}
                {'STATUS'.padEnd(10)}
                {'TOOL'.padEnd(toolColWidth)}
                {'ACTIVITY'}
              </Text>
              {visibleSessionRows.items.map((agent, idx) => {
                const absoluteIdx = visibleSessionRows.start + idx;
                const isSelected = absoluteIdx === selectedIdx;
                const sel = isSelected && mainFocus === 'agents';
                const intent = getAgentIntent(agent);
                const isDone = agent._dead;
                const isFailed = agent._failed;
                const status = isDone ? (isFailed ? 'failed' : 'done') : (intent && !/idle/i.test(intent) ? 'active' : 'idle');
                const statusColor = { active: 'green', idle: 'yellow', done: 'green', failed: 'red' }[status] || 'gray';
                const activity = isDone
                  ? (agent.outputPreview || (isFailed ? 'exited with error' : 'completed'))
                  : (intent && !/idle/i.test(intent) ? intent : (agent._duration || '-'));
                return (
                  <Text key={agent.agent_id || agent.id}>
                    <Text color={sel ? 'cyan' : 'gray'}>{sel ? '› ' : '  '}</Text>
                    <Text color={statusColor}>{status.padEnd(10)}</Text>
                    <Text bold={sel} dimColor={isDone}>{getAgentDisplayLabel(agent, liveAgentNameCounts).padEnd(toolColWidth)}</Text>
                    <Text dimColor={isDone}>{activity}</Text>
                  </Text>
                );
              })}
            </Box>
          );
        })()}
      </Box>

      {/* Tool issue banners — persistent until resolved */}
      {!toolPickerOpen && !isComposing && unavailableCliAgents.map(tool => {
        const state = getManagedToolState(tool.id);
        if (!state.recoveryCommand) return null;
        return (
          <Box key={tool.id} marginTop={1}>
            <Text>
              <Text color="yellow" bold>{tool.name}</Text>
              <Text color="yellow"> {state.detail || 'needs setup'}</Text>
              <Text dimColor>  </Text>
              <Text color="cyan" bold>[f]</Text>
              <Text dimColor> fix</Text>
            </Text>
          </Box>
        );
      })}

      {/* Notice line */}
      <NoticeLine notice={notice} />

      {/* Tool picker overlay */}
      {toolPickerOpen && (() => {
        const tools = readyCliAgents.length > 0 ? readyCliAgents : installedCliAgents;
        const termEnv = detectTerminalEnvironment();
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text dimColor>Opens in: </Text>
              <Text>{termEnv.name}</Text>
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {tools.map((tool, idx) => (
                <Text key={tool.id}>
                  <Text color={idx === toolPickerIdx ? 'cyan' : 'gray'}>{idx === toolPickerIdx ? '› ' : '  '}</Text>
                  <Text color={idx === toolPickerIdx ? 'cyan' : 'white'}>{tool.name}</Text>
                </Text>
              ))}
            </Box>
            <Text dimColor>{'\n'}↑↓ select · enter open · esc cancel</Text>
          </Box>
        );
      })()}

      {/* Compose overlay (commands, messages, memory) */}
      {isComposing && (
        <Box paddingTop={1} flexDirection="column">
          {inputBars}
        </Box>
      )}

      {/* Contextual hints — only when agent selected */}
      <HintRow hints={contextHints} />
    </Box>
  );

  if (isMemoryView) {
    return (
      <Box flexDirection="column">
        {renderSectionIntro('memory', 'Shared memory across your agents and teammates.', 'magenta')}

        <KnowledgePanel
          memories={memories}
          filteredMemories={filteredMemories}
          knowledgeVisible={visibleKnowledgeRows.items}
          windowStart={visibleKnowledgeRows.start}
          memorySearch={memorySearch}
          memorySelectedIdx={memorySelectedIdx}
          deleteConfirm={deleteConfirm}
          deleteMsg={deleteMsg}
        />

        {commandBar}
      </Box>
    );
  }

  if (isSessionsView) {
    return (
      <Box flexDirection="column">
        {renderSectionIntro('sessions', `${liveAgents.length} live session${liveAgents.length === 1 ? '' : 's'} across managed and connected agents.`, 'green')}

        <SessionsPanel
          liveAgents={visibleSessionRows.items}
          totalCount={liveAgents.length}
          windowStart={visibleSessionRows.start}
          selectedIdx={selectedIdx}
          getAgentIntent={getAgentIntent}
          cols={cols}
        />

        {commandBar}
      </Box>
    );
  }

  // ── Overview render ──────────────────────────────────

  return (
    mainPane
  );
}

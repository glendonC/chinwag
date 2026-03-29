import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { basename } from 'path';
import { homedir } from 'os';
import { api } from './api.js';
import {
  buildCombinedAgentRows,
  buildDashboardView,
  formatFiles,
  shortAgentId,
} from './dashboard-view.js';
import { detectTools } from './mcp-config.js';
import { openCommandInTerminal } from './open-command-in-terminal.js';
import { openPath } from './open-path.js';
import { spawnAgent, killAgent, getAgents, getOutput, onUpdate, removeAgent } from './process-manager.js';
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
  listManagedAgentTools,
} from './managed-agents.js';
import {
  getSavedLauncherPreference,
  resolvePreferredManagedTool,
  saveLauncherPreference,
} from './launcher-preferences.js';
import { getProjectContext } from './project.js';

// Strip ANSI escape codes, OSC sequences, cursor controls, and carriage returns
function stripAnsi(str) {
  return str
    .replace(/\x1b\][^\x07]*\x07/g, '')          // OSC sequences (title, etc.)
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')       // CSI sequences (colors, cursor)
    .replace(/\x1b\([A-Z]/g, '')                    // Character set selection
    .replace(/\x1b[=>MNOP78]/g, '')                 // Other escape sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // Control characters (keep \n \r \t)
    .replace(/\r/g, '');
}

const MIN_WIDTH = 50;

function getVisibleWindow(items, selectedIdx, maxItems) {
  if (!items?.length || items.length <= maxItems) {
    return { items: items || [], start: 0 };
  }

  if (selectedIdx == null || selectedIdx < 0) {
    return { items: items.slice(0, maxItems), start: 0 };
  }

  const half = Math.floor(maxItems / 2);
  let start = Math.max(0, selectedIdx - half);
  if (start + maxItems > items.length) {
    start = Math.max(0, items.length - maxItems);
  }

  return {
    items: items.slice(start, start + maxItems),
    start,
  };
}

function formatProjectPath(projectRoot) {
  const home = homedir();
  if (projectRoot?.startsWith(home)) {
    return `~${projectRoot.slice(home.length)}`;
  }
  return projectRoot;
}

function PanelViewNav({ items, activeKey }) {
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text dimColor>view</Text>
      <Box flexDirection="row" flexWrap="wrap">
        {items.map((item) => {
          const active = item.key === activeKey;
          const accent = item.accent || 'cyan';

          return (
            <Box key={item.key} marginRight={3}>
              <Text color={active ? accent : 'gray'}>{active ? '› ' : '  '}</Text>
              <Text color={active ? accent : 'white'} dimColor={!active} bold={active}>{item.label}</Text>
              {item.meta ? <Text dimColor> {item.meta}</Text> : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export function Dashboard({ config, navigate, layout, projectLabel = null, appVersion = '0.1.0' }) {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns || 80);
  const viewportRows = layout?.viewportRows || 18;

  // Project state
  const [teamId, setTeamId] = useState(null);
  const [teamName, setTeamName] = useState(null);
  const [projectRoot, setProjectRoot] = useState(process.cwd());
  const [detectedTools, setDetectedTools] = useState([]);
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Navigation state
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [mainFocus, setMainFocus] = useState('launcher');
  const [view, setView] = useState('home');
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

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

  // Composer: null | 'command' | 'targeted' | 'launch' | 'memory-search' | 'memory-add'
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
    const client = api(config);
    let joined = false;

    async function fetchContext() {
      try {
        if (!joined) {
          await client.post(`/teams/${teamId}/join`, { name: teamName }).catch(() => {});
          joined = true;
        }
        const ctx = await client.get(`/teams/${teamId}/context`);
        setContext(ctx);
        setError(null);
      } catch (err) {
        if (err.message?.includes('Not a member')) joined = false;
        setError(`Failed to fetch: ${err.message}`);
      }
    }

    fetchContext();
    const interval = setInterval(fetchContext, 5000);
    return () => clearInterval(interval);
  }, [teamId, teamName, refreshKey, config?.token]);

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

  useEffect(() => () => {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
  }, []);

  useEffect(() => {
    if (!teamId) return;
    setPreferredLaunchToolId(getSavedLauncherPreference(teamId));
  }, [teamId]);

  // ── Helpers ──────────────────────────────────────────

  function flash(msg, duration = 3000) {
    const tone = typeof duration === 'object' ? duration.tone || 'info' : 'info';
    const autoClearMs = typeof duration === 'object'
      ? (duration.autoClearMs ?? (tone === 'error' || tone === 'warning' ? null : 4000))
      : duration;

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
    flash('Rechecking tools you can start...', { tone: 'info', autoClearMs: 3000 });
  }

  function getManagedToolState(toolId) {
    return managedToolStates[toolId] || { toolId, state: 'checking', detail: 'Checking readiness' };
  }

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
  }

  function rememberLaunchTool(toolId) {
    if (!teamId || !toolId) return;
    if (saveLauncherPreference(teamId, toolId)) {
      setPreferredLaunchToolId(toolId);
    }
  }

  function closeLaunchComposer() {
    setComposeMode(null);
    setComposeText('');
  }

  function selectLaunchTool(tool, { startCompose = false, draftText = composeText } = {}) {
    if (!tool) return;
    setLaunchToolId(tool.id);
    if (startCompose) {
      setView('home');
      setMainFocus('launcher');
      setComposeMode('launch');
      setComposeText(draftText);
    }
  }

  function openLaunchComposer(preselectedTool = null, initialTaskText = '') {
    if (!installedCliAgents.length) {
      flash('No managed launchers are configured yet.', { tone: 'warning' });
      return;
    }

    clearCompose();
    setView('home');
    setMainFocus('launcher');

    const initialTool = preselectedTool
      || (selectedLaunchTool && canLaunchSelectedTool ? selectedLaunchTool : null)
      || preferredLaunchTool
      || readyCliAgents[0]
      || selectedLaunchTool
      || installedCliAgents[0]
      || null;
    if (initialTool) {
      setLaunchToolId(initialTool.id);
    }
    setComposeMode('launch');
    setComposeText(initialTaskText);
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
      if (!rest) {
        openLaunchComposer();
        return;
      }

      const [toolToken, ...taskParts] = rest.split(/\s+/);
      const explicitTool = resolveReadyTool(toolToken);
      if (explicitTool) {
        const taskText = taskParts.join(' ').trim();
        if (taskText) {
          launchManagedTask(explicitTool, taskText);
        } else {
          openLaunchComposer(explicitTool);
          return;
        }
        clearCompose();
        return;
      }

      if (selectedLaunchTool && canLaunchSelectedTool) {
        launchManagedTask(selectedLaunchTool, rest);
        clearCompose();
        return;
      }

      openLaunchComposer(null, rest);
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

    if (verb === 'sessions' || verb === 'agents') {
      setView('sessions');
      setSelectedIdx(liveAgents.length > 0 ? 0 : -1);
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
      flash('Try /new, /fix, /recheck, or /memory.', { tone: 'info', autoClearMs: 5000 });
      clearCompose();
      return;
    }

    if (selectedLaunchTool && canLaunchSelectedTool) {
      launchManagedTask(selectedLaunchTool, text);
      clearCompose();
      return;
    }

    openLaunchComposer(null, text);
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

  function getAgentDisplayLabel(agent) {
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

  // ── API actions ──────────────────────────────────────

  function sendMessage(text, target, targetLabel = null) {
    if (!teamId || !text.trim()) return;
    api(config).post(`/teams/${teamId}/messages`, { text: text.trim(), target: target || undefined })
      .then(() => {
        flash(targetLabel ? `Sent to ${targetLabel}` : 'Sent to team', { tone: 'success', autoClearMs: 4000 });
        setRefreshKey(k => k + 1);
      })
      .catch(() => flash('Could not send message', { tone: 'error' }));
  }

  function saveMemory(text) {
    if (!teamId || !text.trim()) return;
    api(config).post(`/teams/${teamId}/memory`, { text: text.trim() })
      .then(() => { flash('Saved to shared memory', { tone: 'success', autoClearMs: 4000 }); setRefreshKey(k => k + 1); })
      .catch(() => flash('Could not save to shared memory', { tone: 'error' }));
  }

  function deleteMemoryItem(mem) {
    if (!mem?.id || !teamId) return;
    api(config).del(`/teams/${teamId}/memory`, { id: mem.id })
      .then(() => {
        setDeleteMsg('Deleted');
        setDeleteConfirm(false);
        setMemorySelectedIdx(-1);
        setRefreshKey(k => k + 1);
        setTimeout(() => setDeleteMsg(null), 2000);
      })
      .catch(() => {
        setDeleteMsg('Delete failed');
        setDeleteConfirm(false);
        setTimeout(() => setDeleteMsg(null), 2000);
      });
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
      flash(`${toolState.detail || `${toolInfo.name} is not ready`}.${recoveryHint}`, { tone: 'warning' });
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
        flash(`Failed to start ${toolInfo.name}`, { tone: 'error' });
        return false;
      }
      if (flashSuccess) {
        flash(successMessage, { tone: 'success', autoClearMs: 4000 });
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

    flash(`Stopping ${getAgentDisplayLabel(agent)}`, { tone: 'info', autoClearMs: 4000 });
    if (view === 'agent-focus') {
      setView('home');
      setFocusedAgent(null);
    }
  }

  function handleRemoveAgent(agent) {
    if (!agent?._managed) return;
    const removed = removeAgent(agent.id);
    if (removed) {
      flash(`Removed ${getAgentDisplayLabel(agent)}`, { tone: 'success', autoClearMs: 4000 });
      if (view === 'agent-focus') {
        setView('home');
        setFocusedAgent(null);
      }
    } else {
      flash('Could not remove agent', { tone: 'error' });
    }
  }

  function handleRestartAgent(agent) {
    if (!agent?._managed || !agent._dead) return;

    const removed = removeAgent(agent.id);
    if (!removed) {
      flash('Could not restart agent', { tone: 'error' });
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
      flash(`Opened ${tool.name} fix flow. Finish it, then press [u].`, { tone: 'info', autoClearMs: 5000 });
    } else {
      flash(`Run \`${status.recoveryCommand}\` manually, then press [u].`, { tone: 'warning' });
    }
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
  const recentManagedResults = combinedAgents
    .filter(agent => agent._managed && agent._dead)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const selectedAgent = selectedIdx >= 0 ? liveAgents[selectedIdx] : null;
  const mainSelectedAgent = mainFocus === 'agents' ? selectedAgent : null;
  const knowledgeVisible = view === 'memory' || composeMode === 'memory-search' || composeMode === 'memory-add'
    ? visibleMemories
    : visibleMemories.slice(0, Math.min(1, visibleMemories.length));
  const duplicateIssueToolIds = new Set(unavailableCliAgents.map(tool => tool.id));
  const recentResult = recentManagedResults.find(agent => !duplicateIssueToolIds.has(agent.toolId)) || null;

  const hasLiveAgents = liveAgents.length > 0;
  const hasRecentManagedResults = Boolean(recentResult);
  const hasMemories = memories.length > 0;
  const isEmpty = !hasLiveAgents && !hasRecentManagedResults && !hasMemories && installedCliAgents.length === 0;
  const projectDisplayName = teamName || projectLabel || basename(projectRoot);
  const projectDisplayPath = formatProjectPath(projectRoot);
  const liveAgentNameCounts = liveAgents.reduce((counts, agent) => {
    counts.set(agent._display, (counts.get(agent._display) || 0) + 1);
    return counts;
  }, new Map());
  const visibleSessionRows = getVisibleWindow(liveAgents, selectedIdx, Math.max(4, viewportRows - 11));
  const visibleKnowledgeRows = getVisibleWindow(knowledgeVisible, memorySelectedIdx, Math.max(4, viewportRows - 11));
  const commandEntries = [
    { name: '/new', description: 'Start a new task' },
    ...(unavailableCliAgents.some(tool => getManagedToolState(tool.id).recoveryCommand)
      ? [{ name: '/fix', description: 'Open the main setup fix flow' }]
      : []),
    ...(installedCliAgents.length > 0
      ? [{ name: '/recheck', description: 'Refresh available tools and setup state' }]
      : []),
    ...(hasMemories
      ? [{ name: '/memory', description: 'Open shared memory' }]
      : []),
    ...(hasLiveAgents
      ? [{ name: '/sessions', description: 'Open the active session list' }]
      : []),
    ...(selectedAgent && isAgentAddressable(selectedAgent)
      ? [{ name: '/message', description: `Message ${selectedAgent._display}` }]
      : []),
    { name: '/help', description: 'Show command help' },
  ];
  const commandQuery = composeMode === 'command'
    ? composeText.trim().replace(/^\//, '').toLowerCase()
    : '';
  const commandSuggestions = commandEntries.filter((entry) => {
    if (!composeText.trim().startsWith('/')) return false;
    if (!commandQuery) return true;
    const normalized = entry.name.slice(1).toLowerCase();
    return normalized.startsWith(commandQuery) || entry.description.toLowerCase().includes(commandQuery);
  });

  // Clamp selection indices
  useEffect(() => {
    if (liveAgents.length === 0) {
      if (selectedIdx !== -1) setSelectedIdx(-1);
      if (mainFocus !== 'launcher') setMainFocus('launcher');
      return;
    }
    if (selectedIdx >= liveAgents.length) {
      setSelectedIdx(liveAgents.length > 0 ? liveAgents.length - 1 : -1);
    }
  }, [selectedIdx, liveAgents.length, mainFocus]);

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

  // ── Composing state ──────────────────────────────────

  const isComposing = Boolean(composeMode && composeMode !== 'launch');

  // ── Input handling ───────────────────────────────────

  useInput((input, key) => {
    if (cols < MIN_WIDTH) {
      if (input === 'q') navigate('quit');
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

    // ── Overview mode input ────────────────────────────

    if (composeMode === 'launch') {
      if (key.escape) {
        closeLaunchComposer();
        return;
      }

      if (!canLaunchSelectedTool) {
        const num = parseInt(input, 10);
        if (num >= 1 && num <= launcherChoices.length) {
          selectLaunchTool(launcherChoices[num - 1], { startCompose: true });
          return;
        }
      }

      return;
    }

    // When composing text, only handle Esc
    if (isComposing) {
      if (key.escape) clearCompose();
      return;
    }

    if (isHomeView) {
      if (key.downArrow) {
        if (mainFocus === 'launcher' && liveAgents.length > 0) {
          setMainFocus('agents');
          setSelectedIdx(prev => prev >= 0 ? prev : 0);
          return;
        }
        if (mainFocus === 'agents' && liveAgents.length > 0) {
          setSelectedIdx(prev => Math.min((prev < 0 ? 0 : prev) + 1, liveAgents.length - 1));
          return;
        }
      }
      if (key.upArrow) {
        if (mainFocus === 'agents' && selectedIdx > 0) {
          setSelectedIdx(prev => Math.max(prev - 1, 0));
          return;
        }
        if (mainFocus === 'agents') {
          setMainFocus('launcher');
          return;
        }
      }
      if (key.return && mainFocus === 'launcher') {
        openLaunchComposer();
        return;
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

    if (isHomeView && mainFocus === 'launcher') {
      const num = parseInt(input, 10);
      if (num >= 1 && num <= launcherChoices.length) {
        selectLaunchTool(launcherChoices[num - 1], { startCompose: true, draftText: '' });
        return;
      }
    }

    if (input === 's' && hasLiveAgents) {
      setView('sessions');
      setSelectedIdx(prev => prev >= 0 ? prev : 0);
      return;
    }

    if (input === 'o') {
      const result = openPath(projectRoot);
      flash(
        result.ok ? 'Opened project folder' : `Unable to open project folder${result.error ? `: ${result.error}` : ''}`,
        result.ok ? { tone: 'success', autoClearMs: 4000 } : { tone: 'error' }
      );
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

      // Enter on selected agent → focus mode
      if (key.return) {
        if (selectedIdx >= 0 && selectedIdx < liveAgents.length) {
          const agent = liveAgents[selectedIdx];
          setFocusedAgent(agent);
          setView('agent-focus');
          setShowDiagnostics(false);
          return;
        }
        beginCommandInput('');
        return;
      }

      // [x] on selected managed agent → stop (running) or remove (exited)
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

    // [n] — spawn a new agent
    if (input === 'n' && installedCliAgents.length > 0) {
      openLaunchComposer();
      return;
    }

    if (input === 'n' && installedCliAgents.length === 0) {
      flash('No managed launchers are configured yet.', { tone: 'warning' });
      return;
    }

    if (input === 'u' && installedCliAgents.length > 0) {
      refreshManagedToolStates({ clearRuntimeFailures: true });
      return;
    }

    if (input === 'f' && unavailableCliAgents.some(tool => getManagedToolState(tool.id).recoveryCommand)) {
      handleFixLauncher(unavailableCliAgents.find(tool => getManagedToolState(tool.id).recoveryCommand));
      return;
    }

    // [/] — command palette or memory search
    if (input === '/') {
      if (isHomeView || isSessionsView) {
        beginCommandInput('/');
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
      handleCommandSubmit(composeText);
      return;
    }
    sendMessage(composeText, composeTarget, composeTargetLabel);
    clearCompose();
  }

  function onTaskLaunchSubmit() {
    if (!selectedLaunchTool || !canLaunchSelectedTool) return;
    const didStart = launchManagedTask(selectedLaunchTool, composeText, { flashSuccess: false });
    if (didStart) {
      setComposeText('');
      flash(`Started ${selectedLaunchTool.name}. Enter another task or press [esc].`, { tone: 'success', autoClearMs: 5000 });
    }
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

  const dashboardRail = (
    <Box paddingTop={1}>
      <PanelViewNav
        items={[
          { key: 'overview', label: 'activity', accent: 'cyan' },
          { key: 'agents', label: 'sessions', meta: liveAgents.length > 0 ? String(liveAgents.length) : null, accent: 'green' },
          { key: 'memory', label: 'memory', meta: memories.length > 0 ? String(memories.length) : null, accent: 'magenta' },
        ]}
        activeKey={isAgentFocusView ? 'agents' : isSessionsView ? 'agents' : isMemoryView ? 'memory' : 'overview'}
      />
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
      <Box flexDirection="column">
        <Box paddingX={1} paddingTop={1}><Text color="red">{error}</Text></Box>
        <Box paddingX={1} paddingTop={1}>
          <HintRow hints={[{ commandKey: 'q', label: 'quit', color: 'gray' }]} />
        </Box>
      </Box>
    );
  }

  if (!context) {
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text dimColor>Loading team context...</Text>
      </Box>
    );
  }

  // ── Agent focus view ─────────────────────────────────

  if (isAgentFocusView && focusedAgent) {
    const freshAgent = focusedAgent._managed
      ? (combinedAgents.find(agent => agent._managed && agent.id === focusedAgent.id) || focusedAgent)
      : (combinedAgents.find(agent => !agent._managed && agent.agent_id === focusedAgent.agent_id) || focusedAgent);
    const isRunning = freshAgent._managed ? freshAgent.status === 'running' : freshAgent.status === 'active';
    const isDead = freshAgent._managed ? freshAgent._dead : freshAgent.status !== 'active';
    const exitCode = freshAgent._exitCode;
    const outputLines = showDiagnostics && freshAgent._managed
      ? getOutput(freshAgent.id, 12)
          .map(line => stripAnsi(line))
          .map(line => line.trimEnd())
          .filter(Boolean)
      : [];
    const agentFiles = freshAgent.activity?.files || [];
    const agentConflicts = conflicts.filter(([file]) => agentFiles.includes(file));
    const sourceLabel = getAgentOriginLabel(freshAgent);
    const quietLabel = freshAgent.minutes_since_update != null && freshAgent.minutes_since_update >= 15
      ? `Quiet for ${Math.round(freshAgent.minutes_since_update)}m`
      : null;
    const outputSummary = freshAgent.outputPreview || null;

    return (
      <Box flexDirection="column">
        {dashboardRail}
        {renderSectionIntro('session details', sourceLabel, 'green')}

        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          <Text>
            {isRunning
              ? <Text color="green">{'\u25CF'} </Text>
              : isDead
                ? <Text color="red">{'\u25CF'} </Text>
                : <Text color="green">{'\u25CF'} </Text>
            }
            <Text bold>{getAgentDisplayLabel(freshAgent)}</Text>
            {freshAgent.handle && <Text dimColor>  {freshAgent.handle}</Text>}
            {freshAgent._duration && <Text dimColor>  {freshAgent._duration}</Text>}
          </Text>
          <Text>{''}</Text>
          <Text bold>Session</Text>
          <Text dimColor>  {sourceLabel}</Text>
          {isRunning && <Text color="green">  Live</Text>}
          {isDead && exitCode === 0 && <Text dimColor>  Completed</Text>}
          {isDead && exitCode !== 0 && <Text color="red">  Exited with error (code {exitCode ?? 'unknown'})</Text>}

          <Text>{''}</Text>
          <Text bold>Work</Text>
          {getAgentIntent(freshAgent) ? (
            <Text>  {getAgentIntent(freshAgent)}</Text>
          ) : (
            <Text dimColor>  No current work summary</Text>
          )}
          {freshAgent._managed && freshAgent._dead && outputSummary && (
            <Text dimColor>  Final response: {outputSummary}</Text>
          )}
          {agentFiles.length > 0 ? (
            <Box flexDirection="column">
              {agentFiles.map(file => (
                <Text key={file} dimColor>  {basename(file)}</Text>
              ))}
            </Box>
          ) : (
            <Text dimColor>  No files reported yet</Text>
          )}

          <Text>{''}</Text>
          <Text bold>Coordination</Text>
          {quietLabel ? <Text color="yellow">  {quietLabel}</Text> : <Text dimColor>  No quiet-session signal</Text>}
          {agentConflicts.length > 0 ? (
            <Box flexDirection="column">
              {agentConflicts.map(([file, owners]) => (
                <Text key={file} color="red">  Conflict on {basename(file)} · {owners.join(' & ')}</Text>
              ))}
            </Box>
          ) : (
            <Text dimColor>  No active conflicts involving this agent</Text>
          )}
          {getAgentMeta(freshAgent) && <Text dimColor>  {getAgentMeta(freshAgent)}</Text>}

          {freshAgent._managed && (
            <>
              <Text>{''}</Text>
              <Text bold>Diagnostics</Text>
              {!showDiagnostics ? (
                <Text dimColor>  Hidden by default. Press [l] to inspect captured process output.</Text>
              ) : outputLines.length > 0 ? (
                <Box flexDirection="column">
                  {outputLines.map((line, idx) => (
                    <Text key={`${freshAgent.id}-${idx}`} dimColor>  {line}</Text>
                  ))}
                </Box>
              ) : (
                <Text dimColor>  No captured output yet</Text>
              )}
            </>
          )}
        </Box>

        <Box paddingX={1} paddingTop={1}>
          <NoticeLine notice={notice} />
        </Box>

        {focusBar}
      </Box>
    );
  }

  // ── Input bars (compose/search/add) ──────────────────

  const inputBars = (
    <>
      {composeMode === 'command' && (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          <Box>
            <Text color="cyan">  /{'>'}</Text>
            <TextInput
              value={composeText}
              onChange={setComposeText}
              onSubmit={onComposeSubmit}
              placeholder="new, fix, recheck, memory"
            />
          </Box>
          {commandSuggestions.length > 0 && (
            <Box flexDirection="column" marginLeft={2}>
              {commandSuggestions.slice(0, 5).map((entry, idx) => (
                <Text key={entry.name}>
                  <Text color={idx === 0 ? 'cyan' : 'gray'}>{idx === 0 ? '  ▸ ' : '    '}</Text>
                  <Text color={idx === 0 ? 'cyan' : 'white'}>{entry.name}</Text>
                  <Text dimColor>  {entry.description}</Text>
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )}

      {composeMode === 'targeted' && (
        <Box paddingX={1} paddingTop={1}>
          <Text color="cyan">  @{composeTargetLabel || 'agent'}{'> '}</Text>
          <TextInput
            value={composeText}
            onChange={setComposeText}
            onSubmit={onComposeSubmit}
            placeholder="Send a coordination note..."
          />
        </Box>
      )}

      {composeMode === 'memory-search' && (
        <Box paddingX={1} paddingTop={1}>
          <Text color="yellow">  memory{'> '}</Text>
          <TextInput value={memorySearch} onChange={setMemorySearch} placeholder="Search shared memory..." />
        </Box>
      )}

      {composeMode === 'memory-add' && (
        <Box paddingX={1} paddingTop={1}>
          <Text color="green">  save{'> '}</Text>
          <TextInput value={memoryInput} onChange={setMemoryInput} onSubmit={onMemorySubmit} placeholder="Save shared memory..." />
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

  const overlayBar = (isComposing || notice) ? (
    <Box paddingTop={1} flexDirection="column">
      {isComposing ? (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          {inputBars}
        </Box>
      ) : null}
      <NoticeLine notice={notice} />
      {isComposing ? (
        <HintRow hints={navItems.map(item => ({
          commandKey: item.key,
          label: item.label,
          color: item.color || 'cyan',
        }))} />
      ) : null}
    </Box>
  ) : null;

  const launcherSummary = selectedLaunchTool
    ? selectedLaunchTool.name
    : readyCliAgents.length > 1
      ? `Choose from ${readyCliAgents.length} ready tools`
      : checkingCliAgents.length > 0
        ? 'Checking tools'
        : unavailableCliAgents.some(tool => getManagedToolState(tool.id).recoveryCommand)
          ? 'Unavailable. Press [f] or [u].'
          : installedCliAgents.length > 0
            ? 'Unavailable. Press [u].'
            : 'Not configured';
  const launcherChoices = readyCliAgents.length > 0 ? readyCliAgents : installedCliAgents;

  const mainActionHints = [
    ...(composeMode === 'launch' && canLaunchSelectedTool ? [{ commandKey: 'enter', label: 'start', color: 'green' }] : []),
    ...(composeMode === 'launch' ? [{ commandKey: 'esc', label: 'close', color: 'cyan' }] : []),
    ...(composeMode !== 'launch' && mainFocus === 'launcher' && installedCliAgents.length > 0 ? [{ commandKey: 'n', label: 'compose', color: 'cyan' }] : []),
    ...(composeMode !== 'launch' && launcherChoices.length > 1 ? [{ commandKey: `1-${launcherChoices.length}`, label: 'pick launcher', color: 'cyan' }] : []),
    ...(hasLiveAgents ? [{ commandKey: '↑↓', label: 'move', color: 'cyan' }] : []),
    ...(mainSelectedAgent ? [{ commandKey: 'enter', label: 'inspect', color: 'cyan' }] : []),
    ...(mainSelectedAgent && isAgentAddressable(mainSelectedAgent) ? [{ commandKey: 'm', label: 'message', color: 'cyan' }] : []),
    ...(mainSelectedAgent?._managed && !mainSelectedAgent._dead ? [{ commandKey: 'x', label: 'stop', color: 'red' }] : []),
    ...(hasLiveAgents ? [{ commandKey: 's', label: 'sessions', color: 'cyan' }] : []),
    ...(hasMemories ? [{ commandKey: 'k', label: 'memory', color: 'magenta' }] : []),
    { commandKey: '/', label: 'commands', color: 'cyan' },
    ...(installedCliAgents.length > 0 ? [{ commandKey: 'u', label: 'recheck', color: 'yellow' }] : []),
    ...(unavailableCliAgents.some(tool => getManagedToolState(tool.id).recoveryCommand)
      ? [{ commandKey: 'f', label: 'fix', color: 'yellow' }]
      : []),
    { commandKey: 'o', label: 'folder', color: 'cyan' },
    { commandKey: 'q', label: 'quit', color: 'gray' },
  ];

  const mainPane = (
    <Box flexDirection="column" paddingTop={1}>
      {dashboardRail}
      <Box borderStyle="round" borderColor={mainFocus === 'launcher' ? 'cyan' : 'gray'} paddingX={1} flexDirection="column">
        <Text>
          <Text color="magenta" bold>chinwag</Text>
          <Text dimColor> (v{appVersion})</Text>
        </Text>
        <Text>
          <Text dimColor>project: </Text>
          <Text color="cyan" bold>{projectDisplayName}</Text>
        </Text>
        <Text>
          <Text dimColor>directory: </Text>
          <Text>{projectDisplayPath}</Text>
        </Text>
        <Text>
          <Text dimColor>launcher: </Text>
          <Text color={canLaunchSelectedTool ? 'cyan' : selectedLaunchTool ? 'yellow' : 'white'}>{launcherSummary}</Text>
          {selectedLaunchTool && !canLaunchSelectedTool && selectedLaunchToolState?.detail ? (
            <Text dimColor>  {selectedLaunchToolState.detail}</Text>
          ) : null}
        </Text>
        {launcherChoices.length > 0 ? (
          <Box flexWrap="wrap" paddingTop={1}>
            {launcherChoices.map((tool, idx) => {
              const state = getManagedToolState(tool.id).state;
              const selected = selectedLaunchTool?.id === tool.id;
              const ready = state === 'ready';
              return (
                <Box key={tool.id} marginRight={2}>
                  <Text color={selected ? 'cyan' : ready ? 'white' : 'gray'} bold={selected || ready}>[{idx + 1}] {tool.name}</Text>
                  {!ready ? <Text dimColor> unavailable</Text> : null}
                </Box>
              );
            })}
          </Box>
        ) : null}
        {composeMode === 'launch' && selectedLaunchTool ? (
          canLaunchSelectedTool ? (
            <Box flexDirection="column" paddingTop={1}>
              <Box>
                <Text color={mainFocus === 'launcher' ? 'cyan' : 'gray'}>{mainFocus === 'launcher' ? '› ' : '  '}</Text>
                <Text color="cyan">{selectedLaunchTool.name}{'> '}</Text>
                <TextInput
                  value={composeText}
                  onChange={setComposeText}
                  onSubmit={onTaskLaunchSubmit}
                  placeholder="Describe the task to delegate..."
                />
              </Box>
              {launcherChoices.length > 1 ? (
                <Text dimColor>Press [esc], then choose another launcher.</Text>
              ) : null}
            </Box>
          ) : (
            <Box flexDirection="column" paddingTop={1}>
              <Text color="yellow">{selectedLaunchToolState?.detail || `${selectedLaunchTool.name} is not ready`}</Text>
              <Text dimColor>
                {launcherChoices.some(tool => getManagedToolState(tool.id).state === 'ready')
                  ? 'Pick a ready launcher above, or press [f]/[u].'
                  : 'Press [f] or [u] to make a launcher ready.'}
              </Text>
            </Box>
          )
        ) : (
          <Text>
            <Text color={mainFocus === 'launcher' ? 'cyan' : 'gray'}>{mainFocus === 'launcher' ? '› ' : '  '}</Text>
            <Text color={installedCliAgents.length > 0 ? 'cyan' : 'gray'} bold={installedCliAgents.length > 0}>[n]</Text>
            <Text bold={mainFocus === 'launcher'}> new task</Text>
            <Text dimColor>  {installedCliAgents.length > 0 ? 'start here' : 'no launchers configured'}</Text>
          </Text>
        )}
      </Box>

      {recentResult ? (
        <Box paddingTop={1}>
          <Text dimColor>Last result: {recentResult._display} · {getRecentResultSummary(recentResult)}</Text>
        </Box>
      ) : null}

      {liveAgents.length === 0 ? (
        <Box flexDirection="column" paddingTop={2}>
          <Text dimColor>No live agents yet.</Text>
          <Text dimColor>Agents started elsewhere appear here automatically.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingTop={2}>
          <Text>
            <Text bold>live agents</Text>
            <Text dimColor>  {liveAgents.length} live</Text>
          </Text>
          <Box flexDirection="column" paddingTop={1}>
            {visibleSessionRows.items.map((agent, idx) => {
              const absoluteIdx = visibleSessionRows.start + idx;
              const isSelected = absoluteIdx === selectedIdx;
              const intent = getAgentIntent(agent);
              const origin = getAgentOriginLabel(agent);
              return (
                <Box key={agent.agent_id || agent.id} flexDirection="column" paddingBottom={1}>
                  <Text>
                    <Text color={isSelected && mainFocus === 'agents' ? 'cyan' : 'gray'}>{isSelected && mainFocus === 'agents' ? '› ' : '  '}</Text>
                    <Text color={agent._managed ? 'green' : 'cyan'}>● </Text>
                    <Text bold={isSelected && mainFocus === 'agents'}>{getAgentDisplayLabel(agent)}</Text>
                  </Text>
                  <Text>
                    <Text dimColor>  {origin} · </Text>
                    <Text color={getIntentColor(intent)} dimColor={getIntentColor(intent) === 'gray'}>{intent || 'Idle'}</Text>
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      <HintRow hints={mainActionHints} />
      {overlayBar}
    </Box>
  );

  // ── Empty state ──────────────────────────────────────

  if (isEmpty) {
    return mainPane;
  }

  if (isMemoryView) {
    return (
      <Box flexDirection="column">
        {dashboardRail}
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
        {dashboardRail}
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

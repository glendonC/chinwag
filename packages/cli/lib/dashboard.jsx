import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { basename } from 'path';
import { homedir } from 'os';
import { api } from './api.js';
import { buildCombinedAgentRows, buildDashboardView } from './dashboard-view.js';
import { detectTools } from './mcp-config.js';
import { openPath } from './open-path.js';
import { HintRow, NoticeLine } from './dashboard-ui.jsx';
import { KnowledgePanel, SessionsPanel } from './dashboard-sections.jsx';
import { getProjectContext } from './project.js';
import { useNotice } from './dashboard-notice.js';
import { useMemoryManager } from './dashboard-memory.js';
import { useAgentLifecycle } from './dashboard-agents.js';
import { useComposer } from './dashboard-composer.js';
import { AgentFocusView } from './dashboard-agent-focus.jsx';
import { MainPane } from './dashboard-main-pane.jsx';

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
  return { items: items.slice(start, start + maxItems), start };
}

function formatProjectPath(projectRoot) {
  const home = homedir();
  if (projectRoot?.startsWith(home)) return `~${projectRoot.slice(home.length)}`;
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
  const [focusedAgent, setFocusedAgent] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // ── Custom hooks ────────────────────────────────────
  const { notice, flash } = useNotice();
  const onRefresh = () => setRefreshKey(k => k + 1);

  const memoryManager = useMemoryManager({ config, teamId, onFlash: flash, onRefresh });
  const agents = useAgentLifecycle({ config, teamId, projectRoot, stdout, onFlash: flash });
  const composer = useComposer({ config, teamId, onFlash: flash, onRefresh, memoryManager });

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
    if (!project) { setError('No .chinwag file found. Run `npx chinwag init` first.'); return; }
    if (project.error) { setError(project.error); return; }
    setTeamId(project.teamId);
    setTeamName(project.teamName);
    setProjectRoot(project.root);
    try { setDetectedTools(detectTools(project.root)); } catch {}
  }, []);

  // ── API polling ──────────────────────────────────────
  useEffect(() => {
    if (!teamId) return;
    const client = api(config);
    let joined = false;
    async function fetchContext() {
      try {
        if (!joined) { await client.post(`/teams/${teamId}/join`, { name: teamName }).catch(() => {}); joined = true; }
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

  // ── Convenience aliases ─────────────────────────────
  const isHomeView = view === 'home';
  const isSessionsView = view === 'sessions';
  const isMemoryView = view === 'memory';
  const isAgentFocusView = view === 'agent-focus';

  // ── Data ─────────────────────────────────────────────
  const { getToolName, conflicts, memories, filteredMemories, visibleMemories, visibleAgents } = buildDashboardView({
    context, detectedTools, memoryFilter: null,
    memorySearch: composer.composeMode === 'memory-search' ? memoryManager.memorySearch : '',
    cols, projectDir: teamName || basename(process.cwd()),
  });

  const combinedAgents = buildCombinedAgentRows({ managedAgents: agents.managedAgents, connectedAgents: visibleAgents, getToolName });
  const liveAgents = combinedAgents.filter(agent => !agent._dead);
  const recentManagedResults = combinedAgents.filter(agent => agent._managed && agent._dead).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const selectedAgent = selectedIdx >= 0 ? liveAgents[selectedIdx] : null;
  const mainSelectedAgent = mainFocus === 'agents' ? selectedAgent : null;
  const knowledgeVisible = view === 'memory' || composer.composeMode === 'memory-search' || composer.composeMode === 'memory-add'
    ? visibleMemories : visibleMemories.slice(0, Math.min(1, visibleMemories.length));
  const duplicateIssueToolIds = new Set(agents.unavailableCliAgents.map(tool => tool.id));
  const recentResult = recentManagedResults.find(agent => !duplicateIssueToolIds.has(agent.toolId)) || null;

  const hasLiveAgents = liveAgents.length > 0;
  const hasMemories = memories.length > 0;
  const isEmpty = !hasLiveAgents && !recentResult && !hasMemories && agents.installedCliAgents.length === 0;
  const projectDisplayName = teamName || projectLabel || basename(projectRoot);
  const projectDisplayPath = formatProjectPath(projectRoot);
  const liveAgentNameCounts = liveAgents.reduce((counts, agent) => {
    counts.set(agent._display, (counts.get(agent._display) || 0) + 1);
    return counts;
  }, new Map());
  const visibleSessionRows = getVisibleWindow(liveAgents, selectedIdx, Math.max(4, viewportRows - 11));
  const visibleKnowledgeRows = getVisibleWindow(knowledgeVisible, memoryManager.memorySelectedIdx, Math.max(4, viewportRows - 11));

  const getDisplayLabel = (agent) => agents.getAgentDisplayLabel(agent, liveAgentNameCounts);

  // Clamp selection indices
  useEffect(() => {
    if (liveAgents.length === 0) {
      if (selectedIdx !== -1) setSelectedIdx(-1);
      if (mainFocus !== 'launcher') setMainFocus('launcher');
      return;
    }
    if (selectedIdx >= liveAgents.length) setSelectedIdx(liveAgents.length - 1);
  }, [selectedIdx, liveAgents.length, mainFocus]);

  useEffect(() => {
    memoryManager.clampMemoryIdx(visibleMemories.length);
  }, [memoryManager.memorySelectedIdx, visibleMemories.length]);

  // ── Shared helpers for passing to hooks ─────────────
  const launchComposerOpts = () => ({
    installedCliAgents: agents.installedCliAgents,
    selectedLaunchTool: agents.selectedLaunchTool,
    canLaunchSelectedTool: agents.canLaunchSelectedTool,
    preferredLaunchTool: agents.preferredLaunchTool,
    readyCliAgents: agents.readyCliAgents,
    setView, setMainFocus, setLaunchToolId: agents.setLaunchToolId,
  });

  const selectToolOpts = (draftText = '') => ({
    startCompose: true, draftText,
    onStartCompose: (text) => {
      setView('home'); setMainFocus('launcher');
      composer.setComposeMode('launch'); composer.setComposeText(text);
    },
  });

  const agentViewOpts = () => ({
    getAgentDisplayLabel: getDisplayLabel, view, setView, setFocusedAgent,
  });

  const targetMsgFn = (agent) => composer.beginTargetedMessage(agent, {
    isAgentAddressable: agents.isAgentAddressable,
    getAgentTargetLabel: agents.getAgentTargetLabel,
  });

  // ── Input handling ───────────────────────────────────
  useInput((input, key) => {
    if (cols < MIN_WIDTH) { if (input === 'q') navigate('quit'); return; }

    if (isAgentFocusView) {
      if (key.escape) { setView('home'); setFocusedAgent(null); setShowDiagnostics(false); return; }
      if (input === 'x' && focusedAgent?._managed) {
        focusedAgent._dead
          ? agents.handleRemoveAgent(focusedAgent, agentViewOpts())
          : agents.handleKillAgent(focusedAgent, agentViewOpts());
        return;
      }
      if (input === 'r' && focusedAgent?._managed && focusedAgent._dead) { agents.handleRestartAgent(focusedAgent, agentViewOpts()); return; }
      if (input === 'l' && focusedAgent?._managed) { setShowDiagnostics(prev => !prev); return; }
      if (input === 'm' && agents.isAgentAddressable(focusedAgent)) {
        setView('home'); setFocusedAgent(null); setShowDiagnostics(false);
        targetMsgFn(focusedAgent);
        return;
      }
      return;
    }

    if (composer.composeMode === 'launch') {
      if (key.escape) { composer.closeLaunchComposer(); return; }
      if (!agents.canLaunchSelectedTool) {
        const num = parseInt(input, 10);
        if (num >= 1 && num <= agents.launcherChoices.length) {
          agents.selectLaunchTool(agents.launcherChoices[num - 1], selectToolOpts(''));
          return;
        }
      }
      return;
    }

    if (composer.isComposing) { if (key.escape) composer.clearCompose(); return; }

    if (isHomeView) {
      if (key.downArrow) {
        if (mainFocus === 'launcher' && hasLiveAgents) { setMainFocus('agents'); setSelectedIdx(prev => prev >= 0 ? prev : 0); return; }
        if (mainFocus === 'agents' && hasLiveAgents) { setSelectedIdx(prev => Math.min((prev < 0 ? 0 : prev) + 1, liveAgents.length - 1)); return; }
      }
      if (key.upArrow) {
        if (mainFocus === 'agents' && selectedIdx > 0) { setSelectedIdx(prev => Math.max(prev - 1, 0)); return; }
        if (mainFocus === 'agents') { setMainFocus('launcher'); return; }
      }
      if (key.return && mainFocus === 'launcher') { composer.openLaunchComposer(launchComposerOpts()); return; }
      if (key.return && mainSelectedAgent) { setFocusedAgent(mainSelectedAgent); setView('agent-focus'); setShowDiagnostics(false); return; }
      if (input === 'm' && mainSelectedAgent && agents.isAgentAddressable(mainSelectedAgent)) { targetMsgFn(mainSelectedAgent); return; }
      if (input === 'x' && mainSelectedAgent?._managed && !mainSelectedAgent._dead) { agents.handleKillAgent(mainSelectedAgent, agentViewOpts()); return; }
    }

    if (isHomeView && mainFocus === 'launcher') {
      const num = parseInt(input, 10);
      if (num >= 1 && num <= agents.launcherChoices.length) { agents.selectLaunchTool(agents.launcherChoices[num - 1], selectToolOpts('')); return; }
    }

    if (input === 's' && hasLiveAgents) { setView('sessions'); setSelectedIdx(prev => prev >= 0 ? prev : 0); return; }
    if (input === 'o') {
      const result = openPath(projectRoot);
      flash(result.ok ? 'Opened project folder' : `Unable to open project folder${result.error ? `: ${result.error}` : ''}`,
        result.ok ? { tone: 'success', autoClearMs: 4000 } : { tone: 'error' });
      return;
    }
    if (input === 'k' && hasMemories) { setView(prev => prev === 'memory' ? 'home' : 'memory'); setSelectedIdx(-1); memoryManager.resetMemoryNav(); return; }

    if (isSessionsView) {
      if (key.downArrow && hasLiveAgents) { setSelectedIdx(prev => Math.min(prev + 1, liveAgents.length - 1)); return; }
      if (key.upArrow) { setSelectedIdx(prev => prev <= 0 ? -1 : prev - 1); return; }
      if (key.escape) { setView('home'); return; }
      if (key.return) {
        if (selectedIdx >= 0 && selectedIdx < liveAgents.length) { setFocusedAgent(liveAgents[selectedIdx]); setView('agent-focus'); setShowDiagnostics(false); return; }
        composer.beginCommandInput(''); return;
      }
      if (input === 'x' && selectedIdx >= 0) {
        const agent = liveAgents[selectedIdx];
        if (agent?._managed) { agent._dead ? agents.handleRemoveAgent(agent, agentViewOpts()) : agents.handleKillAgent(agent, agentViewOpts()); return; }
      }
      if (input === 'r' && selectedIdx >= 0) {
        const agent = liveAgents[selectedIdx];
        if (agent?._managed && agent._dead) { agents.handleRestartAgent(agent, agentViewOpts()); return; }
      }
    }

    if (isMemoryView) {
      if (key.downArrow && visibleMemories.length > 0) { memoryManager.setMemorySelectedIdx(prev => Math.min(prev + 1, visibleMemories.length - 1)); memoryManager.setDeleteConfirm(false); return; }
      if (key.upArrow) { memoryManager.setMemorySelectedIdx(prev => prev <= 0 ? -1 : prev - 1); memoryManager.setDeleteConfirm(false); return; }
      if (key.escape) { if (memoryManager.deleteConfirm) { memoryManager.setDeleteConfirm(false); return; } setView('home'); return; }
    }

    if (input === 'n' && agents.installedCliAgents.length > 0) { composer.openLaunchComposer(launchComposerOpts()); return; }
    if (input === 'n') { flash('No managed launchers are configured yet.', { tone: 'warning' }); return; }
    if (input === 'u' && agents.installedCliAgents.length > 0) { agents.refreshManagedToolStates({ clearRuntimeFailures: true }); return; }
    if (input === 'f' && agents.unavailableCliAgents.some(tool => agents.getManagedToolState(tool.id).recoveryCommand)) {
      agents.handleFixLauncher(agents.unavailableCliAgents.find(tool => agents.getManagedToolState(tool.id).recoveryCommand));
      return;
    }
    if (input === '/') {
      if (isHomeView || isSessionsView) { composer.beginCommandInput('/'); return; }
      if (isMemoryView) { composer.setComposeMode('memory-search'); return; }
    }
    if (input === 'a' && isMemoryView) { composer.setComposeMode('memory-add'); memoryManager.setMemoryInput(''); return; }
    if (input === 'd' && isMemoryView && memoryManager.memorySelectedIdx >= 0) {
      if (!memoryManager.deleteConfirm) { memoryManager.setDeleteConfirm(true); return; }
      memoryManager.deleteMemoryItem(visibleMemories[memoryManager.memorySelectedIdx]); return;
    }
    if (input === 'q') { navigate('quit'); return; }
  });

  // ── Submit handlers ──────────────────────────────────
  function onComposeSubmit() {
    if (composer.composeMode === 'command') {
      composer.handleCommandSubmit(composer.composeText, {
        readyCliAgents: agents.readyCliAgents, selectedLaunchTool: agents.selectedLaunchTool,
        canLaunchSelectedTool: agents.canLaunchSelectedTool, launchManagedTask: agents.launchManagedTask,
        openLauncherFn: (preselectedTool, initialTaskText) =>
          composer.openLaunchComposer({ ...launchComposerOpts(), preselectedTool, initialTaskText: initialTaskText || '' }),
        refreshManagedToolStates: agents.refreshManagedToolStates, handleFixLauncher: agents.handleFixLauncher,
        liveAgents, selectedAgent, isAgentAddressable: agents.isAgentAddressable,
        setView, setSelectedIdx, setMemorySelectedIdx: memoryManager.setMemorySelectedIdx,
        beginTargetedMessageFn: targetMsgFn, hasMemories,
      });
      return;
    }
    composer.onComposeSubmit(() => {});
  }

  function onTaskLaunchSubmit() {
    composer.onTaskLaunchSubmit({
      selectedLaunchTool: agents.selectedLaunchTool,
      canLaunchSelectedTool: agents.canLaunchSelectedTool,
      launchManagedTask: agents.launchManagedTask,
    });
  }

  function onMemorySubmit() {
    memoryManager.onMemorySubmit();
    composer.setComposeMode(null);
  }

  // ── Nav items ────────────────────────────────────────
  function buildNavItems() {
    if (isAgentFocusView) {
      const items = [{ key: 'esc', label: 'back', color: 'cyan' }];
      if (focusedAgent?._managed && !focusedAgent._dead) items.push({ key: 'x', label: 'stop', color: 'red' });
      if (focusedAgent?._managed && focusedAgent._dead) { items.push({ key: 'r', label: 'restart', color: 'green' }); items.push({ key: 'x', label: 'remove', color: 'red' }); }
      if (agents.isAgentAddressable(focusedAgent)) items.push({ key: 'm', label: 'message', color: 'cyan' });
      if (focusedAgent?._managed) items.push({ key: 'l', label: showDiagnostics ? 'hide diagnostics' : 'diagnostics', color: 'yellow' });
      return items;
    }
    if (composer.isComposing) {
      return [
        { key: 'enter', label: composer.composeMode === 'memory-add' ? 'save' : composer.composeMode === 'memory-search' ? 'search' : 'send', color: 'green' },
        { key: 'esc', label: 'cancel', color: 'cyan' },
      ];
    }
    return [{ key: 'q', label: 'quit', color: 'gray' }];
  }
  const navItems = buildNavItems();

  // ── Shared UI fragments ─────────────────────────────
  const dashboardRail = (
    <Box paddingTop={1}>
      <PanelViewNav
        items={[
          { key: 'overview', label: 'activity', accent: 'cyan' },
          { key: 'agents', label: 'sessions', meta: hasLiveAgents ? String(liveAgents.length) : null, accent: 'green' },
          { key: 'memory', label: 'memory', meta: hasMemories ? String(memories.length) : null, accent: 'magenta' },
        ]}
        activeKey={isAgentFocusView || isSessionsView ? 'agents' : isMemoryView ? 'memory' : 'overview'}
      />
    </Box>
  );

  const commandSuggestions = buildCommandSuggestions(composer, agents, selectedAgent, hasMemories, hasLiveAgents);

  const inputBars = (
    <>
      {composer.composeMode === 'command' && (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          <Box>
            <Text color="cyan">  /{'>'}</Text>
            <TextInput value={composer.composeText} onChange={composer.setComposeText} onSubmit={onComposeSubmit} placeholder="new, fix, recheck, memory" />
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
      {composer.composeMode === 'targeted' && (
        <Box paddingX={1} paddingTop={1}>
          <Text color="cyan">  @{composer.composeTargetLabel || 'agent'}{'> '}</Text>
          <TextInput value={composer.composeText} onChange={composer.setComposeText} onSubmit={onComposeSubmit} placeholder="Send a coordination note..." />
        </Box>
      )}
      {composer.composeMode === 'memory-search' && (
        <Box paddingX={1} paddingTop={1}>
          <Text color="yellow">  memory{'> '}</Text>
          <TextInput value={memoryManager.memorySearch} onChange={memoryManager.setMemorySearch} placeholder="Search shared memory..." />
        </Box>
      )}
      {composer.composeMode === 'memory-add' && (
        <Box paddingX={1} paddingTop={1}>
          <Text color="green">  save{'> '}</Text>
          <TextInput value={memoryManager.memoryInput} onChange={memoryManager.setMemoryInput} onSubmit={onMemorySubmit} placeholder="Save shared memory..." />
        </Box>
      )}
    </>
  );

  const overlayBar = (composer.isComposing || notice) ? (
    <Box paddingTop={1} flexDirection="column">
      {composer.isComposing ? <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">{inputBars}</Box> : null}
      <NoticeLine notice={notice} />
      {composer.isComposing ? <HintRow hints={navItems.map(item => ({ commandKey: item.key, label: item.label, color: item.color || 'cyan' }))} /> : null}
    </Box>
  ) : null;

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
        <Box paddingX={1} paddingTop={1}><HintRow hints={[{ commandKey: 'q', label: 'quit', color: 'gray' }]} /></Box>
      </Box>
    );
  }
  if (!context) {
    return <Box flexDirection="column" paddingX={1} paddingTop={1}><Text dimColor>Loading team context...</Text></Box>;
  }

  // ── Agent focus view ─────────────────────────────────
  if (isAgentFocusView && focusedAgent) {
    return (
      <AgentFocusView
        focusedAgent={focusedAgent}
        combinedAgents={combinedAgents}
        conflicts={conflicts}
        showDiagnostics={showDiagnostics}
        notice={notice}
        navItems={navItems}
        dashboardRail={dashboardRail}
        getAgentDisplayLabel={getDisplayLabel}
        getAgentOriginLabel={agents.getAgentOriginLabel}
        getAgentIntent={agents.getAgentIntent}
        getAgentMeta={agents.getAgentMeta}
        isAgentAddressable={agents.isAgentAddressable}
      />
    );
  }

  // ── Launcher summary ────────────────────────────────
  const launcherSummary = agents.selectedLaunchTool
    ? agents.selectedLaunchTool.name
    : agents.readyCliAgents.length > 1
      ? `Choose from ${agents.readyCliAgents.length} ready tools`
      : agents.checkingCliAgents.length > 0
        ? 'Checking tools'
        : agents.unavailableCliAgents.some(tool => agents.getManagedToolState(tool.id).recoveryCommand)
          ? 'Unavailable. Press [f] or [u].'
          : agents.installedCliAgents.length > 0 ? 'Unavailable. Press [u].' : 'Not configured';

  const mainActionHints = buildMainActionHints(composer, agents, mainFocus, mainSelectedAgent, hasLiveAgents, hasMemories);

  const mainPane = (
    <MainPane
      appVersion={appVersion}
      projectDisplayName={projectDisplayName}
      projectDisplayPath={projectDisplayPath}
      mainFocus={mainFocus}
      launcherSummary={launcherSummary}
      selectedLaunchTool={agents.selectedLaunchTool}
      selectedLaunchToolState={agents.selectedLaunchToolState}
      canLaunchSelectedTool={agents.canLaunchSelectedTool}
      launcherChoices={agents.launcherChoices}
      installedCliAgents={agents.installedCliAgents}
      getManagedToolState={agents.getManagedToolState}
      composeMode={composer.composeMode}
      composeText={composer.composeText}
      setComposeText={composer.setComposeText}
      onTaskLaunchSubmit={onTaskLaunchSubmit}
      liveAgents={liveAgents}
      recentResult={recentResult}
      getRecentResultSummary={agents.getRecentResultSummary}
      visibleSessionRows={visibleSessionRows}
      selectedIdx={selectedIdx}
      getAgentDisplayLabel={getDisplayLabel}
      getAgentIntent={agents.getAgentIntent}
      getAgentOriginLabel={agents.getAgentOriginLabel}
      getIntentColor={agents.getIntentColor}
      mainActionHints={mainActionHints}
      overlayBar={overlayBar}
      dashboardRail={dashboardRail}
    />
  );

  if (isEmpty) return mainPane;

  // ── Memory view ─────────────────────────────────────
  if (isMemoryView) {
    const commandBar = (
      <Box paddingX={1} paddingTop={1} flexDirection="column">
        <Box borderStyle="round" borderColor={composer.isComposing ? 'cyan' : 'gray'} paddingX={1} flexDirection="column">
          {inputBars}
          {!composer.isComposing && <Text dimColor>  {'>'} Press / for commands</Text>}
        </Box>
        <NoticeLine notice={notice} />
        <Box paddingTop={1}>
          <HintRow hints={[
            { commandKey: '/', label: 'search', color: 'cyan' },
            { commandKey: 'a', label: 'add', color: 'green' },
            ...(memoryManager.memorySelectedIdx >= 0 ? [{ commandKey: 'd', label: 'delete', color: 'red' }] : []),
            { commandKey: 'esc', label: 'back', color: 'cyan' },
            { commandKey: 'q', label: 'quit', color: 'gray' },
          ]} />
        </Box>
      </Box>
    );
    return (
      <Box flexDirection="column">
        {dashboardRail}
        <Box flexDirection="column" paddingTop={1}>
          <Text color="magenta" bold>memory</Text>
          <Text dimColor>Shared memory across your agents and teammates.</Text>
        </Box>
        <KnowledgePanel
          memories={memories} filteredMemories={filteredMemories}
          knowledgeVisible={visibleKnowledgeRows.items} windowStart={visibleKnowledgeRows.start}
          memorySearch={memoryManager.memorySearch} memorySelectedIdx={memoryManager.memorySelectedIdx}
          deleteConfirm={memoryManager.deleteConfirm} deleteMsg={memoryManager.deleteMsg}
        />
        {commandBar}
      </Box>
    );
  }

  // ── Sessions view ───────────────────────────────────
  if (isSessionsView) {
    const commandBar = (
      <Box paddingX={1} paddingTop={1} flexDirection="column">
        <Box borderStyle="round" borderColor={composer.isComposing ? 'cyan' : 'gray'} paddingX={1} flexDirection="column">
          {inputBars}
          {!composer.isComposing && <Text dimColor>  {'>'} Press / for commands</Text>}
        </Box>
        <NoticeLine notice={notice} />
        <Box paddingTop={1}>
          <HintRow hints={[
            { commandKey: '↑↓', label: 'select', color: 'cyan' },
            { commandKey: 'q', label: 'quit', color: 'gray' },
          ]} />
        </Box>
      </Box>
    );
    return (
      <Box flexDirection="column">
        {dashboardRail}
        <Box flexDirection="column" paddingTop={1}>
          <Text color="green" bold>sessions</Text>
          <Text dimColor>{liveAgents.length} live session{liveAgents.length === 1 ? '' : 's'} across managed and connected agents.</Text>
        </Box>
        <SessionsPanel
          liveAgents={visibleSessionRows.items} totalCount={liveAgents.length}
          windowStart={visibleSessionRows.start} selectedIdx={selectedIdx}
          getAgentIntent={agents.getAgentIntent} cols={cols}
        />
        {commandBar}
      </Box>
    );
  }

  return mainPane;
}

// ── Pure helper functions ─────────────────────────────

function buildCommandSuggestions(composer, agents, selectedAgent, hasMemories, hasLiveAgents) {
  const commandEntries = [
    { name: '/new', description: 'Start a new task' },
    ...(agents.unavailableCliAgents.some(tool => agents.getManagedToolState(tool.id).recoveryCommand)
      ? [{ name: '/fix', description: 'Open the main setup fix flow' }] : []),
    ...(agents.installedCliAgents.length > 0
      ? [{ name: '/recheck', description: 'Refresh available tools and setup state' }] : []),
    ...(hasMemories ? [{ name: '/memory', description: 'Open shared memory' }] : []),
    ...(hasLiveAgents ? [{ name: '/sessions', description: 'Open the active session list' }] : []),
    ...(selectedAgent && agents.isAgentAddressable(selectedAgent)
      ? [{ name: '/message', description: `Message ${selectedAgent._display}` }] : []),
    { name: '/help', description: 'Show command help' },
  ];
  if (composer.composeMode !== 'command') return [];
  const query = composer.composeText.trim().replace(/^\//, '').toLowerCase();
  return commandEntries.filter((entry) => {
    if (!composer.composeText.trim().startsWith('/')) return false;
    if (!query) return true;
    const normalized = entry.name.slice(1).toLowerCase();
    return normalized.startsWith(query) || entry.description.toLowerCase().includes(query);
  });
}

function buildMainActionHints(composer, agents, mainFocus, mainSelectedAgent, hasLiveAgents, hasMemories) {
  return [
    ...(composer.composeMode === 'launch' && agents.canLaunchSelectedTool ? [{ commandKey: 'enter', label: 'start', color: 'green' }] : []),
    ...(composer.composeMode === 'launch' ? [{ commandKey: 'esc', label: 'close', color: 'cyan' }] : []),
    ...(composer.composeMode !== 'launch' && mainFocus === 'launcher' && agents.installedCliAgents.length > 0 ? [{ commandKey: 'n', label: 'compose', color: 'cyan' }] : []),
    ...(composer.composeMode !== 'launch' && agents.launcherChoices.length > 1 ? [{ commandKey: `1-${agents.launcherChoices.length}`, label: 'pick launcher', color: 'cyan' }] : []),
    ...(hasLiveAgents ? [{ commandKey: '↑↓', label: 'move', color: 'cyan' }] : []),
    ...(mainSelectedAgent ? [{ commandKey: 'enter', label: 'inspect', color: 'cyan' }] : []),
    ...(mainSelectedAgent && agents.isAgentAddressable(mainSelectedAgent) ? [{ commandKey: 'm', label: 'message', color: 'cyan' }] : []),
    ...(mainSelectedAgent?._managed && !mainSelectedAgent._dead ? [{ commandKey: 'x', label: 'stop', color: 'red' }] : []),
    ...(hasLiveAgents ? [{ commandKey: 's', label: 'sessions', color: 'cyan' }] : []),
    ...(hasMemories ? [{ commandKey: 'k', label: 'memory', color: 'magenta' }] : []),
    { commandKey: '/', label: 'commands', color: 'cyan' },
    ...(agents.installedCliAgents.length > 0 ? [{ commandKey: 'u', label: 'recheck', color: 'yellow' }] : []),
    ...(agents.unavailableCliAgents.some(tool => agents.getManagedToolState(tool.id).recoveryCommand) ? [{ commandKey: 'f', label: 'fix', color: 'yellow' }] : []),
    { commandKey: 'o', label: 'folder', color: 'cyan' },
    { commandKey: 'q', label: 'quit', color: 'gray' },
  ];
}

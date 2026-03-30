import { isAgentAddressable } from './dashboard-agent-display.js';
import { MIN_WIDTH } from './dashboard-utils.js';

/**
 * Creates the input handler for the dashboard.
 * Encapsulates all keyboard shortcut logic.
 */
export function createInputHandler({
  // View state
  view, setView,
  mainFocus, setMainFocus,
  selectedIdx, setSelectedIdx,
  focusedAgent, setFocusedAgent,
  showDiagnostics, setShowDiagnostics,
  setHeroInput, setHeroInputActive,
  // Connection
  cols, error, context, connectionRetry,
  // Data
  allVisibleAgents, liveAgents, visibleMemories,
  hasLiveAgents, hasMemories,
  mainSelectedAgent,
  liveAgentNameCounts,
  // Hooks
  agents,
  integrations,
  composer,
  memory,
  // Commands
  commandSuggestions,
  handleCommandSubmit,
  handleOpenWebDashboard,
  // Navigation
  navigate,
}) {
  return function handleInput(input, key) {
    const isHomeView = view === 'home';
    const isSessionsView = view === 'sessions';
    const isMemoryView = view === 'memory';
    const isAgentFocusView = view === 'agent-focus';

    if (cols < MIN_WIDTH) {
      if (input === 'q') navigate('quit');
      return;
    }

    if (input === 'r' && (error || !context)) {
      connectionRetry();
      return;
    }

    // ── Agent focus mode ─────────────────────────────
    if (isAgentFocusView) {
      if (key.escape) {
        setView('home');
        setFocusedAgent(null);
        setShowDiagnostics(false);
        return;
      }
      if (input === 'x' && focusedAgent?._managed) {
        if (focusedAgent._dead) {
          const removed = agents.handleRemoveAgent(focusedAgent, liveAgentNameCounts);
          if (removed) { setView('home'); setFocusedAgent(null); }
        } else {
          agents.handleKillAgent(focusedAgent, liveAgentNameCounts);
          setView('home');
          setFocusedAgent(null);
        }
        return;
      }
      if (input === 'r' && focusedAgent?._managed && focusedAgent._dead) {
        const restarted = agents.handleRestartAgent(focusedAgent);
        if (restarted) { setView('home'); setFocusedAgent(null); }
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
        composer.beginTargetedMessage(focusedAgent);
        return;
      }
      return;
    }

    // ── Compose mode input ───────────────────────────
    if (composer.isComposing) {
      if (key.escape) { composer.clearCompose(); return; }
      if (composer.composeMode === 'command') {
        if (key.downArrow) {
          composer.setCommandSelectedIdx(i => Math.min(i + 1, Math.min(commandSuggestions.length - 1, 5)));
          return;
        }
        if (key.upArrow) {
          composer.setCommandSelectedIdx(i => Math.max(i - 1, 0));
          return;
        }
      }
      return;
    }

    // ── Tool picker overlay ──────────────────────────
    if (agents.toolPickerOpen) {
      const tools = agents.readyCliAgents.length > 0 ? agents.readyCliAgents : agents.installedCliAgents;
      if (key.escape) { agents.setToolPickerOpen(false); return; }
      if (key.downArrow) { agents.setToolPickerIdx(i => Math.min(i + 1, tools.length - 1)); return; }
      if (key.upArrow) { agents.setToolPickerIdx(i => Math.max(i - 1, 0)); return; }
      if (key.return) {
        agents.handleToolPickerSelect(agents.toolPickerIdx);
        return;
      }
      return;
    }

    // ── Home view input ──────────────────────────────
    if (isHomeView) {
      if (input === 'n') {
        agents.openToolPicker();
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
        composer.beginTargetedMessage(mainSelectedAgent);
        return;
      }
      if (input === 'x' && mainSelectedAgent?._managed && !mainSelectedAgent._dead) {
        agents.handleKillAgent(mainSelectedAgent, liveAgentNameCounts);
        return;
      }
    }

    if (input === 's' && hasLiveAgents) {
      setView('sessions');
      setSelectedIdx(prev => prev >= 0 ? prev : 0);
      return;
    }

    if (input === 'w') {
      handleOpenWebDashboard();
      return;
    }

    if (input === 'k' && hasMemories) {
      setView(prev => prev === 'memory' ? 'home' : 'memory');
      setSelectedIdx(-1);
      memory.resetMemorySelection();
      return;
    }

    // ── Sessions view navigation ─────────────────────
    if (isSessionsView) {
      if (key.downArrow && liveAgents.length > 0) {
        setSelectedIdx(prev => Math.min(prev + 1, liveAgents.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIdx(prev => prev <= 0 ? -1 : prev - 1);
        return;
      }
      if (key.escape) { setView('home'); return; }
      if (key.return) {
        if (selectedIdx >= 0 && selectedIdx < allVisibleAgents.length) {
          setFocusedAgent(liveAgents[selectedIdx]);
          setView('agent-focus');
          setShowDiagnostics(false);
          return;
        }
        return;
      }
      if (input === 'x' && selectedIdx >= 0) {
        const agent = liveAgents[selectedIdx];
        if (agent?._managed) {
          if (agent._dead) {
            agents.handleRemoveAgent(agent, liveAgentNameCounts);
          } else {
            agents.handleKillAgent(agent, liveAgentNameCounts);
          }
          return;
        }
      }
      if (input === 'r' && selectedIdx >= 0) {
        const agent = liveAgents[selectedIdx];
        if (agent?._managed && agent._dead) {
          agents.handleRestartAgent(agent);
          return;
        }
      }
    }

    // ── Memory view navigation ───────────────────────
    if (isMemoryView) {
      if (key.downArrow && visibleMemories.length > 0) {
        memory.setMemorySelectedIdx(prev => Math.min(prev + 1, visibleMemories.length - 1));
        memory.setDeleteConfirm(false);
        return;
      }
      if (key.upArrow) {
        memory.setMemorySelectedIdx(prev => prev <= 0 ? -1 : prev - 1);
        memory.setDeleteConfirm(false);
        return;
      }
      if (key.escape) {
        if (memory.deleteConfirm) { memory.setDeleteConfirm(false); return; }
        setView('home');
        return;
      }
    }

    if (input === 'f') {
      const fixableTool = agents.unavailableCliAgents.find(tool => agents.getManagedToolState(tool.id).recoveryCommand);
      if (fixableTool) {
        agents.handleFixLauncher(fixableTool);
        return;
      }
      if (integrations.integrationIssues.length > 0) {
        integrations.repairIntegrations();
        return;
      }
      return;
    }

    if (input === '/') {
      if (isHomeView || isSessionsView) {
        composer.beginCommandInput('');
        return;
      }
      if (isMemoryView) {
        composer.beginMemorySearch();
        return;
      }
    }

    if (input === 'a' && isMemoryView) {
      composer.beginMemoryAdd();
      memory.setMemoryInput('');
      return;
    }

    if (input === 'd' && isMemoryView && memory.memorySelectedIdx >= 0) {
      if (!memory.deleteConfirm) { memory.setDeleteConfirm(true); return; }
      memory.deleteMemoryItem(visibleMemories[memory.memorySelectedIdx]);
      return;
    }

    if (input === 'q') { navigate('quit'); return; }
  };
}

/**
 * Creates the command submit handler.
 */
export function createCommandHandler({
  agents,
  integrations,
  composer,
  memory,
  flash,
  setView,
  setSelectedIdx,
  setHeroInput,
  setHeroInputActive,
  setMainFocus,
  handleOpenWebDashboard,
  liveAgents,
  selectedAgent,
  isAgentAddressable: checkAddressable,
}) {
  return function handleCommandSubmit(rawText) {
    const text = rawText.trim().replace(/^\//, '').trim();
    if (!text) { composer.clearCompose(); return; }

    const [verbRaw, ...restParts] = text.split(/\s+/);
    const verb = verbRaw.toLowerCase();
    const rest = restParts.join(' ').trim();

    if (verb === 'new' || verb === 'start') {
      const explicitTool = rest ? agents.resolveReadyTool(rest) : null;
      const tool = explicitTool || agents.selectedLaunchTool || agents.readyCliAgents[0];
      if (tool) {
        agents.launchManagedTask(tool, '');
      } else {
        flash('No tools ready. Run /recheck.', { tone: 'warning' });
      }
      composer.clearCompose();
      return;
    }

    if (verb === 'fix') {
      const hasLauncherFix = agents.unavailableCliAgents.some(tool => agents.getManagedToolState(tool.id).recoveryCommand);
      if (hasLauncherFix) {
        agents.handleFixLauncher();
      } else {
        integrations.repairIntegrations();
      }
      composer.clearCompose();
      return;
    }

    if (verb === 'repair') {
      integrations.repairIntegrations();
      composer.clearCompose();
      return;
    }

    if (verb === 'recheck' || verb === 'refresh') {
      agents.refreshManagedToolStates({ clearRuntimeFailures: true });
      integrations.refreshIntegrationStatuses({ showFlash: true });
      composer.clearCompose();
      return;
    }

    if (verb === 'doctor') {
      integrations.refreshIntegrationStatuses({ showFlash: true });
      composer.clearCompose();
      return;
    }

    if (verb === 'knowledge' || verb === 'memory') {
      setView('memory');
      memory.setMemorySelectedIdx(-1);
      composer.clearCompose();
      return;
    }

    if (verb === 'sessions' || verb === 'agents' || verb === 'history') {
      setView('sessions');
      setSelectedIdx(liveAgents.length > 0 ? 0 : -1);
      composer.clearCompose();
      return;
    }

    if (verb === 'web' || verb === 'dashboard') {
      handleOpenWebDashboard();
      composer.clearCompose();
      return;
    }

    if (verb === 'message') {
      if (selectedAgent && checkAddressable(selectedAgent)) {
        composer.beginTargetedMessage(selectedAgent);
      } else {
        flash('Select a live agent to message.', { tone: 'warning' });
        composer.clearCompose();
      }
      return;
    }

    if (verb === 'help') {
      flash('Try /new, /doctor, /recheck, /memory, /web, or /sessions.', { tone: 'info' });
      composer.clearCompose();
      return;
    }

    if (agents.selectedLaunchTool && agents.canLaunchSelectedTool) {
      agents.launchManagedTask(agents.selectedLaunchTool, text);
      composer.clearCompose();
      return;
    }

    setHeroInput(text);
    setHeroInputActive(true);
    setMainFocus('input');
    composer.clearCompose();
  };
}

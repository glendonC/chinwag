/**
 * Dashboard view state - reducer + flash notifications.
 *
 * This file used to host a mega-provider with seven contexts (View,
 * Connection, Agent, Composer, Memory, Integration, Data). Six of those
 * had exactly one consumer and existed purely to shuttle hook returns
 * between sibling components. They've been collapsed: DashboardProviders
 * now builds the hooks and passes them explicitly as props, and the
 * DataProvider body lives as a hook at ./hooks/useDashboardData.ts.
 *
 * ViewProvider stays because it has multiple consumers at different
 * nesting levels (the outer DashboardProviders reads `flash` from it,
 * and the inner DashboardViewComponent reads `state`, `dispatch`, and
 * `notice`) - that's the case where a context genuinely earns its
 * keep.
 *
 * useCommandSuggestions stays here because it's still the command
 * palette logic; it has no context dependency, just args in, list out.
 */
import React, {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useReducer,
  useRef,
  useCallback,
  useState,
} from 'react';
import type { Dispatch, ReactNode } from 'react';
import { isAgentAddressable } from './agent-display.js';
import { COMMAND_SUGGESTION_LIMIT } from './constants.js';
import { dashboardReducer, createInitialState } from './reducer.js';
import type { DashboardState, DashboardAction, DashboardNotice, NoticeTone } from './reducer.js';
import type { UseAgentLifecycleReturn } from './agents.js';
import type { UseComposerReturn } from './composer.js';
import type { UseIntegrationDoctorReturn } from './integrations.js';
import type { CombinedAgentRow } from './view.js';

// ── View context ─────────────────────────────────────

interface ViewContextValue {
  state: DashboardState;
  dispatch: Dispatch<DashboardAction>;
  notice: DashboardNotice | null;
  flash: (msg: string, opts?: { tone?: NoticeTone; autoClearMs?: number }) => void;
}

const ViewContext = createContext<ViewContextValue | null>(null);

export function useView(): ViewContextValue {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error('useView must be used within ViewProvider');
  return ctx;
}

interface ViewProviderProps {
  children: ReactNode;
}

/**
 * View state: owns the dashboard reducer (view, selectedIdx, mainFocus,
 * focusedAgent, showDiagnostics, heroInput) plus the flash notification.
 */
export function ViewProvider({ children }: ViewProviderProps): React.ReactNode {
  const [state, dispatch] = useReducer(dashboardReducer, undefined, createInitialState);

  // ── Flash notification ───────────────────────────
  const [notice, setNotice] = useState<DashboardNotice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback(function flash(
    msg: string,
    opts: { tone?: NoticeTone; autoClearMs?: number } = {},
  ) {
    const tone: NoticeTone = typeof opts === 'object' ? opts.tone || 'info' : 'info';
    const autoClearMs = typeof opts === 'object' ? opts.autoClearMs : null;
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
    setNotice({ text: msg, tone });
    if (autoClearMs && autoClearMs > 0) {
      noticeTimer.current = setTimeout(() => {
        setNotice((current) => (current?.text === msg ? null : current));
        noticeTimer.current = null;
      }, autoClearMs);
    }
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const value = useMemo(() => ({ state, dispatch, notice, flash }), [state, notice, flash]);

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

// ── Command palette hook ────────────────────────────

export interface CommandSuggestion {
  name: string;
  description: string;
}

interface UseCommandSuggestionsArgs {
  composer: UseComposerReturn;
  agents: UseAgentLifecycleReturn;
  integrations: UseIntegrationDoctorReturn;
  hasMemories: boolean;
  hasLiveAgents: boolean;
  selectedAgent: CombinedAgentRow | null;
}

/**
 * Command suggestions derived from agent/memory/integration state.
 * Pure hook - no provider needed.
 */
export function useCommandSuggestions({
  composer,
  agents,
  integrations,
  hasMemories,
  hasLiveAgents,
  selectedAgent,
}: UseCommandSuggestionsArgs): CommandSuggestion[] {
  const commandEntries = useMemo(
    () => [
      { name: '/new', description: 'Open a tool in a new terminal tab' },
      ...(agents.unavailableCliAgents.some(
        (tool) => agents.getManagedToolState(tool.id).recoveryCommand,
      ) || integrations.integrationIssues.length > 0
        ? [{ name: '/fix', description: 'Open the main setup fix flow' }]
        : []),
      { name: '/recheck', description: 'Refresh available tools and integration health' },
      { name: '/doctor', description: 'Scan local Chinmeister integration health' },
      ...(integrations.integrationIssues.length > 0
        ? [{ name: '/repair', description: 'Repair detected integration issues' }]
        : []),
      ...(hasMemories ? [{ name: '/knowledge', description: 'View shared knowledge' }] : []),
      ...(hasLiveAgents ? [{ name: '/history', description: 'View past agent activity' }] : []),
      { name: '/web', description: 'Open chinmeister in browser' },
      ...(selectedAgent && isAgentAddressable(selectedAgent)
        ? [{ name: '/message', description: `Message ${selectedAgent._display}` }]
        : []),
      { name: '/help', description: 'Show command help' },
    ],
    [agents, integrations, hasMemories, hasLiveAgents, selectedAgent],
  );

  const commandQuery =
    composer.composeMode === 'command'
      ? composer.composeText.trim().replace(/^\//, '').toLowerCase()
      : '';

  const commandSuggestions = useMemo(() => {
    if (composer.composeMode !== 'command') return [];
    return commandEntries
      .filter((entry) => {
        if (!commandQuery) return true;
        const normalized = entry.name.slice(1).toLowerCase();
        return (
          normalized.startsWith(commandQuery) ||
          entry.description.toLowerCase().includes(commandQuery)
        );
      })
      .slice(0, COMMAND_SUGGESTION_LIMIT + 1);
  }, [composer.composeMode, commandEntries, commandQuery]);

  return commandSuggestions;
}

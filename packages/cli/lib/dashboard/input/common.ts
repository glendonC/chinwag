/**
 * Shared types and interfaces used across all input handlers.
 */
import type { Dispatch } from 'react';
import type { DashboardState, DashboardAction, NoticeTone } from '../reducer.js';
import type { CombinedAgentRow, MemoryEntry, TeamContext } from '../view.js';
import type { UseAgentLifecycleReturn } from '../agents.js';
import type { UseIntegrationDoctorReturn } from '../integrations.js';
import type { UseComposerReturn } from '../composer.js';
import type { UseMemoryManagerReturn } from '../memory.js';

export interface InkKey {
  escape?: boolean;
  return?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
}

export interface CommandSuggestion {
  name: string;
  description?: string;
}

export interface InputHandlerContext {
  state: DashboardState;
  dispatch: Dispatch<DashboardAction>;
  cols: number;
  error: string | null;
  context: TeamContext | null;
  connectionRetry: () => void;
  allVisibleAgents: CombinedAgentRow[];
  liveAgents: CombinedAgentRow[];
  visibleMemories: MemoryEntry[];
  hasLiveAgents: boolean;
  hasMemories: boolean;
  mainSelectedAgent: CombinedAgentRow | null;
  liveAgentNameCounts: Map<string, number>;
  agents: UseAgentLifecycleReturn;
  integrations: UseIntegrationDoctorReturn;
  composer: UseComposerReturn;
  memory: UseMemoryManagerReturn;
  commandSuggestions: CommandSuggestion[];
  handleCommandSubmit: (text: string) => void;
  handleOpenWebDashboard: () => void;
  navigate: (target: string) => void;
}

export interface CreateInputHandlerParams {
  state: DashboardState;
  dispatch: Dispatch<DashboardAction>;
  cols: number;
  error: string | null;
  context: TeamContext | null;
  connectionRetry: () => void;
  allVisibleAgents: CombinedAgentRow[];
  liveAgents: CombinedAgentRow[];
  visibleMemories: MemoryEntry[];
  hasLiveAgents: boolean;
  hasMemories: boolean;
  mainSelectedAgent: CombinedAgentRow | null;
  liveAgentNameCounts: Map<string, number>;
  agents: UseAgentLifecycleReturn;
  integrations: UseIntegrationDoctorReturn;
  composer: UseComposerReturn;
  memory: UseMemoryManagerReturn;
  commandSuggestions: CommandSuggestion[];
  handleCommandSubmit: (text: string) => void;
  handleOpenWebDashboard: () => void;
  navigate: (target: string) => void;
}

export interface CreateCommandHandlerParams {
  agents: UseAgentLifecycleReturn;
  integrations: UseIntegrationDoctorReturn;
  composer: UseComposerReturn;
  memory: UseMemoryManagerReturn;
  flash: (text: string, options?: { tone?: NoticeTone }) => void;
  dispatch: Dispatch<DashboardAction>;
  handleOpenWebDashboard: () => void;
  liveAgents: CombinedAgentRow[];
  selectedAgent: CombinedAgentRow | null;
  isAgentAddressable: (agent: CombinedAgentRow | null | undefined) => boolean;
}

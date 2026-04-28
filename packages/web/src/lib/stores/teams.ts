import { type z } from 'zod';
import { createStore, useStore } from 'zustand';
import { api } from '../api.js';
import { createEmptyUserTeams, userTeamsSchema, validateResponse } from '../apiSchemas.js';
import { authActions } from './auth.js';
import { requestRefresh } from './refresh.js';
import { isDemoActive, getActiveScenarioId } from '../demoMode.js';
import { getDemoData } from '../demo/index.js';

type UserTeams = z.infer<typeof userTeamsSchema>;
type Team = UserTeams['teams'][number];

/** Set of team IDs we've joined this session (for the /join call) */
const joinedTeams = new Set<string>();
let joinedTeamsToken: string | null = null;

function syncJoinedTeamsCache(token: string | null): void {
  if (joinedTeamsToken !== token) {
    joinedTeams.clear();
    joinedTeamsToken = token;
  }
}

interface TeamLoadError {
  status?: number;
  message?: string;
  name?: string;
}

function formatTeamLoadError(err: TeamLoadError | null | undefined): string {
  if (err?.status === 401) return 'Your session expired. Sign in again.';
  if (err?.status === 408) return 'Request timed out while loading projects.';
  if (err?.message?.includes('Failed to fetch') || err?.name === 'TypeError') {
    return 'Cannot reach server to load projects.';
  }
  return err?.message || 'Could not load projects.';
}

interface TeamState {
  teams: Team[];
  activeTeamId: string | null;
  teamsError: string | null;
  loadTeams: (autoSelect?: boolean) => Promise<void>;
  selectTeam: (teamId: string | null) => void;
  ensureJoined: (teamId: string) => Promise<void>;
}

const teamStore = createStore<TeamState>((set) => ({
  teams: [],
  activeTeamId: null,
  teamsError: null,

  /**
   * Load all teams for the current user.
   * On boot (autoSelect=true, the default): auto-selects the single team
   * if there's exactly one, otherwise overview.
   * On refresh (autoSelect=false): updates the team list but preserves the
   * current activeTeamId to avoid fighting with the URL sync effect.
   */
  async loadTeams(autoSelect = true) {
    const { token } = authActions.getState();
    syncJoinedTeamsCache(token);
    // Demo path: read teams from the active scenario instead of /me/teams.
    if (isDemoActive()) {
      const teamList = getDemoData(getActiveScenarioId()).teams.teams;
      const teamIds = new Set(teamList.map((t) => t.team_id));
      if (autoSelect) {
        set({
          teams: teamList,
          activeTeamId: teamList.length === 1 ? teamList[0].team_id : null,
          teamsError: null,
        });
      } else {
        set((state) => ({
          teams: teamList,
          activeTeamId:
            state.activeTeamId && teamIds.has(state.activeTeamId) ? state.activeTeamId : null,
          teamsError: null,
        }));
      }
      return;
    }
    try {
      const rawResult = await api('GET', '/me/teams', null, token);
      const result = validateResponse(userTeamsSchema, rawResult, 'me-teams', {
        fallback: createEmptyUserTeams(),
      }) as UserTeams;
      const teamList = result.teams || [];
      const teamIds = new Set(teamList.map((t) => t.team_id));
      if (autoSelect) {
        set({
          teams: teamList,
          activeTeamId: teamList.length === 1 ? teamList[0].team_id : null,
          teamsError: null,
        });
      } else {
        // Preserve activeTeamId if the team still exists; clear if it was removed
        set((state) => ({
          teams: teamList,
          activeTeamId:
            state.activeTeamId && teamIds.has(state.activeTeamId) ? state.activeTeamId : null,
          teamsError: null,
        }));
      }
    } catch (err) {
      set({
        teams: [],
        activeTeamId: null,
        teamsError: formatTeamLoadError(err as TeamLoadError),
      });
    }
  },

  /** Select a specific team (or null for overview). */
  selectTeam(teamId: string | null) {
    set({ activeTeamId: teamId });
  },

  /**
   * Ensure we've joined a team (POST /teams/{id}/join).
   * Only calls once per session per team.
   */
  async ensureJoined(teamId: string) {
    const { token } = authActions.getState();
    syncJoinedTeamsCache(token);
    if (joinedTeams.has(teamId)) return;
    // Demo path: pretend the join succeeded. Demo teams come pre-joined
    // so this is just bookkeeping; no /join request goes out.
    if (isDemoActive()) {
      joinedTeams.add(teamId);
      return;
    }
    try {
      await api('POST', `/teams/${teamId}/join`, {}, token);
      joinedTeams.add(teamId);
    } catch {
      // non-critical - continue even if join fails
    }
  },
}));

// Re-load teams when the demo toggle flips so the sidebar list swaps in
// lockstep with the rest of the demo overlay. autoSelect=false to preserve
// the user's current routing intent (e.g. they were on Overview, stay on
// Overview rather than getting auto-selected into a team).
if (typeof window !== 'undefined') {
  window.addEventListener('chinmeister:demo-scenario-changed', () => {
    teamStore
      .getState()
      .loadTeams(false)
      .catch(() => {});
  });
}

/** React hook - use inside components */
export function useTeamStore<T>(selector: (state: TeamState) => T): T {
  return useStore(teamStore, selector);
}

/** Clear the per-session join cache for a specific team so the next
 *  ensureJoined() call actually POSTs /join again. Called when a poll
 *  returns NOT_MEMBER - the member row was evicted server-side. */
export function clearJoinedCache(teamId: string): void {
  joinedTeams.delete(teamId);
}

/** Direct access - use outside components */
export const teamActions = {
  getState: (): TeamState => teamStore.getState(),
  loadTeams: (autoSelect?: boolean): Promise<void> => teamStore.getState().loadTeams(autoSelect),
  selectTeam: (id: string | null): void => teamStore.getState().selectTeam(id),
  ensureJoined: (id: string): Promise<void> => teamStore.getState().ensureJoined(id),
  subscribe: teamStore.subscribe,

  async updateMemory(teamId: string, id: string, text?: string, tags?: string[]): Promise<void> {
    if (isDemoActive()) return;
    const { token } = authActions.getState();
    const body: Record<string, unknown> = { id };
    if (text !== undefined) body.text = text;
    if (tags !== undefined) body.tags = tags;
    await api('PUT', `/teams/${teamId}/memory`, body, token);
    requestRefresh();
  },

  async deleteMemory(teamId: string, id: string): Promise<void> {
    if (isDemoActive()) return;
    const { token } = authActions.getState();
    await api('DELETE', `/teams/${teamId}/memory`, { id }, token);
    requestRefresh();
  },

  async createCategory(
    teamId: string,
    name: string,
    description?: string,
    color?: string,
  ): Promise<void> {
    if (isDemoActive()) return;
    const { token } = authActions.getState();
    const body: Record<string, unknown> = { name };
    if (description !== undefined) body.description = description;
    if (color !== undefined) body.color = color;
    await api('POST', `/teams/${teamId}/categories`, body, token);
    requestRefresh();
  },

  async updateCategory(
    teamId: string,
    id: string,
    name?: string,
    description?: string,
    color?: string,
  ): Promise<void> {
    if (isDemoActive()) return;
    const { token } = authActions.getState();
    const body: Record<string, unknown> = { id };
    if (name !== undefined) body.name = name;
    if (description !== undefined) body.description = description;
    if (color !== undefined) body.color = color;
    await api('PUT', `/teams/${teamId}/categories`, body, token);
    requestRefresh();
  },

  async deleteCategory(teamId: string, id: string): Promise<void> {
    if (isDemoActive()) return;
    const { token } = authActions.getState();
    await api('DELETE', `/teams/${teamId}/categories`, { id }, token);
    requestRefresh();
  },

  async sendMessage(teamId: string, text: string, target?: string): Promise<void> {
    if (isDemoActive()) return;
    const { token } = authActions.getState();
    const body: Record<string, string> = { text };
    if (target) body.target = target;
    await api('POST', `/teams/${teamId}/messages`, body, token);
    requestRefresh();
  },

  async submitCommand(
    teamId: string,
    type: 'spawn' | 'stop' | 'message',
    payload: Record<string, unknown>,
  ): Promise<{ ok?: boolean; id?: string; warning?: string; error?: string }> {
    if (isDemoActive()) {
      // Pretend the command was accepted. UI shows the optimistic state and
      // the next demo poll reasserts the baseline.
      return { ok: true };
    }
    const { token } = authActions.getState();
    const result = await api<{ ok?: boolean; id?: string; warning?: string; error?: string }>(
      'POST',
      `/teams/${teamId}/commands`,
      { type, payload },
      token,
    );
    requestRefresh();
    return result;
  },
};

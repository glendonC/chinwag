import { createStore, useStore } from 'zustand';
import { api } from '../api.js';
import { authActions } from './auth.js';
import { requestRefresh } from './refresh.js';

/** Set of team IDs we've joined this session (for the /join call) */
const joinedTeams = new Set();
let joinedTeamsToken = null;

function syncJoinedTeamsCache(token) {
  if (joinedTeamsToken !== token) {
    joinedTeams.clear();
    joinedTeamsToken = token;
  }
}

function formatTeamLoadError(err) {
  if (err?.status === 401) return 'Your session expired. Sign in again.';
  if (err?.status === 408) return 'Request timed out while loading projects.';
  if (err?.message?.includes('Failed to fetch') || err?.name === 'TypeError') {
    return 'Cannot reach server to load projects.';
  }
  return err?.message || 'Could not load projects.';
}

const teamStore = createStore((set) => ({
  teams: [],
  activeTeamId: null,
  teamsError: null,

  /**
   * Load all teams for the current user.
   * Auto-selects overview if 2+ teams, or the single team if only 1.
   */
  async loadTeams() {
    const { token } = authActions.getState();
    syncJoinedTeamsCache(token);
    try {
      const result = await api('GET', '/me/teams', null, token);
      const teamList = result.teams || [];
      set({
        teams: teamList,
        activeTeamId: teamList.length === 1 ? teamList[0].team_id : null,
        teamsError: null,
      });
    } catch (err) {
      set({
        teams: [],
        activeTeamId: null,
        teamsError: formatTeamLoadError(err),
      });
    }
  },

  /** Select a specific team (or null for overview). */
  selectTeam(teamId) {
    set({ activeTeamId: teamId });
  },

  /**
   * Ensure we've joined a team (POST /teams/{id}/join).
   * Only calls once per session per team.
   */
  async ensureJoined(teamId) {
    const { token } = authActions.getState();
    syncJoinedTeamsCache(token);
    if (joinedTeams.has(teamId)) return;
    try {
      await api('POST', `/teams/${teamId}/join`, {}, token);
      joinedTeams.add(teamId);
    } catch {
      // non-critical — continue even if join fails
    }
  },
}));

/** React hook — use inside components */
export function useTeamStore(selector) {
  return useStore(teamStore, selector);
}

/** Direct access — use outside components */
export const teamActions = {
  getState: () => teamStore.getState(),
  loadTeams: () => teamStore.getState().loadTeams(),
  selectTeam: (id) => teamStore.getState().selectTeam(id),
  ensureJoined: (id) => teamStore.getState().ensureJoined(id),
  subscribe: teamStore.subscribe,

  async updateMemory(teamId, id, text, category) {
    const { token } = authActions.getState();
    const body = { id };
    if (text !== undefined) body.text = text;
    if (category !== undefined) body.category = category;
    await api('PUT', `/teams/${teamId}/memory`, body, token);
    requestRefresh();
  },

  async deleteMemory(teamId, id) {
    const { token } = authActions.getState();
    await api('DELETE', `/teams/${teamId}/memory`, { id }, token);
    requestRefresh();
  },

  async sendMessage(teamId, text, target) {
    const { token } = authActions.getState();
    const body = { text };
    if (target) body.target = target;
    await api('POST', `/teams/${teamId}/messages`, body, token);
    requestRefresh();
  },
};

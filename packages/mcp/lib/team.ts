import {
  TEAM_ID_PATTERN,
  isValidTeamId,
  findTeamFile as findTeamFileShared,
} from '../../shared/team-utils.js';
import type { TeamContext, ConflictInfo, LockedFileInfo, MemoryInfo } from './utils/display.js';

export { TEAM_ID_PATTERN, isValidTeamId };

/** API client interface expected by teamHandlers. */
export interface ApiClient {
  get(path: string): Promise<any>;
  post(path: string, body: Record<string, unknown>): Promise<any>;
  put(path: string, body: Record<string, unknown>): Promise<any>;
  del(path: string, body?: Record<string, unknown>): Promise<any>;
}

/** Conflict check result from the API. */
export interface ConflictCheckResult {
  conflicts: ConflictInfo[];
  locked: LockedFileInfo[];
}

/** Lock claim result from the API. */
export interface ClaimResult {
  claimed: string[];
  blocked: Array<{ file: string; held_by: string; tool?: string }>;
}

/** Session start result from the API. */
export interface SessionResult {
  session_id: string;
}

/** Memory search result from the API. */
export interface MemorySearchResult {
  memories: MemoryInfo[];
}

/** Standard API result for mutating operations. */
export interface OkResult {
  ok?: boolean;
  error?: string;
}

/** All team handler methods available to tools. */
export interface TeamHandlers {
  joinTeam(teamId: string, name?: string | null): Promise<OkResult>;
  leaveTeam(teamId: string): Promise<OkResult>;
  updateActivity(teamId: string, files: string[], summary: string): Promise<OkResult>;
  checkConflicts(teamId: string, files: string[]): Promise<ConflictCheckResult>;
  getTeamContext(teamId: string): Promise<TeamContext>;
  heartbeat(teamId: string): Promise<OkResult>;
  reportFile(teamId: string, file: string): Promise<OkResult>;
  saveMemory(teamId: string, text: string, tags?: string[]): Promise<OkResult>;
  searchMemories(
    teamId: string,
    query?: string,
    tags?: string[],
    limit?: number,
  ): Promise<MemorySearchResult>;
  updateMemory(teamId: string, id: string, text?: string, tags?: string[]): Promise<OkResult>;
  deleteMemory(teamId: string, id: string): Promise<OkResult>;
  claimFiles(teamId: string, files: string[]): Promise<ClaimResult>;
  releaseFiles(teamId: string, files?: string[]): Promise<OkResult>;
  sendMessage(teamId: string, text: string, target?: string): Promise<OkResult>;
  startSession(teamId: string, framework?: string): Promise<SessionResult>;
  endSession(teamId: string, sessionId: string): Promise<OkResult>;
  recordEdit(teamId: string, file: string): Promise<OkResult>;
  reportModel(teamId: string, model: string): Promise<OkResult>;
}

/**
 * Find .chinwag file and return the team ID, or null.
 * Wraps the shared findTeamFile to preserve the MCP-expected return type (string | null).
 */
export function findTeamFile(cwd: string = process.cwd()): string | null {
  const result = findTeamFileShared(cwd);
  return result ? result.teamId : null;
}

export function teamHandlers(client: ApiClient): TeamHandlers {
  function validateTeam(teamId: string): void {
    if (!teamId || !isValidTeamId(teamId)) throw new Error('Invalid or missing team ID');
  }

  return {
    async joinTeam(teamId, name = null) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/join`, name ? { name } : {});
    },

    async leaveTeam(teamId) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/leave`, {});
    },

    async updateActivity(teamId, files, summary) {
      validateTeam(teamId);
      return client.put(`/teams/${teamId}/activity`, { files, summary });
    },

    async checkConflicts(teamId, files) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/conflicts`, { files });
    },

    async getTeamContext(teamId) {
      validateTeam(teamId);
      return client.get(`/teams/${teamId}/context`);
    },

    async heartbeat(teamId) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/heartbeat`, {});
    },

    async reportFile(teamId, file) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/file`, { file });
    },

    async saveMemory(teamId, text, tags) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/memory`, { text, tags: tags || [] });
    },

    async searchMemories(teamId, query, tags, limit) {
      validateTeam(teamId);
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (tags?.length) params.set('tags', tags.join(','));
      if (limit) params.set('limit', String(limit));
      const qs = params.toString();
      return client.get(`/teams/${teamId}/memory${qs ? '?' + qs : ''}`);
    },

    async updateMemory(teamId, id, text, tags) {
      validateTeam(teamId);
      const body: Record<string, unknown> = { id };
      if (text !== undefined) body.text = text;
      if (tags !== undefined) body.tags = tags;
      return client.put(`/teams/${teamId}/memory`, body);
    },

    async deleteMemory(teamId, id) {
      validateTeam(teamId);
      return client.del(`/teams/${teamId}/memory`, { id });
    },

    async claimFiles(teamId, files) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/locks`, { files });
    },

    async releaseFiles(teamId, files) {
      validateTeam(teamId);
      return client.del(`/teams/${teamId}/locks`, files ? { files } : {});
    },

    async sendMessage(teamId, text, target) {
      validateTeam(teamId);
      const body: Record<string, unknown> = { text };
      if (target) body.target = target;
      return client.post(`/teams/${teamId}/messages`, body);
    },

    async startSession(teamId, framework) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/sessions`, { framework });
    },

    async endSession(teamId, sessionId) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/sessionend`, { session_id: sessionId });
    },

    async recordEdit(teamId, file) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/sessionedit`, { file });
    },

    async reportModel(teamId, model) {
      validateTeam(teamId);
      return client.put(`/teams/${teamId}/sessionmodel`, { model });
    },
  };
}

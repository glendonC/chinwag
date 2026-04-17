import {
  TEAM_ID_PATTERN,
  isValidTeamId,
  findTeamFile as findTeamFileShared,
} from '@chinwag/shared/team-utils.js';
import type { TeamContext, ConflictInfo, LockedFileInfo, MemoryInfo } from './utils/display.js';

export { TEAM_ID_PATTERN, isValidTeamId };

/** API client interface expected by teamHandlers. */
export interface ApiClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T>;
  put<T = unknown>(path: string, body: Record<string, unknown>): Promise<T>;
  del<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T>;
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

/** Standard API result for mutating operations — discriminated union. */
export type OkResult = ({ ok: true } & Record<string, unknown>) | { ok: false; error: string };

/** Team membership: join, leave, heartbeat. */
export interface TeamMemberHandlers {
  joinTeam(teamId: string, name?: string | null): Promise<OkResult>;
  leaveTeam(teamId: string): Promise<OkResult>;
  heartbeat(teamId: string): Promise<OkResult>;
}

/** Activity reporting: status updates, file tracking, conflict checks, context. */
export interface TeamActivityHandlers {
  updateActivity(teamId: string, files: string[], summary: string): Promise<OkResult>;
  checkConflicts(teamId: string, files: string[]): Promise<ConflictCheckResult>;
  getTeamContext(teamId: string): Promise<TeamContext>;
  reportFile(teamId: string, file: string): Promise<OkResult>;
}

export interface SearchMemoryFilters {
  sessionId?: string | undefined;
  agentId?: string | undefined;
  handle?: string | undefined;
  after?: string | undefined;
  before?: string | undefined;
}

/** Shared memory: save, search, update, delete. */
export interface TeamMemoryHandlers {
  saveMemory(teamId: string, text: string, tags?: string[]): Promise<OkResult>;
  searchMemories(
    teamId: string,
    query?: string,
    tags?: string[],
    categories?: string[],
    limit?: number,
    filters?: SearchMemoryFilters,
  ): Promise<MemorySearchResult>;
  updateMemory(teamId: string, id: string, text?: string, tags?: string[]): Promise<OkResult>;
  deleteMemory(teamId: string, id: string): Promise<OkResult>;
  deleteMemoriesBatch(
    teamId: string,
    filter: { ids?: string[]; tags?: string[]; before?: string },
  ): Promise<OkResult & { deleted?: number }>;
}

/** Coordination: file locks, messaging, sessions. */
export interface TeamCoordinationHandlers {
  claimFiles(teamId: string, files: string[]): Promise<ClaimResult>;
  releaseFiles(teamId: string, files?: string[]): Promise<OkResult>;
  sendMessage(teamId: string, text: string, target?: string): Promise<OkResult>;
  startSession(teamId: string, framework?: string): Promise<SessionResult>;
  endSession(teamId: string, sessionId: string): Promise<OkResult>;
  recordEdit(
    teamId: string,
    file: string,
    linesAdded?: number,
    linesRemoved?: number,
  ): Promise<OkResult>;
  reportOutcome(teamId: string, outcome: string, summary?: string | null): Promise<OkResult>;
  recordCommits(
    teamId: string,
    sessionId: string,
    commits: Array<{
      sha: string;
      branch?: string | undefined;
      message?: string | undefined;
      files_changed?: number | undefined;
      lines_added?: number | undefined;
      lines_removed?: number | undefined;
      committed_at?: string | undefined;
    }>,
  ): Promise<OkResult>;
  reportModel(teamId: string, model: string): Promise<OkResult>;
  recordToolCalls(
    teamId: string,
    sessionId: string,
    calls: Array<{
      tool: string;
      at: number;
      is_error?: boolean | undefined;
      error_preview?: string | undefined;
      duration_ms?: number | undefined;
    }>,
  ): Promise<OkResult>;
  recordSessionTokens(
    teamId: string,
    sessionId: string,
    tokens: {
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens?: number | undefined;
      cache_creation_tokens?: number | undefined;
    },
  ): Promise<OkResult>;
}

/** All team handler methods available to tools. */
export type TeamHandlers = TeamMemberHandlers &
  TeamActivityHandlers &
  TeamMemoryHandlers &
  TeamCoordinationHandlers;

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

    async searchMemories(teamId, query, tags, categories, limit, filters) {
      validateTeam(teamId);
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (tags?.length) params.set('tags', tags.join(','));
      if (categories?.length) params.set('categories', categories.join(','));
      if (limit) params.set('limit', String(limit));
      if (filters?.sessionId) params.set('session_id', filters.sessionId);
      if (filters?.agentId) params.set('agent_id', filters.agentId);
      if (filters?.handle) params.set('handle', filters.handle);
      if (filters?.after) params.set('after', filters.after);
      if (filters?.before) params.set('before', filters.before);
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

    async deleteMemoriesBatch(teamId, filter) {
      validateTeam(teamId);
      return client.del(`/teams/${teamId}/memory/batch`, filter);
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

    async recordEdit(teamId, file, linesAdded, linesRemoved) {
      validateTeam(teamId);
      const body: Record<string, unknown> = { file };
      if (linesAdded) body.lines_added = linesAdded;
      if (linesRemoved) body.lines_removed = linesRemoved;
      return client.post(`/teams/${teamId}/sessionedit`, body);
    },

    async reportOutcome(teamId, outcome, summary) {
      validateTeam(teamId);
      const body: Record<string, unknown> = { outcome };
      if (summary) body.summary = summary;
      return client.put(`/teams/${teamId}/sessionoutcome`, body);
    },

    async recordCommits(teamId, sessionId, commits) {
      validateTeam(teamId);
      const body: Record<string, unknown> = { commits };
      if (sessionId) body.session_id = sessionId;
      return client.post(`/teams/${teamId}/commits`, body);
    },

    async reportModel(teamId, model) {
      validateTeam(teamId);
      return client.put(`/teams/${teamId}/sessionmodel`, { model });
    },

    async recordToolCalls(teamId, sessionId, calls) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/tool-calls`, { session_id: sessionId, calls });
    },

    async recordSessionTokens(teamId, sessionId, tokens) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/sessiontokens`, {
        session_id: sessionId,
        input_tokens: tokens.input_tokens,
        output_tokens: tokens.output_tokens,
        cache_read_tokens: tokens.cache_read_tokens ?? 0,
        cache_creation_tokens: tokens.cache_creation_tokens ?? 0,
      });
    },
  };
}

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

const TEAM_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isValidTeamId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 30 && TEAM_ID_PATTERN.test(id);
}

export function findTeamFile(cwd = process.cwd()) {
  let dir = cwd;
  while (true) {
    const filePath = join(dir, '.chinwag');
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        const teamId = data.team || null;
        if (teamId && !isValidTeamId(teamId)) return null;
        return teamId;
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function teamHandlers(client) {
  function validateTeam(teamId) {
    if (!teamId || !isValidTeamId(teamId)) throw new Error('Invalid or missing team ID');
  }

  // ── Full API surface ─────────────────────────────────────────────
  // Client wrappers for all team endpoints. Not all are called by
  // current MCP tools/hooks/channels — kept for future features.

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

    async saveMemory(teamId, text, category) {
      validateTeam(teamId);
      return client.post(`/teams/${teamId}/memory`, { text, category });
    },

    async searchMemories(teamId, query, category, limit) {
      validateTeam(teamId);
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (category) params.set('category', category);
      if (limit) params.set('limit', String(limit));
      const qs = params.toString();
      return client.get(`/teams/${teamId}/memory${qs ? '?' + qs : ''}`);
    },

    async updateMemory(teamId, id, text, category) {
      validateTeam(teamId);
      const body = { id };
      if (text !== undefined) body.text = text;
      if (category !== undefined) body.category = category;
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

    async getLockedFiles(teamId) {
      validateTeam(teamId);
      return client.get(`/teams/${teamId}/locks`);
    },

    async sendMessage(teamId, text, target) {
      validateTeam(teamId);
      const body = { text };
      if (target) body.target = target;
      return client.post(`/teams/${teamId}/messages`, body);
    },

    async getMessages(teamId, since) {
      validateTeam(teamId);
      const qs = since ? `?since=${encodeURIComponent(since)}` : '';
      return client.get(`/teams/${teamId}/messages${qs}`);
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

    async getHistory(teamId, days = 7) {
      validateTeam(teamId);
      return client.get(`/teams/${teamId}/history?days=${days}`);
    },
  };
}

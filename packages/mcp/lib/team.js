import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export function findTeamFile(cwd = process.cwd()) {
  const filePath = join(cwd, '.chinwag');
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      return data.team || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function teamHandlers(client) {
  return {
    async joinTeam(teamId) {
      return client.post(`/teams/${teamId}/join`, {});
    },

    async leaveTeam(teamId) {
      return client.post(`/teams/${teamId}/leave`, {});
    },

    async updateActivity(teamId, files, summary) {
      return client.put(`/teams/${teamId}/activity`, { files, summary });
    },

    async checkConflicts(teamId, files) {
      return client.post(`/teams/${teamId}/conflicts`, { files });
    },

    async getTeamContext(teamId) {
      return client.get(`/teams/${teamId}/context`);
    },

    async heartbeat(teamId) {
      return client.post(`/teams/${teamId}/heartbeat`, {});
    },

    async reportFile(teamId, file) {
      return client.post(`/teams/${teamId}/file`, { file });
    },

    async saveMemory(teamId, text, category) {
      return client.post(`/teams/${teamId}/memory`, { text, category });
    },

    async startSession(teamId, framework) {
      return client.post(`/teams/${teamId}/sessions`, { framework });
    },

    async endSession(teamId, sessionId) {
      return client.post(`/teams/${teamId}/sessionend`, { session_id: sessionId });
    },

    async recordEdit(teamId, file) {
      return client.post(`/teams/${teamId}/sessionedit`, { file });
    },

    async getHistory(teamId, days = 7) {
      return client.get(`/teams/${teamId}/history?days=${days}`);
    },
  };
}

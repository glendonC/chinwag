import type { LiveAgent } from './types.js';

export interface FileGroup {
  teamId: string;
  file: string;
  agents: LiveAgent[];
}

// Group live-agent file claims by (team, file). A file keyed across
// different teams is not the same file — router.ts in repo A is not
// router.ts in repo B.
export function groupFilesByTeam(liveAgents: LiveAgent[]): FileGroup[] {
  const map = new Map<string, FileGroup>();
  for (const agent of liveAgents) {
    for (const file of agent.files) {
      const key = `${agent.teamId}\u0000${file}`;
      const existing = map.get(key);
      if (existing) {
        existing.agents.push(agent);
      } else {
        map.set(key, { teamId: agent.teamId, file, agents: [agent] });
      }
    }
  }
  return [...map.values()];
}

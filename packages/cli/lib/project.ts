import { findTeamFile } from '@chinmeister/shared/team-utils.js';

interface ProjectContext {
  filePath: string;
  root: string;
  teamId: string;
  teamName: string;
}

export function getProjectContext(cwd: string = process.cwd()): ProjectContext | null {
  const result = findTeamFile(cwd);
  if (!result) return null;
  return {
    filePath: result.filePath,
    root: result.root,
    teamId: result.teamId,
    teamName: result.teamName,
  };
}

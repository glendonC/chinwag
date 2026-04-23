import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseBudgetConfig, type BudgetConfig } from './budget-config.js';

export interface TeamFileInfo {
  filePath: string;
  root: string;
  teamId: string;
  teamName: string;
  /** Team-level budget defaults from the `.chinmeister` file, if present. */
  budgets: Partial<BudgetConfig> | null;
}

/**
 * Team IDs use the format `t_` followed by exactly 16 lowercase hex characters,
 * matching the worker route constraint: `t_[a-f0-9]{16}`.
 */
export const TEAM_ID_PATTERN = /^t_[a-f0-9]{16}$/;

export function isValidTeamId(id: unknown): id is string {
  return typeof id === 'string' && TEAM_ID_PATTERN.test(id);
}

export function findTeamFile(startDir = process.cwd()): TeamFileInfo | null {
  let dir = startDir;
  while (true) {
    const filePath = join(dir, '.chinmeister');
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as {
          team?: string | null;
          name?: string | null;
          budgets?: unknown;
        };
        const teamId = data.team ?? null;
        if (!teamId || !isValidTeamId(teamId)) return null;
        return {
          filePath,
          root: dir,
          teamId,
          teamName: data.name || basename(dir),
          budgets: parseBudgetConfig(data.budgets),
        };
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

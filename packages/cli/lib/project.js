import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join } from 'path';

function findChinwagFile(cwd = process.cwd()) {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, '.chinwag');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function getProjectContext(cwd = process.cwd()) {
  const filePath = findChinwagFile(cwd);
  if (!filePath) return null;

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (!data.team) {
      return { error: 'Invalid .chinwag file - missing team ID.' };
    }

    const root = dirname(filePath);
    return {
      filePath,
      root,
      teamId: data.team,
      teamName: data.name || basename(root),
    };
  } catch {
    return { error: 'Could not read .chinwag file.' };
  }
}

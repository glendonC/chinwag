import { basename, join } from 'path';
import { loadConfig, configExists } from './config.js';
import { api } from './api.js';
import { writeFileAtomicSync } from '@chinwag/shared/fs-atomic.js';

export async function handleTeamCommand(subcmd: string, arg?: string): Promise<void> {
  if (!configExists()) {
    console.log('Run `npx chinwag` first to create an account.');
    return;
  }

  const config = loadConfig();
  const client = api(config);

  if (subcmd === 'create') {
    try {
      const projectName = basename(process.cwd());
      const result = await client.post<{ team_id: string }>('/teams', { name: projectName });
      const teamId = result.team_id;

      const chinwagFile = join(process.cwd(), '.chinwag');
      writeFileAtomicSync(
        chinwagFile,
        JSON.stringify({ team: teamId, name: projectName }, null, 2) + '\n',
      );

      console.log(`Team created: ${teamId}`);
      console.log(`Wrote .chinwag to ${chinwagFile}`);
      console.log('Commit this file so teammates auto-join.');
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      console.log(
        `  Could not create team. ${status != null && status >= 500 ? 'Try again shortly.' : 'Check your connection.'}`,
      );
    }
  } else if (subcmd === 'join') {
    if (!arg) {
      console.log('Usage: npx chinwag team join <team-id>');
      return;
    }
    try {
      const projectName = basename(process.cwd());
      await client.post(`/teams/${arg}/join`, { name: projectName });

      const chinwagFile = join(process.cwd(), '.chinwag');
      writeFileAtomicSync(
        chinwagFile,
        JSON.stringify({ team: arg, name: projectName }, null, 2) + '\n',
      );

      console.log(`Joined team: ${arg}`);
      console.log(`Wrote .chinwag to ${chinwagFile}`);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      console.log(
        `  Could not join team. ${status != null && status >= 500 ? 'Try again shortly.' : 'Check your connection.'}`,
      );
    }
  } else {
    console.log('Usage: npx chinwag team <create|join> [team-id]');
  }
}

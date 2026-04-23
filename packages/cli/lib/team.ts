import { basename, join } from 'path';
import { loadConfig, configExists } from './config.js';
import { api } from './api.js';
import { writeFileAtomicSync } from '@chinmeister/shared/fs-atomic.js';

export async function handleTeamCommand(subcmd: string | undefined, arg?: string): Promise<void> {
  if (!configExists()) {
    console.log('Run `npx chinmeister` first to create an account.');
    return;
  }

  const config = loadConfig();
  const client = api(config);

  if (subcmd === 'create') {
    try {
      const projectName = basename(process.cwd());
      const result = await client.post<{ team_id: string }>('/teams', { name: projectName });
      const teamId = result.team_id;

      const chinmeisterFile = join(process.cwd(), '.chinmeister');
      writeFileAtomicSync(
        chinmeisterFile,
        JSON.stringify({ team: teamId, name: projectName }, null, 2) + '\n',
      );

      console.log(`Team created: ${teamId}`);
      console.log(`Wrote .chinmeister to ${chinmeisterFile}`);
      console.log('Commit this file so teammates auto-join.');
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      console.log(
        `  Could not create team. ${status != null && status >= 500 ? 'Try again shortly.' : 'Check your connection.'}`,
      );
    }
  } else if (subcmd === 'join') {
    if (!arg) {
      console.log('Usage: npx chinmeister team join <team-id>');
      return;
    }
    try {
      const projectName = basename(process.cwd());
      await client.post(`/teams/${arg}/join`, { name: projectName });

      const chinmeisterFile = join(process.cwd(), '.chinmeister');
      writeFileAtomicSync(
        chinmeisterFile,
        JSON.stringify({ team: arg, name: projectName }, null, 2) + '\n',
      );

      console.log(`Joined team: ${arg}`);
      console.log(`Wrote .chinmeister to ${chinmeisterFile}`);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      console.log(
        `  Could not join team. ${status != null && status >= 500 ? 'Try again shortly.' : 'Check your connection.'}`,
      );
    }
  } else {
    console.log('Usage: npx chinmeister team <create|join> [team-id]');
  }
}

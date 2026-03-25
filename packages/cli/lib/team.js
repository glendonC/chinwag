import { writeFileSync } from 'fs';
import { basename, join } from 'path';
import { loadConfig, configExists } from './config.js';
import { api } from './api.js';

export async function handleTeamCommand(subcmd, arg) {
  if (!configExists()) {
    console.log('Run `npx chinwag` first to create an account.');
    return;
  }

  const config = loadConfig();
  const client = api(config);

  if (subcmd === 'create') {
    try {
      const projectName = basename(process.cwd());
      const result = await client.post('/teams', { name: projectName });
      const teamId = result.team_id;

      const chinwagFile = join(process.cwd(), '.chinwag');
      writeFileSync(chinwagFile, JSON.stringify({ team: teamId, name: projectName }, null, 2) + '\n');

      console.log(`Team created: ${teamId}`);
      console.log(`Wrote .chinwag to ${chinwagFile}`);
      console.log('Commit this file so teammates auto-join.');
    } catch (err) {
      console.log(`Error: ${err.message}`);
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
      writeFileSync(chinwagFile, JSON.stringify({ team: arg, name: projectName }, null, 2) + '\n');

      console.log(`Joined team: ${arg}`);
      console.log(`Wrote .chinwag to ${chinwagFile}`);
    } catch (err) {
      console.log(`Error: ${err.message}`);
    }
  } else {
    console.log('Usage: npx chinwag team <create|join> [team-id]');
  }
}

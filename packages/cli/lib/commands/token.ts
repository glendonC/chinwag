import { configExists, loadConfig, getConfigPaths } from '../config.js';

export async function runToken(): Promise<void> {
  if (!configExists()) {
    const { configFile } = getConfigPaths();
    console.log(`No config found at ${configFile}. Run \`npx chinmeister init\` first.`);
    process.exit(1);
  }

  const config = loadConfig();
  if (!config?.token) {
    const { configFile } = getConfigPaths();
    console.log(`Invalid config at ${configFile}. Run \`npx chinmeister init\` again.`);
    process.exit(1);
  }

  process.stdout.write(`${config.token}\n`);
}

import chalk from 'chalk';
import {
  configureHostIntegration,
  formatIntegrationScanResults,
  scanHostIntegrations,
  summarizeIntegrationScan,
} from '../../../shared/integration-doctor.js';

const ok = chalk.green('✔');
const warn = chalk.yellow('!');
const dim = chalk.dim;

function parseDoctorArgs(argv = []) {
  const args = [...argv];
  const fixAll = args.includes('--fix');
  const onlyDetected = !args.includes('--all');

  if (args[0] === 'fix') {
    return {
      action: 'fix',
      hostId: args[1] && !args[1].startsWith('-') ? args[1] : null,
      fixAll: fixAll || !args[1],
      onlyDetected,
    };
  }

  return {
    action: 'scan',
    hostId: null,
    fixAll,
    onlyDetected,
  };
}

function selectRepairTargets(scanResults, { hostId = null, fixAll = false } = {}) {
  if (hostId) return [hostId];
  if (!fixAll) return [];
  return scanResults
    .filter((item) => item.detected && item.repairable && item.status !== 'ready')
    .map((item) => item.id);
}

export async function runDoctor(argv = []) {
  const cwd = process.cwd();
  const parsed = parseDoctorArgs(argv);
  const initialScan = scanHostIntegrations(cwd);

  console.log('');
  console.log(`  ${chalk.cyan.bold('chinwag doctor')}`);
  console.log(`  ${dim('integration health and repair')}`);
  console.log('');
  console.log(formatIntegrationScanResults(initialScan, { onlyDetected: parsed.onlyDetected })
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n'));
  console.log('');

  const targets = selectRepairTargets(initialScan, parsed);
  if (parsed.action !== 'fix' && !parsed.fixAll) {
    const summary = summarizeIntegrationScan(initialScan, { onlyDetected: parsed.onlyDetected });
    console.log(`  ${summary.tone === 'success' ? ok : warn} ${summary.text}`);
    console.log('');
    return;
  }

  if (targets.length === 0) {
    console.log(`  ${warn} No repairable integrations selected.`);
    console.log('');
    return;
  }

  const repaired = [];
  const failed = [];
  for (const hostId of targets) {
    const result = configureHostIntegration(cwd, hostId);
    if (result.error) {
      failed.push({ hostId, error: result.error });
    } else {
      repaired.push(result.name);
    }
  }

  if (repaired.length > 0) {
    console.log(`  ${ok} Repaired ${repaired.join(', ')}`);
  }
  if (failed.length > 0) {
    for (const item of failed) {
      console.log(`  ${chalk.red('✖')} ${item.hostId}: ${item.error}`);
    }
  }

  const postScan = scanHostIntegrations(cwd);
  const summary = summarizeIntegrationScan(postScan, { onlyDetected: parsed.onlyDetected });
  console.log('');
  console.log(`  ${summary.tone === 'success' ? ok : warn} ${summary.text}`);
  if (repaired.length > 0) {
    console.log(`  ${dim('Restart affected tools to reconnect with the updated config.')}`);
  }
  console.log('');
}

export { parseDoctorArgs, selectRepairTargets };

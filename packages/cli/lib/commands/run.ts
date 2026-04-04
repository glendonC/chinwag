import {
  attachTerminal,
  getOutput,
  resizePty,
  spawnAgent,
  waitForExit,
} from '../process-manager.js';
import type { AttachTerminalResult } from '../process-manager.js';
import { configExists, loadConfig } from '../config.js';
import {
  checkManagedAgentToolAvailability,
  createManagedAgentLaunch,
  getManagedAgentTool,
  listManagedAgentTools,
} from '../managed-agents.js';
import type { ManagedTool } from '../managed-agents.js';
import {
  getSavedLauncherPreference,
  resolvePreferredManagedTool,
  saveLauncherPreference,
} from '../launcher-preferences.js';
import { getProjectContext } from '../project.js';
import { hasError } from '../utils/type-guards.js';
import { formatError, createLogger } from '@chinwag/shared';

const log = createLogger('run');

function printUsage(): void {
  process.stderr.write('Usage: chinwag run [--tool <tool-id>] "task description"\n');
}

function printAvailableTools(tools: ManagedTool[]): void {
  if (!tools.length) return;
  process.stderr.write('Available managed tools:\n');
  for (const tool of tools) {
    process.stderr.write(`  - ${tool.id} (${tool.name})\n`);
  }
}

interface ParsedArgs {
  toolId: string | null;
  task: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let toolId: string | null = null;
  const taskParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tool') {
      toolId = args[i + 1] || null;
      i += 1;
      continue;
    }
    taskParts.push(arg);
  }

  return {
    toolId,
    task: taskParts.join(' ').trim(),
  };
}

function writeBufferedOutput(id: number): void {
  const lines = getOutput(id, 200);
  if (!lines.length) return;
  const text = lines.join('\n');
  if (text) {
    process.stdout.write(text);
    if (!text.endsWith('\n')) process.stdout.write('\n');
  }
}

function bridgeStdin(terminal: AttachTerminalResult): () => void {
  const onData = (chunk: Buffer): void => terminal.write(chunk.toString('utf-8'));
  const cleanupFns: Array<() => void> = [];

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    cleanupFns.push(() => process.stdin.setRawMode(false));
  }

  process.stdin.resume();
  process.stdin.on('data', onData);
  cleanupFns.push(() => process.stdin.off('data', onData));

  return () => {
    for (const cleanup of cleanupFns.reverse()) {
      try {
        cleanup();
      } catch (err: unknown) {
        log.error(formatError(err));
      }
    }
  };
}

export async function runManagedAgentCommand(argv: string[] = []): Promise<number> {
  const { toolId, task } = parseArgs(argv);
  if (!task) {
    printUsage();
    return 1;
  }

  if (!configExists()) {
    process.stderr.write('No config found. Run `npx chinwag init` first.\n');
    return 1;
  }

  const config = loadConfig();
  if (!config?.token) {
    process.stderr.write('Invalid config. Run `npx chinwag init` again.\n');
    return 1;
  }

  const project = getProjectContext(process.cwd());
  if (!project) {
    process.stderr.write('No .chinwag file found. Run `npx chinwag init` in this project first.\n');
    return 1;
  }
  if (hasError(project)) {
    process.stderr.write(`${project.error}\n`);
    return 1;
  }

  const availableTools = listManagedAgentTools();
  if (!availableTools.length) {
    process.stderr.write('No managed CLI tools are installed.\n');
    return 1;
  }

  let tool: ManagedTool | null = null;
  const preferredToolId = getSavedLauncherPreference(project.teamId);
  if (toolId) {
    tool = getManagedAgentTool(toolId) as ManagedTool | null;
    if (!tool || !availableTools.some((item) => item.id === tool!.id)) {
      process.stderr.write(`Managed tool not available: ${toolId}\n`);
      printAvailableTools(availableTools);
      return 1;
    }
  } else {
    tool = resolvePreferredManagedTool(availableTools, preferredToolId) as ManagedTool | null;
    if (!tool) {
      process.stderr.write('Multiple managed tools are available. Choose one with `--tool`.\n');
      printAvailableTools(availableTools);
      return 1;
    }
  }

  const launch = createManagedAgentLaunch({
    tool,
    task,
    cwd: project.root,
    token: config.token,
    cols: process.stdout.columns || undefined,
    rows: process.stdout.rows || undefined,
  });

  const availability = await checkManagedAgentToolAvailability(tool, { cwd: project.root });
  if (availability.state !== 'ready') {
    process.stderr.write(`${availability.detail || `${tool.name} is not ready`}\n`);
    if (availability.recoveryCommand) {
      process.stderr.write(`Run \`${availability.recoveryCommand}\` and try again.\n`);
    }
    return 1;
  }

  const result = spawnAgent(launch);
  if (result.status !== 'running') {
    writeBufferedOutput(result.id);
    return 1;
  }

  saveLauncherPreference(project.teamId, tool.id);

  const terminal = attachTerminal(result.id, { replayBuffer: true });
  if (!terminal) {
    writeBufferedOutput(result.id);
    const exitCode = await waitForExit(result.id);
    return exitCode ?? 1;
  }

  const cleanupInput = bridgeStdin(terminal);
  const onResize = (): void =>
    resizePty(result.id, process.stdout.columns || 120, process.stdout.rows || 30);
  if (process.stdout.isTTY) {
    process.stdout.on('resize', onResize);
  }

  try {
    const exitCode = await waitForExit(result.id);
    return exitCode ?? 0;
  } finally {
    if (process.stdout.isTTY) {
      process.stdout.off('resize', onResize);
    }
    cleanupInput();
    terminal.dispose();
  }
}

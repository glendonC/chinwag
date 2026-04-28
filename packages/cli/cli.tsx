import React, { useState, useEffect, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { basename } from 'path';
import { loadConfig, configExists, deleteConfig } from './lib/config.js';
import type { ChinmeisterConfig } from './lib/config.js';
import { api } from './lib/api.js';
import { Welcome } from './lib/init.jsx';
import { Customize } from './lib/customize.jsx';
import { Dashboard } from './lib/dashboard/index.jsx';
import { ControlShell } from './lib/shell.jsx';
import type { ModeItem, ShellDimensions } from './lib/shell.jsx';
import { useTerminalControl } from './lib/terminal-control.js';
import { formatError, createLogger } from '@chinmeister/shared';

const log = createLogger('cli');

// Node 22+ required for native WebSocket
if (parseInt(process.version.slice(1)) < 22) {
  console.error('chinmeister requires Node.js 22 or later (current: ' + process.version + ')');
  process.exit(1);
}

// Hand off to an MCP/hook/channel runtime module in the same process.
// Same-process import is required because MCP uses stdin/stdout for JSON-RPC
// and hooks need direct stdio access — child_process would add broken-pipe risk.
// The never-resolving promise keeps the top-level await alive so the imported
// module's signal handlers and event loops continue running.
interface HandOffOptions {
  stripSubcommand?: boolean;
  transport?: string | null;
}

async function handOffToRuntime(
  modulePath: string,
  { stripSubcommand = false, transport = null }: HandOffOptions = {},
): Promise<void> {
  if (transport) {
    process.env.CHINMEISTER_TRANSPORT = transport;
  }
  if (stripSubcommand) {
    const [node = '', script = ''] = process.argv;
    process.argv = [node, script, ...process.argv.slice(3)];
  }
  await import(modulePath);
  // Keep process alive — the imported module owns the event loop from here.
  await new Promise<void>(() => {});
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    process.stderr.write(`[chinmeister] Screen error: ${error.message}\n`);
    if (errorInfo.componentStack) {
      process.stderr.write(`[chinmeister] Component stack:${errorInfo.componentStack}\n`);
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return React.createElement(
        Box,
        { flexDirection: 'column', padding: 1 },
        React.createElement(
          Text,
          { color: 'red' },
          `Something went wrong: ${this.state.error.message}`,
        ),
        React.createElement(Text, { dimColor: true }, 'Press Ctrl+C to exit and restart.'),
      );
    }
    return this.props.children;
  }
}

// Handle reset command before launching TUI
if (process.argv[2] === 'reset') {
  deleteConfig();
  console.log('Config cleared. Run chinmeister to start fresh.');
  process.exit(0);
}

// Hidden runtime subcommands used by generated tool configs.
if (process.argv[2] === 'mcp') {
  await handOffToRuntime('chinmeister-mcp/index.js', { transport: 'mcp' });
}

if (process.argv[2] === 'channel') {
  await handOffToRuntime('chinmeister-mcp/channel.js', { transport: 'channel' });
}

if (process.argv[2] === 'hook') {
  await handOffToRuntime('chinmeister-mcp/hook.js', { stripSubcommand: true, transport: 'hook' });
}

// Handle init command before launching TUI
if (process.argv[2] === 'init') {
  const { runInit } = await import('./lib/commands/init.js');
  await runInit();
  process.exit(0);
}

// Handle add command before launching TUI
if (process.argv[2] === 'add') {
  const { runAdd } = await import('./lib/commands/add.js');
  await runAdd(process.argv[3]);
  process.exit(0);
}

// Handle doctor command before launching TUI
if (process.argv[2] === 'doctor') {
  const { runDoctor } = await import('./lib/commands/doctor.js');
  await runDoctor(process.argv.slice(3));
  process.exit(0);
}

// Handle token command before launching TUI
if (process.argv[2] === 'token') {
  const { runToken } = await import('./lib/commands/token.js');
  await runToken();
  process.exit(0);
}

// Handle team commands before launching TUI
if (process.argv[2] === 'team') {
  const { handleTeamCommand } = await import('./lib/team.js');
  await handleTeamCommand(process.argv[3], process.argv[4]);
  process.exit(0);
}

// Handle run command before launching TUI
if (process.argv[2] === 'run') {
  const { runManagedAgentCommand } = await import('./lib/commands/run.js');
  const exitCode = await runManagedAgentCommand(process.argv.slice(3));
  process.exit(exitCode);
}

// Handle dashboard command — open web dashboard in browser
if (process.argv[2] === 'dashboard') {
  const { openDashboard } = await import('./lib/open-dashboard.js');
  await openDashboard();
  process.exit(0);
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;
const PRIMARY_MODES: ModeItem[] = [
  { key: 'dashboard', label: 'dashboard', shortLabel: 'dashboard', accent: 'cyan' },
  { key: 'customize', label: 'settings', shortLabel: 'settings', accent: 'green' },
];

interface FooterHint {
  key: string;
  label: string;
  color?: string;
}

interface UserInfo {
  handle?: string;
  color?: string;
}

const SHELL_MODE_PREFIXES: Record<string, ModeItem> = {
  loading: { key: 'loading', label: 'boot', shortLabel: 'boot', accent: 'cyan' },
  welcome: { key: 'welcome', label: 'setup', shortLabel: 'setup', accent: 'cyan' },
};

function App(): React.ReactNode {
  const [screen, setScreen] = useState('loading');
  const [config, setConfig] = useState<ChinmeisterConfig | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [spin, setSpin] = useState(0);
  const [footerHints, setFooterHints] = useState<FooterHint[] | null>(null);
  const { exit } = useApp();
  const projectLabel = basename(process.cwd());
  const isPrimaryMode = PRIMARY_MODES.some((mode) => mode.key === screen);

  const prefix = SHELL_MODE_PREFIXES[screen];
  const shellModes = prefix ? [prefix, ...PRIMARY_MODES] : PRIMARY_MODES;

  useTerminalControl(`chinmeister · ${projectLabel || 'control plane'}`);

  useEffect(() => {
    if (screen !== 'loading') return;
    const id = setInterval(() => setSpin((s) => (s + 1) % SPINNER.length), SPINNER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [screen]);

  useEffect(() => {
    async function init(): Promise<void> {
      if (configExists()) {
        const cfg = loadConfig();
        setConfig(cfg);

        try {
          const me = (await api(cfg).get('/me')) as UserInfo;
          setUser(me);
          setScreen('dashboard');
        } catch (err: unknown) {
          log.error(formatError(err));
          setScreen('welcome');
        }
      } else {
        setScreen('welcome');
      }
    }
    init();
  }, []);

  const onSetup = (cfg: ChinmeisterConfig, usr: UserInfo): void => {
    setConfig(cfg);
    setUser(usr);
    setScreen('dashboard');
  };

  const navigate = (to: string): void => {
    if (to === 'quit') {
      exit();
      return;
    }
    setScreen(to);
  };

  const refreshUser = async (): Promise<void> => {
    if (!config) return;
    try {
      const me = (await api(config).get('/me')) as UserInfo;
      setUser(me);
    } catch (err: unknown) {
      log.error(formatError(err));
    }
  };

  useInput((input: string, key) => {
    if (!isPrimaryMode || !key.tab) return;

    const idx = PRIMARY_MODES.findIndex((mode) => mode.key === screen);
    if (idx === -1) return;

    const delta = key.shift ? -1 : 1;
    const nextIdx = (idx + delta + PRIMARY_MODES.length) % PRIMARY_MODES.length;
    const nextMode = PRIMARY_MODES[nextIdx];
    if (nextMode) setScreen(nextMode.key);
  });

  function renderScreen({ viewportRows }: { viewportRows: number }): React.ReactNode {
    switch (screen) {
      case 'loading':
        return (
          <Box paddingTop={1}>
            <Text>
              <Text color="cyan">{SPINNER[spin]}</Text>
              <Text dimColor> connecting to chinmeister</Text>
            </Text>
          </Box>
        );
      case 'welcome':
        return <Welcome onComplete={onSetup} />;
      case 'customize':
        return (
          <Customize config={config} user={user} navigate={navigate} refreshUser={refreshUser} />
        );
      case 'dashboard':
        return (
          <Dashboard
            config={config}
            navigate={navigate}
            layout={{ viewportRows }}
            setFooterHints={setFooterHints}
          />
        );
      default:
        return null;
    }
  }

  return (
    <ControlShell modeItems={shellModes} activeMode={screen} user={user} footerHints={footerHints}>
      {({ viewportRows }: ShellDimensions) => (
        <ErrorBoundary>{renderScreen({ viewportRows })}</ErrorBoundary>
      )}
    </ControlShell>
  );
}

render(React.createElement(App));

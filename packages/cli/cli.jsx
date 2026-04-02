import React, { useState, useEffect, Component } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { basename } from 'path';
import { readFileSync } from 'fs';
import { loadConfig, saveConfig, configExists, deleteConfig } from './lib/config.js';
import { api } from './lib/api.js';
import { Welcome } from './lib/init.jsx';
import { Chat } from './lib/chat.jsx';
import { Customize } from './lib/customize.jsx';
import { Dashboard } from './lib/dashboard.jsx';
import { Discover } from './lib/discover.jsx';
import { ControlShell } from './lib/shell.jsx';
import { useTerminalControl } from './lib/terminal-control.js';

// Node 22+ required for native WebSocket
if (parseInt(process.version.slice(1)) < 22) {
  console.error('chinwag requires Node.js 22 or later (current: ' + process.version + ')');
  process.exit(1);
}

let PKG_VERSION = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
  PKG_VERSION = pkg.version || PKG_VERSION;
} catch (err) { console.error('[chinwag]', err?.message || err); }

async function handOffToRuntime(modulePath, { stripSubcommand = false, transport = null } = {}) {
  if (transport) {
    process.env.CHINWAG_TRANSPORT = transport;
  }
  if (stripSubcommand) {
    process.argv = [process.argv[0], process.argv[1], ...process.argv.slice(3)];
  }
  await import(modulePath);
  await new Promise(() => {});
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    process.stderr.write(`[chinwag] Screen error: ${error.message}\n`);
  }

  render() {
    if (this.state.error) {
      return React.createElement(Box, { flexDirection: 'column', padding: 1 },
        React.createElement(Text, { color: 'red' }, `Something went wrong: ${this.state.error.message}`),
        React.createElement(Text, { dimColor: true }, 'Press Ctrl+C to exit and restart.')
      );
    }
    return this.props.children;
  }
}

// Handle reset command before launching TUI
if (process.argv[2] === 'reset') {
  deleteConfig();
  console.log('Config cleared. Run chinwag to start fresh.');
  process.exit(0);
}

// Hidden runtime subcommands used by generated tool configs.
if (process.argv[2] === 'mcp') {
  await handOffToRuntime('chinwag-mcp/index.js', { transport: 'mcp' });
}

if (process.argv[2] === 'channel') {
  await handOffToRuntime('chinwag-mcp/channel.js', { transport: 'channel' });
}

if (process.argv[2] === 'hook') {
  await handOffToRuntime('chinwag-mcp/hook.js', { stripSubcommand: true, transport: 'hook' });
}

// Handle init command before launching TUI
if (process.argv[2] === 'init') {
  const { runInit } = await import('./lib/init-command.js');
  await runInit();
  process.exit(0);
}

// Handle add command before launching TUI
if (process.argv[2] === 'add') {
  const { runAdd } = await import('./lib/add-command.js');
  await runAdd(process.argv[3]);
  process.exit(0);
}

// Handle doctor command before launching TUI
if (process.argv[2] === 'doctor') {
  const { runDoctor } = await import('./lib/doctor-command.js');
  await runDoctor(process.argv.slice(3));
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
  const { runManagedAgentCommand } = await import('./lib/run-command.js');
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
const PRIMARY_MODES = [
  { key: 'dashboard', label: 'dashboard', shortLabel: 'dashboard', accent: 'cyan' },
  { key: 'discover', label: 'tools', shortLabel: 'tools', accent: 'yellow' },
  { key: 'chat', label: 'chat', shortLabel: 'chat', accent: 'magenta' },
  { key: 'customize', label: 'settings', shortLabel: 'settings', accent: 'green' },
];

function App() {
  const [screen, setScreen] = useState('loading');
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [spin, setSpin] = useState(0);
  const [footerHints, setFooterHints] = useState(null);
  const { exit } = useApp();
  const projectLabel = basename(process.cwd());
  const isPrimaryMode = PRIMARY_MODES.some(mode => mode.key === screen);
  const shellModes = screen === 'loading'
    ? [{ key: 'loading', label: 'boot', shortLabel: 'boot', accent: 'cyan' }, ...PRIMARY_MODES]
    : screen === 'welcome'
      ? [{ key: 'welcome', label: 'setup', shortLabel: 'setup', accent: 'cyan' }, ...PRIMARY_MODES]
      : PRIMARY_MODES;

  useTerminalControl(`chinwag · ${projectLabel || 'control plane'}`);

  useEffect(() => {
    if (screen !== 'loading') return;
    const id = setInterval(() => setSpin(s => (s + 1) % SPINNER.length), SPINNER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [screen]);

  useEffect(() => {
    async function init() {
      if (configExists()) {
        const cfg = loadConfig();
        setConfig(cfg);

        try {
          const me = await api(cfg).get('/me');
          setUser(me);
          setScreen('dashboard');
        } catch (err) {
          console.error('[chinwag]', err?.message || err);
          setScreen('welcome');
        }
      } else {
        setScreen('welcome');
      }
    }
    init();
  }, []);

  const onSetup = (cfg, usr) => {
    setConfig(cfg);
    setUser(usr);
    setScreen('dashboard');
  };

  const navigate = (to) => {
    if (to === 'quit') {
      exit();
      return;
    }
    setScreen(to);
  };

  const refreshUser = async () => {
    if (!config) return;
    try {
      const me = await api(config).get('/me');
      setUser(me);
    } catch (err) { console.error('[chinwag]', err?.message || err); }
  };

  useInput((input, key) => {
    if (!isPrimaryMode || !key.tab) return;

    const idx = PRIMARY_MODES.findIndex(mode => mode.key === screen);
    if (idx === -1) return;

    const delta = key.shift ? -1 : 1;
    const nextIdx = (idx + delta + PRIMARY_MODES.length) % PRIMARY_MODES.length;
    setScreen(PRIMARY_MODES[nextIdx].key);
  });

  return (
    <ControlShell
      modeItems={shellModes}
      activeMode={screen}
      user={user}
      footerHints={footerHints}
    >
      {({ viewportRows, compact }) => (
        <ErrorBoundary>
          {(() => {
          if (screen === 'loading') {
            return (
              <Box paddingTop={1}>
                <Text><Text color="cyan">{SPINNER[spin]}</Text><Text dimColor>  connecting to chinwag</Text></Text>
              </Box>
            );
          }
          if (screen === 'welcome') return <Welcome onComplete={onSetup} />;
          if (screen === 'chat') return <Chat config={config} user={user} navigate={navigate} layout={{ viewportRows }} />;
          if (screen === 'customize') return <Customize config={config} user={user} navigate={navigate} refreshUser={refreshUser} layout={{ viewportRows }} />;
          if (screen === 'dashboard') {
            return (
              <Dashboard
                config={config}
                navigate={navigate}
                layout={{ viewportRows }}
                projectLabel={projectLabel}
                appVersion={PKG_VERSION}
                setFooterHints={setFooterHints}
              />
            );
          }
          if (screen === 'discover') return <Discover config={config} navigate={navigate} layout={{ viewportRows }} />;
          return null;
          })()}
        </ErrorBoundary>
      )}
    </ControlShell>
  );
}

render(React.createElement(App));

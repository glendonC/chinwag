import React, { useState, useEffect, Component } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { loadConfig, saveConfig, configExists, deleteConfig } from './lib/config.js';
import { api } from './lib/api.js';
import { Welcome } from './lib/init.jsx';
import { Home } from './lib/home.jsx';
import { Chat } from './lib/chat.jsx';
import { Customize } from './lib/customize.jsx';
import { Dashboard } from './lib/dashboard.jsx';

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
        React.createElement(Text, { dimColor: true }, 'Press any key to go back, or [q] to quit.')
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

// Handle init command before launching TUI
if (process.argv[2] === 'init') {
  const { runInit } = await import('./lib/init-command.js');
  await runInit();
  process.exit(0);
}

// Handle team commands before launching TUI
if (process.argv[2] === 'team') {
  const { handleTeamCommand } = await import('./lib/team.js');
  await handleTeamCommand(process.argv[3], process.argv[4]);
  process.exit(0);
}

// Set terminal tab title
process.stdout.write('\x1b]0;chinwag\x07');

function App() {
  const [screen, setScreen] = useState('loading');
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const { exit } = useApp();

  useEffect(() => {
    async function init() {
      if (configExists()) {
        const cfg = loadConfig();
        setConfig(cfg);

        try {
          const me = await api(cfg).get('/me');
          setUser(me);
          setScreen('home');
        } catch {
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
    setScreen('home');
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
    } catch {}
  };

  const screenContent = (() => {
    if (screen === 'loading') {
      return (
        <Box padding={1}>
          <Text dimColor>Connecting...</Text>
        </Box>
      );
    }
    if (screen === 'welcome') return <Welcome onComplete={onSetup} />;
    if (screen === 'home') return <Home user={user} config={config} navigate={navigate} />;
    if (screen === 'chat') return <Chat config={config} user={user} navigate={navigate} />;
    if (screen === 'customize') return <Customize config={config} user={user} navigate={navigate} refreshUser={refreshUser} />;
    if (screen === 'dashboard') return <Dashboard config={config} navigate={navigate} />;
    return null;
  })();

  const screenLabel = { chat: 'chat', customize: 'settings', dashboard: 'dashboard' }[screen] || null;

  return (
    <Box flexDirection="column">
      {screenLabel && (
        <Text>
          <Text color="cyan" dimColor>── </Text>
          <Text color="cyan" bold>chinwag</Text>
          <Text dimColor> · {screenLabel}</Text>
        </Text>
      )}
      <ErrorBoundary>
        {screenContent}
      </ErrorBoundary>
    </Box>
  );
}

render(React.createElement(App));

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { loadConfig, saveConfig, configExists } from './lib/config.js';
import { api } from './lib/api.js';
import { Welcome } from './lib/init.jsx';
import { Home } from './lib/home.jsx';
import { Post } from './lib/post.jsx';
import { Inbox } from './lib/inbox.jsx';
import { Feed } from './lib/feed.jsx';
import { Chat } from './lib/chat.jsx';
import { Customize } from './lib/customize.jsx';

// Set terminal tab title
process.stdout.write('\x1b]0;chinwag\x07');

function App() {
  const [screen, setScreen] = useState('loading');
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [inboxRead, setInboxRead] = useState(false);
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
    if (to === 'inbox') setInboxRead(true);
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
    if (screen === 'home') return <Home user={user} config={config} navigate={navigate} refreshUser={refreshUser} inboxRead={inboxRead} />;
    if (screen === 'post') return <Post config={config} navigate={navigate} refreshUser={refreshUser} />;
    if (screen === 'inbox') return <Inbox config={config} user={user} navigate={navigate} />;
    if (screen === 'feed') return <Feed config={config} navigate={navigate} />;
    if (screen === 'chat') return <Chat config={config} user={user} navigate={navigate} />;
    if (screen === 'customize') return <Customize config={config} user={user} navigate={navigate} refreshUser={refreshUser} />;
    return null;
  })();

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>── </Text>
        <Text bold>chinwag</Text>
        <Text dimColor> v0.1.0</Text>
      </Text>
      {screenContent}
    </Box>
  );
}

render(React.createElement(App));

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { readFileSync } from 'fs';
import { api } from './api.js';
import { getInkColor } from './colors.js';
import { openDashboard } from './open-dashboard.js';

// Read version from package.json at import time (bundled by esbuild)
let PKG_VERSION = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  PKG_VERSION = pkg.version;
} catch { /* fallback to hardcoded */ }

export function Home({ user, config, navigate }) {
  const [stats, setStats] = useState({ online: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = api(config);

    async function load() {
      try { await client.post('/presence/heartbeat', {}); } catch {}
      try {
        const s = await client.get('/stats');
        setStats(s);
      } catch {}
      setLoading(false);
    }
    load();

    const interval = setInterval(async () => {
      try {
        await client.post('/presence/heartbeat', {});
        const s = await client.get('/stats');
        setStats(s);
      } catch {}
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  useInput((ch) => {
    if (loading) return;
    if (ch === 'd') { navigate('dashboard'); return; }
    if (ch === 'w') { openDashboard().catch(() => {}); return; }
    if (ch === 'f') { navigate('discover'); return; }
    if (ch === 'c') { navigate('chat'); return; }
    if (ch === 's') { navigate('customize'); return; }
    if (ch === 'q') { navigate('quit'); return; }
  });

  if (loading) {
    return (
      <Box padding={1}>
        <Text color="cyan">Connecting...</Text>
      </Box>
    );
  }

  const onlineText = stats.online >= 10
    ? `${stats.online} devs online`
    : stats.online >= 1
      ? 'a few devs online'
      : '';

  const userColor = getInkColor(user?.color);

  return (
    <Box flexDirection="column">
      {/* Splash hub */}
      <Box
        flexDirection="row"
        paddingX={2}
        paddingY={1}
        borderStyle="round"
        borderColor="cyan"
      >
        {/* Shiba inu mascot */}
        <Box flexDirection="column" marginRight={3}>
          <Text><Text color="yellow"> ▄▀▄   ▄▀▄</Text></Text>
          <Text><Text color="yellow"> █</Text>  ▀▄▀  <Text color="yellow">█</Text></Text>
          <Text><Text color="yellow"> █</Text> ▀ ▄ ▀ <Text color="yellow">█</Text></Text>
          <Text>  <Text color="yellow">▀</Text>▄ ▼ ▄<Text color="yellow">▀</Text></Text>
          <Text>   <Text color="yellow">█</Text><Text color="white">▀▀▀</Text><Text color="yellow">█</Text></Text>
          <Text><Text color="yellow">   ██ ██</Text></Text>
          <Text><Text color="white">   ▀▀ ▀▀</Text></Text>
        </Box>

        {/* Info */}
        <Box flexDirection="column">
          <Text>
            <Text color="cyan" bold>chinwag</Text>
            <Text dimColor>  v{PKG_VERSION}</Text>
          </Text>
          <Text dimColor>the control layer for agentic development</Text>
          <Text>{''}</Text>
          <Text>
            <Text dimColor>signed in as </Text>
            <Text color={userColor} bold>{user?.handle || 'unknown'}</Text>
          </Text>
          {onlineText && <Text color="green">{onlineText}</Text>}
        </Box>
      </Box>

      {/* Navigation */}
      <Box paddingX={1} paddingTop={1}>
        <Text>
          <Text color="cyan" bold>[d]</Text><Text dimColor> dashboard  </Text>
          <Text color="cyan" bold>[w]</Text><Text dimColor> web  </Text>
          <Text color="cyan" bold>[f]</Text><Text dimColor> discover  </Text>
          <Text color="cyan" bold>[c]</Text><Text dimColor> chat  </Text>
          <Text color="cyan" bold>[s]</Text><Text dimColor> settings  </Text>
          <Text color="cyan" bold>[q]</Text><Text dimColor> quit</Text>
        </Text>
      </Box>
    </Box>
  );
}

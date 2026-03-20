import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { api } from './api.js';
import { getInkColor } from './colors.js';

export function Home({ user, config, navigate, refreshUser, inboxRead }) {
  const [stats, setStats] = useState({ online: 0, notesToday: 0 });
  const [posted, setPosted] = useState(false);
  const [hasInbox, setHasInbox] = useState(false);
  const [cursor, setCursor] = useState(0);

  const menuItems = useMemo(() => {
    const items = [];

    if (!posted) {
      items.push({ key: 'p', label: "Write today's note — get a stranger's back", action: 'post', highlight: true });
    } else {
      items.push({ key: 'p', label: '✓ Posted today', action: 'post', dim: true });
    }

    if (posted && hasInbox && !inboxRead) {
      items.push({ key: 'i', label: 'A note arrived for you', action: 'inbox', highlight: true });
    } else if (posted && hasInbox) {
      items.push({ key: 'i', label: '✓ Note received', action: 'inbox', dim: true });
    } else if (posted) {
      items.push({ key: 'i', label: "Note sent — one's on the way", action: 'inbox', dim: true });
    }

    items.push({ key: 'f', label: "What others posted today", action: 'feed' });
    items.push({ key: 'c', label: 'Chat', action: 'chat' });
    items.push({ key: 'h', label: 'Customize', action: 'customize', dim: true });
    items.push({ key: 'q', label: 'Quit', action: 'quit', dim: true });

    return items;
  }, [posted, hasInbox, inboxRead]);

  useEffect(() => {
    async function load() {
      const client = api(config);

      try {
        await client.post('/presence/heartbeat', {});
      } catch {}

      try {
        const s = await client.get('/stats');
        setStats(s);
      } catch {}

      try {
        const inbox = await client.get('/notes/inbox');
        if (inbox.locked) {
          setPosted(false);
          setHasInbox(false);
        } else if (inbox.waiting) {
          setPosted(true);
          setHasInbox(false);
        } else {
          setPosted(true);
          setHasInbox(true);
        }
      } catch {}
    }
    load();

    const interval = setInterval(async () => {
      try {
        await api(config).post('/presence/heartbeat', {});
        const s = await api(config).get('/stats');
        setStats(s);
      } catch {}
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(prev => Math.min(menuItems.length - 1, prev + 1));
      return;
    }
    if (key.return) {
      const item = menuItems[cursor];
      if (item) navigate(item.action);
      return;
    }
    const letter = input.toLowerCase();
    const match = menuItems.find(m => m.key === letter);
    if (match) navigate(match.action);
  });

  const handle = user?.handle || config?.handle || 'unknown';
  const color = user?.color || config?.color || 'white';
  const status = user?.status;

  const statsLine = [
    `${stats.online} dev${stats.online !== 1 ? 's' : ''} online`,
    stats.notesToday ? `${stats.notesToday} note${stats.notesToday !== 1 ? 's' : ''} today` : null,
  ].filter(Boolean).join('  ·  ');

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text>Welcome back, <Text color={getInkColor(color)} bold>{handle}</Text></Text>
        {status && <Text dimColor>— {status}</Text>}
        <Text>{''}</Text>
        <Text dimColor>{statsLine}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1}>
        <Text>{''}</Text>
        {menuItems.map((item, i) => {
          const isSelected = i === cursor;
          const prefix = isSelected ? '▸' : ' ';

          if (item.highlight) {
            return (
              <Text key={item.key}>
                <Text color={isSelected ? 'white' : undefined}>{prefix} </Text>
                <Text color="green" bold={isSelected}>[{item.key}]</Text>
                <Text color={isSelected ? 'white' : undefined} bold={isSelected}> {item.label}</Text>
              </Text>
            );
          }

          if (item.dim && !isSelected) {
            return (
              <Text key={item.key}>
                <Text>{prefix} </Text>
                <Text dimColor>[{item.key}] {item.label}</Text>
              </Text>
            );
          }

          return (
            <Text key={item.key}>
              <Text color={isSelected ? 'white' : undefined}>{prefix} </Text>
              <Text bold={isSelected}>[{item.key}]</Text>
              <Text color={isSelected ? 'white' : undefined} bold={isSelected}> {item.label}</Text>
            </Text>
          );
        })}

        <Text>{''}</Text>
        <Text dimColor>[↑↓] Navigate  ·  [enter] Select  ·  or press a letter</Text>
      </Box>
    </Box>
  );
}

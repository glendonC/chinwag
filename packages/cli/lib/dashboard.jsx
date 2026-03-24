import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { api } from './api.js';

export function Dashboard({ config, navigate }) {
  const [teamId, setTeamId] = useState(null);
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    // Read .chinwag file for team ID
    const chinwagFile = join(process.cwd(), '.chinwag');
    if (!existsSync(chinwagFile)) {
      setError('No .chinwag file found. Run `chinwag init` first.');
      return;
    }
    try {
      const data = JSON.parse(readFileSync(chinwagFile, 'utf-8'));
      if (!data.team) {
        setError('Invalid .chinwag file — missing team ID.');
        return;
      }
      setTeamId(data.team);
    } catch {
      setError('Could not read .chinwag file.');
    }
  }, []);

  useEffect(() => {
    if (!teamId) return;

    async function fetchContext() {
      try {
        const client = api(config);
        const ctx = await client.get(`/teams/${teamId}/context`);
        setContext(ctx);
        setLastUpdate(new Date().toLocaleTimeString());
        setError(null);
      } catch (err) {
        setError(`Failed to fetch team context: ${err.message}`);
      }
    }

    fetchContext();
    const interval = setInterval(fetchContext, 5000);
    return () => clearInterval(interval);
  }, [teamId]);

  useInput((ch) => {
    if (ch === 'q') { navigate('quit'); return; }
    if (ch === 'r') {
      // Force refresh by toggling teamId
      setTeamId(prev => {
        setContext(null);
        return prev;
      });
    }
    if (ch === 'b') { navigate('home'); return; }
  });

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">{error}</Text>
        <Box paddingTop={1}>
          <Text dimColor>[b] back  [q] quit</Text>
        </Box>
      </Box>
    );
  }

  if (!context) {
    return (
      <Box padding={1}>
        <Text dimColor>Loading team context...</Text>
      </Box>
    );
  }

  const activeMembers = context.members?.filter(m => m.status === 'active') || [];
  const offlineMembers = context.members?.filter(m => m.status === 'offline') || [];

  // Detect conflicts: files being edited by multiple agents
  const fileOwners = new Map();
  for (const m of activeMembers) {
    if (!m.activity?.files) continue;
    for (const f of m.activity.files) {
      if (!fileOwners.has(f)) fileOwners.set(f, []);
      fileOwners.get(f).push(m.handle);
    }
  }
  const conflicts = [...fileOwners.entries()].filter(([, owners]) => owners.length > 1);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {/* Agents section */}
        <Text bold>Agents ({activeMembers.length} active)</Text>
        <Text dimColor>{'─'.repeat(40)}</Text>

        {activeMembers.length === 0 && offlineMembers.length === 0 && (
          <Text dimColor>  No agents connected</Text>
        )}

        {activeMembers.map((m) => (
          <Box key={m.handle}>
            <Text color="green">  {m.handle}</Text>
            <Text dimColor> (active)</Text>
            {m.activity ? (
              <Text> — {m.activity.files.join(', ')} — "{m.activity.summary}"</Text>
            ) : (
              <Text dimColor> — idle</Text>
            )}
          </Box>
        ))}

        {offlineMembers.map((m) => (
          <Box key={m.handle}>
            <Text dimColor>  {m.handle} (offline)</Text>
          </Box>
        ))}

        {/* Conflicts section */}
        <Text>{''}</Text>
        <Text bold>Conflicts</Text>
        <Text dimColor>{'─'.repeat(40)}</Text>
        {conflicts.length === 0 ? (
          <Text dimColor>  (none)</Text>
        ) : (
          conflicts.map(([file, owners]) => (
            <Box key={file}>
              <Text color="red">  {file}</Text>
              <Text> — edited by {owners.join(', ')}</Text>
            </Box>
          ))
        )}

        {/* Recent Activity section */}
        {context.recentSessions && context.recentSessions.length > 0 && (
          <>
            <Text>{''}</Text>
            <Text bold>Recent Activity (24h)</Text>
            <Text dimColor>{'─'.repeat(40)}</Text>
            {context.recentSessions.map((s) => {
              const duration = s.duration_minutes >= 60
                ? `${Math.floor(s.duration_minutes / 60)}h ${Math.round(s.duration_minutes % 60)}m`
                : `${Math.round(s.duration_minutes)}m`;
              const fileCount = s.files_touched?.length || 0;
              const ended = s.ended_at ? ' (ended)' : '';
              const conflicts = s.conflicts_hit > 0 ? `, ${s.conflicts_hit} conflict${s.conflicts_hit > 1 ? 's' : ''}` : '';
              return (
                <Box key={`${s.owner_handle}-${s.started_at}`}>
                  <Text>  {s.owner_handle}</Text>
                  <Text dimColor> ({s.framework})</Text>
                  <Text> — {duration}, {s.edit_count} edits, {fileCount} files{conflicts}{ended}</Text>
                </Box>
              );
            })}
          </>
        )}

        {/* Memory section */}
        {context.memories && context.memories.length > 0 && (
          <>
            <Text>{''}</Text>
            <Text bold>Team Knowledge ({context.memories.length} entries)</Text>
            <Text dimColor>{'─'.repeat(40)}</Text>
            {context.memories.map((mem) => (
              <Box key={mem.text.slice(0, 50)}>
                <Text dimColor>  [{mem.category}]</Text>
                <Text> {mem.text}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>

      <Box paddingX={1} paddingTop={1}>
        <Text dimColor>
          {lastUpdate && `Updated ${lastUpdate}  `}
          [b] back  [r] refresh  [q] quit
        </Text>
      </Box>
    </Box>
  );
}

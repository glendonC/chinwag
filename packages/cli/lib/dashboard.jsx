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
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
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
  }, [teamId, refreshKey]);

  useInput((ch) => {
    if (ch === 'q') { navigate('quit'); return; }
    if (ch === 'r') {
      setContext(null);
      setRefreshKey(k => k + 1);
    }
    if (ch === 'b') { navigate('home'); return; }
  });

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">{error}</Text>
        <Box paddingTop={1}>
          <Text>
            <Text color="cyan" bold>[b]</Text><Text dimColor> back  </Text>
            <Text color="cyan" bold>[q]</Text><Text dimColor> quit</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  if (!context) {
    return (
      <Box padding={1}>
        <Text color="cyan">Loading team context...</Text>
      </Box>
    );
  }

  const activeMembers = context.members?.filter(m => m.status === 'active') || [];
  const offlineMembers = context.members?.filter(m => m.status === 'offline') || [];

  // Detect conflicts — include tool name when available
  const fileOwners = new Map();
  for (const m of activeMembers) {
    if (!m.activity?.files) continue;
    const label = m.tool && m.tool !== 'unknown' ? `${m.handle} (${m.tool})` : m.handle;
    for (const f of m.activity.files) {
      if (!fileOwners.has(f)) fileOwners.set(f, []);
      fileOwners.get(f).push(label);
    }
  }
  const conflicts = [...fileOwners.entries()].filter(([, owners]) => owners.length > 1);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {/* Agents */}
        <Text color="cyan" bold>Agents</Text>
        <Text dimColor>{'─'.repeat(50)}</Text>

        {activeMembers.length === 0 && offlineMembers.length === 0 && (
          <Text dimColor>  No agents connected</Text>
        )}

        {activeMembers.map((m) => {
          const tool = m.tool && m.tool !== 'unknown' ? ` (${m.tool})` : m.framework ? ` (${m.framework})` : '';
          const duration = m.session_minutes != null
            ? m.session_minutes >= 60
              ? ` ${Math.floor(m.session_minutes / 60)}h${Math.round(m.session_minutes % 60)}m`
              : ` ${Math.round(m.session_minutes)}m`
            : '';
          return (
            <Box key={m.agent_id || m.handle}>
              <Text color="green">  {m.handle}</Text>
              <Text dimColor>{tool}{duration}</Text>
              {m.activity ? (
                <Text>
                  <Text dimColor> — </Text>
                  <Text>{m.activity.files.join(', ')}</Text>
                  <Text dimColor> — "{m.activity.summary}"</Text>
                </Text>
              ) : (
                <Text dimColor> — idle</Text>
              )}
            </Box>
          );
        })}

        {offlineMembers.map((m) => (
          <Box key={m.agent_id || m.handle}>
            <Text dimColor>  {m.handle} (offline)</Text>
          </Box>
        ))}

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <>
            <Text>{''}</Text>
            <Text color="red" bold>Conflicts</Text>
            <Text dimColor>{'─'.repeat(50)}</Text>
            {conflicts.map(([file, owners]) => (
              <Box key={file}>
                <Text color="red">  {file}</Text>
                <Text dimColor> — </Text>
                <Text>{owners.join(', ')}</Text>
              </Box>
            ))}
          </>
        )}

        {/* Recent Activity */}
        {context.recentSessions && context.recentSessions.length > 0 && (
          <>
            <Text>{''}</Text>
            <Text color="cyan" bold>Recent Activity</Text>
            <Text dimColor>{'─'.repeat(50)}</Text>
            {context.recentSessions.map((s) => {
              const duration = s.duration_minutes >= 60
                ? `${Math.floor(s.duration_minutes / 60)}h ${Math.round(s.duration_minutes % 60)}m`
                : `${Math.round(s.duration_minutes)}m`;
              const fileCount = s.files_touched?.length || 0;
              const ended = s.ended_at ? ' (ended)' : '';
              const conflictsBadge = s.conflicts_hit > 0
                ? `, ${s.conflicts_hit} conflict${s.conflicts_hit > 1 ? 's' : ''}`
                : '';
              return (
                <Box key={`${s.owner_handle}-${s.started_at}`}>
                  <Text>  {s.owner_handle}</Text>
                  <Text dimColor> ({s.framework})</Text>
                  <Text dimColor> — {duration}, {s.edit_count} edits, {fileCount} files{conflictsBadge}{ended}</Text>
                </Box>
              );
            })}
          </>
        )}

        {/* Memory */}
        {context.memories && context.memories.length > 0 && (
          <>
            <Text>{''}</Text>
            <Text color="cyan" bold>Team Knowledge</Text>
            <Text dimColor>{'─'.repeat(50)}</Text>
            {context.memories.map((mem, idx) => (
              <Box key={mem.id || idx}>
                <Text color="yellow">  [{mem.category}]</Text>
                <Text> {mem.text}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>

      <Box paddingX={1} paddingTop={1}>
        <Text>
          {lastUpdate && <Text dimColor>Updated {lastUpdate}  </Text>}
          <Text color="cyan" bold>[b]</Text><Text dimColor> back  </Text>
          <Text color="cyan" bold>[r]</Text><Text dimColor> refresh  </Text>
          <Text color="cyan" bold>[q]</Text><Text dimColor> quit</Text>
        </Text>
      </Box>
    </Box>
  );
}

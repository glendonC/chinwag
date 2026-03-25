import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { api } from './api.js';
import { getInkColor } from './colors.js';
import { detectTools } from './mcp-config.js';
import { openDashboard } from './open-dashboard.js';

// Read version from package.json at import time (bundled by esbuild)
let PKG_VERSION = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  PKG_VERSION = pkg.version;
} catch { /* fallback */ }

const MIN_WIDTH = 50;

export function Dashboard({ config, user, navigate }) {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns || 80);
  const [teamId, setTeamId] = useState(null);
  const [teamName, setTeamName] = useState(null);
  const [toolCount, setToolCount] = useState(0);
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setCols(stdout.columns);
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  useEffect(() => {
    const cwd = process.cwd();
    const chinwagFile = join(cwd, '.chinwag');
    if (!existsSync(chinwagFile)) {
      setError('No .chinwag file found. Run `npx chinwag init` first.');
      return;
    }
    try {
      const data = JSON.parse(readFileSync(chinwagFile, 'utf-8'));
      if (!data.team) {
        setError('Invalid .chinwag file — missing team ID.');
        return;
      }
      setTeamId(data.team);
      setTeamName(data.name || data.team);
    } catch {
      setError('Could not read .chinwag file.');
    }

    try {
      setToolCount(detectTools(cwd).length);
    } catch {}
  }, []);

  useEffect(() => {
    if (!teamId) return;

    const client = api(config);
    let joined = false;

    async function fetchContext() {
      try {
        // Auto-join on first fetch or after "not a member" error
        if (!joined) {
          await client.post(`/teams/${teamId}/join`, { name: teamName }).catch(() => {});
          joined = true;
        }
        const ctx = await client.get(`/teams/${teamId}/context`);
        setContext(ctx);
        setError(null);
      } catch (err) {
        if (err.message?.includes('Not a member')) {
          // Force re-join on next attempt
          joined = false;
        }
        setError(`Failed to fetch: ${err.message}`);
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
    if (ch === 'w') { openDashboard().catch(() => {}); return; }
    if (ch === 'f') { navigate('discover'); return; }
    if (ch === 'c') { navigate('chat'); return; }
    if (ch === 's') { navigate('customize'); return; }
  });

  const userColor = getInkColor(user?.color);

  // Branded header — simple text, works at any terminal width
  const header = (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Text>
        <Text color="cyan" bold>chinwag</Text>
        <Text dimColor>  v{PKG_VERSION}</Text>
      </Text>
      <Text>
        <Text color={userColor} bold>{user?.handle || 'unknown'}</Text>
        <Text dimColor> · </Text>
        <Text>{teamName || '—'}</Text>
        {toolCount > 0 && <Text dimColor> · {toolCount} tools</Text>}
      </Text>
    </Box>
  );

  // Divider width — responsive to terminal
  const dividerWidth = Math.min(cols - 4, 50);

  // Nav bar — always visible
  const navBar = (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Text>
        <Text color="cyan" bold>[w]</Text><Text dimColor> browser  </Text>
        <Text color="cyan" bold>[f]</Text><Text dimColor> tools  </Text>
        <Text color="cyan" bold>[c]</Text><Text dimColor> chat  </Text>
        <Text color="cyan" bold>[s]</Text><Text dimColor> settings  </Text>
        <Text color="cyan" bold>[q]</Text><Text dimColor> quit</Text>
      </Text>
    </Box>
  );

  // Too narrow — ask user to widen
  if (cols < MIN_WIDTH) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>chinwag</Text>
        <Text>{''}</Text>
        <Text dimColor>Terminal too narrow.</Text>
        <Text dimColor>Widen to at least {MIN_WIDTH} columns.</Text>
        <Text>{''}</Text>
        <Text dimColor>Current: {cols}</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        {header}
        <Box padding={1}>
          <Text color="red">{error}</Text>
        </Box>
        {navBar}
      </Box>
    );
  }

  if (!context) {
    return (
      <Box flexDirection="column">
        {header}
        <Box padding={1}>
          <Text dimColor>Loading...</Text>
        </Box>
        {navBar}
      </Box>
    );
  }

  // Separate agents with real activity from idle/offline
  const activeWithWork = (context.members || []).filter(m => m.status === 'active' && m.activity?.files?.length > 0);
  const activeIdle = (context.members || []).filter(m => m.status === 'active' && (!m.activity || !m.activity.files?.length));
  const offline = (context.members || []).filter(m => m.status === 'offline');
  const totalActive = activeWithWork.length + activeIdle.length;

  // Detect conflicts
  const fileOwners = new Map();
  for (const m of activeWithWork) {
    const label = m.tool && m.tool !== 'unknown' ? `${m.handle} (${m.tool})` : m.handle;
    for (const f of m.activity.files) {
      if (!fileOwners.has(f)) fileOwners.set(f, []);
      fileOwners.get(f).push(label);
    }
  }
  const conflicts = [...fileOwners.entries()].filter(([, owners]) => owners.length > 1);

  const hasMemories = context.memories?.length > 0;
  const hasSessions = context.recentSessions?.length > 0;
  const hasContent = activeWithWork.length > 0 || conflicts.length > 0 || hasMemories || hasSessions;

  return (
    <Box flexDirection="column">
      {header}

      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {/* Empty state — nothing happening */}
        {!hasContent && (
          <Box flexDirection="column">
            <Text dimColor>All quiet. {totalActive > 0 ? `${totalActive} agent${totalActive > 1 ? 's' : ''} connected, waiting for activity.` : 'Agents will appear here when your tools connect.'}</Text>
          </Box>
        )}

        {/* Active agents with work */}
        {activeWithWork.length > 0 && (
          <>
            <Text color="cyan" bold>Active Agents</Text>
            <Text dimColor>{'─'.repeat(dividerWidth)}</Text>
            {activeWithWork.map((m) => {
              const tool = m.tool && m.tool !== 'unknown' ? m.tool : m.framework || null;
              const toolLabel = tool ? ` via ${tool}` : '';
              const duration = m.session_minutes != null
                ? m.session_minutes >= 60
                  ? ` · ${Math.floor(m.session_minutes / 60)}h ${Math.round(m.session_minutes % 60)}m`
                  : ` · ${Math.round(m.session_minutes)}m`
                : '';
              return (
                <Box key={m.agent_id || m.handle} flexDirection="column">
                  <Text>
                    <Text color="green">  ● </Text>
                    <Text bold>{m.handle}</Text>
                    <Text dimColor>{toolLabel}{duration}</Text>
                  </Text>
                  {m.activity && (
                    <Text dimColor>    {m.activity.files.join(', ')}{m.activity.summary ? ` — "${m.activity.summary}"` : ''}</Text>
                  )}
                </Box>
              );
            })}
          </>
        )}

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <>
            <Text>{''}</Text>
            <Text color="red" bold>Conflicts</Text>
            <Text dimColor>{'─'.repeat(dividerWidth)}</Text>
            {conflicts.map(([file, owners]) => (
              <Box key={file}>
                <Text color="red">  ⚠ {file}</Text>
                <Text dimColor> — {owners.join(' & ')}</Text>
              </Box>
            ))}
          </>
        )}

        {/* Team Knowledge */}
        {hasMemories && (
          <>
            <Text>{''}</Text>
            <Text color="cyan" bold>Team Knowledge</Text>
            <Text dimColor>{'─'.repeat(dividerWidth)}</Text>
            {context.memories.map((mem, idx) => (
              <Box key={mem.id || idx}>
                <Text color="yellow">  [{mem.category}]</Text>
                <Text> {mem.text}</Text>
              </Box>
            ))}
          </>
        )}

        {/* Recent Activity */}
        {hasSessions && (
          <>
            <Text>{''}</Text>
            <Text color="cyan" bold>Recent Activity</Text>
            <Text dimColor>{'─'.repeat(dividerWidth)}</Text>
            {context.recentSessions.map((s) => {
              const duration = s.duration_minutes >= 60
                ? `${Math.floor(s.duration_minutes / 60)}h ${Math.round(s.duration_minutes % 60)}m`
                : `${Math.round(s.duration_minutes)}m`;
              const fileCount = s.files_touched?.length || 0;
              const live = !s.ended_at;
              return (
                <Box key={`${s.owner_handle}-${s.started_at}`}>
                  <Text>  {s.owner_handle}</Text>
                  {s.framework && <Text dimColor> ({s.framework})</Text>}
                  <Text dimColor> — {duration}, {s.edit_count} edits, {fileCount} files</Text>
                  {live && <Text color="green"> live</Text>}
                </Box>
              );
            })}
          </>
        )}
      </Box>

      {navBar}
    </Box>
  );
}

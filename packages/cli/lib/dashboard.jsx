import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { api } from './api.js';
import { buildDashboardView, collectTags, formatDuration, formatFiles, smartSummary } from './dashboard-view.js';

import { detectTools } from './mcp-config.js';
import { openDashboard } from './open-dashboard.js';

let PKG_VERSION = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  PKG_VERSION = pkg.version;
} catch { /* fallback */ }

let VSCODE_EXTENSION = { publisher: 'chinwag', name: 'chinwag', version: PKG_VERSION };
try {
  const pkg = JSON.parse(readFileSync(new URL('../../vscode/package.json', import.meta.url), 'utf-8'));
  VSCODE_EXTENSION = {
    publisher: pkg.publisher || 'chinwag',
    name: pkg.name || 'chinwag',
    version: pkg.version || PKG_VERSION,
  };
} catch { /* fallback */ }

const MIN_WIDTH = 50;
const IDE_COMMAND_SHORTCUT = process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
const IDE_EXTENSION_DIR = fileURLToPath(new URL('../../vscode/', import.meta.url));

export function Dashboard({ config, user, navigate }) {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns || 80);
  const [teamId, setTeamId] = useState(null);
  const [teamName, setTeamName] = useState(null);
  const [detectedTools, setDetectedTools] = useState([]);
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [flashMsg, setFlashMsg] = useState(null);

  // Memory management
  const [memoryFilter, setMemoryFilter] = useState(null);
  const [memorySelectedIdx, setMemorySelectedIdx] = useState(-1);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState(null);

  // Section focus: 'agents' | 'memory'
  const [activeSection, setActiveSection] = useState('agents');

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
      setDetectedTools(detectTools(cwd));
    } catch {}
  }, []);

  useEffect(() => {
    if (!teamId) return;
    const client = api(config);
    let joined = false;

    async function fetchContext() {
      try {
        if (!joined) {
          await client.post(`/teams/${teamId}/join`, { name: teamName }).catch(() => {});
          joined = true;
        }
        const ctx = await client.get(`/teams/${teamId}/context`);
        setContext(ctx);
        setError(null);
      } catch (err) {
        if (err.message?.includes('Not a member')) joined = false;
        setError(`Failed to fetch: ${err.message}`);
      }
    }

    fetchContext();
    const interval = setInterval(fetchContext, 5000);
    return () => clearInterval(interval);
  }, [teamId, teamName, refreshKey, config?.token]);

  useInput((input, key) => {
    // When terminal is too narrow, only allow quit
    if (cols < MIN_WIDTH) {
      if (input === 'q') navigate('quit');
      return;
    }

    // Tab switches section focus
    if (key.tab) {
      setActiveSection(prev => prev === 'agents' ? 'memory' : 'agents');
      setSelectedIdx(-1);
      setMemorySelectedIdx(-1);
      setDeleteConfirm(false);
      return;
    }

    // Section-specific arrow navigation
    if (activeSection === 'agents') {
      if (key.downArrow && visibleAgents.length > 0) {
        setSelectedIdx(prev => Math.min(prev + 1, visibleAgents.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIdx(prev => prev <= 0 ? -1 : prev - 1);
        return;
      }
      if (key.escape) { setSelectedIdx(-1); return; }
    }

    if (activeSection === 'memory') {
      if (key.downArrow && filteredMemories.length > 0) {
        setMemorySelectedIdx(prev => Math.min(prev + 1, filteredMemories.length - 1));
        setDeleteConfirm(false);
        return;
      }
      if (key.upArrow) {
        setMemorySelectedIdx(prev => prev <= 0 ? -1 : prev - 1);
        setDeleteConfirm(false);
        return;
      }
      if (key.escape) {
        if (deleteConfirm) { setDeleteConfirm(false); return; }
        setMemorySelectedIdx(-1);
        return;
      }
    }

    // Memory filter: [m] cycles tags
    if (input === 'm') {
      const tags = [null, ...collectTags(memories)];
      const currentIdx = tags.indexOf(memoryFilter);
      const nextIdx = (currentIdx + 1) % tags.length;
      setMemoryFilter(tags[nextIdx]);
      setMemorySelectedIdx(-1);
      setDeleteConfirm(false);
      return;
    }

    // Memory delete: [d] on selected memory
    if (input === 'd' && activeSection === 'memory' && memorySelectedIdx >= 0) {
      if (!deleteConfirm) {
        setDeleteConfirm(true);
        return;
      }
      // Confirmed — delete
      const mem = filteredMemories[memorySelectedIdx];
      if (mem?.id && teamId) {
        const client = api(config);
        client.del(`/teams/${teamId}/memory`, { id: mem.id }).then(() => {
          setDeleteMsg('Memory deleted');
          setDeleteConfirm(false);
          setMemorySelectedIdx(-1);
          setRefreshKey(k => k + 1);
          setTimeout(() => setDeleteMsg(null), 2000);
        }).catch(() => {
          setDeleteMsg('Delete failed');
          setDeleteConfirm(false);
          setTimeout(() => setDeleteMsg(null), 2000);
        });
      }
      return;
    }

    if (input === 'q') { navigate('quit'); return; }
    if (input === 'r') {
      setContext(null);
      setRefreshKey(k => k + 1);
    }
    if (input === 'w') { openDashboard().catch(() => {}); return; }
    if (input === 'e') {
      // Install/update chinwag extension into IDE
      const extName = `${VSCODE_EXTENSION.publisher}.${VSCODE_EXTENSION.name}-${VSCODE_EXTENSION.version}`;
      // All VS Code forks: Cursor, Windsurf, VS Code, Void, etc.
      const ideDirs = ['.cursor', '.windsurf', '.vscode'];
      const ideDir = ideDirs.find(d => existsSync(join(homedir(), d))) || '.vscode';
      const target = join(homedir(), ideDir, 'extensions', extName);
      const wasInstalled = existsSync(target);
      try {
        mkdirSync(target, { recursive: true });
        cpSync(join(IDE_EXTENSION_DIR, 'package.json'), join(target, 'package.json'));
        cpSync(join(IDE_EXTENSION_DIR, 'dist', 'extension.js'), join(target, 'extension.js'));
        try { cpSync(join(IDE_EXTENSION_DIR, 'logo-mark.svg'), join(target, 'logo-mark.svg')); } catch {}
        setFlashMsg(wasInstalled
          ? `Updated — ${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`
          : `Installed — restart IDE, then ${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`);
      } catch {
        if (wasInstalled) {
          setFlashMsg(`${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`);
        } else {
          setFlashMsg('Could not install extension');
        }
      }
      setTimeout(() => setFlashMsg(null), 5000);
      return;
    }
    if (input === 'f') { navigate('discover'); return; }
    if (input === 'c') { navigate('chat'); return; }
    if (input === 's') { navigate('customize'); return; }
  });

  const {
    getToolName,
    projectDir,
    activeAgents,
    conflicts,
    memories,
    filteredMemories,
    visibleMemories,
    memoryOverflow,
    messages,
    recentSessions,
    showRecent,
    visibleAgents,
    agentOverflow,
    toolCounts,
    isTeam,
  } = buildDashboardView({
    context,
    detectedTools,
    memoryFilter,
    cols,
    projectDir: teamName || basename(process.cwd()),
  });

  useEffect(() => {
    if (selectedIdx >= visibleAgents.length) {
      setSelectedIdx(visibleAgents.length > 0 ? visibleAgents.length - 1 : -1);
    }
  }, [selectedIdx, visibleAgents.length]);

  useEffect(() => {
    if (memorySelectedIdx >= visibleMemories.length) {
      setMemorySelectedIdx(visibleMemories.length > 0 ? visibleMemories.length - 1 : -1);
    }
  }, [memorySelectedIdx, visibleMemories.length]);

  // ── Layout pieces ──────────────────────────────────────

  const header = null;

  const navBar = (
    <Box paddingX={1} paddingTop={1}>
      <Text>
        {activeSection === 'memory' ? (
          <>
            <Text color="cyan" bold>[Tab]</Text><Text dimColor> agents  </Text>
            <Text color="cyan" bold>[m]</Text><Text dimColor> filter  </Text>
            {memorySelectedIdx >= 0 && (
              <><Text color="cyan" bold>[d]</Text><Text dimColor> delete  </Text></>
            )}
          </>
        ) : (
          <><Text color="cyan" bold>[Tab]</Text><Text dimColor> memory  </Text></>
        )}
        <Text color="cyan" bold>[w]</Text><Text dimColor> browser  </Text>
        <Text color="cyan" bold>[f]</Text><Text dimColor> tools  </Text>
        <Text color="cyan" bold>[s]</Text><Text dimColor> settings  </Text>
        <Text color="cyan" bold>[q]</Text><Text dimColor> quit</Text>
      </Text>
    </Box>
  );

  // ── Guards ─────────────────────────────────────────────

  if (cols < MIN_WIDTH) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>chinwag</Text>
        <Text>{''}</Text>
        <Text dimColor>Terminal too narrow ({cols} cols).</Text>
        <Text dimColor>Widen to at least {MIN_WIDTH}.</Text>
        <Text>{''}</Text>
        <Text><Text color="cyan" bold>[q]</Text><Text dimColor> quit</Text></Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} paddingTop={1}>
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
        <Box paddingX={1} paddingTop={1}>
          <Text dimColor>Connecting...</Text>
        </Box>
        {navBar}
      </Box>
    );
  }

  // ── Main render ────────────────────────────────────────

  return (
    <Box flexDirection="column">
      {header}

      {/* Agents — the core section, always visible */}
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text>
          <Text bold>Agents</Text>
          {activeAgents.length > 0 && (
            <Text dimColor>  {activeAgents.length} active</Text>
          )}
          {activeSection === 'agents' && activeAgents.length > 0 && <Text dimColor>  ↑↓</Text>}
        </Text>

        {activeAgents.length === 0 ? (
          <Text dimColor>  No agents running. Start an AI tool to see it here.</Text>
        ) : (
          <>
            {visibleAgents.map((m, idx) => {
              const toolName = getToolName(m.tool);
              const dur = formatDuration(m.session_minutes);
              const hasDupes = toolCounts.get(m.tool) > 1;
              const toolNum = hasDupes
                ? visibleAgents.slice(0, idx).filter(a => a.tool === m.tool).length + 1
                : 0;
              const isSelected = activeSection === 'agents' && idx === selectedIdx;
              const allFiles = m.activity?.files || [];
              const files = formatFiles(allFiles);
              const summary = smartSummary(m.activity);

              return (
                <Box key={m.agent_id || m.handle} flexDirection="column">
                  <Text>
                    {isSelected
                      ? <Text color="cyan">  ▸ </Text>
                      : <Text color="green">  ● </Text>
                    }
                    <Text bold>{toolName || 'Unknown'}</Text>
                    {isTeam && <Text dimColor>  {m.handle}</Text>}
                    {summary && <Text>  {summary}</Text>}
                    {dur && <Text dimColor>  {dur}</Text>}
                  </Text>
                  {isSelected ? (
                    <Box flexDirection="column">
                      {allFiles.length > 0
                        ? allFiles.map(f => (
                            <Text key={f} dimColor>{'      '}{basename(f)}</Text>
                          ))
                        : <Text dimColor>{'      '}No activity reported yet</Text>
                      }
                    </Box>
                  ) : files ? (
                    <Text dimColor>{'    '}{files}</Text>
                  ) : null}
                </Box>
              );
            })}
            {agentOverflow > 0 && (
              <Text dimColor>  + {agentOverflow} more — <Text color="cyan" bold>[w]</Text> to see all</Text>
            )}
          </>
        )}
      </Box>

      {/* Conflicts — only when agents overlap on files */}
      {conflicts.length > 0 && (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          <Text color="red" bold>Conflicts</Text>
  
          {conflicts.map(([file, owners]) => (
            <Text key={file}>
              <Text color="red">  ! {basename(file)}</Text>
              <Text dimColor> — {owners.join(' & ')}</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Messages — show if any exist */}
      {messages.length > 0 && (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          <Text>
            <Text bold>Messages</Text>
            <Text dimColor>  {messages.length} recent</Text>
          </Text>
  
          {messages.slice(0, 5).map((msg, i) => {
            const from = msg.from_tool && msg.from_tool !== 'unknown'
              ? `${msg.from_handle} (${msg.from_tool})`
              : msg.from_handle;
            return (
              <Text key={i}>
                <Text color="blue">  {from}</Text>
                <Text dimColor>  {msg.text}</Text>
              </Text>
            );
          })}
          {messages.length > 5 && (
            <Text dimColor>  + {messages.length - 5} more</Text>
          )}
        </Box>
      )}

      {/* Memory — project knowledge saved by agents */}
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text>
          <Text bold>Memory</Text>
          {memories.length > 0 && <Text dimColor>  {memories.length} saved</Text>}
          {memoryFilter && <Text color="yellow">  [{memoryFilter}]</Text>}
          {activeSection === 'memory' && <Text dimColor>  ↑↓</Text>}
        </Text>

        {filteredMemories.length === 0 ? (
          <Text dimColor>
            {memoryFilter
              ? `  No ${memoryFilter} memories. [m] to change filter.`
              : '  None yet — agents save project knowledge here.'}
          </Text>
        ) : (
          <>
            {visibleMemories.map((mem, idx) => {
              const tagStr = mem.tags?.length ? `[${mem.tags.join(', ')}]` : '';
              const prefixLen = 4 + (tagStr ? tagStr.length + 2 : 0);
              const maxText = cols - prefixLen - 4;
              const text = mem.text.length > maxText ? mem.text.slice(0, maxText - 1) + '…' : mem.text;
              const isMemSelected = activeSection === 'memory' && idx === memorySelectedIdx;
              return (
                <Text key={mem.id || idx}>
                  {isMemSelected
                    ? <Text color="cyan">  ▸ </Text>
                    : <Text>{'  '}</Text>
                  }
                  {tagStr && <Text dimColor>{tagStr}  </Text>}
                  <Text>{text}</Text>
                  {isMemSelected && mem.source_handle && (
                    <Text dimColor>  — {mem.source_handle}</Text>
                  )}
                </Text>
              );
            })}
            {memoryOverflow > 0 && (
              <Text dimColor>  + {memoryOverflow} more — <Text color="cyan" bold>[w]</Text> to browse all</Text>
            )}
          </>
        )}
        {deleteConfirm && (
          <Text color="red">  Press [d] again to confirm delete, [Esc] to cancel</Text>
        )}
        {deleteMsg && (
          <Text dimColor>  {deleteMsg}</Text>
        )}
      </Box>

      {/* Recent — past work, only when no agents are live */}
      {showRecent && (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          <Text bold>Recent</Text>
  
          {recentSessions.slice(0, 5).map(s => {
            const dur = formatDuration(s.duration_minutes) || '0 min';
            const fileCount = s.files_touched?.length || 0;
            const hasActivity = s.edit_count > 0 || fileCount > 0;
            const toolName = s.tool ? getToolName(s.tool) : null;
            return (
              <Text key={`${s.owner_handle}-${s.started_at}`}>
                <Text>  {toolName || 'Agent'}</Text>
                <Text dimColor>  {s.owner_handle}</Text>
                <Text dimColor>  {dur}</Text>
                {hasActivity && <Text dimColor>  {s.edit_count} edits  {fileCount} files</Text>}
              </Text>
            );
          })}
        </Box>
      )}

      {flashMsg && (
        <Box paddingX={1} paddingTop={1}>
          <Text color="green" bold>{flashMsg}</Text>
        </Box>
      )}

      {navBar}
    </Box>
  );
}

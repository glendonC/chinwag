import { describe, expect, it } from 'vitest';
import {
  buildDashboardView,
  createToolNameResolver,
  formatDuration,
  formatFiles,
  hasVisibleSessionActivity,
  smartSummary,
  shortAgentId,
} from '../dashboard-view.js';

describe('dashboard view helpers', () => {
  it('resolves friendly tool names from detected tools', () => {
    const getToolName = createToolNameResolver([
      { id: 'claude-code', name: 'Claude Code' },
      { id: 'cursor', name: 'Cursor' },
    ]);

    expect(getToolName('claude-code')).toBe('Claude Code');
    expect(getToolName('cursor')).toBe('Cursor');
    expect(getToolName('unknown')).toBeNull();
    expect(getToolName('aider')).toBe('aider');
  });

  it('formats durations and file summaries compactly', () => {
    expect(formatDuration(42)).toBe('42 min');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatFiles(['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js'])).toBe('a.js, b.js + 2 more');
  });

  it('suppresses redundant editing summaries', () => {
    expect(smartSummary({ summary: 'Editing src/app.js', files: ['src/app.js'] })).toBeNull();
    expect(smartSummary({ summary: 'Refactor auth flow', files: ['src/app.js'] })).toBe('Refactor auth flow');
  });

  it('extracts the short session suffix from agent ids', () => {
    expect(shortAgentId('claude-code:abc123:def45678')).toBe('def4');
    expect(shortAgentId('cursor:abc123')).toBe('');
  });

  it('keeps active or meaningful recent sessions visible', () => {
    expect(hasVisibleSessionActivity({ ended_at: null, edit_count: 0, files_touched: [] })).toBe(true);
    expect(hasVisibleSessionActivity({ ended_at: '2026-03-26T00:00:00Z', edit_count: 2, files_touched: [] })).toBe(true);
    expect(hasVisibleSessionActivity({ ended_at: '2026-03-26T00:00:00Z', edit_count: 0, files_touched: ['src/app.js'] })).toBe(true);
    expect(hasVisibleSessionActivity({ ended_at: '2026-03-26T00:00:00Z', edit_count: 0, files_touched: [] })).toBe(false);
  });

  it('builds a dashboard view model with conflicts and memory filtering', () => {
    const view = buildDashboardView({
      cols: 80,
      detectedTools: [
        { id: 'claude-code', name: 'Claude Code' },
        { id: 'cursor', name: 'Cursor' },
      ],
      memoryFilter: 'decision',
      projectDir: 'chinwag',
      context: {
        members: [
          {
            agent_id: 'claude-code:aaa:1111',
            handle: 'alice',
            tool: 'claude-code',
            status: 'active',
            session_minutes: 10,
            activity: { files: ['src/shared.js'], summary: 'Refactor auth flow' },
          },
          {
            agent_id: 'cursor:bbb:2222',
            handle: 'bob',
            tool: 'cursor',
            status: 'active',
            session_minutes: 5,
            activity: { files: ['src/shared.js'], summary: 'Fix login bug' },
          },
        ],
        memories: [
          { id: 'm1', tags: ['decision'], text: 'Use TeamDO for coordination' },
          { id: 'm2', tags: ['config'], text: 'Run worker on port 8787' },
        ],
        recentSessions: [
          { owner_handle: 'alice', duration_minutes: 12, edit_count: 2, files_touched: ['src/shared.js'] },
        ],
      },
    });

    expect(view.activeAgents).toHaveLength(2);
    expect(view.conflicts).toEqual([['src/shared.js', ['alice (Claude Code)', 'bob (Cursor)']]]);
    expect(view.filteredMemories).toEqual([{ id: 'm1', tags: ['decision'], text: 'Use TeamDO for coordination' }]);
    expect(view.showRecent).toBe(false);
    expect(view.projectDir).toBe('chinwag');
  });
});

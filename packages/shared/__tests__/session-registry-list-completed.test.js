import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listCompletedSessions, writeCompletedSession } from '../session-registry.ts';

function makeHomeRoot() {
  return join(
    tmpdir(),
    `chinmeister-session-list-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

describe('listCompletedSessions', () => {
  let homeDir;

  beforeEach(() => {
    homeDir = makeHomeRoot();
    mkdirSync(join(homeDir, '.chinmeister', 'sessions'), { recursive: true });
  });

  afterEach(() => rmSync(homeDir, { recursive: true, force: true }));

  it('returns an empty array when the sessions dir is missing', () => {
    const bareHome = makeHomeRoot();
    mkdirSync(bareHome, { recursive: true });
    expect(listCompletedSessions({ homeDir: bareHome })).toEqual([]);
    rmSync(bareHome, { recursive: true, force: true });
  });

  it('returns records written via writeCompletedSession', () => {
    const rec1 = {
      agentId: 'agent-a',
      sessionId: 'sess-a',
      teamId: 't-1',
      toolId: 'claude-code',
      cwd: '/repo/a',
      startedAt: 1000,
      completedAt: 2000,
    };
    const rec2 = {
      agentId: 'agent-b',
      sessionId: 'sess-b',
      teamId: 't-2',
      toolId: 'codex',
      cwd: '/repo/b',
      startedAt: 1500,
      completedAt: 2500,
    };
    writeCompletedSession(rec1, { homeDir });
    writeCompletedSession(rec2, { homeDir });

    const listed = listCompletedSessions({ homeDir });
    expect(listed).toHaveLength(2);
    const agentIds = listed.map((l) => l.record.agentId).sort();
    expect(agentIds).toEqual(['agent-a', 'agent-b']);
    // Each entry surfaces a concrete on-disk path so callers can delete
    // after collecting. Protects against divergence between listing and
    // deletion routines.
    for (const entry of listed) {
      expect(entry.filePath).toContain('.completed.json');
    }
  });

  it('skips corrupted completion files rather than crashing the sweep', () => {
    writeCompletedSession(
      {
        agentId: 'agent-ok',
        sessionId: 'sess-ok',
        teamId: 't-1',
        toolId: 'claude-code',
        cwd: '/repo',
        startedAt: 1000,
        completedAt: 2000,
      },
      { homeDir },
    );
    // Write a malformed file alongside — the sweep must keep going.
    writeFileSync(
      join(homeDir, '.chinmeister', 'sessions', 'agent-bad.completed.json'),
      'not json at all',
    );

    const listed = listCompletedSessions({ homeDir });
    expect(listed).toHaveLength(1);
    expect(listed[0].record.agentId).toBe('agent-ok');
  });

  it('ignores files that do not match the *.completed.json pattern', () => {
    writeCompletedSession(
      {
        agentId: 'agent-a',
        sessionId: 'sess-a',
        teamId: 't-1',
        toolId: 'claude-code',
        cwd: '/repo',
        startedAt: 1000,
        completedAt: 2000,
      },
      { homeDir },
    );
    // Unrelated files (session records, misc) must not be returned.
    writeFileSync(
      join(homeDir, '.chinmeister', 'sessions', 'agent-a.session.json'),
      '{"pid":1234}',
    );
    writeFileSync(join(homeDir, '.chinmeister', 'sessions', 'README.md'), 'notes');

    const listed = listCompletedSessions({ homeDir });
    expect(listed).toHaveLength(1);
    expect(listed[0].record.agentId).toBe('agent-a');
  });

  it('drops records missing required identifiers', () => {
    writeFileSync(
      join(homeDir, '.chinmeister', 'sessions', 'agent-x.completed.json'),
      JSON.stringify({ agentId: 'agent-x' }), // missing sessionId / teamId
    );
    expect(listCompletedSessions({ homeDir })).toEqual([]);
  });
});

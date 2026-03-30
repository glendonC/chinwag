import { describe, expect, it } from 'vitest';
import {
  buildHostJoinShare,
  buildSurfaceJoinShare,
  buildToolJoinShare,
} from './toolAnalytics.js';

const teams = [
  {
    team_id: 't_one',
    team_name: 'alpha',
    tools_configured: [
      { tool: 'cursor', joins: 4 },
      { tool: 'claude-code', joins: 2 },
    ],
    hosts_configured: [
      { host_tool: 'cursor', joins: 4 },
      { host_tool: 'claude-code', joins: 2 },
    ],
    surfaces_seen: [
      { agent_surface: 'cline', joins: 3 },
    ],
  },
  {
    team_id: 't_two',
    team_name: 'beta',
    tools_configured: [
      { tool: 'cursor', joins: 1 },
    ],
    hosts_configured: [
      { host_tool: 'cursor', joins: 1 },
    ],
    surfaces_seen: [
      { agent_surface: 'continue', joins: 2 },
      { agent_surface: 'cline', joins: 1 },
    ],
  },
];

describe('tool analytics join shares', () => {
  it('builds tool join share entries with project rollups', () => {
    const entries = buildToolJoinShare(teams);
    expect(entries[0]).toMatchObject({
      tool: 'cursor',
      value: 5,
      projectCount: 2,
    });
  });

  it('builds host join share entries', () => {
    const entries = buildHostJoinShare(teams);
    expect(entries[0]).toMatchObject({
      host_tool: 'cursor',
      value: 5,
      projectCount: 2,
    });
    expect(entries[1]).toMatchObject({
      host_tool: 'claudecode',
      value: 2,
      projectCount: 1,
    });
  });

  it('builds agent surface join share entries', () => {
    const entries = buildSurfaceJoinShare(teams);
    expect(entries[0]).toMatchObject({
      agent_surface: 'cline',
      value: 4,
      projectCount: 2,
    });
    expect(entries[1]).toMatchObject({
      agent_surface: 'continue',
      value: 2,
      projectCount: 1,
    });
  });
});

import { describe, it, expect } from 'vitest';
import { dashboardSummarySchema } from './common.js';

// Contract tests locking the schema's defaulting discipline.
//
// Why: before this schema was tightened, optional server fields like
// `conflict_count` and `recent_sessions_24h` were coerced to 0 on omission
// via `.default(0)`. That masked degraded payloads — "server said zero"
// looked identical to "server omitted." Widgets need to distinguish.
//
// Also locks `.passthrough()` so worker-shipped fields outside the web
// schema (notably `active_members`) survive parse.

function validSummary(overrides: Record<string, unknown> = {}) {
  return {
    team_id: 't1',
    active_agents: 0,
    memory_count: 0,
    ...overrides,
  };
}

describe('dashboardSummarySchema', () => {
  it('parses an empty response with defaults', () => {
    const parsed = dashboardSummarySchema.parse({});
    expect(parsed.teams).toEqual([]);
    expect(parsed.degraded).toBe(false);
    expect(parsed.failed_teams).toEqual([]);
    expect(parsed.truncated).toBe(false);
  });

  it('round-trips truncated flag', () => {
    const parsed = dashboardSummarySchema.parse({
      teams: [],
      degraded: false,
      failed_teams: [],
      truncated: true,
    });
    expect(parsed.truncated).toBe(true);
  });

  it('parses a minimal team summary (server sends only required fields)', () => {
    const parsed = dashboardSummarySchema.parse({
      teams: [{ team_id: 't1' }],
    });
    expect(parsed.teams).toHaveLength(1);
    expect(parsed.teams[0].team_id).toBe('t1');
    // Required-in-shared fields default when omitted:
    expect(parsed.teams[0].active_agents).toBe(0);
    expect(parsed.teams[0].memory_count).toBe(0);
  });

  it('leaves omitted optional fields as undefined (not coerced to 0)', () => {
    const parsed = dashboardSummarySchema.parse({
      teams: [{ team_id: 't1' }],
    });
    // These used to silently default to 0 — hiding server omission.
    // The renderer must see `undefined` so "server said zero" and "server
    // omitted" stay distinguishable.
    expect(parsed.teams[0].conflict_count).toBeUndefined();
    expect(parsed.teams[0].total_members).toBeUndefined();
    expect(parsed.teams[0].live_sessions).toBeUndefined();
    expect(parsed.teams[0].recent_sessions_24h).toBeUndefined();
  });

  it('parses a full team summary with all optional fields populated', () => {
    const parsed = dashboardSummarySchema.parse({
      teams: [
        validSummary({
          team_name: 'chinmeister',
          conflict_count: 2,
          total_members: 7,
          live_sessions: 3,
          recent_sessions_24h: 14,
          hosts_configured: [{ host_tool: 'claude-code', joins: 12 }],
        }),
      ],
    });
    const t = parsed.teams[0];
    expect(t.team_name).toBe('chinmeister');
    expect(t.conflict_count).toBe(2);
    expect(t.total_members).toBe(7);
    expect(t.live_sessions).toBe(3);
    expect(t.recent_sessions_24h).toBe(14);
    expect(t.hosts_configured).toHaveLength(1);
    expect(t.hosts_configured[0].host_tool).toBe('claude-code');
  });

  it('parses a degraded response with failed_teams', () => {
    const parsed = dashboardSummarySchema.parse({
      teams: [validSummary()],
      degraded: true,
      failed_teams: [{ team_id: 't2', team_name: 'down' }],
      truncated: false,
    });
    expect(parsed.degraded).toBe(true);
    expect(parsed.failed_teams).toHaveLength(1);
    expect(parsed.failed_teams[0]).toMatchObject({ team_id: 't2', team_name: 'down' });
  });

  it('preserves active_members via passthrough (web-only field)', () => {
    // active_members is not declared in the web schema — the shared MCP/CLI
    // contract doesn't carry presence payloads. Passthrough keeps the field
    // available at runtime for consumers like useOverviewData.
    const parsed = dashboardSummarySchema.parse({
      teams: [
        {
          ...validSummary(),
          active_members: [
            {
              agent_id: 'a1',
              handle: 'someone',
              host_tool: 'claude-code',
              files: ['src/app.ts'],
            },
          ],
        },
      ],
    });
    const team = parsed.teams[0] as Record<string, unknown>;
    expect(team.active_members).toBeDefined();
    expect(Array.isArray(team.active_members)).toBe(true);
    expect(team.active_members as unknown[]).toHaveLength(1);
  });
});

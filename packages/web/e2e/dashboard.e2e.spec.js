import { test, expect } from '@playwright/test';

const API_HOST = 'https://api.chinmeister.com';

function createDashboardState() {
  return {
    user: {
      handle: 'alice',
      color: 'cyan',
      created_at: '2026-01-01T00:00:00Z',
    },
    teams: [
      { team_id: 't_alpha', team_name: 'Alpha Team' },
      { team_id: 't_beta', team_name: 'Beta Team' },
    ],
    contexts: {
      t_alpha: {
        members: [
          {
            agent_id: 'cursor:alpha:1',
            handle: 'alice',
            host_tool: 'cursor',
            status: 'active',
            activity: { files: ['src/alpha.js'], summary: 'Reviewing alpha flow' },
          },
        ],
        memories: [
          {
            id: 'mem_alpha',
            text: 'Alpha project memory',
            tags: ['alpha'],
            handle: 'alice',
            host_tool: 'cursor',
            agent_model: 'claude-opus',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        locks: [],
        messages: [],
        sessions: [],
        conflicts: [],
        hosts_configured: [{ host_tool: 'cursor', joins: 3 }],
        surfaces_seen: [],
        models_seen: [],
        usage: {},
      },
      t_beta: {
        members: [
          {
            agent_id: 'claude-code:beta:1',
            handle: 'bob',
            host_tool: 'claude-code',
            status: 'active',
            activity: { files: ['src/beta.js'], summary: 'Fixing beta flow' },
          },
        ],
        memories: [
          {
            id: 'mem_beta',
            text: 'Beta project memory',
            tags: ['beta'],
            handle: 'bob',
            host_tool: 'claude-code',
            agent_model: 'claude-opus',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        locks: [],
        messages: [],
        sessions: [],
        conflicts: [],
        hosts_configured: [{ host_tool: 'claude-code', joins: 2 }],
        surfaces_seen: [],
        models_seen: [],
        usage: {},
      },
    },
  };
}

function buildDashboardSummary(state) {
  return {
    teams: state.teams.map((team) => {
      const context = state.contexts[team.team_id];
      return {
        team_id: team.team_id,
        team_name: team.team_name,
        active_agents: context.members.filter((member) => member.status === 'active').length,
        memory_count: context.memories.length,
        conflict_count: context.conflicts.length,
        total_members: context.members.length,
        live_sessions: context.sessions.filter((session) => !session.ended_at).length,
        recent_sessions_24h: context.sessions.length,
        hosts_configured: context.hosts_configured,
        surfaces_seen: context.surfaces_seen,
        models_seen: context.models_seen,
        usage: context.usage,
      };
    }),
    degraded: false,
    failed_teams: [],
    truncated: false,
  };
}

async function attachApiMocks(page, state) {
  await page.route(`${API_HOST}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (method === 'GET' && path === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.user),
      });
      return;
    }

    if (method === 'GET' && path === '/me/teams') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ teams: state.teams }),
      });
      return;
    }

    if (method === 'GET' && path === '/me/dashboard') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildDashboardSummary(state)),
      });
      return;
    }

    // Analytics endpoints all funnel through validateResponse with a
    // demo-seed fallback, so an empty body is enough to keep the page
    // render path moving without committing the e2e mock to full
    // analytics fixtures.
    if (method === 'GET' && path === '/me/analytics') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }

    if (method === 'GET' && /^\/teams\/[^/]+\/analytics$/.test(path)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }

    if (method === 'GET' && /^\/teams\/[^/]+\/conversations\/analytics$/.test(path)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }

    if (method === 'POST' && path === '/auth/ws-ticket') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ticket: 'ws-ticket-test', expires_at: '2026-01-01T01:00:00Z' }),
      });
      return;
    }

    const joinMatch = path.match(/^\/teams\/([^/]+)\/join$/);
    if (joinMatch && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    const contextMatch = path.match(/^\/teams\/([^/]+)\/context$/);
    if (contextMatch && method === 'GET') {
      const [, teamId] = contextMatch;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.contexts[teamId]),
      });
      return;
    }

    const memoryMatch = path.match(/^\/teams\/([^/]+)\/memory$/);
    if (memoryMatch && method === 'PUT') {
      const [, teamId] = memoryMatch;
      const body = request.postDataJSON();
      const context = state.contexts[teamId];
      const memory = context.memories.find((entry) => entry.id === body.id);
      if (memory) {
        if (body.text !== undefined) memory.text = body.text;
        if (body.tags !== undefined) memory.tags = body.tags;
        memory.updated_at = '2026-01-01T00:05:00Z';
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (memoryMatch && method === 'DELETE') {
      const [, teamId] = memoryMatch;
      const body = request.postDataJSON();
      const context = state.contexts[teamId];
      context.memories = context.memories.filter((entry) => entry.id !== body.id);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    throw new Error(`Unhandled API route in Playwright mock: ${method} ${path}`);
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class MockWebSocket {
      constructor(url) {
        this.url = url;
        window.__chinmeisterMockWs = this;
        setTimeout(() => this.onopen?.(), 0);
      }

      send() {}

      close() {
        this.onclose?.();
      }
    }

    window.WebSocket = MockWebSocket;
  });
});

test('switches between overview projects through the sidebar', async ({ page }) => {
  const state = createDashboardState();
  await attachApiMocks(page, state);

  await page.goto('/dashboard.html#token=tok_switch');

  await expect(page.locator('aside').getByRole('button', { name: 'Alpha Team' })).toBeVisible();
  await expect(page.locator('aside').getByRole('button', { name: 'Beta Team' })).toBeVisible();

  await page.locator('aside').getByRole('button', { name: 'Alpha Team' }).click();
  await expect(page.getByRole('heading', { name: 'Alpha Team' })).toBeVisible();

  await page.locator('aside').getByRole('button', { name: 'Beta Team' }).click();
  await expect(page.getByRole('heading', { name: 'Beta Team' })).toBeVisible();
});

// MemoryRow's delete affordance moved behind a row-expand + two-step
// confirm-then-commit interaction, and the inline Edit/Save flow this test
// originally covered was removed. The remaining behaviors are exercised by
// dedicated unit tests:
//   - delete confirm/commit + onBlur cancel:
//     packages/web/src/components/MemoryRow/MemoryRow.test.jsx
//   - WebSocket-driven memory delta: covered by the websocket store tests
//     in packages/web/src/lib/stores/__tests__/websocket.test.ts
// Left as test.skip so the file stays a touch-point if/when the inline
// editor returns and a true end-to-end run is worth re-establishing.
test.skip('deletes memory, then applies a live memory delta', async ({ page: _page }) => {});

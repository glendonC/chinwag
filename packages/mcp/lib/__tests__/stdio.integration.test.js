import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_ENTRY = fileURLToPath(new URL('../../index.js', import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

async function startFakeApiServer() {
  const state = {
    user: {
      handle: 'alice',
      color: 'cyan',
      created_at: '2026-01-01T00:00:00Z',
    },
    hostTool: 'unknown',
    profile: null,
    joined: false,
    sessionId: null,
    activity: { files: [], summary: '' },
    memories: [],
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const method = request.method || 'GET';
    const body = method === 'GET' ? {} : await readJson(request);
    const agentId = request.headers['x-agent-id'] || 'unknown-agent';
    const hostTool = request.headers['x-agent-host-tool'] || 'unknown';
    state.hostTool = String(hostTool || 'unknown');

    if (method === 'GET' && url.pathname === '/me') {
      return json(response, 200, state.user);
    }

    if (method === 'PUT' && url.pathname === '/agent/profile') {
      state.profile = body;
      return json(response, 200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/auth/ws-ticket') {
      return json(response, 200, { ticket: 'test-ticket' });
    }

    if (method === 'POST' && url.pathname === '/teams/t_abcdef0123456789/join') {
      state.joined = true;
      return json(response, 200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/teams/t_abcdef0123456789/heartbeat') {
      return json(response, 200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/teams/t_abcdef0123456789/sessions') {
      state.sessionId = 'sess_stdio_1';
      return json(response, 201, { ok: true, session_id: state.sessionId });
    }

    if (method === 'POST' && url.pathname === '/teams/t_abcdef0123456789/sessionend') {
      return json(response, 200, { ok: true });
    }

    if (method === 'PUT' && url.pathname === '/teams/t_abcdef0123456789/activity') {
      state.activity = {
        files: body.files || [],
        summary: body.summary || '',
      };
      return json(response, 200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/teams/t_abcdef0123456789/conflicts') {
      const requestedFiles = body.files || [];
      const hasOverlap = requestedFiles.includes('src/auth.js');
      return json(response, 200, {
        conflicts: hasOverlap
          ? [
              {
                owner_handle: 'sarah',
                tool: 'cursor',
                files: ['src/auth.js'],
                summary: 'Parallel auth refactor',
              },
            ]
          : [],
        locked: [],
      });
    }

    if (method === 'POST' && url.pathname === '/teams/t_abcdef0123456789/memory') {
      const now = new Date().toISOString();
      const id = `11111111-1111-4111-8111-${String(state.memories.length + 1).padStart(12, '0')}`;
      state.memories.unshift({
        id,
        text: body.text,
        tags: body.tags || [],
        handle: state.user.handle,
        host_tool: state.hostTool,
        created_at: now,
        updated_at: now,
      });
      return json(response, 200, { ok: true, id });
    }

    if (method === 'GET' && url.pathname === '/teams/t_abcdef0123456789/memory') {
      const query = url.searchParams.get('q');
      const memories = query
        ? state.memories.filter((memory) => memory.text.toLowerCase().includes(query.toLowerCase()))
        : state.memories;
      return json(response, 200, { memories });
    }

    if (method === 'PUT' && url.pathname === '/teams/t_abcdef0123456789/memory') {
      const memory = state.memories.find((entry) => entry.id === body.id);
      if (!memory) return json(response, 404, { error: 'Memory not found' });
      if (body.text !== undefined) memory.text = body.text;
      if (body.tags !== undefined) memory.tags = body.tags;
      memory.updated_at = new Date().toISOString();
      return json(response, 200, { ok: true });
    }

    if (method === 'DELETE' && url.pathname === '/teams/t_abcdef0123456789/memory') {
      const index = state.memories.findIndex((entry) => entry.id === body.id);
      if (index === -1) return json(response, 404, { error: 'Memory not found' });
      state.memories.splice(index, 1);
      return json(response, 200, { ok: true });
    }

    if (method === 'GET' && url.pathname === '/teams/t_abcdef0123456789/context') {
      return json(response, 200, {
        members: [
          {
            agent_id: String(agentId),
            handle: state.user.handle,
            host_tool: state.hostTool,
            status: 'active',
            activity:
              state.activity.files.length > 0
                ? { files: state.activity.files, summary: state.activity.summary }
                : null,
          },
          {
            agent_id: 'cursor:peer:0001',
            handle: 'sarah',
            host_tool: 'cursor',
            status: 'active',
            activity: { files: ['src/auth.js'], summary: 'Parallel auth refactor' },
          },
        ],
        memories: state.memories,
        locks: [],
        messages: [],
        sessions: [],
        conflicts: [],
        hosts_configured: [
          { host_tool: state.hostTool, joins: 1 },
          { host_tool: 'cursor', joins: 1 },
        ],
        surfaces_seen: [],
        models_seen: [],
        usage: { joins: 1, conflict_checks: 1, memories_saved: state.memories.length },
      });
    }

    return json(response, 404, { error: `Unhandled route: ${method} ${url.pathname}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('Failed to bind fake API server');

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function textFromResult(result) {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

describe('mcp stdio integration', () => {
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('joins a team, reports activity, detects conflicts, and round-trips memory', async () => {
    const fakeApi = await startFakeApiServer();
    const homeDir = mkdtempSync(join(tmpdir(), 'chinmeister-mcp-home-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'chinmeister-mcp-repo-'));
    tempDirs.push(homeDir, repoDir);

    const configDir = join(homeDir, '.chinmeister', 'local');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ token: 'tok_stdio', handle: 'alice', color: 'cyan' }, null, 2) + '\n',
    );

    const client = new Client({ name: 'chinmeister-stdio-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: 'node',
      args: [MCP_ENTRY],
      cwd: repoDir,
      env: {
        HOME: homeDir,
        PATH: process.env.PATH,
        CHINMEISTER_PROFILE: 'local',
        CHINMEISTER_API_URL: fakeApi.baseUrl,
      },
      stderr: 'pipe',
    });

    try {
      await client.connect(transport);

      const joinResult = await client.callTool({
        name: 'chinmeister_join_team',
        arguments: { team_id: 't_abcdef0123456789' },
      });
      expect(textFromResult(joinResult)).toContain('Joined team t_abcdef0123456789');
      expect(fakeApi.state.joined).toBe(true);

      const activityResult = await client.callTool({
        name: 'chinmeister_update_activity',
        arguments: {
          files: ['src/auth.js'],
          summary: 'Implementing auth flow',
        },
      });
      expect(textFromResult(activityResult)).toContain('Activity updated');

      const conflictResult = await client.callTool({
        name: 'chinmeister_check_conflicts',
        arguments: {
          files: ['src/auth.js'],
        },
      });
      expect(textFromResult(conflictResult)).toMatch(
        /sarah \(cursor\) is working on src\/auth\.js/,
      );

      const saveResult = await client.callTool({
        name: 'chinmeister_save_memory',
        arguments: {
          text: 'Auth work depends on src/auth.js conventions',
          tags: ['auth', 'decision'],
        },
      });
      expect(textFromResult(saveResult)).toContain('Memory saved [auth, decision]');

      const savedId = fakeApi.state.memories[0]?.id;
      expect(savedId).toBeTruthy();

      const searchResult = await client.callTool({
        name: 'chinmeister_search_memory',
        arguments: {
          query: 'Auth work depends',
        },
      });
      expect(textFromResult(searchResult)).toContain(savedId);
      expect(textFromResult(searchResult)).toContain('alice');

      const updateResult = await client.callTool({
        name: 'chinmeister_update_memory',
        arguments: {
          id: savedId,
          text: 'Auth work follows the shared auth.js conventions',
          tags: ['auth', 'updated'],
        },
      });
      expect(textFromResult(updateResult)).toContain(`Memory ${savedId} updated`);

      const searchUpdatedResult = await client.callTool({
        name: 'chinmeister_search_memory',
        arguments: {
          query: 'shared auth.js',
        },
      });
      expect(textFromResult(searchUpdatedResult)).toContain('shared auth.js conventions');

      const deleteResult = await client.callTool({
        name: 'chinmeister_delete_memory',
        arguments: { id: savedId },
      });
      expect(textFromResult(deleteResult)).toContain(`Memory ${savedId} deleted`);

      const emptySearchResult = await client.callTool({
        name: 'chinmeister_search_memory',
        arguments: {
          query: 'shared auth.js',
        },
      });
      expect(textFromResult(emptySearchResult)).toContain('No memories found.');
    } finally {
      await client.close().catch(() => {});
      await fakeApi.close();
    }
  });
});

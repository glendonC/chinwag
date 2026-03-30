// Worker entry point — HTTP routing, auth, and request handling.
// Uses DO RPC for all Durable Object communication.
// Auth flow: Bearer token → KV lookup → user_id → DO.getUser(id)

import { json } from './lib/http.js';
import { parseTeamPath, getToolFromAgentId, sanitizeTags, teamErrorStatus } from './lib/request-utils.js';
import { handleInit, handleStats, handleToolCatalog } from './routes/public.js';
import {
  authenticate,
  handleChatUpgrade,
  handleClearStatus,
  handleCreateTeam,
  handleDashboardSummary,
  handleGetUserTeams,
  handleHeartbeat,
  handleSetStatus,
  handleUpdateAgentProfile,
  handleUpdateColor,
  handleUpdateHandle,
} from './routes/user.js';
import {
  handleTeamActivity,
  handleTeamClaimFiles,
  handleTeamConflicts,
  handleTeamContext,
  handleTeamDeleteMemory,
  handleTeamEndSession,
  handleTeamFile,
  handleTeamGetLocks,
  handleTeamGetMessages,
  handleTeamHeartbeat,
  handleTeamHistory,
  handleTeamJoin,
  handleTeamLeave,
  handleTeamReleaseFiles,
  handleTeamSaveMemory,
  handleTeamSearchMemory,
  handleTeamSendMessage,
  handleTeamStartSession,
  handleTeamSessionEdit,
  handleTeamUpdateMemory,
} from './routes/team.js';

export { DatabaseDO } from './db.js';
export { LobbyDO } from './lobby.js';
export { RoomDO } from './room.js';
export { TeamDO } from './dos/team/index.js';
export { parseTeamPath, getAgentRuntime, getToolFromAgentId, sanitizeTags, teamErrorStatus } from './lib/request-utils.js';

const PROD_ORIGINS = new Set(['https://chinwag.dev', 'https://www.chinwag.dev']);
const DEV_ORIGINS = new Set(['http://localhost:8788', 'http://localhost:3000', 'http://127.0.0.1:8788']);

function isLoopbackOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
    return isLoopbackHost && (protocol === 'http:' || protocol === 'https:');
  } catch {
    return false;
  }
}

function getAllowedOrigin(origin, environment) {
  if (!origin) return 'https://chinwag.dev';
  if (PROD_ORIGINS.has(origin)) return origin;
  if (environment !== 'production' && DEV_ORIGINS.has(origin)) return origin;
  if (isLoopbackOrigin(origin)) return origin;
  return '';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': getAllowedOrigin(origin, env.ENVIRONMENT),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Id, X-Agent-Host-Tool, X-Agent-Surface, X-Agent-Transport, X-Agent-Tier',
      'Vary': 'Origin',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let response;

      if (method === 'POST' && path === '/auth/init') {
        response = await handleInit(request, env);
      } else if (method === 'GET' && path === '/stats') {
        response = await handleStats(env);
      } else if (method === 'GET' && path === '/tools/catalog') {
        response = handleToolCatalog();
      } else {
        const user = await authenticate(request, env);
        if (!user) {
          return json({ error: 'Unauthorized' }, 401, corsHeaders);
        }

        if (method === 'GET' && path === '/me') {
          const { id, ...profile } = user;
          response = json(profile);
        } else if (method === 'GET' && path === '/me/teams') {
          response = await handleGetUserTeams(user, env);
        } else if (method === 'GET' && path === '/me/dashboard') {
          response = await handleDashboardSummary(user, env);
        } else if (method === 'POST' && path === '/presence/heartbeat') {
          response = await handleHeartbeat(user, env);
        } else if (method === 'PUT' && path === '/me/handle') {
          response = await handleUpdateHandle(request, user, env);
        } else if (method === 'PUT' && path === '/me/color') {
          response = await handleUpdateColor(request, user, env);
        } else if (method === 'PUT' && path === '/status') {
          response = await handleSetStatus(request, user, env);
        } else if (method === 'DELETE' && path === '/status') {
          response = await handleClearStatus(user, env);
        } else if (method === 'GET' && path === '/ws/chat') {
          return handleChatUpgrade(request, user, env);
        } else if (method === 'PUT' && path === '/agent/profile') {
          response = await handleUpdateAgentProfile(request, user, env);
        } else if (method === 'POST' && path === '/teams') {
          response = await handleCreateTeam(request, user, env);
        } else if (path.startsWith('/teams/')) {
          const parsed = parseTeamPath(path);
          if (!parsed) {
            response = json({ error: 'Not found' }, 404);
          } else if (method === 'POST' && parsed.action === 'join') {
            response = await handleTeamJoin(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'leave') {
            response = await handleTeamLeave(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'context') {
            response = await handleTeamContext(request, user, env, parsed.teamId);
          } else if (method === 'PUT' && parsed.action === 'activity') {
            response = await handleTeamActivity(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'conflicts') {
            response = await handleTeamConflicts(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'heartbeat') {
            response = await handleTeamHeartbeat(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'file') {
            response = await handleTeamFile(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'memory') {
            response = await handleTeamSaveMemory(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'memory') {
            response = await handleTeamSearchMemory(request, user, env, parsed.teamId);
          } else if (method === 'PUT' && parsed.action === 'memory') {
            response = await handleTeamUpdateMemory(request, user, env, parsed.teamId);
          } else if (method === 'DELETE' && parsed.action === 'memory') {
            response = await handleTeamDeleteMemory(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'locks') {
            response = await handleTeamClaimFiles(request, user, env, parsed.teamId);
          } else if (method === 'DELETE' && parsed.action === 'locks') {
            response = await handleTeamReleaseFiles(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'locks') {
            response = await handleTeamGetLocks(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'messages') {
            response = await handleTeamSendMessage(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'messages') {
            response = await handleTeamGetMessages(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'sessions') {
            response = await handleTeamStartSession(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'sessionend') {
            response = await handleTeamEndSession(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'sessionedit') {
            response = await handleTeamSessionEdit(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'history') {
            response = await handleTeamHistory(request, user, env, parsed.teamId);
          } else {
            response = json({ error: 'Not found' }, 404);
          }
        } else {
          response = json({ error: 'Not found' }, 404);
        }
      }

      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`Request error (ref: ${ref}):`, err);
      return json({ error: `Internal server error (ref: ${ref})` }, 500, corsHeaders);
    }
  },
};

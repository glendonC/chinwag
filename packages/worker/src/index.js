// Worker entry point — HTTP routing, auth, and request handling.
// Uses DO RPC for all Durable Object communication.
// Auth flow: Bearer token → KV lookup → user_id → DO.getUser(id)

import { json } from './lib/http.js';
import { buildRoutes, matchRoute } from './lib/router.js';
import { createLogger, setLogLevel } from './lib/logger.js';
import {
  handleInit,
  handleStats,
  handleToolCatalog,
  handleGithubAuth,
  handleGithubCallback,
  handleGithubLink,
  handleGithubLinkCallback,
} from './routes/public.js';
import {
  authenticate,
  handleChatUpgrade,
  handleClearStatus,
  handleCreateTeam,
  handleDashboardSummary,
  handleGetUserTeams,
  handleHeartbeat,
  handleRefreshToken,
  handleSetStatus,
  handleUpdateAgentProfile,
  handleUpdateColor,
  handleUnlinkGithub,
  handleGetWsTicket,
  handleUpdateHandle,
} from './routes/user.js';
import {
  handleListDirectory,
  handleGetDirectoryEntry,
  handleTriggerEvaluation,
  handleBatchEvaluate,
  handleAdminDelete,
} from './routes/directory.js';
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
  handleTeamEnrichModel,
  handleTeamWebSocket,
} from './routes/team.js';

export { DatabaseDO } from './dos/database/index.js';
export { LobbyDO } from './lobby.js';
export { RoomDO } from './room.js';
export { TeamDO } from './dos/team/index.js';
export {
  parseTeamPath,
  getAgentRuntime,
  getToolFromAgentId,
  sanitizeTags,
  teamErrorStatus,
} from './lib/request-utils.js';

// --- CORS ---

const PROD_ORIGINS = new Set(['https://chinwag.dev', 'https://www.chinwag.dev']);
const DEV_ORIGINS = new Set([
  'http://localhost:8788',
  'http://localhost:3000',
  'http://127.0.0.1:8788',
]);

function isLoopbackOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    const isLoopbackHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1';
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

/**
 * Validate Origin header for WebSocket upgrades.
 * Browsers always send Origin on WS handshakes. Non-browser clients
 * (MCP servers, CLI) may omit it — that's fine, they're not subject
 * to same-origin policy. We reject only when Origin IS present but
 * does not match our allowlist, which blocks cross-site WS hijacking.
 */
function isWebSocketOriginAllowed(origin, environment) {
  if (!origin) return true; // non-browser client — no Origin header
  return getAllowedOrigin(origin, environment) !== '';
}

// --- Route table ---
// auth: false → public, auth: true (default) → requires authenticated user.
// Handlers receive (request, env, user?, ...params) — user is null for public routes.
// Parametric :params are captured and appended as trailing handler arguments.
// Constrained params use :name(regex) syntax, e.g. :tid(t_[a-f0-9]{16}).
//
// To add a new endpoint, add ONE line here.

// Team ID format used in parseTeamPath — constrained to prevent invalid IDs
// from reaching handlers (they get a 404 instead).
const TID = ':tid(t_[a-f0-9]{16})';

const routes = buildRoutes([
  // Public
  { method: 'POST', path: '/auth/init', handler: (req, env) => handleInit(req, env), auth: false },
  {
    method: 'POST',
    path: '/auth/refresh',
    handler: (req, env) => handleRefreshToken(req, env),
    auth: false,
  },
  { method: 'GET', path: '/stats', handler: (req, env) => handleStats(req, env), auth: false },
  {
    method: 'GET',
    path: '/tools/catalog',
    handler: (req, env) => handleToolCatalog(req, env),
    auth: false,
  },
  {
    method: 'GET',
    path: '/tools/directory',
    handler: (req, env) => handleListDirectory(req, env),
    auth: false,
  },
  {
    method: 'POST',
    path: '/tools/batch-evaluate',
    handler: (req, env) => handleBatchEvaluate(req, env),
    auth: false,
  },
  {
    method: 'POST',
    path: '/tools/admin-delete',
    handler: (req, env) => handleAdminDelete(req, env),
    auth: false,
  },
  {
    method: 'GET',
    path: '/tools/directory/:id',
    handler: (req, env, _u, id) => handleGetDirectoryEntry(req, env, id),
    auth: false,
  },
  {
    method: 'GET',
    path: '/auth/github',
    handler: (req, env) => handleGithubAuth(req, env),
    auth: false,
  },
  {
    method: 'GET',
    path: '/auth/github/callback',
    handler: (req, env) => handleGithubCallback(req, env),
    auth: false,
  },
  {
    method: 'GET',
    path: '/auth/github/callback/link',
    handler: (req, env) => handleGithubLinkCallback(req, env),
    auth: false,
  },

  // Authenticated — user routes
  {
    method: 'GET',
    path: '/me',
    handler: (_req, _env, user) => {
      const { id, ...profile } = user;
      return json(profile);
    },
  },
  { method: 'GET', path: '/me/teams', handler: (_req, env, user) => handleGetUserTeams(user, env) },
  {
    method: 'GET',
    path: '/me/dashboard',
    handler: (_req, env, user) => handleDashboardSummary(user, env),
  },
  {
    method: 'PUT',
    path: '/me/handle',
    handler: (req, env, user) => handleUpdateHandle(req, user, env),
  },
  {
    method: 'PUT',
    path: '/me/color',
    handler: (req, env, user) => handleUpdateColor(req, user, env),
  },
  {
    method: 'PUT',
    path: '/me/github',
    handler: (_req, env, user) => handleUnlinkGithub(user, env),
  },
  { method: 'PUT', path: '/status', handler: (req, env, user) => handleSetStatus(req, user, env) },
  { method: 'DELETE', path: '/status', handler: (_req, env, user) => handleClearStatus(user, env) },
  {
    method: 'POST',
    path: '/presence/heartbeat',
    handler: (_req, env, user) => handleHeartbeat(user, env),
  },
  {
    method: 'PUT',
    path: '/agent/profile',
    handler: (req, env, user) => handleUpdateAgentProfile(req, user, env),
  },
  {
    method: 'POST',
    path: '/tools/evaluate',
    handler: (req, env, user) => handleTriggerEvaluation(req, user, env),
  },
  {
    method: 'POST',
    path: '/auth/ws-ticket',
    handler: (_req, env, user) => handleGetWsTicket(user, env),
  },
  {
    method: 'POST',
    path: '/auth/github/link',
    handler: (req, env, user) => handleGithubLink(req, user, env),
  },
  { method: 'POST', path: '/teams', handler: (req, env, user) => handleCreateTeam(req, user, env) },

  // Authenticated — WebSocket upgrades (return directly, skip CORS headers)
  {
    method: 'GET',
    path: '/ws/chat',
    handler: (req, env, user) => handleChatUpgrade(req, user, env),
  },
  {
    method: 'GET',
    path: `/teams/${TID}/ws`,
    handler: (req, env, user, tid) => handleTeamWebSocket(req, user, env, tid),
  },

  // Authenticated — team routes
  {
    method: 'POST',
    path: `/teams/${TID}/join`,
    handler: (req, env, user, tid) => handleTeamJoin(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/leave`,
    handler: (req, env, user, tid) => handleTeamLeave(req, user, env, tid),
  },
  {
    method: 'GET',
    path: `/teams/${TID}/context`,
    handler: (req, env, user, tid) => handleTeamContext(req, user, env, tid),
  },
  {
    method: 'PUT',
    path: `/teams/${TID}/activity`,
    handler: (req, env, user, tid) => handleTeamActivity(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/conflicts`,
    handler: (req, env, user, tid) => handleTeamConflicts(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/heartbeat`,
    handler: (req, env, user, tid) => handleTeamHeartbeat(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/file`,
    handler: (req, env, user, tid) => handleTeamFile(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/memory`,
    handler: (req, env, user, tid) => handleTeamSaveMemory(req, user, env, tid),
  },
  {
    method: 'GET',
    path: `/teams/${TID}/memory`,
    handler: (req, env, user, tid) => handleTeamSearchMemory(req, user, env, tid),
  },
  {
    method: 'PUT',
    path: `/teams/${TID}/memory`,
    handler: (req, env, user, tid) => handleTeamUpdateMemory(req, user, env, tid),
  },
  {
    method: 'DELETE',
    path: `/teams/${TID}/memory`,
    handler: (req, env, user, tid) => handleTeamDeleteMemory(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/locks`,
    handler: (req, env, user, tid) => handleTeamClaimFiles(req, user, env, tid),
  },
  {
    method: 'DELETE',
    path: `/teams/${TID}/locks`,
    handler: (req, env, user, tid) => handleTeamReleaseFiles(req, user, env, tid),
  },
  {
    method: 'GET',
    path: `/teams/${TID}/locks`,
    handler: (req, env, user, tid) => handleTeamGetLocks(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/messages`,
    handler: (req, env, user, tid) => handleTeamSendMessage(req, user, env, tid),
  },
  {
    method: 'GET',
    path: `/teams/${TID}/messages`,
    handler: (req, env, user, tid) => handleTeamGetMessages(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/sessions`,
    handler: (req, env, user, tid) => handleTeamStartSession(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/sessionend`,
    handler: (req, env, user, tid) => handleTeamEndSession(req, user, env, tid),
  },
  {
    method: 'PUT',
    path: `/teams/${TID}/sessionmodel`,
    handler: (req, env, user, tid) => handleTeamEnrichModel(req, user, env, tid),
  },
  {
    method: 'POST',
    path: `/teams/${TID}/sessionedit`,
    handler: (req, env, user, tid) => handleTeamSessionEdit(req, user, env, tid),
  },
  {
    method: 'GET',
    path: `/teams/${TID}/history`,
    handler: (req, env, user, tid) => handleTeamHistory(req, user, env, tid),
  },
]);

// WebSocket upgrade paths skip CORS header injection (the Response is a
// WebSocket handshake, not a regular HTTP response).
const WS_PATHS = new Set(['/ws/chat']);
const WS_PATTERN = /^\/teams\/[^/]+\/ws$/;

function isWebSocketRoute(path) {
  return WS_PATHS.has(path) || WS_PATTERN.test(path);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;
    const ref = crypto.randomUUID().slice(0, 8);

    // Configure log level from environment
    setLogLevel(env.LOG_LEVEL);
    const log = createLogger('router');

    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': getAllowedOrigin(origin, env.ENVIRONMENT),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Agent-Id, X-Agent-Host-Tool, X-Agent-Surface, X-Agent-Transport, X-Agent-Tier',
      Vary: 'Origin',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const matched = matchRoute(routes, method, path);
      if (!matched) {
        return json({ error: 'Not found' }, 404, corsHeaders);
      }

      const { route, params } = matched;

      // Authenticate if required
      let user = null;
      if (route.auth) {
        user = await authenticate(request, env);
        if (!user) {
          return json({ error: 'Unauthorized' }, 401, corsHeaders);
        }
      }

      // Validate Origin for WebSocket upgrades — reject cross-site hijacking
      if (isWebSocketRoute(path)) {
        if (!isWebSocketOriginAllowed(origin, env.ENVIRONMENT)) {
          return json({ error: 'Origin not allowed' }, 403, corsHeaders);
        }
      }

      const response = await route.handler(request, env, user, ...params);

      // WebSocket upgrades return the handshake directly (no CORS headers)
      if (isWebSocketRoute(path)) {
        return response;
      }

      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers });
    } catch (/** @type {any} */ err) {
      log.error('request failed', {
        ref,
        method,
        path,
        status: 500,
        error: err.message,
      });
      return json({ error: `Internal server error (ref: ${ref})` }, 500, corsHeaders);
    }
  },
};

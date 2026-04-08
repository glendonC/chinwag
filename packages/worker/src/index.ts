// Worker entry point — HTTP routing, auth, and request handling.
// Uses DO RPC for all Durable Object communication.
// Auth flow: Bearer token → KV lookup → user_id → DO.getUser(id)

import type { Env, User } from './types.js';
import type { RouteDefinition } from './lib/router.js';
import { json } from './lib/http.js';
import { buildRoutes, matchRoute } from './lib/router.js';
import { createLogger, setLogLevel } from './lib/logger.js';
import { getErrorMessage } from './lib/errors.js';
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
} from './routes/user/index.js';
import {
  handleListDirectory,
  handleGetDirectoryEntry,
  handleTriggerEvaluation,
  handleBatchEvaluate,
  handleAdminImport,
  handleAdminDelete,
  handleDiscover,
  handleBatchEnrich,
  handleBatchFindVideos,
  handleBatchCredibility,
  handleGetCategories,
  handlePromoteCategory,
  handleGetIcon,
  handleBatchResolveIcons,
  handleBatchExtractColors,
} from './routes/directory.js';
import {
  handleTeamActivity,
  handleTeamClaimFiles,
  handleTeamConflicts,
  handleTeamContext,
  handleTeamDeleteMemory,
  handleTeamEndSession,
  handleTeamFile,
  handleTeamGetCommands,
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
  handleTeamSubmitCommand,
  handleTeamSessionEdit,
  handleTeamReportOutcome,
  handleTeamUpdateMemory,
  handleTeamEnrichModel,
  handleTeamAnalytics,
  handleTeamWebSocket,
} from './routes/team/index.js';

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

function isLoopbackOrigin(origin: string): boolean {
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

function getAllowedOrigin(origin: string, environment: string): string {
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
function isWebSocketOriginAllowed(origin: string, environment: string): boolean {
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

const routeDefinitions: RouteDefinition[] = [
  // Public
  { method: 'POST', path: '/auth/init', handler: handleInit, auth: false },
  { method: 'POST', path: '/auth/refresh', handler: handleRefreshToken, auth: false },
  { method: 'GET', path: '/stats', handler: handleStats, auth: false },
  { method: 'GET', path: '/tools/catalog', handler: handleToolCatalog, auth: false },
  { method: 'GET', path: '/tools/directory', handler: handleListDirectory, auth: false },
  { method: 'POST', path: '/tools/batch-evaluate', handler: handleBatchEvaluate, auth: false },
  { method: 'POST', path: '/tools/discover', handler: handleDiscover, auth: false },
  { method: 'POST', path: '/tools/batch-enrich', handler: handleBatchEnrich, auth: false },
  { method: 'POST', path: '/tools/batch-find-videos', handler: handleBatchFindVideos, auth: false },
  {
    method: 'POST',
    path: '/tools/batch-credibility',
    handler: handleBatchCredibility,
    auth: false,
  },
  { method: 'GET', path: '/tools/categories', handler: handleGetCategories, auth: false },
  { method: 'POST', path: '/tools/categories', handler: handlePromoteCategory, auth: false },
  { method: 'GET', path: '/tools/icon/:id', handler: handleGetIcon, auth: false },
  {
    method: 'POST',
    path: '/tools/batch-resolve-icons',
    handler: handleBatchResolveIcons,
    auth: false,
  },
  {
    method: 'POST',
    path: '/tools/batch-extract-colors',
    handler: handleBatchExtractColors,
    auth: false,
  },
  { method: 'POST', path: '/tools/admin-import', handler: handleAdminImport, auth: false },
  { method: 'POST', path: '/tools/admin-delete', handler: handleAdminDelete, auth: false },
  { method: 'GET', path: '/tools/directory/:id', handler: handleGetDirectoryEntry, auth: false },
  { method: 'GET', path: '/auth/github', handler: handleGithubAuth, auth: false },
  { method: 'GET', path: '/auth/github/callback', handler: handleGithubCallback, auth: false },
  {
    method: 'GET',
    path: '/auth/github/callback/link',
    handler: handleGithubLinkCallback,
    auth: false,
  },

  // Authenticated — user routes
  {
    method: 'GET',
    path: '/me',
    handler: (_req, _env, user) => {
      const { id: _id, ...profile } = user as User;
      return json(profile);
    },
  },
  { method: 'GET', path: '/me/teams', handler: handleGetUserTeams },
  { method: 'GET', path: '/me/dashboard', handler: handleDashboardSummary },
  { method: 'PUT', path: '/me/handle', handler: handleUpdateHandle },
  { method: 'PUT', path: '/me/color', handler: handleUpdateColor },
  { method: 'PUT', path: '/me/github', handler: handleUnlinkGithub },
  { method: 'PUT', path: '/status', handler: handleSetStatus },
  { method: 'DELETE', path: '/status', handler: handleClearStatus },
  { method: 'POST', path: '/presence/heartbeat', handler: handleHeartbeat },
  { method: 'PUT', path: '/agent/profile', handler: handleUpdateAgentProfile },
  { method: 'POST', path: '/tools/evaluate', handler: handleTriggerEvaluation },
  { method: 'POST', path: '/auth/ws-ticket', handler: handleGetWsTicket },
  { method: 'POST', path: '/auth/github/link', handler: handleGithubLink },
  { method: 'POST', path: '/teams', handler: handleCreateTeam },

  // Authenticated — WebSocket upgrades (return directly, skip CORS headers)
  { method: 'GET', path: '/ws/chat', handler: handleChatUpgrade },
  {
    method: 'GET',
    path: `/teams/${TID}/ws`,
    handler: handleTeamWebSocket,
  },

  // Authenticated — team routes
  { method: 'POST', path: `/teams/${TID}/join`, handler: handleTeamJoin },
  { method: 'POST', path: `/teams/${TID}/leave`, handler: handleTeamLeave },
  { method: 'GET', path: `/teams/${TID}/context`, handler: handleTeamContext },
  { method: 'PUT', path: `/teams/${TID}/activity`, handler: handleTeamActivity },
  { method: 'POST', path: `/teams/${TID}/conflicts`, handler: handleTeamConflicts },
  { method: 'POST', path: `/teams/${TID}/heartbeat`, handler: handleTeamHeartbeat },
  { method: 'POST', path: `/teams/${TID}/file`, handler: handleTeamFile },
  { method: 'POST', path: `/teams/${TID}/memory`, handler: handleTeamSaveMemory },
  { method: 'GET', path: `/teams/${TID}/memory`, handler: handleTeamSearchMemory },
  { method: 'PUT', path: `/teams/${TID}/memory`, handler: handleTeamUpdateMemory },
  { method: 'DELETE', path: `/teams/${TID}/memory`, handler: handleTeamDeleteMemory },
  { method: 'POST', path: `/teams/${TID}/locks`, handler: handleTeamClaimFiles },
  { method: 'DELETE', path: `/teams/${TID}/locks`, handler: handleTeamReleaseFiles },
  { method: 'GET', path: `/teams/${TID}/locks`, handler: handleTeamGetLocks },
  { method: 'POST', path: `/teams/${TID}/messages`, handler: handleTeamSendMessage },
  { method: 'GET', path: `/teams/${TID}/messages`, handler: handleTeamGetMessages },
  { method: 'POST', path: `/teams/${TID}/commands`, handler: handleTeamSubmitCommand },
  { method: 'GET', path: `/teams/${TID}/commands`, handler: handleTeamGetCommands },
  { method: 'POST', path: `/teams/${TID}/sessions`, handler: handleTeamStartSession },
  { method: 'POST', path: `/teams/${TID}/sessionend`, handler: handleTeamEndSession },
  { method: 'PUT', path: `/teams/${TID}/sessionmodel`, handler: handleTeamEnrichModel },
  { method: 'POST', path: `/teams/${TID}/sessionedit`, handler: handleTeamSessionEdit },
  { method: 'PUT', path: `/teams/${TID}/sessionoutcome`, handler: handleTeamReportOutcome },
  { method: 'GET', path: `/teams/${TID}/history`, handler: handleTeamHistory },
  { method: 'GET', path: `/teams/${TID}/analytics`, handler: handleTeamAnalytics },
];

const routes = buildRoutes(routeDefinitions);

// WebSocket upgrade paths skip CORS header injection (the Response is a
// WebSocket handshake, not a regular HTTP response).
const WS_PATHS = new Set(['/ws/chat']);
const WS_PATTERN = /^\/teams\/[^/]+\/ws$/;

function isWebSocketRoute(path: string): boolean {
  return WS_PATHS.has(path) || WS_PATTERN.test(path);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;
    const ref = crypto.randomUUID().slice(0, 8);

    // Configure log level from environment
    setLogLevel((env as Env & { LOG_LEVEL?: string }).LOG_LEVEL || '');
    const log = createLogger('router');

    const origin = request.headers.get('Origin') || '';
    const corsHeaders: Record<string, string> = {
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
      let user: User | null = null;
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
    } catch (err: unknown) {
      log.error('request failed', {
        ref,
        method,
        path,
        status: 500,
        error: getErrorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return json({ error: `Internal server error (ref: ${ref})` }, 500, corsHeaders);
    }
  },
} satisfies ExportedHandler<Env>;

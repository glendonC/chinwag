// Worker entry point — HTTP routing, auth, and request handling.
// Uses DO RPC for all Durable Object communication.
// Auth flow: Bearer token → KV lookup → user_id → DO.getUser(id)

import type { Env, User } from './types.js';
import type { RouteDefinition } from './lib/router.js';
import { json } from './lib/http.js';
import { buildRoutes, matchRoute } from './lib/router.js';
import { createLogger, setLogLevel } from './lib/logger.js';
import { getErrorMessage } from './lib/errors.js';
import { registerPublicRoutes } from './routes/public.js';
import { authenticate, registerUserRoutes } from './routes/user/index.js';
import { registerTeamRoutes } from './routes/team/index.js';
import { runPulseCheck } from './lib/pulse.js';
import { runRefreshModelPrices } from './lib/refresh-model-prices.js';

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

const PROD_ORIGINS = new Set(['https://chinmeister.com', 'https://www.chinmeister.com']);
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
  if (!origin) return 'https://chinmeister.com';
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
// To add a new endpoint, append it to the relevant register*Routes() factory
// in routes/* — never grow this composition list. The order below mirrors the
// legacy flat table: public → user → team. Each register function preserves
// its own internal registration order; cross-group reordering is safe only
// because no two team paths share a parametric regex that could collide.

// Team ID format used in parseTeamPath — constrained to prevent invalid IDs
// from reaching handlers (they get a 404 instead).
const TID = ':tid(t_[a-f0-9]{16})';

const routeDefinitions: RouteDefinition[] = [
  ...registerPublicRoutes(),
  ...registerUserRoutes(),
  ...registerTeamRoutes(TID),
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
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Dispatch on the exact cron expression from wrangler.toml. Every configured
    // cron must have an explicit case here; unknown expressions are logged and
    // no-op'd so adding a cron without wiring its handler fails visibly instead
    // of silently running the wrong job.
    switch (controller.cron) {
      case '0 3 * * 1':
        ctx.waitUntil(runPulseCheck(env));
        break;
      case '0 */6 * * *':
        ctx.waitUntil(runRefreshModelPrices(env));
        break;
      default:
        createLogger('scheduled').warn(`unhandled cron expression: ${controller.cron}`);
        break;
    }
  },

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

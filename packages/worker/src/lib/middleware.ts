// Typed middleware factories that eliminate route handler boilerplate.
//
// Each factory builds a RouteHandler (the type the router expects) from a
// simpler inner handler that receives a pre-built context object. The factory
// handles auth assertion, body parsing, team/agent extraction, and DO error
// mapping so route handlers can focus on domain logic.
//
// Usage:
//   import { authedJsonRoute, teamRoute, doResult } from '../lib/middleware.js';
//
//   const handler = authedJsonRoute(async ({ request, env, user, body }) => {
//     const text = requireString(body, 'text');
//     if (!text) return json({ error: 'text is required' }, 400);
//     const result = await doResult((db as any).saveItem(text), 'saveItem');
//     return result;
//   });

import type { Env, User, AgentRuntime } from '../types.js';
import type { RouteHandler } from './router.js';
import type { TeamDO } from '../dos/team/index.js';
import type { DatabaseDO } from '../dos/database/index.js';
import { json, parseBody } from './http.js';
import { requireJson } from './validation.js';
import { getDB, getTeam } from './env.js';
import { getAgentRuntime, teamErrorStatus } from './request-utils.js';
import { createLogger } from './logger.js';

const log = createLogger('middleware');

// ── Context types ──

export interface BaseContext {
  request: Request;
  env: Env;
  params: string[];
}

export interface AuthedContext extends BaseContext {
  user: User;
}

export interface AuthedBodyContext extends AuthedContext {
  body: Record<string, unknown>;
}

export interface TeamContext extends AuthedContext {
  teamId: string;
  team: DurableObjectStub<TeamDO>;
  db: DurableObjectStub<DatabaseDO>;
  agentId: string;
  runtime: AgentRuntime;
}

export interface TeamBodyContext extends TeamContext {
  body: Record<string, unknown>;
}

// ── Factory functions ──

/**
 * Wrap a handler for public (unauthenticated) routes.
 * Passes request, env, and captured route params.
 */
export function publicRoute(
  handler: (ctx: BaseContext) => Response | Promise<Response>,
): RouteHandler {
  return (request, env, _user, ...params) => handler({ request, env, params });
}

/**
 * Wrap a handler for authenticated routes (no body parsing).
 * The user is guaranteed to be non-null — the router rejects unauthenticated
 * requests before this handler runs.
 */
export function authedRoute(
  handler: (ctx: AuthedContext) => Response | Promise<Response>,
): RouteHandler {
  return (request, env, user, ...params) => handler({ request, env, user: user as User, params });
}

/**
 * Wrap a handler for authenticated routes that expect a JSON body.
 * Parses and validates the body; returns 400 on parse failure.
 */
export function authedJsonRoute(
  handler: (ctx: AuthedBodyContext) => Response | Promise<Response>,
): RouteHandler {
  return async (request, env, user, ...params) => {
    const parsed = await parseBody(request);
    const parseErr = requireJson(parsed);
    if (parseErr) return parseErr;
    return handler({
      request,
      env,
      user: user as User,
      body: parsed as Record<string, unknown>,
      params,
    });
  };
}

/**
 * Wrap a handler for authenticated team routes (no body parsing).
 * Extracts teamId from the first route param, builds team DO stub,
 * DB stub, and agent runtime.
 */
export function teamRoute(
  handler: (ctx: TeamContext) => Response | Promise<Response>,
): RouteHandler {
  return (request, env, user, ...params) => {
    const u = user as User;
    const teamId = params[0];
    const runtime = getAgentRuntime(request, u);
    return handler({
      request,
      env,
      user: u,
      params,
      teamId,
      team: getTeam(env, teamId) as DurableObjectStub<TeamDO>,
      db: getDB(env) as DurableObjectStub<DatabaseDO>,
      agentId: runtime.agentId,
      runtime,
    });
  };
}

/**
 * Wrap a handler for authenticated team routes that expect a JSON body.
 * Combines team context extraction with body parsing and validation.
 */
export function teamJsonRoute(
  handler: (ctx: TeamBodyContext) => Response | Promise<Response>,
): RouteHandler {
  return async (request, env, user, ...params) => {
    const parsed = await parseBody(request);
    const parseErr = requireJson(parsed);
    if (parseErr) return parseErr;
    const u = user as User;
    const teamId = params[0];
    const runtime = getAgentRuntime(request, u);
    return handler({
      request,
      env,
      user: u,
      body: parsed as Record<string, unknown>,
      params,
      teamId,
      team: getTeam(env, teamId) as DurableObjectStub<TeamDO>,
      db: getDB(env) as DurableObjectStub<DatabaseDO>,
      agentId: runtime.agentId,
      runtime,
    });
  };
}

// ── DO result mapper ──

/**
 * Call a DO method and map the result to an HTTP response.
 * On success, returns the result as JSON. On error (result contains `.error`),
 * maps the error code to the appropriate HTTP status using teamErrorStatus.
 *
 * @param promise - The DO method call (e.g. `(team as any).getContext(...)`)
 * @param label - A human-readable label for logging on error
 * @param successStatus - HTTP status for success responses (default 200)
 */
export async function doResult(
  promise: Promise<Record<string, unknown>>,
  label: string,
  successStatus = 200,
): Promise<Response> {
  const result = await promise;
  if (result.error) {
    log.warn(`${label} failed: ${result.error}`);
    return json(
      { error: result.error },
      teamErrorStatus(result as { error: string; code?: string }),
    );
  }
  return json(result, successStatus);
}

// Zero-dependency route dispatcher.
//
// Design choice: hand-rolled route map over itty-router/Hono/chanfana.
// The worker has zero runtime deps and the routing needs are simple —
// flat static paths plus two parametric patterns. A library would add
// bundle size and a learning curve for a problem solved in <30 lines.
// Adding a new endpoint is one line in the route table.
//
// Route definitions use the shape:
//   { method, path, handler, auth? }
//
// - auth: false  -> public (no authentication)
// - auth: true   -> requires authenticated user (default)
// - path can contain :params that become handler arguments
//   - bare :name matches any non-slash segment: ([^/]+)
//   - constrained :name(regex) matches the given pattern: (regex)
//     e.g. /teams/:id(t_[a-f0-9]{16})/context
// - Handlers receive (request, env, user?, ...params)

import type { Env, User } from '../types.js';

export type RouteHandler = (
  request: Request,
  env: Env,
  user: User | null,
  ...params: string[]
) => Response | Promise<Response>;

export interface RouteDefinition {
  method: string;
  path: string;
  handler: RouteHandler;
  auth?: boolean;
}

export interface RouteEntry {
  method: string;
  path: string;
  handler: RouteHandler;
  auth: boolean;
  regex?: RegExp;
}

export interface RouteTable {
  staticMap: Map<string, RouteEntry>;
  parametric: RouteEntry[];
}

export interface RouteMatch {
  route: RouteEntry;
  params: string[];
}

/**
 * Match a registered route against the incoming method + path.
 * Returns { route, params } or null.
 *
 * Static paths are checked first (O(1) map lookup), then parametric
 * patterns are tested in registration order.
 */
export function matchRoute(routes: RouteTable, method: string, path: string): RouteMatch | null {
  // 1. Try static lookup (most routes are static — fast path)
  const staticKey = `${method} ${path}`;
  const staticRoute = routes.staticMap.get(staticKey);
  if (staticRoute) return { route: staticRoute, params: [] };

  // 2. Try parametric patterns
  for (const entry of routes.parametric) {
    if (entry.method !== method) continue;
    const match = entry.regex?.exec(path);
    if (match) return { route: entry, params: match.slice(1) };
  }

  return null;
}

/**
 * Build a compiled route table from an array of route definitions.
 * Separates static routes (Map lookup) from parametric routes (regex).
 */
export function buildRoutes(definitions: RouteDefinition[]): RouteTable {
  const staticMap = new Map<string, RouteEntry>();
  const parametric: RouteEntry[] = [];

  for (const def of definitions) {
    const { method, path, handler, auth = true } = def;
    const entry: RouteEntry = { method, path, handler, auth };

    if (path.includes(':')) {
      // Convert :name -> ([^/]+), or :name(regex) -> (regex)
      const pattern = path.replace(/:([^/(]+)(?:\(([^)]+)\))?/g, (_m, _name, constraint) =>
        constraint ? `(${constraint})` : '([^/]+)',
      );
      entry.regex = new RegExp(`^${pattern}$`);
      parametric.push(entry);
    } else {
      staticMap.set(`${method} ${path}`, entry);
    }
  }

  return { staticMap, parametric };
}

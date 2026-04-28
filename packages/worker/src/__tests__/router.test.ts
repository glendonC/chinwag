import { describe, it, expect } from 'vitest';
import { buildRoutes, matchRoute } from '../lib/router.js';
import type { RouteHandler } from '../lib/router.js';

const noop = () => new Response();

type RouteDef = [method: string, path: string, auth?: boolean];

function makeRoutes(defs: RouteDef[]): ReturnType<typeof buildRoutes> {
  return buildRoutes(
    defs.map(([method, path, auth]) => ({
      method,
      path,
      handler: noop,
      auth: auth ?? true,
    })),
  );
}

describe('buildRoutes', () => {
  it('separates static and parametric routes', () => {
    const routes = makeRoutes([
      ['GET', '/stats'],
      ['GET', '/teams/:id/context'],
    ]);
    expect(routes.staticMap.size).toBe(1);
    expect(routes.parametric).toHaveLength(1);
  });

  it('defaults auth to true', () => {
    const routes = buildRoutes([{ method: 'GET', path: '/me', handler: noop }]);
    expect(routes.staticMap.get('GET /me')!.auth).toBe(true);
  });

  it('respects explicit auth: false', () => {
    const routes = buildRoutes([{ method: 'GET', path: '/stats', handler: noop, auth: false }]);
    expect(routes.staticMap.get('GET /stats')!.auth).toBe(false);
  });
});

describe('matchRoute - static routes', () => {
  const routes = makeRoutes([
    ['GET', '/stats', false],
    ['POST', '/auth/init', false],
    ['GET', '/me'],
    ['PUT', '/me/handle'],
    ['DELETE', '/status'],
  ]);

  it('matches exact static paths', () => {
    const match = matchRoute(routes, 'GET', '/stats');
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/stats');
    expect(match!.params).toEqual([]);
  });

  it('matches method + path combination', () => {
    expect(matchRoute(routes, 'POST', '/auth/init')).not.toBeNull();
    expect(matchRoute(routes, 'PUT', '/me/handle')).not.toBeNull();
    expect(matchRoute(routes, 'DELETE', '/status')).not.toBeNull();
  });

  it('returns null for wrong method on existing path', () => {
    expect(matchRoute(routes, 'POST', '/stats')).toBeNull();
    expect(matchRoute(routes, 'GET', '/auth/init')).toBeNull();
  });

  it('returns null for unknown paths', () => {
    expect(matchRoute(routes, 'GET', '/nonexistent')).toBeNull();
    expect(matchRoute(routes, 'GET', '/')).toBeNull();
    expect(matchRoute(routes, 'GET', '/me/unknown')).toBeNull();
  });

  it('preserves auth flag from definition', () => {
    const publicMatch = matchRoute(routes, 'GET', '/stats');
    expect(publicMatch!.route.auth).toBe(false);

    const authedMatch = matchRoute(routes, 'GET', '/me');
    expect(authedMatch!.route.auth).toBe(true);
  });
});

describe('matchRoute - parametric routes', () => {
  const routes = makeRoutes([
    ['GET', '/teams/:id/context'],
    ['POST', '/teams/:id/join'],
    ['GET', '/tools/directory/:id', false],
  ]);

  it('matches parametric paths and extracts params', () => {
    const match = matchRoute(routes, 'GET', '/teams/t_abc123def456789a/context');
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/teams/:id/context');
    expect(match!.params).toEqual(['t_abc123def456789a']);
  });

  it('matches different methods on same parametric pattern', () => {
    const join = matchRoute(routes, 'POST', '/teams/t_0000000000000000/join');
    expect(join).not.toBeNull();
    expect(join!.params).toEqual(['t_0000000000000000']);
  });

  it('matches single-segment param routes', () => {
    const match = matchRoute(routes, 'GET', '/tools/directory/some-tool-id');
    expect(match).not.toBeNull();
    expect(match!.params).toEqual(['some-tool-id']);
  });

  it('returns null for wrong method on parametric path', () => {
    expect(matchRoute(routes, 'DELETE', '/teams/t_abc123def456789a/context')).toBeNull();
  });

  it('does not match if path has extra segments', () => {
    expect(matchRoute(routes, 'GET', '/teams/t_abc123def456789a/context/extra')).toBeNull();
  });

  it('does not match if param contains slashes', () => {
    expect(matchRoute(routes, 'GET', '/tools/directory/a/b')).toBeNull();
  });

  it('does not match partial paths', () => {
    expect(matchRoute(routes, 'GET', '/teams/t_abc123def456789a')).toBeNull();
  });
});

describe('matchRoute - static routes take priority over parametric', () => {
  // Edge case: a static path that could also match a parametric pattern.
  // Static should win because it's checked first.
  const handler1 = (() => 'static') as unknown as RouteHandler;
  const handler2 = (() => 'param') as unknown as RouteHandler;

  const routes = buildRoutes([
    { method: 'GET', path: '/tools/catalog', handler: handler1 },
    { method: 'GET', path: '/tools/:id', handler: handler2 },
  ]);

  it('prefers static match over parametric', () => {
    const match = matchRoute(routes, 'GET', '/tools/catalog');
    expect(match!.route.handler).toBe(handler1);
  });

  it('falls through to parametric for non-static paths', () => {
    const match = matchRoute(routes, 'GET', '/tools/some-other');
    expect(match!.route.handler).toBe(handler2);
  });
});

describe('matchRoute - constrained params', () => {
  // Team ID must match t_[a-f0-9]{16} - rejects invalid IDs at the routing layer
  const routes = makeRoutes([
    ['GET', '/teams/:tid(t_[a-f0-9]{16})/context'],
    ['POST', '/teams/:tid(t_[a-f0-9]{16})/join'],
  ]);

  it('matches valid team ID format', () => {
    const match = matchRoute(routes, 'GET', '/teams/t_abcdef0123456789/context');
    expect(match).not.toBeNull();
    expect(match!.params).toEqual(['t_abcdef0123456789']);
  });

  it('rejects team IDs missing t_ prefix', () => {
    expect(matchRoute(routes, 'GET', '/teams/abcdef0123456789/context')).toBeNull();
  });

  it('rejects team IDs that are too short', () => {
    expect(matchRoute(routes, 'GET', '/teams/t_abc123/context')).toBeNull();
  });

  it('rejects team IDs that are too long', () => {
    expect(matchRoute(routes, 'GET', '/teams/t_abcdef01234567890/context')).toBeNull();
  });

  it('rejects team IDs with uppercase hex', () => {
    expect(matchRoute(routes, 'GET', '/teams/t_ABCDEF0123456789/context')).toBeNull();
  });

  it('rejects arbitrary strings as team IDs', () => {
    expect(matchRoute(routes, 'GET', '/teams/invalid/context')).toBeNull();
  });

  it('returns null for unknown actions on valid team IDs', () => {
    expect(matchRoute(routes, 'GET', '/teams/t_abcdef0123456789/unknown')).toBeNull();
  });
});

describe('matchRoute - 404 coverage', () => {
  const routes = makeRoutes([
    ['GET', '/me'],
    ['GET', '/teams/:id/ws'],
  ]);

  it('returns null for empty path', () => {
    expect(matchRoute(routes, 'GET', '')).toBeNull();
  });

  it('returns null for completely unregistered paths', () => {
    expect(matchRoute(routes, 'GET', '/nope')).toBeNull();
    expect(matchRoute(routes, 'POST', '/teams')).toBeNull();
  });
});

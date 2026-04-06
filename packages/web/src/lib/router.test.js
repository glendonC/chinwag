// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

// router.ts is a singleton with module-level state, so we reset modules for each test.

async function loadRouter(pathname = '/dashboard') {
  vi.resetModules();
  // Set the pathname before the module initializes
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, pathname },
  });
  return import('./router.js');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseLocation', () => {
  it('returns overview for /dashboard path', async () => {
    const { parseLocation } = await loadRouter('/dashboard');
    expect(parseLocation()).toEqual({ view: 'overview', teamId: null });
  });

  it('returns overview for bare root path', async () => {
    const { parseLocation } = await loadRouter('/');
    expect(parseLocation()).toEqual({ view: 'overview', teamId: null });
  });

  it('returns overview for dashboard.html root', async () => {
    const { parseLocation } = await loadRouter('/dashboard.html/');
    expect(parseLocation()).toEqual({ view: 'overview', teamId: null });
  });

  it('returns settings view for /dashboard/settings', async () => {
    const { parseLocation } = await loadRouter('/dashboard/settings');
    expect(parseLocation()).toEqual({ view: 'settings', teamId: null });
  });

  it('returns tools view for /dashboard/tools', async () => {
    const { parseLocation } = await loadRouter('/dashboard/tools');
    expect(parseLocation()).toEqual({ view: 'tools', teamId: null });
  });

  it('returns project view with teamId for /dashboard/project/:id', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project/t_abc123');
    expect(parseLocation()).toEqual({ view: 'project', teamId: 't_abc123' });
  });

  it('accepts hyphens in teamId', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project/my-team-id');
    expect(parseLocation()).toEqual({ view: 'project', teamId: 'my-team-id' });
  });

  it('accepts underscores in teamId', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project/team_123');
    expect(parseLocation()).toEqual({ view: 'project', teamId: 'team_123' });
  });

  it('falls through to overview for /dashboard/project with no id', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project');
    expect(parseLocation()).toEqual({ view: 'overview', teamId: null });
  });

  it('rejects teamId with invalid chars (falls through to overview)', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project/bad%20id');
    const result = parseLocation();
    expect(result).toEqual({ view: 'overview', teamId: null });
  });

  it('returns overview for unknown paths', async () => {
    const { parseLocation } = await loadRouter('/dashboard/unknown/path');
    expect(parseLocation()).toEqual({ view: 'overview', teamId: null });
  });

  it('strips dashboard.html prefix before parsing', async () => {
    const { parseLocation } = await loadRouter('/dashboard.html/settings');
    expect(parseLocation()).toEqual({ view: 'settings', teamId: null });
  });

  it('strips dashboard.html prefix for project routes', async () => {
    const { parseLocation } = await loadRouter('/dashboard.html/project/t_1');
    expect(parseLocation()).toEqual({ view: 'project', teamId: 't_1' });
  });

  // Legacy routes without /dashboard prefix should still work
  it('handles legacy /settings path', async () => {
    const { parseLocation } = await loadRouter('/settings');
    expect(parseLocation()).toEqual({ view: 'settings', teamId: null });
  });

  it('handles legacy /project/:id path', async () => {
    const { parseLocation } = await loadRouter('/project/t_abc123');
    expect(parseLocation()).toEqual({ view: 'project', teamId: 't_abc123' });
  });
});

describe('navigate', () => {
  it('pushes /dashboard for overview', async () => {
    const { navigate } = await loadRouter('/dashboard/settings');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('overview');

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard');
  });

  it('pushes /dashboard/project/:id for project', async () => {
    const { navigate } = await loadRouter('/dashboard');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('project', 't_abc');

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard/project/t_abc');
  });

  it('pushes /dashboard/tools for tools', async () => {
    const { navigate } = await loadRouter('/dashboard');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('tools');

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard/tools');
  });

  it('pushes /dashboard/settings for settings', async () => {
    const { navigate } = await loadRouter('/dashboard');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('settings');

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard/settings');
  });

  it('does not push if already at the same path', async () => {
    const { navigate } = await loadRouter('/dashboard/tools');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('tools');

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('falls back to /dashboard for project view without teamId', async () => {
    const { navigate } = await loadRouter('/dashboard/settings');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('project', null);

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard');
  });
});

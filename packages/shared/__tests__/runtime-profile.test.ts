import { describe, it, expect } from 'vitest';
import {
  normalizeRuntimeProfile,
  isLoopbackUrl,
  getDefaultDashboardPath,
  coerceDashboardUrl,
  resolveRuntimeProfile,
  toWebSocketOrigin,
  resolveRuntimeTargets,
  DEFAULT_API_URL,
  DEFAULT_DASHBOARD_URL,
  LOCAL_API_URL,
  LOCAL_DASHBOARD_URL,
  PROD_RUNTIME_PROFILE,
  LOCAL_RUNTIME_PROFILE,
} from '../runtime-profile.js';

// ---------------------------------------------------------------------------
// normalizeRuntimeProfile
// ---------------------------------------------------------------------------

describe('normalizeRuntimeProfile', () => {
  describe('prod aliases', () => {
    it('normalizes "prod" to "prod"', () => {
      expect(normalizeRuntimeProfile('prod')).toBe('prod');
    });

    it('normalizes "production" to "prod"', () => {
      expect(normalizeRuntimeProfile('production')).toBe('prod');
    });
  });

  describe('local aliases', () => {
    it('normalizes "local" to "local"', () => {
      expect(normalizeRuntimeProfile('local')).toBe('local');
    });

    it('normalizes "dev" to "local"', () => {
      expect(normalizeRuntimeProfile('dev')).toBe('local');
    });

    it('normalizes "development" to "local"', () => {
      expect(normalizeRuntimeProfile('development')).toBe('local');
    });

    it('normalizes "test" to "local"', () => {
      expect(normalizeRuntimeProfile('test')).toBe('local');
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase', () => {
      expect(normalizeRuntimeProfile('PROD')).toBe('prod');
      expect(normalizeRuntimeProfile('LOCAL')).toBe('local');
      expect(normalizeRuntimeProfile('DEV')).toBe('local');
      expect(normalizeRuntimeProfile('PRODUCTION')).toBe('prod');
      expect(normalizeRuntimeProfile('DEVELOPMENT')).toBe('local');
      expect(normalizeRuntimeProfile('TEST')).toBe('local');
    });

    it('handles mixed case', () => {
      expect(normalizeRuntimeProfile('Production')).toBe('prod');
      expect(normalizeRuntimeProfile('Dev')).toBe('local');
      expect(normalizeRuntimeProfile('pRoD')).toBe('prod');
    });
  });

  describe('whitespace trimming', () => {
    it('trims leading and trailing spaces', () => {
      expect(normalizeRuntimeProfile('  prod  ')).toBe('prod');
      expect(normalizeRuntimeProfile(' local ')).toBe('local');
    });

    it('trims tabs', () => {
      expect(normalizeRuntimeProfile('\tprod\t')).toBe('prod');
    });
  });

  describe('nullish and invalid inputs', () => {
    it('returns null for null', () => {
      expect(normalizeRuntimeProfile(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(normalizeRuntimeProfile(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(normalizeRuntimeProfile('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(normalizeRuntimeProfile('   ')).toBeNull();
    });

    it('returns null for unrecognized values', () => {
      expect(normalizeRuntimeProfile('garbage')).toBeNull();
      expect(normalizeRuntimeProfile('staging')).toBeNull();
      expect(normalizeRuntimeProfile('preview')).toBeNull();
      expect(normalizeRuntimeProfile('ci')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// isLoopbackUrl
// ---------------------------------------------------------------------------

describe('isLoopbackUrl', () => {
  describe('localhost', () => {
    it('returns true for http://localhost', () => {
      expect(isLoopbackUrl('http://localhost')).toBe(true);
    });

    it('returns true for https://localhost', () => {
      expect(isLoopbackUrl('https://localhost')).toBe(true);
    });

    it('returns true for localhost with port', () => {
      expect(isLoopbackUrl('http://localhost:8787')).toBe(true);
      expect(isLoopbackUrl('http://localhost:3000')).toBe(true);
    });

    it('returns true for localhost with path', () => {
      expect(isLoopbackUrl('http://localhost/path')).toBe(true);
      expect(isLoopbackUrl('http://localhost:8787/api/v1')).toBe(true);
    });
  });

  describe('127.0.0.1', () => {
    it('returns true for 127.0.0.1', () => {
      expect(isLoopbackUrl('http://127.0.0.1')).toBe(true);
      expect(isLoopbackUrl('https://127.0.0.1')).toBe(true);
    });

    it('returns true for 127.0.0.1 with port', () => {
      expect(isLoopbackUrl('http://127.0.0.1:8787')).toBe(true);
    });
  });

  describe('IPv6 ::1', () => {
    // Node URL parser returns "[::1]" for hostname, which does not match bare "::1"
    it('returns false for bracketed ::1 (URL parser limitation)', () => {
      expect(isLoopbackUrl('http://[::1]:8787')).toBe(false);
      expect(isLoopbackUrl('http://[::1]')).toBe(false);
    });
  });

  describe('remote hosts', () => {
    it('returns false for public URLs', () => {
      expect(isLoopbackUrl('https://chinmeister-api.glendonchin.workers.dev')).toBe(false);
      expect(isLoopbackUrl('https://example.com')).toBe(false);
      expect(isLoopbackUrl('https://google.com')).toBe(false);
    });

    it('returns false for IP addresses that are not loopback', () => {
      expect(isLoopbackUrl('http://192.168.1.1:8787')).toBe(false);
      expect(isLoopbackUrl('http://10.0.0.1')).toBe(false);
    });
  });

  describe('nullish and invalid inputs', () => {
    it('returns false for null', () => {
      expect(isLoopbackUrl(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isLoopbackUrl(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isLoopbackUrl('')).toBe(false);
    });

    it('returns false for invalid URL', () => {
      expect(isLoopbackUrl('not a url')).toBe(false);
      expect(isLoopbackUrl('://missing-scheme')).toBe(false);
    });

    it('returns false for bare hostname without scheme', () => {
      expect(isLoopbackUrl('localhost')).toBe(false);
      expect(isLoopbackUrl('localhost:8787')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// getDefaultDashboardPath
// ---------------------------------------------------------------------------

describe('getDefaultDashboardPath', () => {
  it('returns /dashboard for prod', () => {
    expect(getDefaultDashboardPath('prod')).toBe('/dashboard');
  });

  it('returns /dashboard.html for local', () => {
    expect(getDefaultDashboardPath('local')).toBe('/dashboard.html');
  });
});

// ---------------------------------------------------------------------------
// coerceDashboardUrl
// ---------------------------------------------------------------------------

describe('coerceDashboardUrl', () => {
  it('appends default prod path when URL has no path', () => {
    expect(coerceDashboardUrl('https://chinmeister.com', 'prod')).toBe(
      'https://chinmeister.com/dashboard',
    );
  });

  it('appends default local path when URL has no path', () => {
    expect(coerceDashboardUrl('http://localhost:56790', 'local')).toBe(
      'http://localhost:56790/dashboard.html',
    );
  });

  it('appends default path when URL has only root slash', () => {
    expect(coerceDashboardUrl('https://chinmeister.com/', 'prod')).toBe(
      'https://chinmeister.com/dashboard',
    );
  });

  it('preserves existing non-root path', () => {
    expect(coerceDashboardUrl('http://localhost:56790/custom', 'local')).toBe(
      'http://localhost:56790/custom',
    );
  });

  it('preserves existing dashboard path', () => {
    expect(coerceDashboardUrl('https://chinmeister.com/dashboard', 'prod')).toBe(
      'https://chinmeister.com/dashboard',
    );
  });

  it('defaults to prod profile when profile is omitted', () => {
    expect(coerceDashboardUrl('https://chinmeister.com')).toBe('https://chinmeister.com/dashboard');
  });

  it('preserves query string from input', () => {
    const result = coerceDashboardUrl('https://chinmeister.com/dashboard?team=abc', 'prod');
    expect(result).toContain('team=abc');
  });

  it('throws on invalid URL', () => {
    expect(() => coerceDashboardUrl('not a url', 'prod')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveRuntimeProfile
// ---------------------------------------------------------------------------

describe('resolveRuntimeProfile', () => {
  it('defaults to prod when no options given', () => {
    expect(resolveRuntimeProfile()).toBe('prod');
    expect(resolveRuntimeProfile({})).toBe('prod');
  });

  describe('explicit profile', () => {
    it('uses explicit profile when provided', () => {
      expect(resolveRuntimeProfile({ profile: 'local' })).toBe('local');
      expect(resolveRuntimeProfile({ profile: 'development' })).toBe('local');
      expect(resolveRuntimeProfile({ profile: 'production' })).toBe('prod');
      expect(resolveRuntimeProfile({ profile: 'test' })).toBe('local');
      expect(resolveRuntimeProfile({ profile: 'dev' })).toBe('local');
    });

    it('explicit profile takes priority over loopback detection', () => {
      expect(resolveRuntimeProfile({ profile: 'prod', apiUrl: 'http://localhost:8787' })).toBe(
        'prod',
      );
    });

    it('falls through to detection when profile is unrecognized', () => {
      expect(resolveRuntimeProfile({ profile: 'garbage', apiUrl: 'http://localhost:8787' })).toBe(
        'local',
      );
    });

    it('falls through to prod when profile is null', () => {
      expect(resolveRuntimeProfile({ profile: null })).toBe('prod');
    });
  });

  describe('loopback detection', () => {
    it('detects local from loopback apiUrl', () => {
      expect(resolveRuntimeProfile({ apiUrl: 'http://localhost:8787' })).toBe('local');
    });

    it('detects local from 127.0.0.1 apiUrl', () => {
      expect(resolveRuntimeProfile({ apiUrl: 'http://127.0.0.1:8787' })).toBe('local');
    });

    it('detects local from loopback dashboardUrl', () => {
      expect(resolveRuntimeProfile({ dashboardUrl: 'http://127.0.0.1:56790' })).toBe('local');
    });

    it('detects local from loopback chatWsUrl', () => {
      expect(resolveRuntimeProfile({ chatWsUrl: 'ws://localhost:8787/ws/chat' })).toBe('local');
    });

    it('returns prod for remote URLs with no explicit profile', () => {
      expect(
        resolveRuntimeProfile({ apiUrl: 'https://chinmeister-api.glendonchin.workers.dev' }),
      ).toBe('prod');
    });

    it('returns prod when all URLs are remote', () => {
      expect(
        resolveRuntimeProfile({
          apiUrl: 'https://api.example.com',
          dashboardUrl: 'https://dashboard.example.com',
          chatWsUrl: 'wss://ws.example.com',
        }),
      ).toBe('prod');
    });
  });
});

// ---------------------------------------------------------------------------
// toWebSocketOrigin
// ---------------------------------------------------------------------------

describe('toWebSocketOrigin', () => {
  it('converts https to wss', () => {
    expect(toWebSocketOrigin('https://chinmeister-api.glendonchin.workers.dev')).toBe(
      'wss://chinmeister-api.glendonchin.workers.dev',
    );
  });

  it('converts http to ws', () => {
    expect(toWebSocketOrigin('http://localhost:8787')).toBe('ws://localhost:8787');
  });

  it('strips path from URL', () => {
    expect(toWebSocketOrigin('https://example.com/api/v1')).toBe('wss://example.com');
  });

  it('strips query string from URL', () => {
    expect(toWebSocketOrigin('https://example.com?token=abc')).toBe('wss://example.com');
  });

  it('strips hash from URL', () => {
    expect(toWebSocketOrigin('https://example.com#section')).toBe('wss://example.com');
  });

  it('strips path, query, and hash together', () => {
    expect(toWebSocketOrigin('https://example.com/path?q=1#hash')).toBe('wss://example.com');
  });

  it('preserves port', () => {
    expect(toWebSocketOrigin('http://localhost:3000/path')).toBe('ws://localhost:3000');
  });

  it('preserves custom port on https', () => {
    expect(toWebSocketOrigin('https://example.com:9443/api')).toBe('wss://example.com:9443');
  });

  it('throws on invalid URL', () => {
    expect(() => toWebSocketOrigin('not a url')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveRuntimeTargets
// ---------------------------------------------------------------------------

describe('resolveRuntimeTargets', () => {
  it('returns prod defaults when no options given', () => {
    const targets = resolveRuntimeTargets();
    expect(targets).toMatchObject({
      profile: 'prod',
      apiUrl: DEFAULT_API_URL,
      dashboardUrl: DEFAULT_DASHBOARD_URL,
      teamWsOrigin: 'wss://chinmeister-api.glendonchin.workers.dev',
      chatWsUrl: 'wss://chinmeister-api.glendonchin.workers.dev/ws/chat',
    });
  });

  it('returns local defaults when profile is local', () => {
    const targets = resolveRuntimeTargets({ profile: 'local' });
    expect(targets).toMatchObject({
      profile: 'local',
      apiUrl: LOCAL_API_URL,
      dashboardUrl: LOCAL_DASHBOARD_URL,
      dashboardOrigin: 'http://localhost:56790',
      dashboardPath: '/dashboard.html',
      teamWsOrigin: 'ws://localhost:8787',
      chatWsUrl: 'ws://localhost:8787/ws/chat',
    });
  });

  it('uses custom apiUrl override and derives WS from it', () => {
    const targets = resolveRuntimeTargets({
      profile: 'prod',
      apiUrl: 'https://custom-api.example.com',
    });
    expect(targets.apiUrl).toBe('https://custom-api.example.com');
    expect(targets.teamWsOrigin).toBe('wss://custom-api.example.com');
    expect(targets.chatWsUrl).toBe('wss://custom-api.example.com/ws/chat');
  });

  it('uses custom dashboardUrl override', () => {
    const targets = resolveRuntimeTargets({
      profile: 'prod',
      dashboardUrl: 'https://custom.example.com/my-dash',
    });
    expect(targets.dashboardUrl).toBe('https://custom.example.com/my-dash');
    expect(targets.dashboardOrigin).toBe('https://custom.example.com');
    expect(targets.dashboardPath).toBe('/my-dash');
  });

  it('uses custom chatWsUrl override', () => {
    const targets = resolveRuntimeTargets({
      profile: 'prod',
      chatWsUrl: 'wss://custom-ws.example.com/ws/chat',
    });
    expect(targets.chatWsUrl).toBe('wss://custom-ws.example.com/ws/chat');
  });

  it('derives dashboardOrigin and dashboardPath from default prod', () => {
    const targets = resolveRuntimeTargets();
    expect(targets.dashboardOrigin).toBe('https://chinmeister.com');
    expect(targets.dashboardPath).toBe('/dashboard');
  });

  it('derives chatWsUrl from apiUrl when not explicitly provided', () => {
    const targets = resolveRuntimeTargets({ profile: 'local' });
    expect(targets.chatWsUrl).toBe('ws://localhost:8787/ws/chat');
  });

  it('returns all required fields', () => {
    const targets = resolveRuntimeTargets();
    expect(targets).toHaveProperty('profile');
    expect(targets).toHaveProperty('apiUrl');
    expect(targets).toHaveProperty('dashboardUrl');
    expect(targets).toHaveProperty('dashboardOrigin');
    expect(targets).toHaveProperty('dashboardPath');
    expect(targets).toHaveProperty('chatWsUrl');
    expect(targets).toHaveProperty('teamWsOrigin');
  });

  it('auto-detects local profile from loopback apiUrl', () => {
    const targets = resolveRuntimeTargets({ apiUrl: 'http://localhost:8787' });
    expect(targets.profile).toBe('local');
  });
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('PROD_RUNTIME_PROFILE is "prod"', () => {
    expect(PROD_RUNTIME_PROFILE).toBe('prod');
  });

  it('LOCAL_RUNTIME_PROFILE is "local"', () => {
    expect(LOCAL_RUNTIME_PROFILE).toBe('local');
  });

  it('DEFAULT_API_URL is the production API endpoint', () => {
    expect(DEFAULT_API_URL).toBe('https://chinmeister-api.glendonchin.workers.dev');
  });

  it('DEFAULT_DASHBOARD_URL is the production dashboard', () => {
    expect(DEFAULT_DASHBOARD_URL).toBe('https://chinmeister.com/dashboard');
  });

  it('LOCAL_API_URL is localhost:8787', () => {
    expect(LOCAL_API_URL).toBe('http://localhost:8787');
  });

  it('LOCAL_DASHBOARD_URL is localhost:56790/dashboard.html', () => {
    expect(LOCAL_DASHBOARD_URL).toBe('http://localhost:56790/dashboard.html');
  });
});

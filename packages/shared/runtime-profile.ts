export type ChinmeisterRuntimeProfile = 'prod' | 'local';

export interface RuntimeProfileOptions {
  profile?: string | null | undefined;
  apiUrl?: string | null | undefined;
  dashboardUrl?: string | null | undefined;
}

export interface RuntimeTargets {
  profile: ChinmeisterRuntimeProfile;
  apiUrl: string;
  dashboardUrl: string;
  dashboardOrigin: string;
  dashboardPath: string;
  teamWsOrigin: string;
}

export const PROD_RUNTIME_PROFILE: ChinmeisterRuntimeProfile = 'prod';
export const LOCAL_RUNTIME_PROFILE: ChinmeisterRuntimeProfile = 'local';

export const DEFAULT_API_URL = 'https://api.chinmeister.com';
export const DEFAULT_DASHBOARD_URL = 'https://chinmeister.com/dashboard';
export const LOCAL_API_URL = 'http://localhost:8787';
export const LOCAL_DASHBOARD_URL = 'http://localhost:56790/dashboard.html';

const DASHBOARD_PATHS: Record<ChinmeisterRuntimeProfile, string> = {
  prod: '/dashboard',
  local: '/dashboard.html',
};

const PROFILE_ALIASES: Record<string, ChinmeisterRuntimeProfile> = {
  prod: PROD_RUNTIME_PROFILE,
  production: PROD_RUNTIME_PROFILE,
  local: LOCAL_RUNTIME_PROFILE,
  dev: LOCAL_RUNTIME_PROFILE,
  development: LOCAL_RUNTIME_PROFILE,
  test: LOCAL_RUNTIME_PROFILE,
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function normalizeRuntimeProfile(
  value: string | ChinmeisterRuntimeProfile | null | undefined,
): ChinmeisterRuntimeProfile | null {
  if (!value) return null;
  return PROFILE_ALIASES[String(value).trim().toLowerCase()] || null;
}

export function isLoopbackUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function getDefaultDashboardPath(profile: ChinmeisterRuntimeProfile): string {
  return DASHBOARD_PATHS[profile];
}

export function coerceDashboardUrl(
  value: string,
  profile: ChinmeisterRuntimeProfile = PROD_RUNTIME_PROFILE,
): string {
  const parsed = new URL(value);
  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = getDefaultDashboardPath(profile);
  }
  return parsed.toString();
}

export function resolveRuntimeProfile(
  options: RuntimeProfileOptions = {},
): ChinmeisterRuntimeProfile {
  const explicit = normalizeRuntimeProfile(options.profile);
  if (explicit) return explicit;

  if (isLoopbackUrl(options.apiUrl) || isLoopbackUrl(options.dashboardUrl)) {
    return LOCAL_RUNTIME_PROFILE;
  }

  return PROD_RUNTIME_PROFILE;
}

export function toWebSocketOrigin(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return trimTrailingSlash(parsed.toString());
}

export function resolveRuntimeTargets(options: RuntimeProfileOptions = {}): RuntimeTargets {
  const profile = resolveRuntimeProfile(options);

  const defaultApiUrl = profile === LOCAL_RUNTIME_PROFILE ? LOCAL_API_URL : DEFAULT_API_URL;
  const defaultDashboardUrl =
    profile === LOCAL_RUNTIME_PROFILE ? LOCAL_DASHBOARD_URL : DEFAULT_DASHBOARD_URL;

  const apiUrl = options.apiUrl || defaultApiUrl;
  const dashboardUrl = coerceDashboardUrl(options.dashboardUrl || defaultDashboardUrl, profile);
  const teamWsOrigin = toWebSocketOrigin(apiUrl);
  const dashboard = new URL(dashboardUrl);

  return {
    profile,
    apiUrl,
    dashboardUrl,
    dashboardOrigin: dashboard.origin,
    dashboardPath: dashboard.pathname,
    teamWsOrigin,
  };
}

// Shared token refresh logic used by both api.ts (runtime 401 recovery)
// and auth.ts (startup validation). Consolidated to avoid drift.

import { createJsonApiClient } from '@chinmeister/shared/api-client.js';
import { getConfigPaths, saveConfig } from '@chinmeister/shared/config.js';
import { createLogger } from './utils/logger.js';
import { getErrorMessage } from './utils/responses.js';

const log = createLogger('token-refresh');

/** Result of a successful token refresh. */
export interface RefreshResult {
  token: string;
  refresh_token: string;
}

// Inflight deduplication: if multiple callers trigger refresh concurrently,
// the second awaits the first's promise instead of starting a new one.
// Same pattern as api.ts inflightRefresh.
let inflightRefresh: Promise<RefreshResult | null> | null = null;

/**
 * Attempt to refresh tokens via POST /auth/refresh and persist to disk.
 *
 * Uses a bare (unauthenticated) client - the refresh endpoint accepts the
 * refresh_token in the body, not via Authorization header.
 *
 * Safe to call concurrently: uses inflight deduplication so only one
 * network request is made even if multiple callers race.
 *
 * Returns the new token pair on success, or null on failure.
 */
export async function refreshAndPersistToken(
  baseUrl: string,
  refreshToken: string,
  currentConfig: Record<string, unknown>,
): Promise<RefreshResult | null> {
  if (inflightRefresh) {
    return inflightRefresh;
  }

  inflightRefresh = doRefreshAndPersist(baseUrl, refreshToken, currentConfig).finally(() => {
    inflightRefresh = null;
  });

  return inflightRefresh;
}

/** @internal Exported only for testing - resets the inflight deduplication state. */
export function _resetInflightRefresh(): void {
  inflightRefresh = null;
}

async function doRefreshAndPersist(
  baseUrl: string,
  refreshToken: string,
  currentConfig: Record<string, unknown>,
): Promise<RefreshResult | null> {
  try {
    const client = createJsonApiClient({ baseUrl, userAgent: 'chinmeister-mcp/1.0' });
    const result = await client.post<RefreshResult>('/auth/refresh', {
      refresh_token: refreshToken,
    });

    if (!result.token) return null;

    const updatedConfig = {
      ...currentConfig,
      token: result.token,
      refresh_token: result.refresh_token,
    };
    try {
      saveConfig(updatedConfig);
      log.info('Token refreshed and persisted successfully.');
    } catch (writeErr: unknown) {
      const { configFile } = getConfigPaths();
      log.warn(
        'Token refresh succeeded but disk persist failed - ' +
          'in-memory token is valid but will not survive restart. ' +
          `Config path: ${configFile}. Error: ` +
          getErrorMessage(writeErr),
      );
    }

    return result;
  } catch (err: unknown) {
    log.error('Token refresh failed: ' + getErrorMessage(err));
    return null;
  }
}

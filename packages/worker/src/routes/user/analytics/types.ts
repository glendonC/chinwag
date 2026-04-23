// Shared types for user analytics merge modules.
//
// Each module owns a single analytic. It exposes an accumulator, a `merge`
// that folds one team result into the accumulator, and a `project` that
// shapes the final slice. TeamResult is typed against the shared contract
// so modules get real typing — no Record<string, unknown> smuggling.

import type { UserAnalytics } from '@chinmeister/shared/contracts/analytics.js';

/**
 * Result from a single team's getAnalyticsForOwner call. Either an error
 * shape (timeout / failure) or a partial UserAnalytics — partial because
 * individual DO methods may omit fields on failure.
 */
export type TeamResult = Partial<UserAnalytics> & { error?: string };

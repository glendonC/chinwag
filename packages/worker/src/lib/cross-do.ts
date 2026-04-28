// Cross-DO write retry helper.
//
// Cloudflare Durable Objects don't support cross-DO transactions. When a
// route writes to TeamDO and DatabaseDO in sequence, a transient failure on
// the second write can leave the two stores inconsistent. Examples:
//
//   - handleTeamLeave: team.leave succeeds, db.removeUserTeam times out → user
//     is gone from TeamDO but the user_teams roster row persists ("ghost-kick").
//   - handleTeamJoin: team.join succeeds, db.addUserTeam times out → user is
//     in TeamDO but invisible on the dashboard ("hidden member").
//
// Both bugs share a root cause: the second write isn't retried, and the
// route returns success to the client based only on the first write.
//
// withDORetry wraps an idempotent DO operation with exponential backoff.
// Use it for the second-of-two writes when the operation is genuinely
// idempotent (DELETE WHERE x=?, INSERT ON CONFLICT DO UPDATE, etc.) and a
// terminal failure should be logged but not surfaced to the client.

import { createLogger } from './logger.js';
import { getErrorMessage } from './errors.js';

const log = createLogger('cross-do');

interface RetryOptions {
  /** Operation name for logs. */
  label: string;
  /** Max attempts before giving up. Default 4 (1 initial + 3 retries). */
  maxAttempts?: number;
  /** Initial backoff in ms. Doubles each retry. Default 50. */
  initialDelayMs?: number;
  /** Cap on backoff between retries. Default 1000. */
  maxDelayMs?: number;
}

/**
 * Run an idempotent DO operation with exponential backoff. The operation
 * MUST be safe to retry - typically `db.addUserTeam` (upsert), `db.removeUserTeam`
 * (DELETE WHERE), or any other write that can be replayed without side effects.
 *
 * On terminal failure, logs and rethrows. Caller decides whether the failure
 * is fatal to the request or can be tolerated as eventually-consistent.
 */
export async function withDORetry<T>(op: () => Promise<T>, options: RetryOptions): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const initialDelay = options.initialDelayMs ?? 50;
  const maxDelay = options.maxDelayMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts - 1) break;
      const delay = Math.min(initialDelay * 2 ** attempt, maxDelay);
      log.warn(`${options.label} attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
        error: getErrorMessage(err),
      });
      await sleep(delay);
    }
  }
  log.error(`${options.label} failed after ${maxAttempts} attempts`, {
    error: getErrorMessage(lastError),
  });
  throw lastError;
}

/**
 * Same as withDORetry but swallows the terminal error. Use when the second
 * write of a cross-DO sequence isn't required for the request to succeed -
 * the route reports success based on the first write, and a self-heal path
 * elsewhere will reconcile the second store on the next operation. The
 * failure is still logged for ops visibility.
 *
 * Example: handleTeamLeave's db.removeUserTeam - if it fails terminally, the
 * user appears to have left (TeamDO removed them), and the orphan user_teams
 * row gets cleaned up the next time `chinmeister init` runs (or when the
 * user manually re-leaves).
 */
export async function tryDORetry<T>(
  op: () => Promise<T>,
  options: RetryOptions,
): Promise<T | null> {
  try {
    return await withDORetry(op, options);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

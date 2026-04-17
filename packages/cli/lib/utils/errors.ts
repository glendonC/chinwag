/**
 * Shared error classification for HTTP API errors.
 *
 * Maps HTTP status codes and network error messages to user-friendly
 * descriptions. Used across the dashboard connection, customize screen,
 * and init command to avoid duplicating status-to-message logic.
 */

export type ConnectionState = 'offline' | 'reconnecting' | 'error';

export interface ClassifiedError {
  state: ConnectionState;
  detail: string;
  fatal?: boolean;
}

export interface InitErrorClassification {
  title: string;
  hint: string;
}

/**
 * Classify an HTTP/network error into a connection state and user-facing message.
 */
export function classifyError(err: {
  message?: string | undefined;
  status?: number | undefined;
  code?: string | undefined;
}): ClassifiedError {
  const msg = err.message || '';
  const status = err.status;

  if (status === 401)
    return { state: 'offline', detail: 'Session expired. Re-run chinwag init.', fatal: true };
  if (status === 403)
    return { state: 'offline', detail: 'Access denied. You may have been removed from this team.' };
  if (status === 404)
    return { state: 'offline', detail: 'Team not found. The .chinwag file may be stale.' };
  if (status === 409) return { state: 'error', detail: 'Conflict. That resource already exists.' };
  if (status === 429) return { state: 'reconnecting', detail: 'Rate limited. Retrying shortly.' };
  if (status != null && status >= 500)
    return { state: 'reconnecting', detail: 'Server error. Retrying...' };
  if (status === 408 || msg.includes('timed out'))
    return { state: 'reconnecting', detail: 'Request timed out. Retrying...' };

  const networkCodes = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'];
  if ((err.code && networkCodes.includes(err.code)) || networkCodes.some((c) => msg.includes(c))) {
    return { state: 'offline', detail: 'Cannot reach server. Check your connection.' };
  }

  return { state: 'reconnecting', detail: msg || 'Connection issue. Retrying...' };
}

/**
 * Classify an error for the init/welcome screen.
 * Wraps classifyError() and maps to init-specific title/hint messaging.
 */
export function classifyInitError({
  message = '',
  status,
}: { message?: string | undefined; status?: number | undefined } = {}): InitErrorClassification {
  const classified = classifyError({ message, status });

  if (status === 429)
    return { title: 'Our servers are busy right now.', hint: 'Try again in a few minutes.' };
  if (status != null && status >= 500)
    return { title: 'Something went wrong on our end.', hint: 'Try again shortly.' };
  if (classified.state === 'reconnecting' && (status === 408 || message.includes('timed out')))
    return { title: 'Request timed out.', hint: 'Check your connection and try again.' };
  if (classified.state === 'offline' && !classified.fatal)
    return { title: 'Cannot reach server.', hint: 'Check your internet connection.' };

  return { title: 'Could not connect.', hint: message };
}

/**
 * Get a user-friendly message for an HTTP error in a form/action context
 * (e.g. updating a handle, saving a color). Falls back to classifyError
 * but returns just the detail string for inline display.
 */
export function friendlyErrorMessage(
  err: { message?: string; status?: number },
  fallbackMessage = 'Something went wrong.',
): string {
  const status = err.status;

  if (status === 400) return 'Invalid input. Check the format and try again.';
  if (status === 409) return 'That resource already exists or conflicts with another.';

  const classified = classifyError(err);
  if (classified.detail) return classified.detail;

  return err.message || fallbackMessage;
}

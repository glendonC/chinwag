/**
 * Barrel re-export — all contract types available from a single import.
 *
 * Prefer direct domain imports for new code:
 *   import type { TeamMember } from '@chinwag/shared/contracts/team.js';
 *   import type { UserAnalytics } from '@chinwag/shared/contracts/analytics.js';
 *
 * This file preserves backward compatibility for existing consumers.
 */

export * from './contracts/team.js';
export * from './contracts/analytics.js';
export * from './contracts/conversation.js';
export * from './contracts/events.js';
export * from './contracts/dashboard.js';
export * from './contracts/tools.js';

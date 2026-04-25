// User route registration -- composes the authenticated, non-team route table.
//
// Split into focused modules:
//   auth.ts      -- authenticate(), token refresh, WS ticket creation
//   profile.ts   -- handle, color, status, agent profile, presence heartbeat
//   teams.ts     -- team CRUD, chat upgrade
//   analytics.ts -- cross-team analytics aggregation
//   sessions.ts  -- cross-team session listing for the timeline
//   dashboard.ts -- multi-team dashboard summary orchestration
//   data.ts      -- export and delete user-owned data

import type { RouteDefinition } from '../../lib/router.js';
import { authenticate, handleGetWsTicket } from './auth.js';
import { handleSuggestTool } from '../directory.js';
import { handleGithubLink } from '../public.js';
import {
  handleMe,
  handleUnlinkGithub,
  handleUpdateHandle,
  handleUpdateColor,
  handleSetStatus,
  handleClearStatus,
  handleHeartbeat,
  handleUpdateAgentProfile,
  handleGlobalRank,
  handleUpdateBudgets,
  handleRevokeTokens,
} from './profile.js';
import { handleGetUserTeams, handleChatUpgrade, handleCreateTeam } from './teams.js';
import { handleUserAnalytics } from './analytics.js';
import { handleUserSessions } from './sessions.js';
import { handleDashboardSummary } from './dashboard.js';
import { handleExportUserData, handleDeleteUserData } from './data.js';

// authenticate is used by the worker entry point, not the route table.
// Re-export it here so callers have a single user-routes module to depend on.
export { authenticate };

/**
 * All authenticated non-team routes. Includes the WebSocket upgrade for
 * peer-to-peer chat, but team-scoped WS upgrades live in registerTeamRoutes.
 * Registration order is preserved to keep parametric matching deterministic.
 */
export function registerUserRoutes(): RouteDefinition[] {
  return [
    { method: 'GET', path: '/me', handler: handleMe },
    { method: 'GET', path: '/me/teams', handler: handleGetUserTeams },
    { method: 'GET', path: '/me/dashboard', handler: handleDashboardSummary },
    { method: 'GET', path: '/me/analytics', handler: handleUserAnalytics },
    { method: 'GET', path: '/me/sessions', handler: handleUserSessions },
    { method: 'GET', path: '/me/global-rank', handler: handleGlobalRank },
    { method: 'PUT', path: '/me/handle', handler: handleUpdateHandle },
    { method: 'PUT', path: '/me/color', handler: handleUpdateColor },
    { method: 'PUT', path: '/me/budgets', handler: handleUpdateBudgets },
    { method: 'POST', path: '/me/revoke-tokens', handler: handleRevokeTokens },
    { method: 'GET', path: '/me/data/export', handler: handleExportUserData },
    { method: 'POST', path: '/me/data/delete', handler: handleDeleteUserData },
    { method: 'PUT', path: '/me/github', handler: handleUnlinkGithub },
    { method: 'PUT', path: '/status', handler: handleSetStatus },
    { method: 'DELETE', path: '/status', handler: handleClearStatus },
    { method: 'POST', path: '/presence/heartbeat', handler: handleHeartbeat },
    { method: 'PUT', path: '/agent/profile', handler: handleUpdateAgentProfile },
    { method: 'POST', path: '/auth/ws-ticket', handler: handleGetWsTicket },
    { method: 'POST', path: '/auth/github/link', handler: handleGithubLink },
    { method: 'POST', path: '/teams', handler: handleCreateTeam },
    { method: 'POST', path: '/tools/suggest', handler: handleSuggestTool },

    // Authenticated WebSocket upgrade (return directly, skip CORS headers)
    { method: 'GET', path: '/ws/chat', handler: handleChatUpgrade },
  ];
}

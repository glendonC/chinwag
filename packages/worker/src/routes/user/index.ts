// User route dispatcher — re-exports all user route handlers.
//
// Split into focused modules:
//   auth.ts      -- authenticate(), token refresh, WS ticket creation
//   profile.ts   -- handle, color, status, agent profile, presence heartbeat
//   teams.ts     -- team CRUD, chat upgrade
//   analytics.ts -- cross-team analytics aggregation
//   sessions.ts  -- cross-team session listing for the timeline
//   dashboard.ts -- multi-team dashboard summary orchestration

export { authenticate, handleRefreshToken, handleGetWsTicket } from './auth.js';
export {
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
export { handleGetUserTeams, handleChatUpgrade, handleCreateTeam } from './teams.js';
export { handleUserAnalytics } from './analytics.js';
export { handleUserSessions } from './sessions.js';
export { handleDashboardSummary } from './dashboard.js';
export { handleExportUserData, handleDeleteUserData } from './data.js';

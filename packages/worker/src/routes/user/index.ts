// User route dispatcher — re-exports all user route handlers.
//
// Split into focused modules:
//   auth.ts    -- authenticate(), token refresh, WS ticket creation
//   profile.ts -- handle, color, status, agent profile, presence heartbeat
//   teams.ts   -- team CRUD, dashboard summary, chat upgrade

export { authenticate, handleRefreshToken, handleGetWsTicket } from './auth.js';
export {
  handleUnlinkGithub,
  handleUpdateHandle,
  handleUpdateColor,
  handleSetStatus,
  handleClearStatus,
  handleHeartbeat,
  handleUpdateAgentProfile,
} from './profile.js';
export {
  handleGetUserTeams,
  handleDashboardSummary,
  handleChatUpgrade,
  handleCreateTeam,
} from './teams.js';

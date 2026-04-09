// Team route dispatcher — re-exports all team route handlers.

export {
  handleTeamJoin,
  handleTeamLeave,
  handleTeamContext,
  handleTeamHeartbeat,
  handleTeamWebSocket,
} from './membership.js';
export {
  handleTeamActivity,
  handleTeamConflicts,
  handleTeamFile,
  handleTeamStartSession,
  handleTeamEndSession,
  handleTeamSessionEdit,
  handleTeamReportOutcome,
  handleTeamHistory,
  handleTeamEditHistory,
  handleTeamEnrichModel,
} from './activity.js';
export {
  handleTeamSaveMemory,
  handleTeamSearchMemory,
  handleTeamUpdateMemory,
  handleTeamDeleteMemory,
  handleTeamDeleteMemoryBatch,
} from './memory.js';
export {
  handleTeamCreateCategory,
  handleTeamListCategories,
  handleTeamCategoryNames,
  handleTeamUpdateCategory,
  handleTeamDeleteCategory,
  handleTeamPromotableTags,
} from './categories.js';
export { handleTeamClaimFiles, handleTeamReleaseFiles, handleTeamGetLocks } from './locks.js';
export { handleTeamSendMessage, handleTeamGetMessages } from './messages.js';
export { handleTeamSubmitCommand, handleTeamGetCommands } from './commands.js';
export { handleTeamAnalytics } from './analytics.js';

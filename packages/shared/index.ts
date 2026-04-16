// runtime-profile
export {
  PROD_RUNTIME_PROFILE,
  LOCAL_RUNTIME_PROFILE,
  DEFAULT_API_URL,
  DEFAULT_DASHBOARD_URL,
  LOCAL_API_URL,
  LOCAL_DASHBOARD_URL,
  normalizeRuntimeProfile,
  isLoopbackUrl,
  getDefaultDashboardPath,
  coerceDashboardUrl,
  resolveRuntimeProfile,
  resolveRuntimeTargets,
  toWebSocketOrigin,
  type ChinwagRuntimeProfile,
  type RuntimeProfileOptions,
  type RuntimeTargets,
} from './runtime-profile.js';

// api-client
export {
  createJsonApiClient,
  ApiRequestError,
  type ApiError,
  type ApiClientConfig,
  type JsonApiClient,
} from './api-client.js';

// agent-identity
export {
  detectRuntimeIdentity,
  detectToolName,
  generateAgentId,
  generateSessionAgentId,
  getConfiguredAgentId,
  type RuntimeIdentity,
  type DetectRuntimeOptions,
  type RuntimeIdentityLike,
} from './agent-identity.js';

// config
export {
  CONFIG_DIR,
  CONFIG_FILE,
  LOCAL_CONFIG_DIR,
  LOCAL_CONFIG_FILE,
  getConfigPaths,
  configExists,
  loadConfig,
  saveConfig,
  deleteConfig,
  validateConfigShape,
  type ChinwagConfig,
  type ConfigPathOptions,
  type ConfigPaths,
} from './config.js';

// error-utils
export { formatError, formatErrorChain, getHttpStatus, getErrorCode } from './error-utils.js';

// logger
export { createLogger, type Logger } from './logger.js';

// contracts
export { AGENT_STATUS } from './contracts.js';
export type {
  AgentStatus,
  RuntimeIdentityContract,
  MemberActivity,
  AgentMetadata,
  TeamMember,
  TeamConflict,
  ConflictMatch,
  LockedConflict,
  TeamLock,
  TeamMemory,
  TeamMessage,
  TeamSession,
  HostJoinMetric,
  SurfaceJoinMetric,
  ModelMetric,
  TeamContext,
  DashboardTeamSummary,
  DashboardSummary,
  AuthenticatedUser,
  UserTeam,
  UserTeamsResponse,
  WebSocketTicketResponse,
  ToolCatalogEntry,
  ToolCatalogResponse,
  ToolDirectoryEvaluation,
  ToolDirectoryResponse,
  HeartbeatEvent,
  ActivityEvent,
  FileEvent,
  MemberJoinedEvent,
  MemberLeftEvent,
  StatusChangeEvent,
  LockChangeEvent,
  MessageEvent,
  MemoryDeltaEvent,
  ContextEvent,
  DashboardDeltaEvent,
  ConflictCheckResponse,
} from './contracts.js';

// dashboard-ws
export { normalizeDashboardDeltaEvent, applyDelta, type DashboardLimits } from './dashboard-ws.js';

// integration-doctor
export {
  commandExists,
  buildChinwagCliArgs,
  buildChinwagHookCommand,
  detectHostIntegrations,
  formatIntegrationScanResults,
  summarizeIntegrationScan,
  writeMcpConfig,
  writeHooksConfig,
  writeCursorHooksConfig,
  writeWindsurfHooksConfig,
  configureHostIntegration,
  scanHostIntegrations,
  type IntegrationScanResult,
  type IntegrationScanSummary,
  type ConfigureResult,
  type WriteResult,
} from './integration-doctor.js';

// integration-model
export {
  HOST_INTEGRATIONS,
  AGENT_SURFACES,
  getHostIntegrationById,
  buildHostIntegrationCatalogEntries,
  buildAgentSurfaceCatalogEntries,
  type HostIntegrationRuntime,
  type HostIntegration,
  type AgentSurface,
  type CatalogEntry,
  type McpTool,
  type ToolCatalog,
  type ToolDetect,
  type ToolProcessDetection,
  type ToolSpawnConfig,
  type ToolAvailabilityCheck,
  type ToolFailurePattern,
} from './integration-model.js';

// process-utils
export { readProcessInfo, getProcessTtyPath, getProcessCommandString } from './process-utils.js';

// session-registry
export {
  SESSION_COMMAND_MARKER,
  getSessionsDir,
  safeAgentId,
  getSessionFilePath,
  getCurrentTtyPath,
  isProcessAlive,
  isSessionRecordAlive,
  writeSessionRecord,
  readSessionRecord,
  deleteSessionRecord,
  resolveSessionAgentId,
  setTerminalTitle,
  pingAgentTerminal,
  type SessionRecord,
  type SessionRecordInput,
  type ResolveSessionOptions,
} from './session-registry.js';

// team-utils
export { TEAM_ID_PATTERN, isValidTeamId, findTeamFile, type TeamFileInfo } from './team-utils.js';

// tool-registry (types like McpTool, ToolDetect, etc. are re-exported via integration-model)
export { MCP_TOOLS, getMcpToolById, type AvailabilityCheckResult } from './tool-registry.js';

// tool-call-categories (shared classifier for research/edit/exec/memory)
export {
  TOOL_CALL_CATEGORIES,
  RESEARCH_TOOLS,
  EDIT_TOOLS,
  classifyToolCall,
  sqlInList,
  type ToolCallCategory,
} from './tool-call-categories.js';

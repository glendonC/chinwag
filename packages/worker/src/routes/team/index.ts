// Team route registration -- composes the per-team route table.
//
// Each submodule exports a registerXyzRoutes(TID) factory returning
// RouteDefinition[]. registerTeamRoutes concatenates them in the same
// order the original flat table used. Cross-group ordering is safe to
// shift only because every team path has a unique distinguishing
// segment after `/teams/:tid/...`, so no two parametric regexes can
// match the same URL. If you add a route that overlaps with another
// (e.g. a wildcard tail), reconsider this composition.

import type { RouteDefinition } from '../../lib/router.js';
import { registerMembershipRoutes } from './membership.js';
import { registerActivityRoutes } from './activity.js';
import { registerMemoryRoutes } from './memory.js';
import { registerCategoriesRoutes } from './categories.js';
import { registerLocksRoutes } from './locks.js';
import { registerMessagesRoutes } from './messages.js';
import { registerCommandsRoutes } from './commands.js';
import { registerAnalyticsRoutes } from './analytics.js';
import { registerBillingBlocksRoutes } from './billing-blocks.js';
import { registerConversationsRoutes } from './conversations.js';

export function registerTeamRoutes(TID: string): RouteDefinition[] {
  return [
    ...registerMembershipRoutes(TID),
    ...registerActivityRoutes(TID),
    ...registerMemoryRoutes(TID),
    ...registerCategoriesRoutes(TID),
    ...registerLocksRoutes(TID),
    ...registerMessagesRoutes(TID),
    ...registerCommandsRoutes(TID),
    ...registerAnalyticsRoutes(TID),
    ...registerBillingBlocksRoutes(TID),
    ...registerConversationsRoutes(TID),
  ];
}

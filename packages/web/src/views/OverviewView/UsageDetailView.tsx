/**
 * Usage detail view public surface. The drill is internally sharded into
 * `./UsageDetailView/` — orchestrator, shared helpers, ring constants,
 * CSS module, and (post-split) per-tab panel components. Consumers keep
 * their default import unchanged; the folder structure is an
 * implementation detail.
 */

export { default } from './UsageDetailView/index.js';

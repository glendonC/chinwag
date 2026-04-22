// Back-compat re-export. The real implementation lives in ./demo/baseline.ts
// (healthy scenario) and ./demo/scenarios.ts (edge states). New call sites
// should import from './demo/index.js' directly and use getDemoData() with
// a scenario id; keeping createDemoAnalytics() here so the existing
// useUserAnalytics / useTeamExtendedAnalytics fallback contract stays stable
// until those hooks are migrated to scenario-aware form.

export { createBaselineAnalytics as createDemoAnalytics } from './demo/baseline.js';

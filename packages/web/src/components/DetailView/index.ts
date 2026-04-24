export { default as DetailView } from './DetailView.js';
export type { DetailTabDef, TabControl } from './DetailView.js';

export { default as DetailSection } from './DetailSection.js';

export { default as FocusedDetailView } from './FocusedDetailView.js';
export type { FocusedQuestion } from './FocusedDetailView.js';

export { default as Metric } from './Metric.js';
export type { MetricTone } from './Metric.js';

export { default as BreakdownList, BreakdownMeta } from './BreakdownList.js';
export type { BreakdownItem } from './BreakdownList.js';

export { default as FileList } from './FileList.js';
export type { FileListItem } from './FileList.js';

// Reusable viz primitives — share the same import path as the shell
// primitives above so callers don't need to memorize a second location.
export * from './viz/index.js';

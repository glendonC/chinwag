// Demo-mode activation and scenario selection. Reads ?demo=<scenario-id>
// from the URL; when present, hooks skip their API fetch and use the named
// scenario's fixture instead. The selector UI (DemoSwitcher) writes this
// param back via history.replaceState so scenario swaps don't navigate.
//
// Rules:
// - URL param is the source of truth: ?demo=empty wins over any local state.
// - ?demo with no value (or "1") resolves to the default scenario so a
//   bare `?demo` toggle still works.
// - In dev builds (import.meta.env.DEV) the switcher is always visible so
//   unrouted local work still exercises scenarios without URL surgery.

import { DEFAULT_SCENARIO, isDemoScenarioId, type DemoScenarioId } from './demo/index.js';

const DEMO_PARAM = 'demo';

function readParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(DEMO_PARAM);
}

/** True when the URL carries `?demo` — regardless of value. Hooks use this
 *  to gate the API-fetch path. */
export function isDemoActive(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has(DEMO_PARAM);
}

/** Active scenario id resolved from the URL. Returns the default when the
 *  param is absent, empty, or points to an unknown scenario. */
export function getActiveScenarioId(): DemoScenarioId {
  const raw = readParam();
  if (raw == null) return DEFAULT_SCENARIO;
  if (raw === '' || raw === '1' || raw === 'true') return DEFAULT_SCENARIO;
  return isDemoScenarioId(raw) ? raw : DEFAULT_SCENARIO;
}

/** Update the URL's `?demo=` in place. Preserves other query params; does
 *  not push a history entry so the browser back button doesn't accumulate
 *  scenario swaps. Clears to a bare URL when passed null. */
export function setActiveScenarioId(id: DemoScenarioId | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id == null) url.searchParams.delete(DEMO_PARAM);
  else url.searchParams.set(DEMO_PARAM, id);
  window.history.replaceState({}, '', url.toString());
  window.dispatchEvent(new Event('chinwag:demo-scenario-changed'));
}

/** Whether to surface the DemoSwitcher floating control. On in demo mode
 *  or in dev builds; off in production without `?demo`. */
export function shouldShowDemoSwitcher(): boolean {
  if (isDemoActive()) return true;
  return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
}

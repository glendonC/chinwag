// React binding for the Reports demo payload. Subscribes to scenario
// changes via useDemoScenario so the Reports view re-renders when the
// switcher swaps. Mirrors useUserAnalytics' pattern minus the API fall-
// through - Reports has no backend yet, so the demo payload is the source
// today. When the backend lands, this becomes a conditional fetch hook
// that falls through to the API when the demo flag is off.

import { useMemo } from 'react';
import { getDemoData, type ReportsDemoData } from '../lib/demo/index.js';
import { useDemoScenario } from './useDemoScenario.js';

export function useDemoReports(): ReportsDemoData {
  const demo = useDemoScenario();
  return useMemo(() => getDemoData(demo.scenarioId).reports, [demo.scenarioId]);
}

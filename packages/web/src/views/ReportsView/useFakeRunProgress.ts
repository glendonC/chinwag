// Simulates a live report run for the skeleton. Advances through
// plain-English phases (not internal pipeline stages — that's a non-goal
// violation) and progressively reveals findings on a timer.
//
// Returns the current phase label, progress (0-1), elapsed ms, and the
// findings that have landed so far. Callers render these directly.

import { useEffect, useRef, useState } from 'react';
import type { Finding } from './types.js';
import { getCompletedReportFor } from './mock-findings.js';

const PHASES: Array<{ label: string; durationMs: number }> = [
  { label: 'Reading your session history', durationMs: 3_500 },
  { label: 'Looking at the files your agents touched', durationMs: 4_000 },
  { label: 'Finding patterns', durationMs: 4_500 },
  { label: 'Writing up findings', durationMs: 3_000 },
];

const TOTAL_MS = PHASES.reduce((sum, p) => sum + p.durationMs, 0);

interface ProgressState {
  phaseIndex: number;
  phaseLabel: string;
  progress: number;
  elapsedMs: number;
  findings: Finding[];
  isComplete: boolean;
}

export function useFakeRunProgress(reportId: string, active: boolean): ProgressState {
  const [state, setState] = useState<ProgressState>(() => ({
    phaseIndex: 0,
    phaseLabel: PHASES[0].label,
    progress: 0,
    elapsedMs: 0,
    findings: [],
    isComplete: false,
  }));
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    startRef.current = Date.now();
    const completedReport = getCompletedReportFor(reportId);
    const allFindings = completedReport?.findings ?? [];

    const interval = setInterval(() => {
      const start = startRef.current ?? Date.now();
      const elapsed = Date.now() - start;

      if (elapsed >= TOTAL_MS) {
        setState({
          phaseIndex: PHASES.length - 1,
          phaseLabel: 'Done',
          progress: 1,
          elapsedMs: TOTAL_MS,
          findings: allFindings,
          isComplete: true,
        });
        clearInterval(interval);
        return;
      }

      // Which phase are we in?
      let cumulative = 0;
      let phaseIndex = 0;
      for (let i = 0; i < PHASES.length; i++) {
        cumulative += PHASES[i].durationMs;
        if (elapsed < cumulative) {
          phaseIndex = i;
          break;
        }
      }

      // Reveal findings proportional to overall progress — earlier findings first.
      const progress = Math.min(1, elapsed / TOTAL_MS);
      const revealed = Math.floor(progress * allFindings.length);
      const landedFindings = allFindings.slice(0, revealed);

      setState({
        phaseIndex,
        phaseLabel: PHASES[phaseIndex].label,
        progress,
        elapsedMs: elapsed,
        findings: landedFindings,
        isComplete: false,
      });
    }, 180);

    return () => clearInterval(interval);
  }, [active, reportId]);

  return state;
}

export function getPhaseList(): ReadonlyArray<{ label: string; durationMs: number }> {
  return PHASES;
}

export function getEstimatedTotalMs(): number {
  return TOTAL_MS;
}

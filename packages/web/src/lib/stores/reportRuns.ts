// Active report runs — in-memory, keyed by reportId.
//
// When the real backend lands, this becomes the subscription surface
// for server-pushed run state (launched / completed / failed events).
// For the skeleton, it just tracks which reports the user has launched
// in this session so the UI can render a "running" state in place of
// the Launch button, and the state survives in-app navigation.

import { createStore, useStore } from 'zustand';

interface ActiveRun {
  reportId: string;
  startedAt: number;
}

interface ReportRunsState {
  active: Record<string, ActiveRun>;
  launch: (reportId: string) => void;
  cancel: (reportId: string) => void;
}

const reportRunsStore = createStore<ReportRunsState>((set) => ({
  active: {},
  launch: (reportId) =>
    set((s) => ({
      active: { ...s.active, [reportId]: { reportId, startedAt: Date.now() } },
    })),
  cancel: (reportId) =>
    set((s) => {
      if (!s.active[reportId]) return s;
      const next = { ...s.active };
      delete next[reportId];
      return { active: next };
    }),
}));

export function useActiveRun(reportId: string): ActiveRun | undefined {
  return useStore(reportRunsStore, (s) => s.active[reportId]);
}

export const reportRunsActions = {
  launch: (reportId: string) => reportRunsStore.getState().launch(reportId),
  cancel: (reportId: string) => reportRunsStore.getState().cancel(reportId),
};

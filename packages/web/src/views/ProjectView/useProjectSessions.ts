import { useMemo } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import {
  buildFilesTouched,
  countLiveSessions,
  selectRecentSessions,
  sumSessionEdits,
} from './projectViewState.js';

type Session = any;

interface UseProjectSessionsReturn {
  allSessions: Session[];
  sessions: Session[];
  filesTouched: string[];
  filesTouchedCount: number;
  sessionEditCount: number;
  liveSessionCount: number;
}

export default function useProjectSessions(): UseProjectSessionsReturn {
  const contextData = usePollingStore((s) => s.contextData) as Record<string, unknown> | null;

  const allSessions = useMemo(
    () =>
      selectRecentSessions(
        (contextData?.recentSessions as Session[]) || (contextData?.sessions as Session[]) || [],
      ),
    [contextData],
  );
  const sessions = allSessions.slice(0, 8);
  const filesTouched: string[] = useMemo(() => buildFilesTouched(allSessions), [allSessions]);
  const sessionEditCount: number = useMemo(() => sumSessionEdits(allSessions), [allSessions]);
  const filesTouchedCount = filesTouched.length;
  const liveSessionCount: number = useMemo(() => countLiveSessions(allSessions), [allSessions]);

  return {
    allSessions,
    sessions,
    filesTouched,
    filesTouchedCount,
    sessionEditCount,
    liveSessionCount,
  };
}

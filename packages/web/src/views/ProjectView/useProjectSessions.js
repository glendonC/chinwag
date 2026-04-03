import { useMemo } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import {
  buildFilesTouched,
  countLiveSessions,
  selectRecentSessions,
  sumSessionEdits,
} from './projectViewState.js';

/**
 * Session-related derived data: recent sessions, edit counts, files touched.
 */
export default function useProjectSessions() {
  const contextData = usePollingStore((s) => s.contextData);

  const allSessions = useMemo(
    () => selectRecentSessions(contextData?.recentSessions || contextData?.sessions || []),
    [contextData],
  );
  const sessions = allSessions.slice(0, 8);
  const filesTouched = useMemo(() => buildFilesTouched(allSessions), [allSessions]);
  const sessionEditCount = useMemo(() => sumSessionEdits(allSessions), [allSessions]);
  const filesTouchedCount = filesTouched.length;
  const liveSessionCount = useMemo(() => countLiveSessions(allSessions), [allSessions]);

  return {
    allSessions,
    sessions,
    filesTouched,
    filesTouchedCount,
    sessionEditCount,
    liveSessionCount,
  };
}

import { useState, useEffect, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore, authActions } from './lib/stores/auth.js';
import { useTeamStore, teamActions } from './lib/stores/teams.js';
import {
  usePollingStore,
  startPolling,
  stopPolling,
  resetPollingState,
  forceRefresh,
} from './lib/stores/polling.js';
import { formatRelativeTime } from './lib/relativeTime.js';
import { getErrorMessage } from './lib/errorHelpers.js';
import { useRoute, parseLocation, type Route } from './lib/router.js';

import ConnectView from './views/ConnectView/ConnectView.js';
import OverviewView from './views/OverviewView/OverviewView.js';
import ProjectView from './views/ProjectView/ProjectView.js';
import SettingsView from './views/SettingsView/SettingsView.js';
import ToolsView from './views/ToolsView/ToolsView.js';
import Sidebar from './components/Sidebar/Sidebar.js';
import Banner from './components/Banner/Banner.js';
import RenderErrorBoundary from './components/RenderErrorBoundary/RenderErrorBoundary.js';

import styles from './App.module.css';

type BootState = 'loading' | 'ready' | 'unauthenticated';

interface SidebarFallbackProps {
  reset: () => void;
}

/** Sidebar-specific fallback used by the shared error boundary. */
function SidebarFallback({ reset }: SidebarFallbackProps): ReactNode {
  return (
    <aside className={styles.sidebarFallback}>
      <svg width="36" height="36" viewBox="0 0 32 32" className={styles.sidebarFallbackIcon}>
        <path fill="#d49aae" d="M4 24 20 24 24 20 8 20z" />
        <path fill="#a896d4" d="M6 18 22 18 26 14 10 14z" />
        <path fill="#8ec0a4" d="M8 12 24 12 28 8 12 8z" />
      </svg>
      <button onClick={reset} className={styles.sidebarFallbackBtn}>
        Reload sidebar
      </button>
    </aside>
  );
}

export default function App(): ReactNode {
  const [bootCompleted, setBootCompleted] = useState<boolean>(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const route = useRoute();

  const { token, user } = useAuthStore(
    useShallow((s) => ({
      token: s.token,
      user: s.user,
    })),
  );
  const {
    dashboardData,
    dashboardStatus,
    contextData,
    contextStatus,
    contextTeamId,
    pollError,
    lastUpdate,
  } = usePollingStore(
    useShallow((s) => ({
      dashboardData: s.dashboardData,
      dashboardStatus: s.dashboardStatus,
      contextData: s.contextData,
      contextStatus: s.contextStatus,
      contextTeamId: s.contextTeamId,
      pollError: s.pollError,
      lastUpdate: s.lastUpdate,
    })),
  );
  const activeTeamId = useTeamStore((s) => s.activeTeamId);

  const isAuthenticated = !!token && !!user;
  const hasOverviewSnapshot =
    activeTeamId === null && dashboardStatus === 'stale' && !!dashboardData;
  const hasProjectSnapshot =
    activeTeamId !== null &&
    contextStatus === 'stale' &&
    contextTeamId === activeTeamId &&
    !!contextData;
  const errorDismissed = pollError && dismissedError === pollError;
  const showError = pollError && !errorDismissed && (hasOverviewSnapshot || hasProjectSnapshot);
  const lastSynced = formatRelativeTime(lastUpdate);

  // Derive boot state — no effect sync needed
  const bootState: BootState = !bootCompleted
    ? 'loading'
    : isAuthenticated
      ? 'ready'
      : 'unauthenticated';

  // Reset polling data when auth drops (external store action, not setState)
  useEffect(() => {
    if (bootCompleted && !isAuthenticated) resetPollingState();
  }, [bootCompleted, isAuthenticated]);

  useEffect(() => {
    if (bootState === 'ready' && isAuthenticated) {
      startPolling();
    }
  }, [activeTeamId, bootState, isAuthenticated]);

  useEffect(() => {
    async function boot(): Promise<void> {
      setBootError(null);
      let t = authActions.readTokenFromHash();
      // Clean up non-token hash params (e.g. github_linked=1)
      if (!t && window.location.hash) {
        history.replaceState(null, '', window.location.pathname);
      }
      if (!t) t = authActions.getStoredToken();
      if (!t) {
        setBootCompleted(true);
        return;
      }
      try {
        await authActions.authenticate(t);
        await teamActions.loadTeams();
        // If URL specifies a project, select that team on boot
        const initial = parseLocation();
        if (initial.view === 'project' && initial.teamId) {
          teamActions.selectTeam(initial.teamId);
        }
      } catch (err) {
        setBootError(getErrorMessage(err, 'Authentication failed'));
      }
      setBootCompleted(true);
    }
    boot();
    return () => stopPolling();
  }, []);

  // Sync team store with URL: if URL says project/:id, select that team
  useEffect(() => {
    if (!bootCompleted || !isAuthenticated) return;
    if (route.view === 'project' && route.teamId && route.teamId !== activeTeamId) {
      teamActions.selectTeam(route.teamId);
    } else if (route.view !== 'project' && activeTeamId !== null) {
      teamActions.selectTeam(null);
    }
  }, [route.view, route.teamId, activeTeamId, bootCompleted, isAuthenticated]);

  const activeView: Route['view'] =
    route.view === 'project' && !route.teamId
      ? activeTeamId
        ? 'project'
        : 'overview'
      : route.view;

  if (bootState === 'loading') {
    return (
      <div className={styles.bootScreen}>
        <div className={styles.bootSpinner}>
          <svg className={styles.spinnerMark} width="48" height="48" viewBox="0 0 32 32">
            <path className={styles.chevron1} fill="#8ec0a4" d="M8 12 24 12 28 8 12 8z" />
            <path className={styles.chevron2} fill="#a896d4" d="M6 18 22 18 26 14 10 14z" />
            <path className={styles.chevron3} fill="#d49aae" d="M4 24 20 24 24 20 8 20z" />
          </svg>
          <span className={styles.bootBrand}>chinwag</span>
        </div>
      </div>
    );
  }

  if (bootState === 'unauthenticated') {
    return <ConnectView error={bootError} />;
  }

  return (
    <div className={styles.layout}>
      <RenderErrorBoundary label="Sidebar" fallback={SidebarFallback}>
        <Sidebar activeView={activeView} />
      </RenderErrorBoundary>

      <div className={styles.main}>
        {showError && (
          <div className={styles.bannerSlot}>
            <Banner
              variant="error"
              eyebrow="Live sync paused"
              meta={
                lastSynced
                  ? `Showing the last successful snapshot from ${lastSynced}.`
                  : 'Showing the last successful snapshot.'
              }
              actions={[{ label: 'Retry', onClick: forceRefresh }]}
              onDismiss={() => setDismissedError(pollError)}
            >
              {pollError}
            </Banner>
          </div>
        )}

        <div className={styles.content}>
          {activeView === 'overview' && (
            <RenderErrorBoundary label="OverviewView" resetKey={activeView}>
              <OverviewView />
            </RenderErrorBoundary>
          )}
          {activeView === 'project' && (
            <RenderErrorBoundary label="ProjectView" resetKey={`project-${activeTeamId}`}>
              <ProjectView />
            </RenderErrorBoundary>
          )}
          {activeView === 'tools' && (
            <RenderErrorBoundary label="ToolsView" resetKey={activeView}>
              <ToolsView />
            </RenderErrorBoundary>
          )}
          {activeView === 'settings' && (
            <RenderErrorBoundary label="SettingsView" resetKey={activeView}>
              <SettingsView />
            </RenderErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}

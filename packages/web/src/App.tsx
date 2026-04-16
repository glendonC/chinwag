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
  injectDemoData,
} from './lib/stores/polling.js';
import { getErrorMessage } from './lib/errorHelpers.js';
import { useRoute, parseLocation, type Route } from './lib/router.js';
import { isDemoMode } from './lib/demoData.js';

import ConnectView from './views/ConnectView/ConnectView.js';
import OverviewView from './views/OverviewView/OverviewView.js';
import ProjectView from './views/ProjectView/ProjectView.js';
import SettingsView from './views/SettingsView/SettingsView.js';
import ToolsView from './views/ToolsView/ToolsView.js';
import GlobalView from './views/GlobalView/GlobalView.js';
import ReportsView from './views/ReportsView/ReportsView.js';
import Sidebar from './components/Sidebar/Sidebar.js';
import Banner from './components/Banner/Banner.js';
import RenderErrorBoundary from './components/RenderErrorBoundary/RenderErrorBoundary.js';

import styles from './App.module.css';

type BootState = 'loading' | 'ready' | 'unauthenticated';
const SIDEBAR_COLLAPSE_STORAGE_KEY = 'chinwag:sidebar-collapsed-v1';

function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Default to collapsed (stored '0' means explicitly expanded)
    return localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readSidebarCollapsed());
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
    consecutiveFailures,
    lastUpdate,
  } = usePollingStore(
    useShallow((s) => ({
      dashboardData: s.dashboardData,
      dashboardStatus: s.dashboardStatus,
      contextData: s.contextData,
      contextStatus: s.contextStatus,
      contextTeamId: s.contextTeamId,
      pollError: s.pollError,
      consecutiveFailures: s.consecutiveFailures,
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
  // Only show after 2+ consecutive failures — prevents flicker during dev server restarts
  const showError =
    pollError &&
    !errorDismissed &&
    consecutiveFailures >= 2 &&
    (hasOverviewSnapshot || hasProjectSnapshot);
  // Derive boot state — no effect sync needed
  const demo = isDemoMode();
  const bootState: BootState = !bootCompleted
    ? 'loading'
    : isAuthenticated || demo
      ? 'ready'
      : 'unauthenticated';

  // Reset polling data when auth drops (external store action, not setState)
  useEffect(() => {
    if (bootCompleted && !isAuthenticated && !demo) resetPollingState();
  }, [bootCompleted, isAuthenticated, demo]);

  useEffect(() => {
    try {
      // Store '0' for expanded (collapsed is the default)
      if (sidebarCollapsed) {
        localStorage.removeItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
      } else {
        localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, '0');
      }
    } catch {
      // Ignore storage failures; collapse state still works for this session.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (bootState === 'ready' && isAuthenticated && !demo) {
      startPolling();
    }
  }, [activeTeamId, bootState, isAuthenticated, demo]);

  useEffect(() => {
    async function boot(): Promise<void> {
      setBootError(null);

      // Demo mode: bypass auth, inject synthetic data
      if (isDemoMode()) {
        const { createDemoContext, DEMO_TEAMS } = await import('./lib/demoData.js');
        const demoTeamId = DEMO_TEAMS[0].team_id;
        teamActions.setDemoTeams(
          DEMO_TEAMS as Array<{ team_id: string; team_name?: string }>,
          demoTeamId,
        );
        injectDemoData(demoTeamId, createDemoContext());
        // Navigate to the project view so the memory tab is accessible
        history.replaceState(null, '', `/dashboard/project/${demoTeamId}?demo=1`);
        setBootCompleted(true);
        return;
      }

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
    if (!bootCompleted || (!isAuthenticated && !demo)) return;
    if (route.view === 'project' && route.teamId && route.teamId !== activeTeamId) {
      teamActions.selectTeam(route.teamId);
    } else if (route.view !== 'project' && activeTeamId !== null) {
      teamActions.selectTeam(null);
    }
  }, [route.view, route.teamId, activeTeamId, bootCompleted, isAuthenticated, demo]);

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
    <div
      className={sidebarCollapsed ? `${styles.layout} ${styles.layoutCollapsed}` : styles.layout}
    >
      <RenderErrorBoundary label="Sidebar" fallback={SidebarFallback}>
        <Sidebar
          activeView={activeView}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
        />
      </RenderErrorBoundary>

      <div className={styles.main}>
        {showError && (
          <div className={styles.bannerSlot}>
            <Banner
              variant="error"
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
          {activeView === 'tools' && (
            <RenderErrorBoundary label="ToolsView" resetKey={activeView}>
              <ToolsView />
            </RenderErrorBoundary>
          )}
          {activeView === 'project' && (
            <RenderErrorBoundary label="ProjectView" resetKey={`project-${activeTeamId}`}>
              <ProjectView />
            </RenderErrorBoundary>
          )}
          {activeView === 'global' && (
            <RenderErrorBoundary label="GlobalView" resetKey={activeView}>
              <GlobalView />
            </RenderErrorBoundary>
          )}
          {activeView === 'reports' && (
            <RenderErrorBoundary label="ReportsView" resetKey={activeView}>
              <ReportsView />
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

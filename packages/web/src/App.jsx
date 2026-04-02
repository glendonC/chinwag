import { useState, useEffect } from 'react';
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

import ConnectView from './views/ConnectView/ConnectView.jsx';
import OverviewView from './views/OverviewView/OverviewView.jsx';
import ProjectView from './views/ProjectView/ProjectView.jsx';
import SettingsView from './views/SettingsView/SettingsView.jsx';
import ToolsView from './views/ToolsView/ToolsView.jsx';
import Sidebar from './components/Sidebar/Sidebar.jsx';
import RenderErrorBoundary from './components/RenderErrorBoundary/RenderErrorBoundary.jsx';

import styles from './App.module.css';

/** Sidebar-specific fallback used by the shared error boundary. */
function SidebarFallback({ reset }) {
  return (
    <aside
      style={{
        width: 'var(--sidebar-width, 216px)',
        padding: '18px 0 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <svg width="36" height="36" viewBox="0 0 32 32" style={{ marginBottom: '14px' }}>
        <path fill="#d49aae" d="M4 24 20 24 24 20 8 20z" />
        <path fill="#a896d4" d="M6 18 22 18 26 14 10 14z" />
        <path fill="#8ec0a4" d="M8 12 24 12 28 8 12 8z" />
      </svg>
      <button
        onClick={reset}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--muted, #888)',
          fontFamily: 'var(--mono, monospace)',
          fontSize: '10px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          padding: '4px 8px',
        }}
      >
        Reload sidebar
      </button>
    </aside>
  );
}

export default function App() {
  const [bootCompleted, setBootCompleted] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [dismissedError, setDismissedError] = useState(null);
  const [activeNav, setActiveNav] = useState(null);

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const dashboardData = usePollingStore((s) => s.dashboardData);
  const dashboardStatus = usePollingStore((s) => s.dashboardStatus);
  const contextData = usePollingStore((s) => s.contextData);
  const contextStatus = usePollingStore((s) => s.contextStatus);
  const contextTeamId = usePollingStore((s) => s.contextTeamId);
  const pollError = usePollingStore((s) => s.pollError);
  const lastUpdate = usePollingStore((s) => s.lastUpdate);
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
  const bootState = !bootCompleted ? 'loading' : isAuthenticated ? 'ready' : 'unauthenticated';

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
    async function boot() {
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
      } catch (err) {
        setBootError(err.message || 'Authentication failed');
      }
      setBootCompleted(true);
    }
    boot();
    return () => stopPolling();
  }, []);

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

  const activeView = activeNav || (activeTeamId !== null ? 'project' : 'overview');

  return (
    <div className={styles.layout}>
      <RenderErrorBoundary label="Sidebar" fallback={SidebarFallback}>
        <Sidebar activeNav={activeNav} onNavigate={setActiveNav} />
      </RenderErrorBoundary>

      <div className={styles.main}>
        {showError && (
          <div className={styles.errorBanner} role="status" aria-live="polite">
            <div className={styles.errorCopy}>
              <span className={styles.errorEyebrow}>Live sync paused</span>
              <span className={styles.errorText}>{pollError}</span>
              <span className={styles.errorMeta}>
                {lastSynced
                  ? `Showing the last successful snapshot from ${lastSynced}.`
                  : 'Showing the last successful snapshot.'}
              </span>
            </div>

            <div className={styles.errorActions}>
              <button type="button" className={styles.errorRetry} onClick={forceRefresh}>
                Retry
              </button>
              <button
                className={styles.errorDismiss}
                onClick={() => setDismissedError(pollError)}
                aria-label="Dismiss"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M3 3l8 8M11 3l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div className={styles.content}>
          <RenderErrorBoundary label="App">
            {activeView === 'overview' && <OverviewView />}
            {activeView === 'project' && <ProjectView />}
            {activeView === 'tools' && <ToolsView />}
            {activeView === 'settings' && <SettingsView />}
          </RenderErrorBoundary>
        </div>
      </div>
    </div>
  );
}

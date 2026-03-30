import { useState, useEffect } from 'react';
import { useAuthStore, authActions } from './lib/stores/auth.js';
import { useTeamStore, teamActions } from './lib/stores/teams.js';
import { usePollingStore, startPolling, stopPolling, forceRefresh } from './lib/stores/polling.js';
import { formatRelativeTime } from './lib/relativeTime.js';

import ConnectView from './views/ConnectView/ConnectView.jsx';
import OverviewView from './views/OverviewView/OverviewView.jsx';
import ProjectView from './views/ProjectView/ProjectView.jsx';
import SettingsView from './views/SettingsView/SettingsView.jsx';
import ToolsView from './views/ToolsView/ToolsView.jsx';
import Sidebar from './components/Sidebar/Sidebar.jsx';

import styles from './App.module.css';

export default function App() {
  const [bootState, setBootState] = useState('loading');
  const [bootError, setBootError] = useState(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
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
  const hasOverviewSnapshot = activeTeamId === null && dashboardStatus === 'stale' && !!dashboardData;
  const hasProjectSnapshot = activeTeamId !== null
    && contextStatus === 'stale'
    && contextTeamId === activeTeamId
    && !!contextData;
  const showError = pollError && !errorDismissed && (hasOverviewSnapshot || hasProjectSnapshot);
  const lastSynced = formatRelativeTime(lastUpdate);

  useEffect(() => {
    if (pollError) setErrorDismissed(false);
  }, [pollError]);

  useEffect(() => {
    if (bootState === 'ready' && !isAuthenticated) {
      stopPolling();
      setBootState('unauthenticated');
    } else if (bootState === 'unauthenticated' && isAuthenticated) {
      setBootState('ready');
    }
  }, [bootState, isAuthenticated]);

  useEffect(() => {
    if (bootState === 'ready' && isAuthenticated) {
      startPolling();
    }
  }, [activeTeamId, bootState, isAuthenticated]);

  useEffect(() => {
    async function boot() {
      setBootState('loading');
      setBootError(null);
      let t = authActions.readTokenFromHash();
      if (!t) t = authActions.getStoredToken();
      if (!t) { setBootState('unauthenticated'); return; }
      try {
        await authActions.authenticate(t);
        await teamActions.loadTeams();
        setBootState('ready');
      } catch (err) {
        setBootError(err.message || 'Authentication failed');
        setBootState('unauthenticated');
      }
    }
    boot();
    return () => stopPolling();
  }, []);

  if (bootState === 'loading') {
    return (
      <div className={styles.bootScreen}>
        <div className={styles.bootSpinner}>
          <svg className={styles.spinnerMark} width="32" height="32" viewBox="0 0 32 32">
            <path fill="#d49aae" d="M4 24 20 24 24 20 8 20z" />
            <path fill="#a896d4" d="M6 18 22 18 26 14 10 14z" />
            <path fill="#8ec0a4" d="M8 12 24 12 28 8 12 8z" />
          </svg>
          <span className={styles.bootText}>Loading...</span>
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
      <Sidebar activeNav={activeNav} onNavigate={setActiveNav} />

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
              <button className={styles.errorDismiss} onClick={() => setErrorDismissed(true)} aria-label="Dismiss">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div className={styles.content}>
          {activeView === 'overview' && <OverviewView />}
          {activeView === 'project' && <ProjectView />}
          {activeView === 'tools' && <ToolsView />}
          {activeView === 'settings' && <SettingsView />}
        </div>
      </div>
    </div>
  );
}

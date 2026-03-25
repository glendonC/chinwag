import { useState, useEffect, useMemo } from 'react';
import { useAuthStore, authActions } from './lib/stores/auth.js';
import { useTeamStore, teamActions } from './lib/stores/teams.js';
import { usePollingStore, startPolling, stopPolling } from './lib/stores/polling.js';

import Sidebar from './components/Sidebar/Sidebar.jsx';
import TopBar from './components/TopBar/TopBar.jsx';
import ConnectView from './views/ConnectView/ConnectView.jsx';
import OverviewView from './views/OverviewView/OverviewView.jsx';
import ProjectView from './views/ProjectView/ProjectView.jsx';

import styles from './App.module.css';

export default function App() {
  const [bootState, setBootState] = useState('loading'); // 'loading' | 'unauthenticated' | 'ready'
  const [bootError, setBootError] = useState(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const pollError = usePollingStore((s) => s.pollError);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const overviewMode = activeTeamId === null;

  const isAuthenticated = !!token && !!user;

  const showError = pollError && !errorDismissed;

  // When pollError changes, reset dismissal
  useEffect(() => {
    if (pollError) setErrorDismissed(false);
  }, [pollError]);

  // React to auth state changes
  useEffect(() => {
    if (bootState === 'ready' && !isAuthenticated) {
      // User logged out
      stopPolling();
      setBootState('unauthenticated');
    } else if (bootState === 'unauthenticated' && isAuthenticated) {
      // User just connected via ConnectView
      setBootState('ready');
    }
  }, [bootState, isAuthenticated]);

  // Restart polling when active team changes
  useEffect(() => {
    if (bootState === 'ready' && isAuthenticated) {
      startPolling();
    }
  }, [activeTeamId, bootState, isAuthenticated]);

  // Boot sequence
  useEffect(() => {
    async function boot() {
      setBootState('loading');
      setBootError(null);

      // 1. Check URL hash for token
      let t = authActions.readTokenFromHash();

      // 2. Check sessionStorage
      if (!t) t = authActions.getStoredToken();

      // 3. No token found
      if (!t) {
        setBootState('unauthenticated');
        return;
      }

      // 4. Authenticate
      try {
        await authActions.authenticate(t);
        await teamActions.loadTeams();
        startPolling();
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
        <div className="page-gradients">
          <div className="gradient-blob gradient-blob--peach" />
          <div className="gradient-blob gradient-blob--lavender" />
          <div className="gradient-blob gradient-blob--sage" />
        </div>
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
    return (
      <>
        <div className="page-gradients">
          <div className="gradient-blob gradient-blob--peach" />
          <div className="gradient-blob gradient-blob--lavender" />
          <div className="gradient-blob gradient-blob--sage" />
        </div>
        <ConnectView error={bootError} />
      </>
    );
  }

  // Ready state — dashboard layout
  return (
    <>
      <div className="page-gradients">
        <div className="gradient-blob gradient-blob--peach" />
        <div className="gradient-blob gradient-blob--lavender" />
        <div className="gradient-blob gradient-blob--sage" />
      </div>
      <div className={styles.dashboardLayout}>
        <Sidebar />
        <div className={styles.mainArea}>
          <TopBar />
          {showError && (
            <div className={styles.errorBanner}>
              <span className={styles.errorText}>{pollError}</span>
              <button className={styles.errorDismiss} onClick={() => setErrorDismissed(true)} aria-label="Dismiss error">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
          <main className={styles.mainContent}>
            {overviewMode ? <OverviewView /> : <ProjectView />}
          </main>
        </div>
      </div>
    </>
  );
}

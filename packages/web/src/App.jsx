import { useState, useEffect } from 'react';
import { useAuthStore, authActions } from './lib/stores/auth.js';
import { useTeamStore, teamActions } from './lib/stores/teams.js';
import { usePollingStore, startPolling, stopPolling } from './lib/stores/polling.js';

import ConnectView from './views/ConnectView/ConnectView.jsx';
import OverviewView from './views/OverviewView/OverviewView.jsx';
import ProjectView from './views/ProjectView/ProjectView.jsx';
import SettingsView from './views/SettingsView/SettingsView.jsx';
import Sidebar from './components/Sidebar/Sidebar.jsx';

import styles from './App.module.css';

export default function App() {
  const [bootState, setBootState] = useState('loading');
  const [bootError, setBootError] = useState(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const pollError = usePollingStore((s) => s.pollError);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);

  const isAuthenticated = !!token && !!user;
  const showError = pollError && !errorDismissed;

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

  // ── Boot / unauth states ──
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

  // ── Derive active view ──
  const activeView = showSettings ? 'settings' : activeTeamId === null ? 'overview' : 'project';

  // ── Authenticated layout ──
  return (
    <div className={styles.layout}>
      <Sidebar showSettings={showSettings} onSelectSettings={setShowSettings} />

      <div className={styles.main}>
        {showError && (
          <div className={styles.errorBanner}>
            <span className={styles.errorText}>{pollError}</span>
            <button className={styles.errorDismiss} onClick={() => setErrorDismissed(true)} aria-label="Dismiss">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        <div className={styles.content}>
          {activeView === 'settings' && <SettingsView />}
          {activeView === 'overview' && <OverviewView />}
          {activeView === 'project' && <ProjectView />}
        </div>
      </div>
    </div>
  );
}

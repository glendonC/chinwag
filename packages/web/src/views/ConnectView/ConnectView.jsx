import { useState, useEffect } from 'react';
import { authActions } from '../../lib/stores/auth.js';
import { teamActions } from '../../lib/stores/teams.js';
import styles from './ConnectView.module.css';

export default function ConnectView({ error: initialError = null }) {
  const [tokenInput, setTokenInput] = useState('');
  const [connectError, setConnectError] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sync initial error from prop
  useEffect(() => {
    if (initialError) setConnectError(initialError);
  }, [initialError]);

  async function handleConnect() {
    const t = tokenInput.trim();
    if (!t) {
      setConnectError('Please enter a token.');
      return;
    }

    setConnecting(true);
    setConnectError(null);

    try {
      await authActions.authenticate(t);
      await teamActions.loadTeams();
      // App.jsx will react to isAuthenticated becoming true
    } catch (err) {
      setConnectError(err.message || 'Invalid token. Try generating a new one.');
    } finally {
      setConnecting(false);
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') handleConnect();
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText('npx chinwag dashboard');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available, ignore
    }
  }

  return (
    <div className={styles.connectScreen}>
      <div className={styles.connectCard}>
        {/* Logo */}
        <div className={styles.connectLogo}>
          <svg width="28" height="28" viewBox="0 0 32 32">
            <path fill="#d49aae" d="M4 24 20 24 24 20 8 20z" />
            <path fill="#a896d4" d="M6 18 22 18 26 14 10 14z" />
            <path fill="#8ec0a4" d="M8 12 24 12 28 8 12 8z" />
          </svg>
          <span className={styles.connectBrand}>chinwag</span>
        </div>

        <h1 className={styles.connectTitle}>Open your dashboard.</h1>
        <p className={styles.connectSubtitle}>Run this in a configured repo:</p>

        {/* Command box */}
        <button className={styles.commandBox} onClick={copyCommand} title="Copy to clipboard">
          <code className={styles.commandText}>
            <span className={styles.commandPrompt}>$</span> npx chinwag dashboard
          </code>
          <span className={styles.commandCopy}>
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7.5l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
                <path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            )}
          </span>
        </button>

        <details className={styles.tokenSection}>
          <summary className={styles.tokenToggle}>Use token</summary>
          <div className={styles.tokenForm}>
            <input
              type="password"
              className={styles.tokenInput}
              placeholder="Paste your auth token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={handleKeydown}
              autoComplete="off"
              spellCheck="false"
            />
            <button
              className={styles.tokenSubmit}
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
            {connectError && (
              <p className={styles.tokenError}>{connectError}</p>
            )}
          </div>
        </details>

        <a className={styles.connectPrivacy} href="/privacy.html" target="_blank" rel="noopener">Privacy</a>
      </div>
    </div>
  );
}

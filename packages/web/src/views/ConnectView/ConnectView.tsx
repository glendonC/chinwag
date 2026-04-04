import { useState, useEffect, type KeyboardEvent } from 'react';
import { authActions } from '../../lib/stores/auth.js';
import { teamActions } from '../../lib/stores/teams.js';
import { getApiUrl } from '../../lib/api.js';
import { getErrorMessage } from '../../lib/errorHelpers.js';
import styles from './ConnectView.module.css';

const GITHUB_ERROR_MAP: Record<string, string> = {
  github_denied: 'GitHub sign-in was cancelled.',
  github_invalid: 'Invalid response from GitHub. Try again.',
  github_expired: 'Sign-in session expired. Try again.',
  github_token_failed: 'Could not complete GitHub sign-in. Try again.',
  github_profile_failed: 'Could not fetch your GitHub profile. Try again.',
  github_already_linked: 'That GitHub account is already linked to another user.',
  rate_limited: 'Too many accounts created today. Try again tomorrow.',
  account_failed: 'Could not create your account. Try again.',
};

interface Props {
  error?: string | null;
}

function friendlyGithubError(code: string): string {
  return GITHUB_ERROR_MAP[code] || 'Something went wrong with GitHub sign-in. Try again.';
}

function friendlyError(msg: string | null | undefined): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('unauthorized'))
    return 'That token is invalid or expired. Generate a fresh one with npx chinwag token.';
  if (m.includes('timed out') || m.includes('timeout'))
    return 'Could not reach the server. Check your connection and try again.';
  if (m.includes('500') || m.includes('server error'))
    return 'Something went wrong on our end. Try again in a moment.';
  if (m.includes('fetch') || m.includes('network') || m.includes('econnrefused'))
    return 'Could not reach the server. Check your connection and try again.';
  return msg || 'Something went wrong. Try again.';
}

export default function ConnectView({ error: initialError = null }: Props) {
  const [tokenInput, setTokenInput] = useState<string>('');
  const [githubError, setGithubError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (initialError) setGithubError(friendlyError(initialError));
    const hash = window.location.hash;
    if (hash.includes('error=')) {
      const match = hash.match(/error=([^&]+)/);
      if (match) {
        setGithubError(friendlyGithubError(match[1]));
        history.replaceState(null, '', window.location.pathname);
      }
    }
  }, [initialError]);

  async function handleConnect(): Promise<void> {
    const t = tokenInput.trim();
    if (!t) return;

    setConnecting(true);
    setTokenError(null);

    try {
      await authActions.authenticate(t);
      await teamActions.loadTeams();
    } catch (err: unknown) {
      setTokenError(friendlyError(getErrorMessage(err)));
    } finally {
      setConnecting(false);
    }
  }

  function handleKeydown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') handleConnect();
  }

  async function copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText('npx chinwag dashboard');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }

  return (
    <div className={styles.connectScreen}>
      <section className={styles.brandSide}>
        <div className={styles.brandContent}>
          <div className={styles.brandMark}>
            <svg width="48" height="48" viewBox="0 0 32 32">
              <path fill="#d49aae" d="M4 24 20 24 24 20 8 20z" />
              <path fill="#a896d4" d="M6 18 22 18 26 14 10 14z" />
              <path fill="#8ec0a4" d="M8 12 24 12 28 8 12 8z" />
            </svg>
          </div>
          <h1 className={styles.brandHeadline}>The control layer for agentic development.</h1>
        </div>
      </section>

      <section className={styles.authSide}>
        <div className={styles.authContent}>
          <div className={styles.authBlock}>
            <span className={styles.eyebrow}>Connect</span>
            <h2 className={styles.authTitle}>Open your dashboard</h2>

            <a className={styles.githubButton} href={`${getApiUrl()}/auth/github`}>
              <svg
                className={styles.githubIcon}
                width="20"
                height="20"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Sign in with GitHub
            </a>

            {githubError && <p className={styles.githubError}>{githubError}</p>}
          </div>

          <div className={styles.dividerRow}>
            <span className={styles.dividerLine} />
            <span className={styles.dividerLabel}>or use the CLI</span>
            <span className={styles.dividerLine} />
          </div>

          <div className={styles.cliBlock}>
            <p className={styles.authHint}>Run this in any repo that uses chinwag:</p>

            <button className={styles.commandBox} onClick={copyCommand} title="Copy to clipboard">
              <code className={styles.commandText}>
                <span className={styles.commandPrompt}>$</span> npx chinwag dashboard
              </code>
              <span className={styles.commandCopy}>
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M3 7.5l2.5 2.5L11 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect
                      x="4.5"
                      y="4.5"
                      width="7"
                      height="7"
                      rx="1.5"
                      stroke="currentColor"
                      strokeWidth="1.1"
                    />
                    <path
                      d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5"
                      stroke="currentColor"
                      strokeWidth="1.1"
                    />
                  </svg>
                )}
              </span>
            </button>
          </div>

          <div className={styles.tokenBlock}>
            <p className={styles.tokenLabel}>
              Or paste a token from <code>npx chinwag token</code>
            </p>
            <div className={styles.tokenForm}>
              <input
                type="password"
                className={styles.tokenInput}
                placeholder="Auth token"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={handleKeydown}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className={styles.tokenSubmit}
                onClick={handleConnect}
                disabled={connecting || !tokenInput.trim()}
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
            {tokenError && <p className={styles.tokenError}>{tokenError}</p>}
          </div>
        </div>
      </section>

      <a className={styles.privacy} href="/privacy.html" target="_blank" rel="noopener">
        Privacy
      </a>
    </div>
  );
}

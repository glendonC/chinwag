import { useState, type KeyboardEvent, type CSSProperties } from 'react';
import clsx from 'clsx';
import { useAuthStore, authActions } from '../../lib/stores/auth.js';
import { stopPolling } from '../../lib/stores/polling.js';
import { api } from '../../lib/api.js';
import { COLOR_PALETTE, getColorHex } from '../../lib/utils.js';
import { useTheme } from '../../lib/useTheme.js';
import { getErrorMessage } from '../../lib/errorHelpers.js';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import styles from './SettingsView.module.css';

const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const GITHUB_REDIRECT_HOSTS = new Set(['github.com', 'www.github.com']);
const THEME_OPTIONS = ['system', 'light', 'dark'] as const;
type ThemePreference = (typeof THEME_OPTIONS)[number];

function isValidRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && GITHUB_REDIRECT_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isSafeImageUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function validateHandleInput(value: string): string | null {
  if (!value) return 'Handle is required.';
  if (value.length < 3 || value.length > 20) return 'Handle must be 3-20 characters.';
  if (!HANDLE_PATTERN.test(value)) return 'Handle may use letters, numbers, and underscores only.';
  return null;
}

interface HandleFormState {
  editing: boolean;
  value: string;
  error: string | null;
  saving: boolean;
}

interface ColorFormState {
  saving: boolean;
  error: string | null;
  hovered: string | null;
}

interface Props {}

export default function SettingsView(_props: Props) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [handleForm, setHandleForm] = useState<HandleFormState>({
    editing: false,
    value: '',
    error: null,
    saving: false,
  });
  const [colorForm, setColorForm] = useState<ColorFormState>({
    saving: false,
    error: null,
    hovered: null,
  });
  const [unlinking, setUnlinking] = useState<boolean>(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();

  const previewColorName = colorForm.hovered || user?.color || 'white';
  const previewColor = getColorHex(previewColorName) || '#98989d';

  function startEditHandle(): void {
    setHandleForm({
      editing: true,
      value: user?.handle || '',
      error: null,
      saving: false,
    });
  }

  async function saveHandle(): Promise<void> {
    const val = handleForm.value.trim();
    if (!val || val === user?.handle) {
      setHandleForm((prev) => ({ ...prev, editing: false }));
      return;
    }
    const validationError = validateHandleInput(val);
    if (validationError) {
      setHandleForm((prev) => ({ ...prev, error: validationError }));
      return;
    }
    setHandleForm((prev) => ({ ...prev, saving: true, error: null }));
    try {
      await api('PUT', '/me/handle', { handle: val }, token);
      authActions.updateUser({ handle: val });
      setHandleForm((prev) => ({ ...prev, editing: false, saving: false }));
    } catch (err: unknown) {
      setHandleForm((prev) => ({
        ...prev,
        error: getErrorMessage(err, 'Update failed'),
        saving: false,
      }));
    }
  }

  function handleHandleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') saveHandle();
    if (e.key === 'Escape') setHandleForm((prev) => ({ ...prev, editing: false }));
  }

  async function selectColor(colorName: string): Promise<void> {
    if (colorName === user?.color || colorForm.saving) return;
    setColorForm((prev) => ({ ...prev, saving: true, error: null }));
    try {
      await api('PUT', '/me/color', { color: colorName }, token);
      authActions.updateUser({ color: colorName });
    } catch (err: unknown) {
      setColorForm((prev) => ({
        ...prev,
        error: getErrorMessage(err, 'Could not update color'),
      }));
    } finally {
      setColorForm((prev) => ({ ...prev, saving: false }));
    }
  }

  async function handleGithubLink(): Promise<void> {
    setLinkError(null);
    try {
      const result = await api<{ url?: string }>('POST', '/auth/github/link', null, token);
      if (typeof result?.url !== 'string' || !isValidRedirectUrl(result.url)) {
        throw new Error('Received an invalid GitHub link response');
      }
      window.location.href = result.url;
    } catch (err: unknown) {
      setLinkError(getErrorMessage(err, 'Could not start GitHub linking'));
    }
  }

  async function handleGithubUnlink(): Promise<void> {
    setUnlinking(true);
    setLinkError(null);
    try {
      await api('PUT', '/me/github', { action: 'unlink' }, token);
      authActions.updateUser({ github_id: null, github_login: null, avatar_url: null });
    } catch (err: unknown) {
      setLinkError(getErrorMessage(err, 'Could not unlink GitHub'));
    } finally {
      setUnlinking(false);
    }
  }

  function handleLogout(): void {
    stopPolling();
    authActions.logout();
  }

  return (
    <div className={styles.page} style={{ '--preview-color': previewColor } as CSSProperties}>
      <ViewHeader eyebrow="Configure" title="Settings" />

      <section className={styles.identitySection}>
        <span className={styles.sectionLabel}>Identity</span>

        <div className={styles.handleSection}>
          {handleForm.editing ? (
            <div className={styles.handleEditor}>
              <div className={styles.handleEditorRow}>
                <input
                  className={styles.handleInput}
                  value={handleForm.value}
                  onChange={(e) => setHandleForm((prev) => ({ ...prev, value: e.target.value }))}
                  onKeyDown={handleHandleKeyDown}
                  maxLength={20}
                  autoFocus
                  disabled={handleForm.saving}
                  placeholder="3-20 chars"
                />
                <button
                  className={clsx(styles.actionButton, styles.actionButtonPrimary)}
                  onClick={saveHandle}
                  disabled={handleForm.saving}
                >
                  {handleForm.saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  className={styles.actionButton}
                  onClick={() => setHandleForm((prev) => ({ ...prev, editing: false }))}
                  disabled={handleForm.saving}
                >
                  Cancel
                </button>
              </div>
              {handleForm.error ? (
                <span className={styles.handleError}>{handleForm.error}</span>
              ) : null}
            </div>
          ) : (
            <button
              className={styles.handleButton}
              onClick={startEditHandle}
              aria-label="Edit handle"
            >
              <span className={styles.handleValue}>{user?.handle || 'Unknown user'}</span>
              <span className={styles.handleAction}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M11.5 1.5l3 3L5 14H2v-3z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Edit</span>
              </span>
            </button>
          )}
        </div>

        <div className={styles.colorSection}>
          <span className={styles.sectionLabel}>Color</span>
          <div className={styles.colorPicker}>
            {COLOR_PALETTE.map((color) => {
              const isCurrent = user?.color === color.name;
              const isPreview = previewColorName === color.name;
              return (
                <button
                  key={color.name}
                  className={clsx(
                    styles.colorDot,
                    isCurrent && styles.colorDotCurrent,
                    isPreview && styles.colorDotPreview,
                  )}
                  style={{ '--dot-color': color.hex } as CSSProperties}
                  onClick={() => selectColor(color.name)}
                  onMouseEnter={() => setColorForm((prev) => ({ ...prev, hovered: color.name }))}
                  onMouseLeave={() => setColorForm((prev) => ({ ...prev, hovered: null }))}
                  onFocus={() => setColorForm((prev) => ({ ...prev, hovered: color.name }))}
                  onBlur={() => setColorForm((prev) => ({ ...prev, hovered: null }))}
                  disabled={colorForm.saving}
                  title={color.name}
                  aria-label={`Select ${color.name}`}
                />
              );
            })}
          </div>
          {colorForm.error && <span className={styles.handleError}>{colorForm.error}</span>}
        </div>
      </section>

      <section className={styles.appearanceSection}>
        <span className={styles.sectionLabel}>Appearance</span>
        <div className={styles.themeToggle}>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option}
              className={clsx(styles.themeOption, theme === option && styles.themeOptionActive)}
              onClick={() => setTheme(option as ThemePreference)}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.githubSection}>
        <span className={styles.sectionLabel}>GitHub</span>

        {user?.github_login ? (
          <div className={styles.githubConnected}>
            <div className={styles.githubIdentity}>
              {user.avatar_url && isSafeImageUrl(user.avatar_url) && (
                <img
                  src={user.avatar_url}
                  alt={`${user.github_login}'s avatar`}
                  className={styles.githubAvatar}
                />
              )}
              <span className={styles.githubLogin}>{user.github_login}</span>
              <span className={styles.githubBadge}>Connected</span>
            </div>
            <button
              className={styles.githubUnlink}
              onClick={handleGithubUnlink}
              disabled={unlinking}
            >
              {unlinking ? 'Unlinking...' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <button className={styles.githubLinkButton} onClick={handleGithubLink}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Connect GitHub
          </button>
        )}

        {linkError && <p className={styles.linkError}>{linkError}</p>}
      </section>

      <button className={styles.signoutBtn} onClick={handleLogout}>
        Sign out
      </button>
    </div>
  );
}

import { useState } from 'react';
import { useAuthStore, authActions } from '../../lib/stores/auth.js';
import { stopPolling } from '../../lib/stores/polling.js';
import { api, getApiUrl } from '../../lib/api.js';
import { COLOR_PALETTE, getColorHex } from '../../lib/utils.js';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import styles from './SettingsView.module.css';

export default function SettingsView() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [editingHandle, setEditingHandle] = useState(false);
  const [handleValue, setHandleValue] = useState('');
  const [handleError, setHandleError] = useState(null);
  const [handleSaving, setHandleSaving] = useState(false);
  const [colorSaving, setColorSaving] = useState(false);
  const [colorError, setColorError] = useState(null);
  const [hoveredColor, setHoveredColor] = useState(null);
  const [unlinking, setUnlinking] = useState(false);
  const [linkError, setLinkError] = useState(null);

  const previewColorName = hoveredColor || user?.color || 'white';
  const previewColor = getColorHex(previewColorName) || '#98989d';

  function startEditHandle() {
    setHandleValue(user?.handle || '');
    setHandleError(null);
    setEditingHandle(true);
  }

  async function saveHandle() {
    const val = handleValue.trim();
    if (!val || val === user?.handle) { setEditingHandle(false); return; }
    setHandleSaving(true);
    setHandleError(null);
    try {
      await api('PUT', '/me/handle', { handle: val }, token);
      authActions.updateUser({ handle: val });
      setEditingHandle(false);
    } catch (err) {
      setHandleError(err.message || 'Update failed');
    } finally {
      setHandleSaving(false);
    }
  }

  function handleHandleKeyDown(e) {
    if (e.key === 'Enter') saveHandle();
    if (e.key === 'Escape') setEditingHandle(false);
  }

  async function selectColor(colorName) {
    if (colorName === user?.color || colorSaving) return;
    setColorSaving(true);
    setColorError(null);
    try {
      await api('PUT', '/me/color', { color: colorName }, token);
      authActions.updateUser({ color: colorName });
    } catch (err) {
      setColorError(err.message || 'Could not update color');
    } finally {
      setColorSaving(false);
    }
  }

  async function handleGithubLink() {
    setLinkError(null);
    try {
      const result = await api('POST', '/auth/github/link', null, token);
      if (result.url) window.location.href = result.url;
    } catch (err) {
      setLinkError(err.message || 'Could not start GitHub linking');
    }
  }

  async function handleGithubUnlink() {
    setUnlinking(true);
    setLinkError(null);
    try {
      await api('PUT', '/me/github', { action: 'unlink' }, token);
      authActions.updateUser({ github_id: null, github_login: null, avatar_url: null });
    } catch (err) {
      setLinkError(err.message || 'Could not unlink GitHub');
    } finally {
      setUnlinking(false);
    }
  }

  function handleLogout() {
    stopPolling();
    try { authActions.logout(); } catch {}
  }

  return (
    <div className={styles.page} style={{ '--preview-color': previewColor }}>
      <ViewHeader eyebrow="Configure" title="Settings" />

      <section className={styles.identitySection}>
        <span className={styles.sectionLabel}>Identity</span>

        <div className={styles.handleSection}>
          {editingHandle ? (
            <div className={styles.handleEditor}>
              <div className={styles.handleEditorRow}>
                <input
                  className={styles.handleInput}
                  value={handleValue}
                  onChange={(e) => setHandleValue(e.target.value)}
                  onKeyDown={handleHandleKeyDown}
                  maxLength={20}
                  autoFocus
                  disabled={handleSaving}
                  placeholder="3-20 chars"
                />
                <button className={`${styles.actionButton} ${styles.actionButtonPrimary}`} onClick={saveHandle} disabled={handleSaving}>
                  {handleSaving ? 'Saving...' : 'Save'}
                </button>
                <button className={styles.actionButton} onClick={() => setEditingHandle(false)} disabled={handleSaving}>
                  Cancel
                </button>
              </div>
              {handleError ? <span className={styles.handleError}>{handleError}</span> : null}
            </div>
          ) : (
            <button className={styles.handleButton} onClick={startEditHandle} aria-label="Edit handle">
              <span className={styles.handleValue}>{user?.handle || 'Unknown user'}</span>
              <span className={styles.handleAction}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M11.5 1.5l3 3L5 14H2v-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
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
                className={`${styles.colorDot} ${isCurrent ? styles.colorDotCurrent : ''} ${isPreview ? styles.colorDotPreview : ''}`}
                style={{ '--dot-color': color.hex }}
                onClick={() => selectColor(color.name)}
                onMouseEnter={() => setHoveredColor(color.name)}
                onMouseLeave={() => setHoveredColor(null)}
                onFocus={() => setHoveredColor(color.name)}
                onBlur={() => setHoveredColor(null)}
                disabled={colorSaving}
                title={color.name}
                aria-label={`Select ${color.name}`}
              />
              );
            })}
          </div>
          {colorError && <span className={styles.handleError}>{colorError}</span>}
        </div>
      </section>

      <section className={styles.githubSection}>
        <span className={styles.sectionLabel}>GitHub</span>

        {user?.github_login ? (
          <div className={styles.githubConnected}>
            <div className={styles.githubIdentity}>
              {user.avatar_url && (
                <img src={user.avatar_url} alt="" className={styles.githubAvatar} />
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

import { useState } from 'react';
import { useAuthStore, authActions } from '../../lib/stores/auth.js';
import { stopPolling } from '../../lib/stores/polling.js';
import { api } from '../../lib/api.js';
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
  const [hoveredColor, setHoveredColor] = useState(null);

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
    try {
      await api('PUT', '/me/color', { color: colorName }, token);
      authActions.updateUser({ color: colorName });
    } catch {} finally {
      setColorSaving(false);
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
        </div>
      </section>

      <button className={styles.signoutBtn} onClick={handleLogout}>
        Sign out
      </button>
    </div>
  );
}

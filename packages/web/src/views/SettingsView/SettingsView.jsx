import { useState } from 'react';
import { useAuthStore, authActions } from '../../lib/stores/auth.js';
import { stopPolling } from '../../lib/stores/polling.js';
import { api } from '../../lib/api.js';
import { COLOR_PALETTE } from '../../lib/utils.js';
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
    <div className={styles.page}>
      <ViewHeader
        eyebrow="Settings"
        title="Settings"
      />

      <div className={styles.profilePreview}>
        <span
          className={styles.profileSwatch}
          style={{ background: COLOR_PALETTE.find((entry) => entry.name === user?.color)?.hex || '#98989d' }}
        />
        <div className={styles.profileCopy}>
          <strong className={styles.profileHandle}>{user?.handle || 'Unknown user'}</strong>
          <span className={styles.profileMeta}>Current account</span>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Account</h2>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Handle</span>
          {editingHandle ? (
            <div className={styles.fieldEdit}>
              <input
                className={styles.fieldInput}
                value={handleValue}
                onChange={(e) => setHandleValue(e.target.value)}
                onKeyDown={handleHandleKeyDown}
                maxLength={20}
                autoFocus
                disabled={handleSaving}
                placeholder="3-20 chars"
              />
              <button className={styles.btnSave} onClick={saveHandle} disabled={handleSaving}>
                {handleSaving ? '...' : 'Save'}
              </button>
              <button className={styles.btnCancel} onClick={() => setEditingHandle(false)} disabled={handleSaving}>
                Cancel
              </button>
              {handleError && <span className={styles.fieldError}>{handleError}</span>}
            </div>
          ) : (
            <div className={styles.fieldValueRow}>
              <span className={styles.fieldValue}>
                {user?.handle || '\u2014'}
              </span>
              <button className={styles.btnEdit} onClick={startEditHandle} aria-label="Edit handle">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M11.5 1.5l3 3L5 14H2v-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Color</span>
          <div className={styles.colorPicker}>
            {COLOR_PALETTE.map(c => (
              <button
                key={c.name}
                className={styles.colorDot}
                style={{
                  background: c.hex,
                  boxShadow: user?.color === c.name
                    ? `0 0 0 2px #fff, 0 0 0 4px ${c.hex}`
                    : undefined,
                }}
                onClick={() => selectColor(c.name)}
                disabled={colorSaving}
                title={c.name}
                aria-label={`Select ${c.name}`}
              />
            ))}
          </div>
        </div>

      </section>

      <section className={styles.section}>
        <button className={styles.signoutBtn} onClick={handleLogout}>
          Sign out
        </button>
      </section>
    </div>
  );
}

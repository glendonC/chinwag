import { useState } from 'react';
import { MEMORY_CATEGORIES } from '../../lib/utils.js';
import styles from './MemoryRow.module.css';

const CATEGORIES = [...MEMORY_CATEGORIES];

export default function MemoryRow({ memory, onUpdate, onDelete }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(memory.text);
  const [editCategory, setEditCategory] = useState(memory.category);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const tagStyle = MEMORY_CATEGORIES.has(memory.category)
    ? styles[`tag_${memory.category}`]
    : styles.tag_reference;

  function handleEdit() {
    setEditText(memory.text);
    setEditCategory(memory.category);
    setError(null);
    setIsEditing(true);
  }

  function handleCancel() {
    setIsEditing(false);
    setError(null);
  }

  async function handleSave() {
    if (!editText.trim()) return;
    const textChanged = editText !== memory.text;
    const catChanged = editCategory !== memory.category;
    if (!textChanged && !catChanged) { setIsEditing(false); return; }

    setSaving(true);
    setError(null);
    try {
      await onUpdate(
        memory.id,
        textChanged ? editText.trim() : undefined,
        catChanged ? editCategory : undefined,
      );
      setIsEditing(false);
    } catch (err) {
      setError(err.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setSaving(true);
    setError(null);
    try {
      await onDelete(memory.id);
    } catch (err) {
      setError(err.message || 'Delete failed');
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') handleCancel();
    if (e.key === 'Enter' && e.metaKey) handleSave();
  }

  if (isEditing) {
    return (
      <div className={styles.memoryRow} onKeyDown={handleKeyDown}>
        <div className={styles.editForm}>
          <div className={styles.editTop}>
            <select
              className={styles.editSelect}
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              disabled={saving}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <span className={styles.editAuthor}>{memory.source_handle}</span>
          </div>
          <textarea
            className={styles.editTextarea}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            maxLength={2000}
            rows={3}
            disabled={saving}
            autoFocus
          />
          {error && <span className={styles.editError}>{error}</span>}
          <div className={styles.editActions}>
            <button className={styles.btnSave} onClick={handleSave} disabled={saving || !editText.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button className={styles.btnCancel} onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.memoryRow}>
      <div className={styles.memoryContent}>
        <span className={`${styles.tag} ${tagStyle}`}>{memory.category}</span>
        <span className={styles.memoryText}>{memory.text}</span>
      </div>
      {(onUpdate || onDelete) && (
        <div className={styles.memoryActions}>
          {onUpdate && (
            <button className={styles.btnAction} onClick={handleEdit} title="Edit memory" aria-label="Edit memory">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M11.5 1.5l3 3L5 14H2v-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              className={`${styles.btnAction} ${confirmDelete ? styles.btnConfirmDelete : ''}`}
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
              title={confirmDelete ? 'Click again to confirm' : 'Delete memory'}
              aria-label={confirmDelete ? 'Confirm delete' : 'Delete memory'}
              disabled={saving}
            >
              {confirmDelete ? (
                <span className={styles.confirmText}>Delete?</span>
              ) : (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5M4 4l.8 9a1 1 0 001 .9h4.4a1 1 0 001-.9L12 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

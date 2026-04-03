import { useState, useCallback } from 'react';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { validateTags } from '../../lib/validateTags.js';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './MemoryRow.module.css';

/**
 * Mode state machine for MemoryRow.
 *
 * States: 'view' | 'editing' | 'confirming-delete' | 'saving'
 *
 * Transitions:
 *   view → editing           (startEdit)
 *   view → confirming-delete (requestDelete)
 *   editing → view           (cancelEdit)
 *   editing → saving         (save)
 *   confirming-delete → view (cancelDelete / blur)
 *   confirming-delete → saving (confirmDelete)
 *   saving → view            (save success / delete success)
 *   saving → editing         (save failure)
 *   saving → view            (delete failure, resets to view)
 */

export default function MemoryRow({ memory, onUpdate, onDelete }) {
  const [mode, setMode] = useState('view');
  const [editText, setEditText] = useState(memory.text);
  const [editTags, setEditTags] = useState((memory.tags || []).join(', '));
  const [error, setError] = useState(null);

  const saving = mode === 'saving';
  const isEditing = mode === 'editing' || mode === 'saving';
  const confirmDelete = mode === 'confirming-delete';

  const tags = memory.tags || [];
  const when = formatRelativeTime(memory.updated_at || memory.created_at);
  const rawTool = memory.host_tool;
  const toolMeta = rawTool && rawTool !== 'unknown' ? getToolMeta(rawTool) : null;
  const handle = memory.handle || null;
  const model = memory.agent_model || null;
  const accentColor = toolMeta?.color || 'var(--soft)';

  const startEdit = useCallback(() => {
    if (mode !== 'view') return;
    setEditText(memory.text);
    setEditTags((memory.tags || []).join(', '));
    setError(null);
    setMode('editing');
  }, [mode, memory.text, memory.tags]);

  const cancelEdit = useCallback(() => {
    if (mode !== 'editing') return;
    setError(null);
    setMode('view');
  }, [mode]);

  const requestDelete = useCallback(() => {
    if (mode !== 'view') return;
    setMode('confirming-delete');
  }, [mode]);

  const cancelDelete = useCallback(() => {
    if (mode !== 'confirming-delete') return;
    setMode('view');
  }, [mode]);

  const save = useCallback(async () => {
    if (mode !== 'editing') return;
    if (!editText.trim()) return;

    const { tags: newTags, error: tagError } = validateTags(editTags);
    if (tagError) {
      setError(tagError);
      return;
    }

    const textChanged = editText !== memory.text;
    const tagsChanged = JSON.stringify(newTags) !== JSON.stringify(memory.tags || []);
    if (!textChanged && !tagsChanged) {
      setMode('view');
      return;
    }

    setMode('saving');
    setError(null);
    try {
      await onUpdate(
        memory.id,
        textChanged ? editText.trim() : undefined,
        tagsChanged ? newTags : undefined,
      );
      setMode('view');
    } catch (err) {
      setError(err.message || 'Update failed');
      setMode('editing');
    }
  }, [mode, editText, editTags, memory.id, memory.text, memory.tags, onUpdate]);

  const confirmDeleteAction = useCallback(async () => {
    if (mode !== 'confirming-delete') return;
    setMode('saving');
    setError(null);
    try {
      await onDelete(memory.id);
      // Component will unmount on success — no state update needed
    } catch (err) {
      setError(err.message || 'Delete failed');
      setMode('view');
    }
  }, [mode, memory.id, onDelete]);

  function handleDeleteClick() {
    if (mode === 'view') {
      requestDelete();
    } else if (mode === 'confirming-delete') {
      confirmDeleteAction();
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') cancelEdit();
    if (e.key === 'Enter' && e.metaKey) save();
  }

  if (isEditing) {
    return (
      <div className={styles.row}>
        <div className={styles.accent} style={{ background: accentColor }} />
        <div className={styles.body} onKeyDown={handleKeyDown}>
          <div className={styles.editForm}>
            <input
              className={styles.editTagsInput}
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="Tags (comma-separated)"
              disabled={saving}
            />
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
            <div className={styles.editFooter}>
              <span className={styles.editAuthor}>{handle}</span>
              <div className={styles.editActions}>
                <button
                  className={styles.btnSave}
                  onClick={save}
                  disabled={saving || !editText.trim()}
                >
                  {saving ? 'Saving\u2026' : 'Save'}
                </button>
                <button className={styles.btnCancel} onClick={cancelEdit} disabled={saving}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <div className={styles.accent} style={{ background: accentColor }} />
      <div className={styles.body}>
        <div className={styles.text}>{memory.text}</div>

        <div className={styles.footer}>
          <div className={styles.source}>
            {toolMeta && (
              <>
                <ToolIcon tool={rawTool} size={14} />
                <span className={styles.toolLabel}>{toolMeta.label}</span>
              </>
            )}
            {model && (
              <>
                {toolMeta && <span className={styles.sep}>&middot;</span>}
                <span className={styles.modelLabel}>{model}</span>
              </>
            )}
            {handle && (
              <>
                {(toolMeta || model) && <span className={styles.sep}>&middot;</span>}
                <span>{handle}</span>
              </>
            )}
            {when && (
              <>
                <span className={styles.sep}>&middot;</span>
                <span>{when}</span>
              </>
            )}
            {tags.length > 0 && (
              <>
                <span className={styles.sep}>&middot;</span>
                {tags.map((t) => (
                  <span key={t} className={styles.tag}>
                    {t}
                  </span>
                ))}
              </>
            )}
          </div>

          {(onUpdate || onDelete) && (
            <div className={styles.actions}>
              {onUpdate && (
                <button className={styles.btnText} onClick={startEdit}>
                  Edit
                </button>
              )}
              {onDelete && (
                <>
                  <span className={styles.actionSep}>&middot;</span>
                  <button
                    className={confirmDelete ? styles.btnText : styles.btnDelete}
                    onClick={handleDeleteClick}
                    onBlur={cancelDelete}
                    disabled={saving}
                  >
                    {confirmDelete ? (
                      <span className={styles.confirmLabel}>Confirm?</span>
                    ) : (
                      'Delete'
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

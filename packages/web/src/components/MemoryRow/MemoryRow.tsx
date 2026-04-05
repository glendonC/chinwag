import { useReducer, useCallback } from 'react';
import type { Memory } from '../../lib/apiSchemas.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { validateTags } from '../../lib/validateTags.js';
import { getErrorMessage } from '../../lib/errorHelpers.js';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './MemoryRow.module.css';

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type Mode = 'view' | 'editing' | 'confirming-delete' | 'saving';

interface RowState {
  mode: Mode;
  editText: string;
  editTags: string;
  error: string | null;
}

type RowAction =
  | { type: 'START_EDIT'; text: string; tags: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'SET_TEXT'; value: string }
  | { type: 'SET_TAGS'; value: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'REQUEST_DELETE' }
  | { type: 'CANCEL_DELETE' }
  | { type: 'START_SAVE' }
  | { type: 'SAVE_SUCCESS' }
  | { type: 'SAVE_ERROR'; error: string }
  | { type: 'DELETE_SUCCESS' }
  | { type: 'DELETE_ERROR'; error: string };

export function rowReducer(state: RowState, action: RowAction): RowState {
  switch (action.type) {
    case 'START_EDIT':
      if (state.mode !== 'view') return state;
      return { mode: 'editing', editText: action.text, editTags: action.tags, error: null };

    case 'CANCEL_EDIT':
      if (state.mode !== 'editing') return state;
      return { ...state, mode: 'view', error: null };

    case 'SET_TEXT':
      if (state.mode !== 'editing') return state;
      return { ...state, editText: action.value };

    case 'SET_TAGS':
      if (state.mode !== 'editing') return state;
      return { ...state, editTags: action.value };

    case 'SET_ERROR':
      if (state.mode !== 'editing') return state;
      return { ...state, error: action.error };

    case 'REQUEST_DELETE':
      if (state.mode !== 'view') return state;
      return { ...state, mode: 'confirming-delete' };

    case 'CANCEL_DELETE':
      if (state.mode !== 'confirming-delete') return state;
      return { ...state, mode: 'view' };

    case 'START_SAVE':
      if (state.mode !== 'editing' && state.mode !== 'confirming-delete') return state;
      return { ...state, mode: 'saving', error: null };

    case 'SAVE_SUCCESS':
      if (state.mode !== 'saving') return state;
      return { ...state, mode: 'view' };

    case 'SAVE_ERROR':
      if (state.mode !== 'saving') return state;
      return { ...state, mode: 'editing', error: action.error };

    case 'DELETE_SUCCESS':
      // Component will unmount — keep current state
      return state;

    case 'DELETE_ERROR':
      if (state.mode !== 'saving') return state;
      return { ...state, mode: 'view', error: action.error };

    default:
      return state;
  }
}

export function initState(memory: Memory): RowState {
  return {
    mode: 'view',
    editText: memory.text,
    editTags: (memory.tags || []).join(', '),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  memory: Memory;
  onUpdate?: (id: string, text?: string, tags?: string[]) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export default function MemoryRow({ memory, onUpdate, onDelete }: Props) {
  const [state, dispatch] = useReducer(rowReducer, memory, initState);
  const { mode, editText, editTags, error } = state;

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
    dispatch({ type: 'START_EDIT', text: memory.text, tags: (memory.tags || []).join(', ') });
  }, [memory.text, memory.tags]);

  const cancelEdit = useCallback(() => {
    dispatch({ type: 'CANCEL_EDIT' });
  }, []);

  const requestDelete = useCallback(() => {
    dispatch({ type: 'REQUEST_DELETE' });
  }, []);

  const cancelDelete = useCallback(() => {
    dispatch({ type: 'CANCEL_DELETE' });
  }, []);

  const save = useCallback(async () => {
    if (mode !== 'editing') return;
    if (!editText.trim()) return;

    const { tags: newTags, error: tagError } = validateTags(editTags);
    if (tagError) {
      dispatch({ type: 'SET_ERROR', error: tagError });
      return;
    }

    const textChanged = editText !== memory.text;
    const tagsChanged = JSON.stringify(newTags) !== JSON.stringify(memory.tags || []);
    if (!textChanged && !tagsChanged) {
      dispatch({ type: 'CANCEL_EDIT' });
      return;
    }

    dispatch({ type: 'START_SAVE' });
    try {
      await onUpdate?.(
        memory.id,
        textChanged ? editText.trim() : undefined,
        tagsChanged ? newTags : undefined,
      );
      dispatch({ type: 'SAVE_SUCCESS' });
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: getErrorMessage(err, 'Update failed') });
    }
  }, [mode, editText, editTags, memory.id, memory.text, memory.tags, onUpdate]);

  const confirmDeleteAction = useCallback(async () => {
    if (mode !== 'confirming-delete') return;
    dispatch({ type: 'START_SAVE' });
    try {
      await onDelete?.(memory.id);
      dispatch({ type: 'DELETE_SUCCESS' });
      // Component will unmount on success — no meaningful state update needed
    } catch (err) {
      dispatch({ type: 'DELETE_ERROR', error: getErrorMessage(err, 'Delete failed') });
    }
  }, [mode, memory.id, onDelete]);

  function handleDeleteClick() {
    if (mode === 'view') {
      requestDelete();
    } else if (mode === 'confirming-delete') {
      confirmDeleteAction();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
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
              onChange={(e) => dispatch({ type: 'SET_TAGS', value: e.target.value })}
              placeholder="Tags (comma-separated)"
              aria-label="Tags (comma-separated)"
              disabled={saving}
            />
            <textarea
              className={styles.editTextarea}
              value={editText}
              onChange={(e) => dispatch({ type: 'SET_TEXT', value: e.target.value })}
              aria-label="Memory content"
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
                <ToolIcon tool={rawTool!} size={14} />
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

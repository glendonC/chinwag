import { useState, useCallback } from 'react';
import type { Memory } from '../../lib/apiSchemas.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { getErrorMessage } from '../../lib/errorHelpers.js';
import ToolIcon from '../ToolIcon/ToolIcon.jsx';
import styles from './MemoryRow.module.css';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  memory: Memory;
  onDelete?: (id: string) => Promise<void>;
}

export default function MemoryRow({ memory, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tags = memory.tags || [];
  const when = formatRelativeTime(memory.updated_at || memory.created_at);
  const rawTool = memory.host_tool;
  const toolMeta = rawTool && rawTool !== 'unknown' ? getToolMeta(rawTool) : null;
  const handle = memory.handle || null;
  const model = memory.agent_model || null;
  const accentColor = toolMeta?.color || 'var(--soft)';

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await onDelete?.(memory.id);
    } catch (err) {
      setError(getErrorMessage(err, 'Delete failed'));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [confirmDelete, memory.id, onDelete]);

  const cancelDelete = useCallback(() => {
    setConfirmDelete(false);
  }, []);

  const fullCreated = memory.created_at ? new Date(memory.created_at).toLocaleString() : null;
  const fullUpdated = memory.updated_at ? new Date(memory.updated_at).toLocaleString() : null;
  const lastAccessed = memory.last_accessed_at ? formatRelativeTime(memory.last_accessed_at) : null;

  return (
    <div className={styles.row}>
      <div className={styles.accent} style={{ background: accentColor }} />
      <div className={styles.body}>
        {/* Primary: always visible */}
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <div className={styles.text}>{memory.text}</div>

          <div className={styles.meta}>
            <div className={styles.source}>
              {toolMeta && (
                <>
                  <ToolIcon tool={rawTool!} size={13} />
                  <span className={styles.toolLabel}>{toolMeta.label}</span>
                </>
              )}
              {handle && (
                <>
                  {toolMeta && <span className={styles.sep}>&middot;</span>}
                  <span>{handle}</span>
                </>
              )}
              {when && (
                <>
                  <span className={styles.sep}>&middot;</span>
                  <span className={styles.time}>{when}</span>
                </>
              )}
            </div>

            {tags.length > 0 && (
              <div className={styles.cats}>
                {tags.slice(0, 3).map((t) => (
                  <span key={t} className={styles.tag}>
                    {t}
                  </span>
                ))}
                {tags.length > 3 && <span className={styles.catOverflow}>+{tags.length - 3}</span>}
              </div>
            )}
          </div>
        </button>

        {/* Detail: one click away */}
        {expanded && (
          <div className={styles.detail}>
            {/* Tags */}
            {tags.length > 0 && (
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Tags</span>
                <div className={styles.detailPills}>
                  {tags.map((t) => (
                    <span key={t} className={styles.tag}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Model */}
            {model && (
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Model</span>
                <span className={styles.detailValue}>{model}</span>
              </div>
            )}

            {/* Timestamps */}
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Created</span>
              <span className={styles.detailValue}>{fullCreated}</span>
              {fullUpdated && fullUpdated !== fullCreated && (
                <>
                  <span className={styles.sep}>&middot;</span>
                  <span className={styles.detailLabel}>Updated</span>
                  <span className={styles.detailValue}>{fullUpdated}</span>
                </>
              )}
              {lastAccessed && (
                <>
                  <span className={styles.sep}>&middot;</span>
                  <span className={styles.detailLabel}>Last read</span>
                  <span className={styles.detailValue}>{lastAccessed}</span>
                </>
              )}
            </div>

            {/* Actions */}
            {onDelete && (
              <div className={styles.detailActions}>
                {error && <span className={styles.detailError}>{error}</span>}
                <button
                  className={confirmDelete ? styles.btnDanger : styles.btnAction}
                  onClick={handleDelete}
                  onBlur={cancelDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting\u2026' : confirmDelete ? 'Confirm delete?' : 'Delete'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

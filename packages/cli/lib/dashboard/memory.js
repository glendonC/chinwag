import { useState, useRef } from 'react';
import { api } from '../api.js';

// ── Constants ───────────────────────────────────────
const DELETE_FEEDBACK_MS = 2000;

/**
 * Custom hook for memory management in the dashboard.
 * Handles memory selection, search, add, and delete operations.
 */
export function useMemoryManager({ config, teamId, bumpRefreshKey, flash }) {
  const [memorySelectedIdx, setMemorySelectedIdx] = useState(-1);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState(null);
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryInput, setMemoryInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const pendingSaveRef = useRef(Promise.resolve());

  function saveMemory(text) {
    if (!teamId || !text.trim()) return Promise.resolve();

    const doSave = async () => {
      setIsSaving(true);
      flash('Saving to shared memory\u2026', { tone: 'info' });
      try {
        await api(config).post(`/teams/${teamId}/memory`, { text: text.trim() });
        flash('Saved to shared memory', { tone: 'success' });
        bumpRefreshKey();
      } catch (err) {
        console.error('[chinwag] Could not save memory:', err?.message || err);
        flash('Could not save \u2014 check connection and try again', {
          tone: 'error',
          autoClearMs: 5000,
        });
        throw err; // re-throw so caller can preserve input
      } finally {
        setIsSaving(false);
      }
    };

    pendingSaveRef.current = pendingSaveRef.current.then(doSave, doSave);
    return pendingSaveRef.current;
  }

  function deleteMemoryItem(mem) {
    if (!mem?.id || !teamId) return;
    api(config)
      .del(`/teams/${teamId}/memory`, { id: mem.id })
      .then(() => {
        setDeleteMsg('Deleted');
        setDeleteConfirm(false);
        setMemorySelectedIdx(-1);
        bumpRefreshKey();
        setTimeout(() => setDeleteMsg(null), DELETE_FEEDBACK_MS);
      })
      .catch((err) => {
        console.error('[chinwag] Could not delete memory:', err?.message || err);
        flash('Could not delete — check connection and try again', {
          tone: 'error',
          autoClearMs: 5000,
        });
        setDeleteConfirm(false);
        setDeleteMsg(null);
      });
  }

  function resetMemorySelection() {
    setMemorySelectedIdx(-1);
    setDeleteConfirm(false);
  }

  const clearMemorySearch = () => setMemorySearch('');
  const clearMemoryInput = () => setMemoryInput('');

  function onMemorySubmit() {
    const savedText = memoryInput;
    setMemoryInput('');
    saveMemory(savedText).catch(() => {
      setMemoryInput(savedText); // restore on failure so user can retry
    });
  }

  return {
    memorySelectedIdx,
    setMemorySelectedIdx,
    deleteConfirm,
    setDeleteConfirm,
    deleteMsg,
    memorySearch,
    setMemorySearch,
    memoryInput,
    setMemoryInput,
    saveMemory,
    isSaving,
    deleteMemoryItem,
    resetMemorySelection,
    clearMemorySearch,
    clearMemoryInput,
    onMemorySubmit,
  };
}

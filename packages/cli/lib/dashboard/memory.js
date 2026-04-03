import { useState } from 'react';
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

  function saveMemory(text) {
    if (!teamId || !text.trim()) return;
    api(config)
      .post(`/teams/${teamId}/memory`, { text: text.trim() })
      .then(() => {
        flash('Saved to shared memory', { tone: 'success' });
        bumpRefreshKey();
      })
      .catch((err) => {
        console.error('[chinwag] Could not save memory:', err?.message || err);
        flash('Could not save memory. Check connection.', { tone: 'error' });
      });
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
        setDeleteMsg('Could not delete.');
        setDeleteConfirm(false);
        setTimeout(() => setDeleteMsg(null), DELETE_FEEDBACK_MS);
      });
  }

  function resetMemorySelection() {
    setMemorySelectedIdx(-1);
    setDeleteConfirm(false);
  }

  const clearMemorySearch = () => setMemorySearch('');
  const clearMemoryInput = () => setMemoryInput('');

  function onMemorySubmit() {
    saveMemory(memoryInput);
    setMemoryInput('');
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
    deleteMemoryItem,
    resetMemorySelection,
    clearMemorySearch,
    clearMemoryInput,
    onMemorySubmit,
  };
}

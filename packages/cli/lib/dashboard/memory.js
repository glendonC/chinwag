import { useState, useCallback } from 'react';
import { api } from '../api.js';

// ── Constants ───────────────────────────────────────
const DELETE_FEEDBACK_MS = 2000;

/**
 * Custom hook for memory management in the dashboard.
 * Reads memorySelectedIdx, deleteConfirm, deleteMsg from the dashboard reducer.
 * Keeps memorySearch and memoryInput as local state (bound to TextInput onChange).
 */
export function useMemoryManager({ config, teamId, bumpRefreshKey, flash }, state, dispatch) {
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryInput, setMemoryInput] = useState('');

  // Read from reducer state
  const { memorySelectedIdx, deleteConfirm, deleteMsg } = state;

  function saveMemory(text) {
    if (!teamId || !text.trim()) return;
    api(config).post(`/teams/${teamId}/memory`, { text: text.trim() })
      .then(() => { flash('Saved to shared memory', { tone: 'success' }); bumpRefreshKey(); })
      .catch(() => flash('Memory not saved. Check connection.', { tone: 'error' }));
  }

  function deleteMemoryItem(mem) {
    if (!mem?.id || !teamId) return;
    api(config).del(`/teams/${teamId}/memory`, { id: mem.id })
      .then(() => {
        dispatch({ type: 'SET_DELETE_MSG', msg: 'Deleted' });
        dispatch({ type: 'RESET_MEMORY_SELECTION' });
        bumpRefreshKey();
        setTimeout(() => dispatch({ type: 'SET_DELETE_MSG', msg: null }), DELETE_FEEDBACK_MS);
      })
      .catch(() => {
        dispatch({ type: 'SET_DELETE_MSG', msg: 'Delete failed' });
        dispatch({ type: 'SET_DELETE_CONFIRM', confirm: false });
        setTimeout(() => dispatch({ type: 'SET_DELETE_MSG', msg: null }), DELETE_FEEDBACK_MS);
      });
  }

  function resetMemorySelection() {
    dispatch({ type: 'RESET_MEMORY_SELECTION' });
  }

  const clearMemorySearch = useCallback(() => {
    setMemorySearch('');
  }, []);

  const clearMemoryInput = useCallback(() => {
    setMemoryInput('');
  }, []);

  function onMemorySubmit() {
    saveMemory(memoryInput);
    setMemoryInput('');
  }

  return {
    memorySelectedIdx,
    deleteConfirm,
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

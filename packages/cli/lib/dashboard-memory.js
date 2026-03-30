import { useState, useRef, useEffect } from 'react';
import { api } from './api.js';

/**
 * Custom hook for memory management in the dashboard.
 *
 * Encapsulates all memory-related state and operations:
 * - Memory selection / navigation
 * - Delete with confirmation
 * - Memory search
 * - Memory add (save)
 */
export function useMemoryManager({ config, teamId, onFlash, onRefresh }) {
  const [memorySelectedIdx, setMemorySelectedIdx] = useState(-1);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState(null);
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryInput, setMemoryInput] = useState('');

  function saveMemory(text) {
    if (!teamId || !text.trim()) return;
    api(config).post(`/teams/${teamId}/memory`, { text: text.trim() })
      .then(() => {
        onFlash('Saved to shared memory', { tone: 'success', autoClearMs: 4000 });
        onRefresh();
      })
      .catch(() => onFlash('Could not save to shared memory', { tone: 'error' }));
  }

  function deleteMemoryItem(mem) {
    if (!mem?.id || !teamId) return;
    api(config).del(`/teams/${teamId}/memory`, { id: mem.id })
      .then(() => {
        setDeleteMsg('Deleted');
        setDeleteConfirm(false);
        setMemorySelectedIdx(-1);
        onRefresh();
        setTimeout(() => setDeleteMsg(null), 2000);
      })
      .catch(() => {
        setDeleteMsg('Delete failed');
        setDeleteConfirm(false);
        setTimeout(() => setDeleteMsg(null), 2000);
      });
  }

  function onMemorySubmit() {
    saveMemory(memoryInput);
    setMemoryInput('');
    return true; // signal to caller to clear compose mode
  }

  function clampMemoryIdx(visibleCount) {
    if (memorySelectedIdx >= visibleCount) {
      setMemorySelectedIdx(visibleCount > 0 ? visibleCount - 1 : -1);
    }
  }

  function resetMemoryNav() {
    setMemorySelectedIdx(-1);
    setDeleteConfirm(false);
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
    onMemorySubmit,
    clampMemoryIdx,
    resetMemoryNav,
  };
}

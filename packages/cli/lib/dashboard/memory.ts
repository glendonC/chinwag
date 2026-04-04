import type { Dispatch, SetStateAction } from 'react';
import { useState, useRef } from 'react';
import { api } from '../api.js';
import type { ChinwagConfig } from '../config.js';
import type { MemoryEntry } from './view.js';
import type { NoticeTone } from './reducer.js';
import { formatError } from '@chinwag/shared';

// ── Constants ───────────────────────────────────────
const DELETE_FEEDBACK_MS = 2000;

interface UseMemoryManagerParams {
  config: ChinwagConfig | null;
  teamId: string | null;
  bumpRefreshKey: () => void;
  flash: (text: string, options?: { tone?: NoticeTone; autoClearMs?: number }) => void;
}

export interface UseMemoryManagerReturn {
  memorySelectedIdx: number;
  setMemorySelectedIdx: Dispatch<SetStateAction<number>>;
  deleteConfirm: boolean;
  setDeleteConfirm: Dispatch<SetStateAction<boolean>>;
  deleteMsg: string | null;
  memorySearch: string;
  setMemorySearch: Dispatch<SetStateAction<string>>;
  memoryInput: string;
  setMemoryInput: Dispatch<SetStateAction<string>>;
  saveMemory: (text: string) => Promise<void>;
  isSaving: boolean;
  deleteMemoryItem: (mem: MemoryEntry) => void;
  resetMemorySelection: () => void;
  clearMemorySearch: () => void;
  clearMemoryInput: () => void;
  onMemorySubmit: () => void;
}

/**
 * Custom hook for memory management in the dashboard.
 * Handles memory selection, search, add, and delete operations.
 */
export function useMemoryManager({
  config,
  teamId,
  bumpRefreshKey,
  flash,
}: UseMemoryManagerParams): UseMemoryManagerReturn {
  const [memorySelectedIdx, setMemorySelectedIdx] = useState(-1);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryInput, setMemoryInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const pendingSaveRef = useRef<Promise<void>>(Promise.resolve());

  function saveMemory(text: string): Promise<void> {
    if (!teamId || !text.trim()) return Promise.resolve();

    const doSave = async () => {
      setIsSaving(true);
      flash('Saving to shared memory\u2026', { tone: 'info' });
      try {
        await api(config).post(`/teams/${teamId}/memory`, { text: text.trim() });
        flash('Saved to shared memory', { tone: 'success' });
        bumpRefreshKey();
      } catch (err: unknown) {
        console.error('[chinwag] Could not save memory:', formatError(err));
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

  function deleteMemoryItem(mem: MemoryEntry): void {
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
      .catch((err: unknown) => {
        console.error('[chinwag] Could not delete memory:', formatError(err));
        flash('Could not delete \u2014 check connection and try again', {
          tone: 'error',
          autoClearMs: 5000,
        });
        setDeleteConfirm(false);
        setDeleteMsg(null);
      });
  }

  function resetMemorySelection(): void {
    setMemorySelectedIdx(-1);
    setDeleteConfirm(false);
  }

  const clearMemorySearch = (): void => setMemorySearch('');
  const clearMemoryInput = (): void => setMemoryInput('');

  function onMemorySubmit(): void {
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

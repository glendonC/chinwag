import { useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useKeyboardHint } from '../components/KeyboardHint/KeyboardHint.jsx';
import { useTabKeyboard } from '../lib/useTabKeyboard.js';

interface UseTabsResult<T extends string> {
  activeTab: T;
  setActiveTab: Dispatch<SetStateAction<T>>;
  hint: { open: boolean; onOpen: () => void; onDismiss: () => void };
  ref: RefObject<HTMLDivElement | null>;
}

export function useTabs<T extends string>(tabIds: readonly T[]): UseTabsResult<T> {
  const [activeTab, setActiveTab] = useState<T>(tabIds[0]);
  const hint = useKeyboardHint();
  const ref = useTabKeyboard(
    [...tabIds] as string[],
    setActiveTab as Dispatch<SetStateAction<string>>,
  );
  return { activeTab, setActiveTab, hint, ref };
}

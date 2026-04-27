import { useState, useEffect, useCallback } from 'react';

type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface UseThemeReturn {
  theme: ThemePreference;
  resolved: ResolvedTheme;
  setTheme: (value: ThemePreference) => void;
}

const STORAGE_KEY = 'chinmeister-theme';

// Lazy access so module evaluation does not crash in test environments
// (jsdom omits matchMedia by default) or in any future SSR context. The
// hook itself only ever runs in the browser, where matchMedia exists.
function getDarkMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

function getSystemTheme(): ResolvedTheme {
  return getDarkMediaQuery()?.matches ? 'dark' : 'light';
}

function apply(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0e0f11' : '#ffffff';
}

export function useTheme(): UseThemeReturn {
  const [preference, setPreference] = useState<ThemePreference>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemePreference) || 'system',
  );
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  const resolved: ResolvedTheme = preference === 'system' ? systemTheme : preference;

  const setTheme = useCallback((value: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, value);
    setPreference(value);
  }, []);

  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  useEffect(() => {
    const mq = getDarkMediaQuery();
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return { theme: preference, resolved, setTheme };
}

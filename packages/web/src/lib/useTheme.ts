import { useState, useEffect, useCallback } from 'react';

type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface UseThemeReturn {
  theme: ThemePreference;
  resolved: ResolvedTheme;
  setTheme: (value: ThemePreference) => void;
}

const STORAGE_KEY = 'chinmeister-theme';
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

function getSystemTheme(): ResolvedTheme {
  return darkMQ.matches ? 'dark' : 'light';
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
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    darkMQ.addEventListener('change', handler);
    return () => darkMQ.removeEventListener('change', handler);
  }, []);

  return { theme: preference, resolved, setTheme };
}

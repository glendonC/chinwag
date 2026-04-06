// Lightweight URL router for the dashboard SPA.
// Syncs navigation state to browser history for deep linking, back/forward,
// and bookmarkable URLs. Zero dependencies.
//
// URL structure (relative to dashboard base):
//   /               → overview
//   /project/:id    → project view
//   /tools          → tools view
//   /settings       → settings view

import { useEffect, useSyncExternalStore } from 'react';

export interface Route {
  view: 'overview' | 'project' | 'tools' | 'settings';
  teamId: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let currentRoute = parseLocation();

export function parseLocation(): Route {
  const path = window.location.pathname
    .replace(/\/dashboard\.html\/?/, '/dashboard/')
    .replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  // Strip the /dashboard prefix — all dashboard routes live under it
  if (segments[0] === 'dashboard') segments.shift();

  if (segments[0] === 'project' && segments[1]) {
    const teamId = segments[1].trim();
    // Validate teamId is a non-empty, reasonable identifier
    if (teamId.length > 0 && /^[\w-]+$/.test(teamId)) {
      return { view: 'project', teamId };
    }
    // Invalid teamId — fall through to overview
    return { view: 'overview', teamId: null };
  }
  if (segments[0] === 'tools') return { view: 'tools', teamId: null };
  if (segments[0] === 'settings') return { view: 'settings', teamId: null };
  return { view: 'overview', teamId: null };
}

function emit() {
  currentRoute = parseLocation();
  for (const fn of listeners) fn();
}

function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return currentRoute;
}

/** Navigate to a new route, pushing a history entry. */
export function navigate(view: Route['view'], teamId?: string | null) {
  let path: string;
  if (view === 'project' && teamId) path = `/dashboard/project/${teamId}`;
  else if (view === 'tools') path = '/dashboard/tools';
  else if (view === 'settings') path = '/dashboard/settings';
  else path = '/dashboard';

  if (window.location.pathname !== path) {
    window.history.pushState(null, '', path);
    emit();
  }
}

/** Hook: returns the current route, re-renders on navigation. */
export function useRoute(): Route {
  useEffect(() => {
    // Listen for back/forward button
    window.addEventListener('popstate', emit);
    return () => window.removeEventListener('popstate', emit);
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Set or remove a query parameter, pushing a history entry. */
export function setQueryParam(key: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  const next = url.pathname + url.search;
  if (window.location.pathname + window.location.search !== next) {
    window.history.pushState(null, '', next);
    emit();
  }
}

/** Hook: returns a single query param value, re-renders on navigation. */
export function useQueryParam(key: string): string | null {
  return useSyncExternalStore(subscribe, () =>
    new URLSearchParams(window.location.search).get(key),
  );
}

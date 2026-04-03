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
  const path = window.location.pathname.replace(/\/dashboard\.html\/?/, '/');
  const segments = path.split('/').filter(Boolean);

  if (segments[0] === 'project' && segments[1]) {
    return { view: 'project', teamId: segments[1] };
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
  if (view === 'project' && teamId) path = `/project/${teamId}`;
  else if (view === 'tools') path = '/tools';
  else if (view === 'settings') path = '/settings';
  else path = '/';

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

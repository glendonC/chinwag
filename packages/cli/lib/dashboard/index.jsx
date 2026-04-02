import React from 'react';
import { DashboardProvider } from './DashboardProvider.jsx';
import { DashboardShell } from './DashboardShell.jsx';

/**
 * Dashboard entry point.
 * Composes DashboardProvider (context, state, hooks) with DashboardShell (layout, input, views).
 * External API is unchanged: pass config, navigate, layout, projectLabel, appVersion, setFooterHints.
 */
export function Dashboard({
  config,
  navigate,
  layout,
  _projectLabel = null,
  _appVersion = '0.1.0',
  setFooterHints,
}) {
  return (
    <DashboardProvider
      config={config}
      navigate={navigate}
      layout={layout}
      setFooterHints={setFooterHints}
    >
      <DashboardShell />
    </DashboardProvider>
  );
}

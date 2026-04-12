import { useState } from 'react';
import clsx from 'clsx';
import { useTeamStore } from '../../lib/stores/teams.js';
import { navigate, type Route } from '../../lib/router.js';
import { projectGradient } from '../../lib/projectGradient.js';
import { useTheme } from '../../lib/useTheme.js';
import styles from './Sidebar.module.css';

interface Props {
  activeView: Route['view'];
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({ activeView, collapsed = false, onToggle }: Props) {
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const overviewActive = activeView === 'overview';
  const toolsActive = activeView === 'tools';
  const directoryActive = activeView === 'directory';
  const globalActive = activeView === 'global';
  const settingsActive = activeView === 'settings';

  const { resolved, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  const go = (view: Route['view'], teamId?: string) => () => {
    if (teamId !== undefined) {
      navigate(view, teamId);
    } else {
      navigate(view);
    }
    setMobileOpen(false);
  };

  return (
    <>
      <button
        className={styles.mobileToggle}
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {mobileOpen ? (
            <path
              d="M5 5l10 10M15 5l-10 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M3 5h14M3 10h14M3 15h14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      {mobileOpen && (
        <div
          className={styles.mobileBackdrop}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className={clsx(styles.sidebarWrap, collapsed && styles.sidebarWrapCollapsed)}>
        {onToggle && (
          <button
            type="button"
            className={styles.sidebarToggle}
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg
              className={styles.toggleIcon}
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
            >
              <path
                d="M9 3.5 5.25 7 9 10.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

        <aside
          className={clsx(
            styles.sidebar,
            mobileOpen && styles.sidebarOpen,
            collapsed && styles.sidebarCollapsed,
          )}
        >
          <div className={styles.sidebarHeader}>
            <button
              type="button"
              className={styles.sidebarLogo}
              onClick={go('overview')}
              aria-label="Home"
              title="Overview"
            >
              <svg width="32" height="32" viewBox="0 0 32 32" className={styles.logoSvg}>
                <path fill="#d49aae" d="M4 24 20 24 24 20 8 20z" />
                <path fill="#a896d4" d="M6 18 22 18 26 14 10 14z" />
                <path fill="#8ec0a4" d="M8 12 24 12 28 8 12 8z" />
              </svg>
            </button>
          </div>

          <nav className={styles.sidebarNav} aria-label="Primary">
            <button
              type="button"
              className={clsx(styles.navItem, overviewActive && styles.navItemActive)}
              onClick={go('overview')}
              aria-current={overviewActive ? 'page' : undefined}
              aria-label="Overview"
              title="Overview"
            >
              <svg
                className={styles.navIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <rect
                  x="1"
                  y="1"
                  width="6"
                  height="6"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <rect
                  x="9"
                  y="1"
                  width="6"
                  height="6"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <rect
                  x="1"
                  y="9"
                  width="6"
                  height="6"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <rect
                  x="9"
                  y="9"
                  width="6"
                  height="6"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
              <span className={styles.navLabel}>Overview</span>
            </button>
            <button
              type="button"
              className={clsx(styles.navItem, toolsActive && styles.navItemActive)}
              onClick={go('tools')}
              aria-current={toolsActive ? 'page' : undefined}
              aria-label="Tools"
              title="Tools"
            >
              <svg
                className={styles.navIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M9.5 6.5l4.1 4.1a1.4 1.4 0 0 1-2 2L7.5 8.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M7.5 8.5 4 12a1 1 0 0 1-1.4 0L2 11.4A1 1 0 0 1 2 10l3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M5.5 6.5 9 3a2.5 2.5 0 0 1 4 1l-1.5 1.5L10 6l.5 1.5L9 9a2.5 2.5 0 0 1-1-4"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={styles.navLabel}>Tools</span>
            </button>
            <button
              type="button"
              className={clsx(styles.navItem, directoryActive && styles.navItemActive)}
              onClick={go('directory')}
              aria-current={directoryActive ? 'page' : undefined}
              aria-label="Directory"
              title="Directory"
            >
              <svg
                className={styles.navIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M2 4.5a1.5 1.5 0 0 1 1.5-1.5h2.6L7.4 4.5h5.1A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={styles.navLabel}>Directory</span>
            </button>
            <button
              type="button"
              className={clsx(styles.navItem, globalActive && styles.navItemActive)}
              onClick={go('global')}
              aria-current={globalActive ? 'page' : undefined}
              aria-label="Global"
              title="Global"
            >
              <svg
                className={styles.navIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
                <ellipse cx="8" cy="8" rx="2.8" ry="6.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span className={styles.navLabel}>Global</span>
            </button>
            <button
              type="button"
              className={clsx(styles.navItem, settingsActive && styles.navItemActive)}
              onClick={go('settings')}
              aria-current={settingsActive ? 'page' : undefined}
              aria-label="Settings"
              title="Settings"
            >
              <svg
                className={styles.navIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M6.7 1.6 9.3 1.6 8.9 3.6 11.3 5 12.8 3.6 14.2 6 12.3 6.6 12.3 9.4 14.2 10 12.8 12.4 11.3 11 8.9 12.4 9.3 14.4 6.7 14.4 7.1 12.4 4.7 11 3.2 12.4 1.8 10 3.7 9.4 3.7 6.6 1.8 6 3.2 3.6 4.7 5 7.1 3.6Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span className={styles.navLabel}>Settings</span>
            </button>
          </nav>

          <div className={styles.sidebarSection}>
            <span className={styles.sectionHeader}>Projects</span>
            <div className={styles.projectList}>
              {teams.length > 0 ? (
                teams.map((team) => (
                  <button
                    key={team.team_id}
                    type="button"
                    className={clsx(
                      styles.navItem,
                      styles.navItemProject,
                      activeTeamId === team.team_id &&
                        activeView === 'project' &&
                        styles.navItemActive,
                    )}
                    onClick={go('project', team.team_id)}
                    aria-current={
                      activeTeamId === team.team_id && activeView === 'project' ? 'page' : undefined
                    }
                    aria-label={team.team_name || team.team_id}
                    title={team.team_name || team.team_id}
                  >
                    <span
                      className={styles.projectSquircle}
                      style={{ background: projectGradient(team.team_id) }}
                    />
                    <span className={styles.projectName}>{team.team_name || team.team_id}</span>
                  </button>
                ))
              ) : (
                <p className={styles.sectionEmpty}>No projects yet</p>
              )}
            </div>
          </div>

          <div className={styles.sidebarSpacer} />

          <button
            type="button"
            className={styles.navItem}
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
            aria-label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={resolved === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            <svg className={styles.navIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
              {resolved === 'dark' ? (
                <>
                  <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                  <path
                    d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </>
              ) : (
                <path
                  d="M14 8.5A6 6 0 1 1 7.5 2A4.7 4.7 0 0 0 14 8.5z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
            <span className={styles.navLabel}>
              {resolved === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          </button>
        </aside>
      </div>
    </>
  );
}

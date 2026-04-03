import { useState } from 'react';
import { useTeamStore } from '../../lib/stores/teams.js';
import { navigate } from '../../lib/router.js';
import { projectGradient } from '../../lib/projectGradient.js';
import styles from './Sidebar.module.css';

export default function Sidebar({ activeView }) {
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const overviewActive = activeView === 'overview';
  const toolsActive = activeView === 'tools';
  const settingsActive = activeView === 'settings';

  const [mobileOpen, setMobileOpen] = useState(false);

  function goOverview() {
    navigate('overview');
    setMobileOpen(false);
  }

  function goTeam(teamId) {
    navigate('project', teamId);
    setMobileOpen(false);
  }

  function goSettings() {
    navigate('settings');
    setMobileOpen(false);
  }

  function goTools() {
    navigate('tools');
    setMobileOpen(false);
  }

  return (
    <>
      <button
        className={styles.mobileToggle}
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle sidebar"
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

      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}>
        <button type="button" className={styles.sidebarLogo} onClick={goOverview} aria-label="Home">
          <svg width="36" height="36" viewBox="0 0 32 32" className={styles.logoSvg}>
            <path fill="#d49aae" d="M4 24 20 24 24 20 8 20z" />
            <path fill="#a896d4" d="M6 18 22 18 26 14 10 14z" />
            <path fill="#8ec0a4" d="M8 12 24 12 28 8 12 8z" />
          </svg>
        </button>

        <nav className={styles.sidebarNav} aria-label="Primary">
          <button
            type="button"
            className={`${styles.navItem} ${overviewActive ? styles.navItemActive : ''}`}
            onClick={goOverview}
            aria-current={overviewActive ? 'page' : undefined}
          >
            <svg className={styles.navIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
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
            className={`${styles.navItem} ${toolsActive ? styles.navItemActive : ''}`}
            onClick={goTools}
            aria-current={toolsActive ? 'page' : undefined}
          >
            <svg className={styles.navIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 3.5h10M3 8h7.5M3 12.5h5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <circle cx="11.5" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="8" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span className={styles.navLabel}>Tools</span>
          </button>
          <button
            type="button"
            className={`${styles.navItem} ${settingsActive ? styles.navItemActive : ''}`}
            onClick={goSettings}
            aria-current={settingsActive ? 'page' : undefined}
          >
            <svg className={styles.navIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
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
                  className={`${styles.navItem} ${styles.navItemProject} ${activeTeamId === team.team_id && activeView === 'project' ? styles.navItemActive : ''}`}
                  onClick={() => goTeam(team.team_id)}
                  aria-current={
                    activeTeamId === team.team_id && activeView === 'project' ? 'page' : undefined
                  }
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
      </aside>
    </>
  );
}

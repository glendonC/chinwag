import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../../lib/stores/auth.js';
import { usePollingStore } from '../../lib/stores/polling.js';
import { api } from '../../lib/api.js';
import StatCard from '../../components/StatCard/StatCard.jsx';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import styles from './ToolsView.module.css';

export default function ToolsView() {
  const token = useAuthStore((s) => s.token);
  const dashboardData = usePollingStore((s) => s.dashboardData);

  const [catalog, setCatalog] = useState(null);
  const [categories, setCategories] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [dashboardSnapshot, setDashboardSnapshot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchCatalog() {
      try {
        const data = await api('GET', '/tools/catalog', null, token);
        if (!cancelled) {
          setCatalog(data.tools || []);
          setCategories(data.categories || {});
        }
      } catch {
        if (!cancelled) setCatalog([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchCatalog();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (dashboardData) {
      setDashboardSnapshot(dashboardData);
      return;
    }
    let cancelled = false;
    async function fetchDashboard() {
      try {
        const data = await api('GET', '/me/dashboard', null, token);
        if (!cancelled) setDashboardSnapshot(data);
      } catch {}
    }
    fetchDashboard();
    return () => { cancelled = true; };
  }, [dashboardData, token]);

  const userTools = useMemo(() => {
    const teams = dashboardSnapshot?.teams || [];
    const toolMap = new Map();
    for (const team of teams) {
      for (const t of (team.tools_configured || [])) {
        if (!toolMap.has(t.tool)) {
          toolMap.set(t.tool, { tool: t.tool, joins: 0, projects: [] });
        }
        const entry = toolMap.get(t.tool);
        entry.joins += t.joins || 0;
        entry.projects.push(team.team_name || team.team_id);
      }
    }
    return [...toolMap.values()].sort((a, b) => b.joins - a.joins);
  }, [dashboardSnapshot]);

  const userToolIds = useMemo(
    () => new Set(userTools.map(t => t.tool)),
    [userTools]
  );

  const filteredTools = useMemo(() => {
    if (!catalog) return [];
    if (activeCategory === 'all') return catalog;
    return catalog.filter(t => t.category === activeCategory);
  }, [catalog, activeCategory]);

  const categoryList = useMemo(() => Object.entries(categories), [categories]);
  const connectedProjects = dashboardSnapshot?.teams?.length || 0;
  const discoveryTools = useMemo(() => {
    return [...filteredTools].sort((a, b) => {
      const aConfigured = userToolIds.has(a.id) ? 1 : 0;
      const bConfigured = userToolIds.has(b.id) ? 1 : 0;
      if (aConfigured !== bConfigured) return aConfigured - bConfigured;
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredTools, userToolIds]);

  if (loading) {
    return (
      <div className={styles.page}>
        <p className={styles.loadingText}>Loading catalog...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ViewHeader
        eyebrow="Tools"
        title="Tools"
      />

      <div className={styles.hero}>
        <StatCard label="Configured" value={userTools.length} tone={userTools.length > 0 ? 'accent' : 'default'} />
        <StatCard label="Available" value={catalog?.length || 0} />
        <StatCard label="Projects" value={connectedProjects} tone={connectedProjects > 0 ? 'success' : 'default'} />
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Configured tools</h2>
          {userTools.length > 0 && (
            <span className={styles.sectionCount}>{userTools.length} configured</span>
          )}
        </div>
        {userTools.length > 0 ? (
          <div className={styles.yourTools}>
            {userTools.map(t => {
              const catalogEntry = catalog?.find(c => c.id === t.tool);
              const displayName = catalogEntry?.name || t.tool;
              return (
                <article key={t.tool} className={styles.yourToolCard}>
                  <div className={styles.yourToolHeader}>
                    <div className={styles.yourToolIdentity}>
                      <ToolIcon tool={t.tool} size={22} />
                      <div>
                        <span className={styles.yourToolName}>{displayName}</span>
                        <span className={styles.yourToolProjects}>
                          {t.projects.join(', ')}
                        </span>
                      </div>
                    </div>
                    <span className={styles.yourToolJoins}>{t.joins} joins</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className={styles.emptyHint}>
            Run <code>npx chinwag init</code> in a project.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Catalog</h2>
        </div>

        <div className={styles.categoryTabs}>
          <button
            className={`${styles.categoryTab} ${activeCategory === 'all' ? styles.categoryTabActive : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            All
          </button>
          {categoryList.map(([id, label]) => (
            <button
              key={id}
              className={`${styles.categoryTab} ${activeCategory === id ? styles.categoryTabActive : ''}`}
              onClick={() => setActiveCategory(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.toolList}>
          {discoveryTools.map(tool => {
            const isConfigured = userToolIds.has(tool.id);
            return (
              <article key={tool.id} className={styles.toolItem}>
                <div className={styles.toolTop}>
                  <div className={styles.toolIdentity}>
                    <ToolIcon tool={tool.id} size={24} />
                    <div>
                      <span className={styles.toolName}>{tool.name}</span>
                      <span className={styles.toolCategory}>{categories[tool.category] || tool.category}</span>
                    </div>
                  </div>
                  <div className={styles.toolFlags}>
                    {isConfigured && <span className={styles.toolConfigured}>configured</span>}
                    {tool.website && (
                      <a
                        href={tool.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.toolLink}
                        aria-label={`Visit ${tool.name} website`}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M10 2h4v4M7 9l7-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
                {tool.description && (
                  <p className={styles.toolDesc}>{tool.description}</p>
                )}
                {tool.installCmd && (
                  <code className={styles.toolInstall}>{tool.installCmd}</code>
                )}
              </article>
            );
          })}
          {discoveryTools.length === 0 && (
            <p className={styles.emptyHint}>No tools in this category.</p>
          )}
        </div>
      </section>
    </div>
  );
}

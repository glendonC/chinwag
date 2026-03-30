import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../../lib/stores/auth.js';
import { usePollingStore } from '../../lib/stores/polling.js';
import { api } from '../../lib/api.js';
import { useToolCatalog } from '../../lib/useToolCatalog.js';
import {
  buildCategoryJoinShare,
  buildHostJoinShare,
  buildSurfaceJoinShare,
  buildToolJoinShare,
  formatShare,
} from '../../lib/toolAnalytics.js';
import { getToolMeta, normalizeToolId } from '../../lib/toolMeta.js';
import StatCard from '../../components/StatCard/StatCard.jsx';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import styles from './ToolsView.module.css';

function summarizeProjects(projects) {
  if (projects.length <= 2) return projects.join(', ');
  return `${projects.slice(0, 2).join(', ')} +${projects.length - 2}`;
}

export default function ToolsView() {
  const token = useAuthStore((s) => s.token);
  const dashboardData = usePollingStore((s) => s.dashboardData);
  const { catalog, categories, loading } = useToolCatalog(token);

  const [activeCategory, setActiveCategory] = useState('all');
  const [dashboardSnapshot, setDashboardSnapshot] = useState(null);

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
      } catch {
        if (!cancelled) setDashboardSnapshot({ teams: [] });
      }
    }
    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, [dashboardData, token]);

  const toolShare = useMemo(
    () => buildToolJoinShare(dashboardSnapshot?.teams || []),
    [dashboardSnapshot]
  );
  const hostShare = useMemo(
    () => buildHostJoinShare(dashboardSnapshot?.teams || []),
    [dashboardSnapshot]
  );
  const surfaceShare = useMemo(
    () => buildSurfaceJoinShare(dashboardSnapshot?.teams || []),
    [dashboardSnapshot]
  );
  const categoryShare = useMemo(
    () => buildCategoryJoinShare(toolShare, catalog, categories),
    [toolShare, catalog, categories]
  );
  const userToolIds = useMemo(
    () => new Set(toolShare.map((tool) => tool.tool)),
    [toolShare]
  );
  const userHostIds = useMemo(
    () => new Set(hostShare.map((host) => host.host_tool)),
    [hostShare]
  );
  const seenSurfaceIds = useMemo(
    () => new Set(surfaceShare.map((surface) => surface.agent_surface)),
    [surfaceShare]
  );
  const filteredTools = useMemo(() => {
    if (activeCategory === 'all') return catalog;
    return catalog.filter((tool) => tool.category === activeCategory);
  }, [catalog, activeCategory]);
  const categoryList = useMemo(() => Object.entries(categories), [categories]);
  const connectedProjects = dashboardSnapshot?.teams?.length || 0;
  const discoveryTools = useMemo(() => {
    return [...filteredTools].sort((a, b) => {
      const aId = normalizeToolId(a.id);
      const bId = normalizeToolId(b.id);
      const aConfigured = userToolIds.has(aId) || userHostIds.has(aId) || seenSurfaceIds.has(aId) ? 1 : 0;
      const bConfigured = userToolIds.has(bId) || userHostIds.has(bId) || seenSurfaceIds.has(bId) ? 1 : 0;
      if (aConfigured !== bConfigured) return aConfigured - bConfigured;
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredTools, seenSurfaceIds, userHostIds, userToolIds]);

  if (loading && catalog.length === 0) {
    return (
      <div className={styles.page}>
        <p className={styles.loadingText}>Loading tool catalog...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ViewHeader eyebrow="Across projects" title="Tools" />

      <p className={styles.intro}>
        Discover your full Chinwag tool stack across projects: configured hosts, observed agent surfaces, and the wider catalog you can add next.
      </p>

      <div className={styles.hero}>
        <StatCard
          label="Configured"
          value={toolShare.length}
          tone={toolShare.length > 0 ? 'accent' : 'default'}
          hint="tools"
        />
        <StatCard
          label="Hosts"
          value={hostShare.length}
          tone={hostShare.length > 0 ? 'success' : 'default'}
          hint="active footprint"
        />
        <StatCard
          label="Surfaces"
          value={surfaceShare.length}
          tone={surfaceShare.length > 0 ? 'accent' : 'default'}
          hint="agent layers"
        />
        <StatCard
          label="Projects"
          value={connectedProjects}
          tone={connectedProjects > 0 ? 'success' : 'default'}
          hint="connected"
        />
      </div>

      <div className={styles.topGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitleSmall}>Configured across projects</h2>
            <span className={styles.sectionMeta}>Current stack footprint</span>
          </div>

          {toolShare.length > 0 ? (
            <div className={styles.list}>
              {toolShare.map((tool) => (
                <div key={tool.tool} className={styles.listRow}>
                  <div className={styles.rowIdentity}>
                    <ToolIcon tool={tool.tool} size={18} />
                    <div className={styles.rowCopy}>
                      <span className={styles.rowLabel}>{getToolMeta(tool.tool).label}</span>
                      <span className={styles.rowMeta}>{summarizeProjects(tool.projects)}</span>
                    </div>
                  </div>
                  <span className={styles.rowValue}>{tool.value} joins</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyHint}>
              Run <code>npx chinwag init</code> in a repo.
            </p>
          )}
        </section>

        <div className={styles.analyticsStack}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitleSmall}>Hosts</h2>
              <span className={styles.sectionMeta}>Cross-project join share</span>
            </div>

            {hostShare.length > 0 ? (
              <div className={styles.signalList}>
                {hostShare.map((host) => (
                  <div key={`host:${host.host_tool}`} className={styles.signalRow}>
                    <div className={styles.rowIdentity}>
                      <ToolIcon tool={host.host_tool} size={18} />
                      <div className={styles.rowCopy}>
                        <span className={styles.rowLabel}>{getToolMeta(host.host_tool).label}</span>
                        <span className={styles.rowMeta}>{summarizeProjects(host.projects)}</span>
                      </div>
                    </div>
                    <div className={styles.signalValueBlock}>
                      <span className={styles.signalValue}>{formatShare(host.share)}</span>
                      <span className={styles.signalMeta}>{host.value} joins</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyHint}>No host telemetry yet.</p>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitleSmall}>Agent surfaces</h2>
              <span className={styles.sectionMeta}>Observed across projects</span>
            </div>

            {surfaceShare.length > 0 ? (
              <div className={styles.signalList}>
                {surfaceShare.map((surface) => (
                  <div key={`surface:${surface.agent_surface}`} className={styles.signalRow}>
                    <div className={styles.rowIdentity}>
                      <ToolIcon tool={surface.agent_surface} size={18} />
                      <div className={styles.rowCopy}>
                        <span className={styles.rowLabel}>{getToolMeta(surface.agent_surface).label}</span>
                        <span className={styles.rowMeta}>{summarizeProjects(surface.projects)}</span>
                      </div>
                    </div>
                    <div className={styles.signalValueBlock}>
                      <span className={styles.signalValue}>{formatShare(surface.share)}</span>
                      <span className={styles.signalMeta}>{surface.value} joins</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyHint}>No extension-level surfaces have been observed yet.</p>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitleSmall}>By category</h2>
              <span className={styles.sectionMeta}>Cross-project composition</span>
            </div>

            {categoryShare.length > 0 ? (
              <div className={styles.list}>
                {categoryShare.map((category) => (
                  <div key={category.id} className={styles.listRow}>
                    <span className={styles.rowLabel}>{category.label}</span>
                    <span className={styles.rowValue}>{formatShare(category.share)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyHint}>No category data yet.</p>
            )}
          </section>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitleSmall}>Catalog</h2>
          <span className={styles.sectionMeta}>{catalog.length} available to add or observe</span>
        </div>

        <div className={styles.filterRow}>
          <button
            className={`${styles.filterButton} ${activeCategory === 'all' ? styles.filterButtonActive : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            All
          </button>
          {categoryList.map(([id, label]) => (
            <button
              key={id}
              className={`${styles.filterButton} ${activeCategory === id ? styles.filterButtonActive : ''}`}
              onClick={() => setActiveCategory(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.catalogGrid}>
          {discoveryTools.map((tool) => {
            const toolId = normalizeToolId(tool.id);
            const isConfigured = userToolIds.has(toolId) || userHostIds.has(toolId);
            const isObserved = !isConfigured && seenSurfaceIds.has(toolId);
            return (
              <article key={tool.id} className={styles.catalogItem}>
                <div className={styles.toolTop}>
                  <div className={styles.rowIdentity}>
                    <ToolIcon tool={tool.id} size={18} />
                    <div className={styles.rowCopy}>
                      <span className={styles.rowLabel}>{tool.name}</span>
                      <span className={styles.rowMeta}>
                        {categories[tool.category] || tool.category}
                      </span>
                    </div>
                  </div>
                  {isConfigured ? <span className={styles.toolConfigured}>Configured</span> : null}
                  {isObserved ? <span className={styles.toolObserved}>Observed</span> : null}
                </div>
                {tool.description ? <p className={styles.toolDesc}>{tool.description}</p> : null}
                {tool.installCmd ? <code className={styles.toolInstall}>{tool.installCmd}</code> : null}
              </article>
            );
          })}
          {discoveryTools.length === 0 ? (
            <p className={styles.emptyHint}>No tools in this category.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

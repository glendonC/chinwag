import { formatShare } from '../../lib/toolAnalytics.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import StatCard from '../../components/StatCard/StatCard.jsx';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import DirectoryRow from './DirectoryRow.jsx';
import { summarizeList } from '../../lib/summarize.js';
import { useToolsViewData } from './useToolsViewData.js';
import styles from './ToolsView.module.css';

interface VerdictOption {
  value: string;
  label: string;
}

const VERDICT_OPTIONS: VerdictOption[] = [
  { value: 'all', label: 'All' },
  { value: 'integrated', label: 'Integrated' },
  { value: 'installable', label: 'Installable' },
  { value: 'listed', label: 'Listed' },
];

const INITIAL_COUNT = 15;

interface Props {}

export default function ToolsView(_props: Props) {
  const {
    loading,
    evaluations,
    categories,
    toolShare,
    hostShare,
    surfaceShare,
    categoryShare,
    categoryList,
    connectedProjects,
    filteredEvaluations,
    activeCategory,
    setActiveCategory,
    activeVerdict,
    setActiveVerdict,
    searchQuery,
    setSearchQuery,
    expandedId,
    setExpandedId,
    showAll,
    setShowAll,
  } = useToolsViewData();

  if (loading && evaluations.length === 0) {
    return (
      <div className={styles.page}>
        <p className={styles.loadingText}>Loading tool directory...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ViewHeader eyebrow="Across projects" title="Tools" />

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
                <div key={tool.tool as string} className={styles.listRow}>
                  <div className={styles.rowIdentity}>
                    <ToolIcon tool={tool.tool as string} size={18} />
                    <div className={styles.rowCopy}>
                      <span className={styles.rowLabel}>
                        {getToolMeta(tool.tool as string).label}
                      </span>
                      <span className={styles.rowMeta}>
                        {summarizeList(tool.projects as string[])}
                      </span>
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
                      <ToolIcon tool={host.host_tool as string} size={18} />
                      <div className={styles.rowCopy}>
                        <span className={styles.rowLabel}>
                          {getToolMeta(host.host_tool as string).label}
                        </span>
                        <span className={styles.rowMeta}>
                          {summarizeList(host.projects as string[])}
                        </span>
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
                      <ToolIcon tool={surface.agent_surface as string} size={18} />
                      <div className={styles.rowCopy}>
                        <span className={styles.rowLabel}>
                          {getToolMeta(surface.agent_surface as string).label}
                        </span>
                        <span className={styles.rowMeta}>
                          {summarizeList(surface.projects as string[])}
                        </span>
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
              <p className={styles.emptyHint}>
                No extension-level surfaces have been observed yet.
              </p>
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
          <h2 className={styles.sectionTitleSmall}>Directory</h2>
          <span className={styles.sectionMeta}>
            {filteredEvaluations.length} of {evaluations.length} evaluated
          </span>
        </div>

        <div className={styles.directoryControls}>
          <div className={styles.filterRow}>
            {VERDICT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`${styles.filterButton} ${activeVerdict === opt.value ? styles.filterButtonActive : ''}`}
                onClick={() => setActiveVerdict(opt.value)}
              >
                {opt.label}
              </button>
            ))}
            <span className={styles.filterDivider} />
            <button
              className={`${styles.filterButton} ${activeCategory === 'all' ? styles.filterButtonActive : ''}`}
              onClick={() => setActiveCategory('all')}
            >
              All categories
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

          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className={styles.directoryHeader}>
          <span className={styles.dhName}>Tool</span>
          <span className={styles.dhVerdict}>Verdict</span>
          <span className={styles.dhMcp}>MCP</span>
          <span className={styles.dhCategory}>Category</span>
          <span className={styles.dhConfidence}>Confidence</span>
          <span className={styles.dhTagline}>Summary</span>
        </div>

        <div className={styles.directoryList}>
          {(showAll ? filteredEvaluations : filteredEvaluations.slice(0, INITIAL_COUNT)).map(
            (ev) => (
              <DirectoryRow
                key={ev.id}
                evaluation={ev}
                categories={categories}
                isExpanded={expandedId === ev.id}
                onToggle={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
              />
            ),
          )}
          {filteredEvaluations.length === 0 ? (
            <p className={styles.emptyHint}>No tools match the current filters.</p>
          ) : null}
          {!showAll && filteredEvaluations.length > INITIAL_COUNT ? (
            <button className={styles.showMoreButton} onClick={() => setShowAll(true)}>
              Show {filteredEvaluations.length - INITIAL_COUNT} more tools
            </button>
          ) : null}
          {showAll && filteredEvaluations.length > INITIAL_COUNT ? (
            <button className={styles.showMoreButton} onClick={() => setShowAll(false)}>
              Show less
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import { formatShare } from '../../lib/toolAnalytics.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import SummaryStat from './SummaryStat.jsx';
import styles from './ProjectView.module.css';

interface ToolSummary {
  tool: string;
  live: number;
  joins: number;
  share: number;
}

interface HostSummary {
  host_tool: string;
  live: number;
  joins: number;
  share: number;
}

interface SurfaceSummary {
  agent_surface: string;
  live: number;
  joins: number;
  share: number;
}

interface ModelSeen {
  agent_model: string;
  count: number;
}

interface FileConflict {
  file: string;
  owners: string[];
}

interface LockEntry {
  file_path: string;
  [key: string]: unknown;
}

interface UsageEntry {
  id: string;
  label: string;
  value: number;
}

interface ProjectToolsTabProps {
  toolSummaries: ToolSummary[];
  hostSummaries: HostSummary[];
  surfaceSummaries: SurfaceSummary[];
  modelsSeen: ModelSeen[];
  conflicts: FileConflict[];
  filesInPlay: string[];
  locks: LockEntry[];
  usageEntries: UsageEntry[];
}

export default function ProjectToolsTab({
  toolSummaries,
  hostSummaries,
  surfaceSummaries,
  modelsSeen,
  conflicts,
  filesInPlay,
  locks,
  usageEntries,
}: ProjectToolsTabProps) {
  const hasUsage = usageEntries.length > 0;

  if (toolSummaries.length === 0) {
    return <EmptyState title="No tools configured" hint="Run npx chinwag init in this repo." />;
  }

  return (
    <div className={styles.panelGrid}>
      <section className={styles.block}>
        <div className={styles.blockHeader}>
          <h2 className={styles.blockTitle}>Tools in this project</h2>
          <span className={styles.blockMeta}>Project-local joins</span>
        </div>
        <div className={styles.distributionList}>
          {toolSummaries.map((tool) => (
            <div key={tool.tool} className={styles.distributionRow}>
              <div className={styles.distributionCopy}>
                <span className={styles.distributionLabel}>
                  <ToolIcon tool={tool.tool} size={16} />
                  <span>{getToolMeta(tool.tool).label}</span>
                </span>
                <span className={styles.distributionMeta}>
                  {tool.live} live · {tool.joins} joins
                </span>
              </div>
              <span className={styles.distributionValue}>
                {tool.joins > 0 ? formatShare(tool.share) : '\u2014'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.asideStack}>
        <section className={styles.block}>
          <div className={styles.blockHeader}>
            <h2 className={styles.blockTitle}>Hosts in this project</h2>
            <span className={styles.blockMeta}>Where local agents run</span>
          </div>

          {hostSummaries.length > 0 ? (
            <div className={styles.distributionList}>
              {hostSummaries.map((host) => (
                <div key={host.host_tool} className={styles.distributionRow}>
                  <div className={styles.distributionCopy}>
                    <span className={styles.distributionLabel}>
                      <ToolIcon tool={host.host_tool} size={16} />
                      <span>{getToolMeta(host.host_tool).label}</span>
                    </span>
                    <span className={styles.distributionMeta}>
                      {host.live} live · {host.joins} joins
                    </span>
                  </div>
                  <span className={styles.distributionValue}>
                    {host.joins > 0 ? formatShare(host.share) : '\u2014'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyHint}>No host telemetry yet.</p>
          )}
        </section>

        <section className={styles.block}>
          <div className={styles.blockHeader}>
            <h2 className={styles.blockTitle}>Surfaces in this project</h2>
            <span className={styles.blockMeta}>Observed in local activity</span>
          </div>

          {surfaceSummaries.length > 0 ? (
            <div className={styles.distributionList}>
              {surfaceSummaries.map((surface) => (
                <div key={surface.agent_surface} className={styles.distributionRow}>
                  <div className={styles.distributionCopy}>
                    <span className={styles.distributionLabel}>
                      <ToolIcon tool={surface.agent_surface} size={16} />
                      <span>{getToolMeta(surface.agent_surface).label}</span>
                    </span>
                    <span className={styles.distributionMeta}>
                      {surface.live} live · {surface.joins} joins
                    </span>
                  </div>
                  <span className={styles.distributionValue}>
                    {surface.joins > 0 ? formatShare(surface.share) : '\u2014'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyHint}>No extension-level surfaces observed yet.</p>
          )}
        </section>

        {modelsSeen.length > 0 && (
          <section className={styles.block}>
            <div className={styles.blockHeader}>
              <h2 className={styles.blockTitle}>Models</h2>
              <span className={styles.blockMeta}>AI models observed</span>
            </div>
            <div className={styles.distributionList}>
              {modelsSeen.map((m) => (
                <div key={m.agent_model} className={styles.distributionRow}>
                  <div className={styles.distributionCopy}>
                    <span className={styles.simpleLabel}>{m.agent_model}</span>
                    <span className={styles.distributionMeta}>
                      {m.count} session{m.count === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className={styles.block}>
          <div className={styles.blockHeader}>
            <h2 className={styles.blockTitle}>Coordination</h2>
            <span className={styles.blockMeta}>Current + recorded</span>
          </div>

          <div className={styles.summaryGrid}>
            <SummaryStat label="overlapping files now" value={conflicts.length} />
            <SummaryStat label="files in play now" value={filesInPlay.length} />
            <SummaryStat label="locks held now" value={locks.length} />
          </div>

          {hasUsage && (
            <div className={styles.distributionList}>
              {usageEntries.map((entry) => (
                <div key={entry.id} className={styles.distributionRow}>
                  <div className={styles.distributionCopy}>
                    <span className={styles.simpleLabel}>{entry.label}</span>
                    <span className={styles.distributionMeta}>lifetime counter</span>
                  </div>
                  <span className={styles.distributionValue}>{entry.value}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
import SectionEmpty from '../../../components/SectionEmpty/SectionEmpty.js';
import styles from '../OverviewView.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { GhostRows, GhostStatRow } from './shared.js';

function DirectoriesWidget({ analytics }: WidgetBodyProps) {
  const dirs = analytics.directory_heatmap;
  if (dirs.length === 0) {
    return (
      <div className={styles.metricBars}>
        {[1, 2, 3].map((i) => (
          <div key={i} className={styles.ghostRow}>
            <span className={styles.ghostLabel}>—</span>
            <div className={styles.ghostBarTrack} />
            <span className={styles.ghostValue}>—</span>
          </div>
        ))}
      </div>
    );
  }
  const maxT = Math.max(...dirs.map((d) => d.touch_count), 1);
  return (
    <div className={styles.metricBars}>
      {dirs.slice(0, 10).map((d) => (
        <div key={d.directory} className={styles.metricRow}>
          <span className={styles.metricLabel} title={d.directory}>
            {d.directory}
          </span>
          <div className={styles.metricBarTrack}>
            <div
              className={styles.metricBarFill}
              style={{ width: `${(d.touch_count / maxT) * 100}%` }}
            />
          </div>
          <span className={styles.metricValue}>
            {d.touch_count}
            {d.file_count > 0 ? ` · ${d.file_count}f` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function FilesWidget({ analytics }: WidgetBodyProps) {
  const files = analytics.file_heatmap;
  if (files.length === 0) {
    return (
      <div className={styles.dataList}>
        {[1, 2, 3].map((i) => (
          <div key={i} className={styles.ghostRow}>
            <span className={styles.ghostLabel} style={{ width: 'auto' }}>
              —
            </span>
            <span className={styles.ghostValue}>—</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.dataList}>
      {files.slice(0, 10).map((f, i) => (
        <div key={f.file} className={styles.dataRow} style={{ '--row-index': i } as CSSProperties}>
          <span className={styles.dataName} title={f.file}>
            {f.file.split('/').slice(-2).join('/')}
          </span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{f.touch_count}</span> touches
            </span>
            {f.total_lines_added != null && f.total_lines_removed != null && (
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>
                  +{f.total_lines_added}/-{f.total_lines_removed}
                </span>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function FileChurnWidget({ analytics }: WidgetBodyProps) {
  const fc = analytics.file_churn;
  if (fc.length === 0) return <GhostRows count={3} />;
  return (
    <div className={styles.dataList}>
      {fc.slice(0, 10).map((f, i) => (
        <div key={f.file} className={styles.dataRow} style={{ '--row-index': i } as CSSProperties}>
          <span className={styles.dataName} title={f.file}>
            {f.file.split('/').slice(-2).join('/')}
          </span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{f.session_count}</span> sessions
            </span>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{f.total_edits}</span> edits
            </span>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{f.total_lines.toLocaleString()}</span> lines
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FileReworkWidget({ analytics }: WidgetBodyProps) {
  const fr = analytics.file_rework;
  if (fr.length === 0) return <GhostRows count={3} />;
  return (
    <div className={styles.dataList}>
      {fr.slice(0, 10).map((f, i) => (
        <div key={f.file} className={styles.dataRow} style={{ '--row-index': i } as CSSProperties}>
          <span className={styles.dataName} title={f.file}>
            {f.file.split('/').slice(-2).join('/')}
          </span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat} style={{ color: 'var(--danger)' }}>
              <span className={styles.dataStatValue}>{f.rework_ratio}%</span> rework
            </span>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>
                {f.failed_edits}/{f.total_edits}
              </span>{' '}
              failed
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditStalenessWidget({ analytics }: WidgetBodyProps) {
  const as_ = analytics.audit_staleness;
  if (as_.length === 0) return <SectionEmpty>No stale directories</SectionEmpty>;
  return (
    <div className={styles.dataList}>
      {as_.slice(0, 10).map((d, i) => (
        <div
          key={d.directory}
          className={styles.dataRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <span className={styles.dataName}>{d.directory}</span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{d.days_since}d</span> ago
            </span>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{d.prior_edit_count}</span> prior edits
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConcurrentEditsWidget({ analytics }: WidgetBodyProps) {
  const ce = analytics.concurrent_edits;
  if (ce.length === 0) return <SectionEmpty>No concurrent edits detected</SectionEmpty>;
  return (
    <div className={styles.dataList}>
      {ce.slice(0, 10).map((f, i) => (
        <div key={f.file} className={styles.dataRow} style={{ '--row-index': i } as CSSProperties}>
          <span className={styles.dataName} title={f.file}>
            {f.file.split('/').slice(-2).join('/')}
          </span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{f.agents}</span> agents
            </span>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{f.edit_count}</span> edits
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FileOverlapWidget({ analytics }: WidgetBodyProps) {
  const fo = analytics.file_overlap;
  if (fo.total_files === 0) return <GhostStatRow labels={['overlap rate', 'shared files']} />;
  return (
    <div className={styles.statRow}>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{fo.overlap_rate}%</span>
        <span className={styles.statBlockLabel}>overlap rate</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{fo.overlapping_files}</span>
        <span className={styles.statBlockLabel}>shared files</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{fo.total_files}</span>
        <span className={styles.statBlockLabel}>total files</span>
      </div>
    </div>
  );
}

export const codebaseWidgets: WidgetRegistry = {
  directories: DirectoriesWidget,
  files: FilesWidget,
  'file-churn': FileChurnWidget,
  'file-rework': FileReworkWidget,
  'audit-staleness': AuditStalenessWidget,
  'concurrent-edits': ConcurrentEditsWidget,
  'file-overlap': FileOverlapWidget,
};

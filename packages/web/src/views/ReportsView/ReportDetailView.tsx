// Report home page - opened when ?report=<id> is in the URL.
//
// Structured data only: runs table (date, status, findings, duration)
// and data-source chips. Launch button transforms into an in-place
// running pill when an active run exists for this report - no
// dedicated live-run page.

import { type CSSProperties, type ReactNode } from 'react';
import BackLink from '../../components/BackLink/BackLink.js';
import LaunchLink from '../../components/LaunchLink/LaunchLink.js';
import { setQueryParam } from '../../lib/router.js';
import { useActiveRun, reportRunsActions } from '../../lib/stores/reportRuns.js';
import { useDemoReports } from '../../hooks/useDemoReports.js';
import { getRunsForReport } from '../../lib/demo/index.js';
import { REPORT_CATALOG, reportHex, type ReportDef } from './report-catalog.js';
import { useElapsed } from './useElapsed.js';
import type { MockRun } from './types.js';
import styles from './ReportDetailView.module.css';

interface Props {
  reportId: string;
  onBack: () => void;
}

const COMPACT_RUN_LIMIT = 12;

// ── helpers ──

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (mins < 60) return `${mins}m ${remSec}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusCell(run: MockRun): string {
  if (run.status === 'complete') return 'complete';
  if (run.status === 'running') return 'running';
  if (run.status === 'queued') return 'queued';
  return 'failed';
}

function findingsCell(run: MockRun): string {
  if (run.status === 'complete') {
    const n = run.findingsCount ?? 0;
    return `${n} finding${n === 1 ? '' : 's'}`;
  }
  return '-';
}

function durationCell(run: MockRun): string {
  if (run.status === 'complete' && run.durationMs) return formatDuration(run.durationMs);
  return '-';
}

// ── Running group ──
//
// Two-squircle mirror of LaunchLink: left pill shows "running {N}s",
// right pill is the cancel button. Same height, same report-color, same
// rhythm as the launch state - only the labels differ.

function RunningGroup({
  startedAt,
  onCancel,
}: {
  startedAt: number;
  onCancel: () => void;
}): ReactNode {
  const elapsedMs = useElapsed(startedAt);
  return (
    <div className={styles.runningGroup}>
      <span className={styles.runningLabel} aria-live="polite">
        Running {formatDuration(elapsedMs)}
      </span>
      <button
        type="button"
        className={styles.cancelButton}
        onClick={onCancel}
        aria-label="Cancel run"
      >
        Cancel
      </button>
    </div>
  );
}

// ── Not-found body ──

function NotFound({ onBack }: { onBack: () => void }): ReactNode {
  return (
    <div className={styles.detail}>
      <div className={styles.notFound}>
        <BackLink label="Reports" onClick={onBack} />
        <h1 className={styles.notFoundTitle}>Report not found</h1>
        <p className={styles.notFoundBody}>This report does not exist or has been removed.</p>
      </div>
    </div>
  );
}

// ── Main ──

export default function ReportDetailView({ reportId, onBack }: Props): ReactNode {
  const reportsData = useDemoReports();
  const report: ReportDef | undefined = REPORT_CATALOG.find((r) => r.id === reportId);
  const activeRun = useActiveRun(reportId);

  if (!report) return <NotFound onBack={onBack} />;

  const hex = reportHex(report);
  const runs = getRunsForReport(reportsData, report.id);
  const visibleRuns = runs.slice(0, COMPACT_RUN_LIMIT);
  const hiddenCount = Math.max(0, runs.length - visibleRuns.length);

  const handleLaunch = (): void => {
    reportRunsActions.launch(report.id);
  };

  const handleCancel = (): void => {
    reportRunsActions.cancel(report.id);
  };

  const handleSelectRun = (runId: string): void => {
    setQueryParam('run', runId);
  };

  return (
    <div
      className={styles.detail}
      style={
        {
          '--report-color': hex,
        } as CSSProperties
      }
    >
      <BackLink label="Reports" onClick={onBack} />

      <h1 className={styles.headerTitle}>{report.name}</h1>

      <div className={styles.actionRow}>
        {activeRun ? (
          <RunningGroup startedAt={activeRun.startedAt} onCancel={handleCancel} />
        ) : (
          <LaunchLink onClick={handleLaunch} />
        )}
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Past runs</h2>
        {runs.length > 0 ? (
          <div className={styles.runsTable}>
            <div className={styles.runsHeaderRow} aria-hidden="true">
              <span className={styles.runsHeaderCell}>Date</span>
              <span className={styles.runsHeaderCell}>Status</span>
              <span className={styles.runsHeaderCell}>Findings</span>
              <span className={styles.runsHeaderCell}>Duration</span>
              <span className={styles.runsHeaderCell} />
            </div>

            {visibleRuns.map((run) => (
              <button
                key={run.id}
                type="button"
                className={styles.runRow}
                onClick={() => handleSelectRun(run.id)}
              >
                <span className={styles.runDate}>
                  {formatRelativeDate(run.completedAt ?? run.startedAt)}
                </span>
                <span className={`${styles.runCell} ${styles[`status_${run.status}`]}`}>
                  {statusCell(run)}
                </span>
                <span className={styles.runCell}>{findingsCell(run)}</span>
                <span className={styles.runCell}>{durationCell(run)}</span>
                <span className={styles.viewPill}>View</span>
              </button>
            ))}

            {hiddenCount > 0 && (
              <span className={styles.earlierLabel}>
                + {hiddenCount} earlier run{hiddenCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        ) : (
          <p className={styles.neverRun}>Never run.</p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Data sources</h2>
        <ul className={styles.sources}>
          {report.reads.map((r) => (
            <li key={r} className={styles.sourceChip}>
              {r.toLowerCase()}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

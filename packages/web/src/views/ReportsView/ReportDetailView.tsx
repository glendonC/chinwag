// Report home page — opened when ?report=<id> is in the URL.
//
// Header → launch → past runs table → reads. No expanded latest row
// (locked row template, no per-row exceptions). No status dots. No
// trust line chrome. Click any run → run page. Utilitarian pass.

import { type CSSProperties, type ReactNode } from 'react';
import BackLink from '../../components/BackLink/BackLink.js';
import { setQueryParam } from '../../lib/router.js';
import { REPORT_CATALOG, reportHex, type ReportDef } from './report-catalog.js';
import { getRunsForReport } from './mock-runs.js';
import type { MockRun } from './types.js';
import styles from './ReportDetailView.module.css';

interface Props {
  reportId: string;
  onBack: () => void;
}

const COMPACT_RUN_LIMIT = 8;

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

// Short cadence token for the eyebrow. Derived from cadenceDays, not
// from the prose `frequency` field (which is meant for longer
// descriptions, not metadata chrome).
function formatCadence(days: number | null): string {
  if (days === null) return 'one-time';
  if (days <= 1) return 'daily';
  if (days <= 7) return 'weekly';
  if (days <= 14) return 'bi-weekly';
  if (days <= 30) return 'monthly';
  if (days <= 90) return 'quarterly';
  return 'yearly';
}

function findingsCell(run: MockRun): string {
  if (run.status === 'complete') {
    const n = run.findingsCount ?? 0;
    return `${n} finding${n === 1 ? '' : 's'}`;
  }
  if (run.status === 'running') {
    return run.currentPhase ? `running · ${run.currentPhase.toLowerCase()}` : 'running';
  }
  if (run.status === 'queued') return 'queued';
  return 'failed';
}

function durationCell(run: MockRun): string {
  if (run.status === 'complete' && run.durationMs) return formatDuration(run.durationMs);
  return '—';
}

// ── Past runs (uniform table) ──

function PastRuns({
  runs,
  onSelect,
}: {
  runs: MockRun[];
  onSelect: (runId: string) => void;
}): ReactNode {
  if (runs.length === 0) {
    return (
      <section className={styles.runsSection}>
        <span className={styles.sectionLabel}>Past runs</span>
        <p className={styles.runsEmpty}>No runs yet. Launch above to see findings.</p>
      </section>
    );
  }

  const visible = runs.slice(0, COMPACT_RUN_LIMIT);
  const hiddenCount = Math.max(0, runs.length - visible.length);

  return (
    <section className={styles.runsSection}>
      <span className={styles.sectionLabel}>Past runs</span>

      <div className={styles.runsTable}>
        <div className={styles.runsHeaderRow} aria-hidden="true">
          <span className={styles.runsHeaderCell}>Date</span>
          <span className={styles.runsHeaderCell}>Findings</span>
          <span className={styles.runsHeaderCell}>Duration</span>
          <span className={styles.runsHeaderCell}>Path</span>
        </div>

        {visible.map((run) => (
          <button
            key={run.id}
            type="button"
            className={styles.runRow}
            onClick={() => onSelect(run.id)}
          >
            <span className={styles.runDate}>
              {formatRelativeDate(run.completedAt ?? run.startedAt)}
            </span>
            <span className={styles.runMeta}>{findingsCell(run)}</span>
            <span className={styles.runMeta}>{durationCell(run)}</span>
            <span className={styles.runPath}>claude code</span>
          </button>
        ))}

        {hiddenCount > 0 && (
          <button type="button" className={styles.earlierLink}>
            ↳ {hiddenCount} earlier run{hiddenCount === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </section>
  );
}

// ── Reads row (plain inline text, no pills) ──

function ReadsRow({ reads }: { reads: string[] }): ReactNode {
  return (
    <section className={styles.readsRow}>
      <span className={styles.sectionLabel}>Reads</span>
      <p className={styles.readsText}>{reads.map((r) => r.toLowerCase()).join(', ')}.</p>
    </section>
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
  const report: ReportDef | undefined = REPORT_CATALOG.find((r) => r.id === reportId);

  if (!report) return <NotFound onBack={onBack} />;

  const hex = reportHex(report);
  const runs = getRunsForReport(report.id);

  const handleLaunch = (): void => {
    setQueryParam('run', `live-${report.id}-${Date.now()}`);
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
      <header className={styles.header}>
        <BackLink label="Reports" onClick={onBack} />
        <div className={styles.headerCopy}>
          <span className={styles.headerEyebrow}>
            {report.category} · {formatCadence(report.cadenceDays)}
          </span>
          <h1 className={styles.headerTitle}>{report.name}</h1>
          <p className={styles.headerDescription}>{report.description}</p>
        </div>
      </header>

      <div className={styles.launchRow}>
        <button type="button" className={styles.launchBtn} onClick={handleLaunch}>
          <span>Launch</span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M2 7h9M6.5 2.5 11 7l-4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <PastRuns runs={runs} onSelect={handleSelectRun} />

      <ReadsRow reads={report.reads} />
    </div>
  );
}

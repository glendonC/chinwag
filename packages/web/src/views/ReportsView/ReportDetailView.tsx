// Report detail view — opened when ?report=<id> is in the URL.
// Lightweight "report home page": header, primary launch CTA, latest run
// summary, past runs list, and the static "what this report does" content.
//
// Click "Launch" → spawns a fresh simulated run via ?run=live-<id>-<ts>
// Click any past run → navigates to that run via ?run=<runId>

import { type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import BackLink from '../../components/BackLink/BackLink.js';
import SectionTitle from '../../components/SectionTitle/SectionTitle.js';
import { setQueryParam } from '../../lib/router.js';
import { agentGradient } from '../../lib/agentGradient.js';
import { REPORT_CATALOG, reportHex, type ReportDef } from './report-catalog.js';
import { getRunsForReport, getLatestRun } from './mock-runs.js';
import { getPathAvailability, pathShortLabel } from './reports-path.js';
import type { MockRun } from './types.js';
import styles from './ReportDetailView.module.css';

interface Props {
  reportId: string;
  onBack: () => void;
}

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

// ── Past runs list ──

function PastRunsList({
  runs,
  onSelect,
}: {
  runs: MockRun[];
  onSelect: (runId: string) => void;
}): ReactNode {
  if (runs.length === 0) {
    return <p className={styles.runsEmpty}>No past runs yet. Launch the first one above.</p>;
  }

  return (
    <div className={styles.runs}>
      {runs.map((run) => {
        const dotClass =
          run.status === 'complete'
            ? styles.runDotComplete
            : run.status === 'failed'
              ? styles.runDotFailed
              : run.status === 'running'
                ? styles.runDotRunning
                : styles.runDotQueued;

        const meta =
          run.status === 'complete'
            ? `${formatDuration(run.durationMs ?? 0)} · ${run.findingsCount ?? 0} findings${
                run.criticalCount ? ` · ${run.criticalCount} critical` : ''
              }`
            : run.status === 'failed'
              ? `failed after ${formatDuration(run.durationMs ?? 0)}`
              : run.status === 'running'
                ? `${run.currentPhase ?? 'starting'}`
                : 'waiting for CLI';

        return (
          <button
            key={run.id}
            type="button"
            className={styles.runRow}
            onClick={() => onSelect(run.id)}
          >
            <span className={clsx(styles.runDot, dotClass)} aria-hidden="true" />
            <span className={styles.runDate}>
              {formatRelativeDate(run.completedAt ?? run.startedAt)}
            </span>
            <span className={styles.runMeta}>{meta}</span>
            <span className={styles.runPath}>{pathShortLabel(run.path)}</span>
            <svg
              className={styles.runChevron}
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3.5 2 6.5 5 3.5 8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

// ── Main ──

export default function ReportDetailView({ reportId, onBack }: Props): ReactNode {
  const report = REPORT_CATALOG.find((r) => r.id === reportId);

  if (!report) {
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

  const hex = reportHex(report);
  const pastRuns = getRunsForReport(report.id);
  const latestRun = getLatestRun(report.id);
  const path = getPathAvailability();

  const handleLaunch = () => {
    setQueryParam('run', `live-${report.id}-${Date.now()}`);
  };

  const handleSelectRun = (runId: string) => {
    setQueryParam('run', runId);
  };

  return (
    <div
      className={styles.detail}
      style={
        {
          '--report-color': hex,
          '--report-gradient': agentGradient(hex),
        } as CSSProperties
      }
    >
      <header className={styles.header}>
        <BackLink label="Reports" onClick={onBack} />
        <div className={styles.headerMain}>
          <div className={styles.headerCopy}>
            <span className={styles.headerEyebrow}>
              {report.category} · {report.frequency}
            </span>
            <h1 className={styles.headerTitle}>{report.name}</h1>
            <p className={styles.headerTagline}>{report.tagline}</p>
          </div>
        </div>
      </header>

      <section className={styles.heroBlock}>
        <div className={styles.heroBlockInner}>
          <div className={styles.heroCopy}>
            <span className={styles.heroLabel}>What this report does</span>
            <p className={styles.heroDescription}>{report.description}</p>
          </div>
          <button type="button" className={styles.launchBtn} onClick={handleLaunch}>
            <span>Launch</span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
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
        <div className={styles.trustLine}>
          <span className={styles.trustDot} aria-hidden="true" />
          <span>{path.trustLine}</span>
        </div>
      </section>

      {latestRun && latestRun.status === 'complete' && (
        <section className={styles.latestBlock}>
          <SectionTitle>Latest report</SectionTitle>
          <button
            type="button"
            className={styles.latestRow}
            onClick={() => handleSelectRun(latestRun.id)}
          >
            <span className={styles.latestRowDate}>
              {formatRelativeDate(latestRun.completedAt ?? latestRun.startedAt)}
            </span>
            <span className={styles.latestRowMeta}>
              {latestRun.findingsCount ?? 0} findings
              {latestRun.criticalCount ? ` · ${latestRun.criticalCount} critical` : ''}
              {latestRun.durationMs ? ` · ${formatDuration(latestRun.durationMs)}` : ''}
            </span>
            <span className={styles.latestRowAction}>
              Open
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M3.5 2 6.5 5 3.5 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </section>
      )}

      <section className={styles.metaGrid}>
        <div className={styles.metaBlock}>
          <SectionTitle>Reads</SectionTitle>
          <ul className={styles.chipList}>
            {report.reads.map((r) => (
              <li key={r} className={styles.chip}>
                {r}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.metaBlock}>
          <SectionTitle>Produces</SectionTitle>
          <ul className={styles.chipList}>
            {report.produces.map((p) => (
              <li key={p} className={styles.chip}>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.exampleBlock}>
        <SectionTitle>Example finding</SectionTitle>
        <p className={styles.example}>{report.exampleInsight}</p>
      </section>

      <section className={styles.runsSection}>
        <div className={styles.runsHeader}>
          <SectionTitle>Past runs {pastRuns.length > 0 && `· ${pastRuns.length}`}</SectionTitle>
        </div>
        <PastRunsList runs={pastRuns} onSelect={handleSelectRun} />
      </section>
    </div>
  );
}

// Live + completed run view. Same route serves both states — the content
// is driven by status. Mounted inside ReportsView when the `run` query
// param is present. `live-<reportId>-<ts>` ids trigger a fresh simulated
// run; real ids are looked up in the mock data.

import { useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import BackLink from '../../components/BackLink/BackLink.js';
import { agentGradient } from '../../lib/agentGradient.js';
import { REPORT_CATALOG, reportHex, type ReportDef } from './report-catalog.js';
import { getRun } from './mock-runs.js';
import { getCompletedReportFor, getCompletedReport } from './mock-findings.js';
import { useFakeRunProgress, getEstimatedTotalMs } from './useFakeRunProgress.js';
import { pathShortLabel } from './reports-path.js';
import type { Finding, CompletedReport, FindingAction, RunPath } from './types.js';
import styles from './ReportRunView.module.css';

interface Props {
  runId: string;
  onBack: () => void;
}

// ── helpers ──

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return `${mins}m ${remSec.toString().padStart(2, '0')}s`;
}

function parseLiveRunId(runId: string): { isLive: true; reportId: string } | { isLive: false } {
  if (!runId.startsWith('live-')) return { isLive: false };
  const withoutPrefix = runId.slice('live-'.length);
  const lastDash = withoutPrefix.lastIndexOf('-');
  if (lastDash === -1) return { isLive: false };
  const reportId = withoutPrefix.slice(0, lastDash);
  return { isLive: true, reportId };
}

function findReport(reportId: string): ReportDef | undefined {
  return REPORT_CATALOG.find((r) => r.id === reportId);
}

function severityLabel(s: Finding['severity']): string {
  switch (s) {
    case 'critical':
      return 'Critical';
    case 'warning':
      return 'Warning';
    case 'info':
      return 'Info';
  }
}

function severityClass(s: Finding['severity']): string {
  switch (s) {
    case 'critical':
      return styles.severityCritical;
    case 'warning':
      return styles.severityWarning;
    case 'info':
      return styles.severityInfo;
  }
}

function actionClass(category: FindingAction['category']): string {
  switch (category) {
    case 'state':
      return styles.actionState;
    case 'export':
      return styles.actionExport;
    case 'spawn':
      return styles.actionSpawn;
  }
}

function actionIcon(category: FindingAction['category']): ReactNode {
  if (category === 'state') {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M2 6l3 3 5-6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (category === 'export') {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M6 2v6M3.5 5.5L6 8l2.5-2.5M2 10h8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M7 2h3v3M10 2L6 6M5 3H3a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function citationTypeLabel(type: string): string {
  switch (type) {
    case 'session':
      return 'Session';
    case 'file':
      return 'File';
    case 'tool_call':
      return 'Tool';
    case 'memory':
      return 'Memory';
    case 'conflict':
      return 'Conflict';
    case 'metric':
      return 'Metric';
    default:
      return type;
  }
}

// ── Finding card ──

function FindingCard({ finding }: { finding: Finding }): ReactNode {
  const severityClassName =
    finding.severity === 'critical'
      ? styles.findingCritical
      : finding.severity === 'warning'
        ? styles.findingWarning
        : styles.findingInfo;

  return (
    <article className={clsx(styles.finding, severityClassName)}>
      <header className={styles.findingHeader}>
        <span className={clsx(styles.severityChip, severityClass(finding.severity))}>
          {severityLabel(finding.severity)}
        </span>
        <h3 className={styles.findingTitle}>{finding.title}</h3>
      </header>

      {finding.body && <p className={styles.findingBody}>{finding.body}</p>}

      <ul className={styles.citationList}>
        {finding.citations.map((c, i) => (
          <li key={i} className={styles.citation}>
            <span className={clsx(styles.citationType, styles[`cite_${c.type}`])}>
              {citationTypeLabel(c.type)}
            </span>
            <span className={styles.citationLabel}>{c.label}</span>
            {c.detail && <span className={styles.citationDetail}>{c.detail}</span>}
          </li>
        ))}
      </ul>

      <div className={styles.actions}>
        {finding.actions.map((a) => (
          <button
            key={a.id}
            type="button"
            className={clsx(styles.action, actionClass(a.category))}
            onClick={() => {
              /* no-op at skeleton stage */
            }}
          >
            {actionIcon(a.category)}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

function RunHeader({
  report,
  statusLabel,
  statusDetail,
  path,
  onBack,
}: {
  report: ReportDef;
  statusLabel: string;
  statusDetail: string;
  path: RunPath;
  onBack: () => void;
}): ReactNode {
  const hex = reportHex(report);
  return (
    <header
      className={styles.header}
      style={
        {
          '--report-color': hex,
          '--report-gradient': agentGradient(hex),
        } as React.CSSProperties
      }
    >
      <BackLink label="Reports" onClick={onBack} />
      <div className={styles.headerMain}>
        <div className={styles.headerCopy}>
          <span className={styles.headerEyebrow}>{report.category}</span>
          <h1 className={styles.headerTitle}>{report.name}</h1>
          <p className={styles.headerTagline}>{report.tagline}</p>
        </div>
        <div className={styles.headerStatus}>
          <span className={styles.headerStatusLabel}>{statusLabel}</span>
          <span className={styles.headerStatusDetail}>{statusDetail}</span>
          <span className={styles.headerStatusPath}>via {pathShortLabel(path)}</span>
        </div>
      </div>
    </header>
  );
}

// ── Live body (running state) ──

function LiveBody({ report, onBack }: { report: ReportDef; onBack: () => void }): ReactNode {
  const { phaseLabel, progress, elapsedMs, findings, isComplete } = useFakeRunProgress(
    report.id,
    true,
  );
  const estTotal = getEstimatedTotalMs();

  if (isComplete) {
    const completed = getCompletedReportFor(report.id);
    if (completed) {
      return <CompletedBody report={report} completed={completed} onBack={onBack} />;
    }
  }

  return (
    <div className={styles.run}>
      <RunHeader
        report={report}
        statusLabel="Running"
        statusDetail={`${formatElapsed(elapsedMs)} · ~${formatElapsed(estTotal - elapsedMs)} left`}
        path="primary"
        onBack={onBack}
      />

      <div className={styles.progressBlock}>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
        </div>
        <span className={styles.phaseLabel}>{phaseLabel}…</span>
      </div>

      <section className={styles.body}>
        {findings.length === 0 ? (
          <div className={styles.awaiting}>
            <span className={styles.awaitingDot} aria-hidden="true" />
            <span className={styles.awaitingText}>Waiting for the first finding…</span>
          </div>
        ) : (
          <div className={styles.findingsStream}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Findings so far</h2>
              <span className={styles.sectionCount}>{findings.length}</span>
            </div>
            <div className={styles.findingsList}>
              {findings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={onBack}>
          Cancel run
        </button>
      </footer>
    </div>
  );
}

// ── Completed body ──

function CompletedBody({
  report,
  completed,
  onBack,
}: {
  report: ReportDef;
  completed: CompletedReport;
  onBack: () => void;
}): ReactNode {
  const critCount = completed.findings.filter((f) => f.severity === 'critical').length;
  const statusDetail = `${completed.findings.length} findings${critCount ? ` · ${critCount} critical` : ''}`;
  const hex = reportHex(report);

  return (
    <div
      className={styles.run}
      style={
        {
          '--report-color': hex,
        } as React.CSSProperties
      }
    >
      <RunHeader
        report={report}
        statusLabel="Complete"
        statusDetail={statusDetail}
        path={completed.stats.path}
        onBack={onBack}
      />

      <section className={styles.summaryBlock}>
        <span className={styles.summaryLabel}>Summary</span>
        <p className={styles.summaryText}>{completed.summary}</p>
      </section>

      <section className={styles.body}>
        <div className={styles.findingsStream}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Findings</h2>
            <span className={styles.sectionCount}>{completed.findings.length}</span>
          </div>
          <div className={styles.findingsList}>
            {completed.findings.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        </div>
      </section>

      <section className={styles.coverageBlock}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>What this report read</h2>
        </div>
        <div className={styles.statsRow}>
          <div className={styles.statsItem}>
            <span className={styles.statsLabel}>Sessions read</span>
            <span className={styles.statsValue}>{completed.stats.sessionsRead}</span>
          </div>
          <div className={styles.statsItem}>
            <span className={styles.statsLabel}>Files read</span>
            <span className={styles.statsValue}>{completed.stats.filesRead}</span>
          </div>
          <div className={styles.statsItem}>
            <span className={styles.statsLabel}>Tokens</span>
            <span className={styles.statsValue}>
              {(completed.stats.tokensUsed / 1000).toFixed(0)}K
            </span>
          </div>
          <div className={styles.statsItem}>
            <span className={styles.statsLabel}>Cost</span>
            <span className={styles.statsValue}>${completed.stats.estimatedCost.toFixed(2)}</span>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerBtn}>
          Download report
        </button>
        <button type="button" className={styles.footerBtn}>
          Share
        </button>
        <button type="button" className={styles.footerBtnPrimary} onClick={onBack}>
          Re-run
        </button>
      </footer>
    </div>
  );
}

// ── Not-found body ──

function NotFound({ onBack }: { onBack: () => void }): ReactNode {
  return (
    <div className={styles.run}>
      <div className={styles.notFound}>
        <BackLink label="Reports" onClick={onBack} />
        <h1 className={styles.notFoundTitle}>Run not found</h1>
        <p className={styles.notFoundBody}>
          The run you&apos;re looking for doesn&apos;t exist or has been cleared.
        </p>
      </div>
    </div>
  );
}

// ── Main ──

export default function ReportRunView({ runId, onBack }: Props): ReactNode {
  const parsed = useMemo(() => parseLiveRunId(runId), [runId]);

  if (parsed.isLive) {
    const report = findReport(parsed.reportId);
    if (!report) return <NotFound onBack={onBack} />;
    return <LiveBody key={runId} report={report} onBack={onBack} />;
  }

  const run = getRun(runId);
  if (!run) return <NotFound onBack={onBack} />;
  const report = findReport(run.reportId);
  if (!report) return <NotFound onBack={onBack} />;

  if (run.status === 'running') {
    return <LiveBody key={runId} report={report} onBack={onBack} />;
  }

  if (run.status === 'queued') {
    return (
      <div className={styles.run}>
        <RunHeader
          report={report}
          statusLabel="Queued"
          statusDetail="Waiting for your CLI to come online"
          path={run.path}
          onBack={onBack}
        />
        <div className={styles.queuedBody}>
          <p>
            This run is waiting for your CLI daemon. It will start automatically as soon as your
            managed agent is online.
          </p>
        </div>
      </div>
    );
  }

  if (run.status === 'failed') {
    return (
      <div className={styles.run}>
        <RunHeader
          report={report}
          statusLabel="Failed"
          statusDetail="Run did not complete"
          path={run.path}
          onBack={onBack}
        />
        <div className={styles.failedBody}>
          <p>This run failed early. No findings were produced.</p>
          <button type="button" className={styles.footerBtnPrimary} onClick={onBack}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const completed = getCompletedReport(run.id) ?? getCompletedReportFor(run.reportId);
  if (!completed) return <NotFound onBack={onBack} />;
  return <CompletedBody report={report} completed={completed} onBack={onBack} />;
}

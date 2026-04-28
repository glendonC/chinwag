// Completed / queued / failed run view. Mounted inside ReportsView
// when the `run` query param is present. Running state is handled by
// ReportDetailView in-place - there's no dedicated live-run view.

import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import BackLink from '../../components/BackLink/BackLink.js';
import { agentGradient } from '../../lib/agentGradient.js';
import { useDemoReports } from '../../hooks/useDemoReports.js';
import { getRun, getCompletedReport, getCompletedReportFor } from '../../lib/demo/index.js';
import { REPORT_CATALOG, reportHex, type ReportDef } from './report-catalog.js';
import type { Finding, CompletedReport } from './types.js';
import styles from './ReportRunView.module.css';

type RunTab = 'findings' | 'steps' | 'sources';
const RUN_TABS: readonly RunTab[] = ['findings', 'steps', 'sources'] as const;

const TAB_LABELS: Record<RunTab, string> = {
  findings: 'Findings',
  steps: 'Steps',
  sources: 'Sources',
};

interface Props {
  runId: string;
  onBack: () => void;
}

// ── helpers ──

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

function actionIcon(category: Finding['actions'][number]['category']): ReactNode {
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
  return (
    <article className={styles.finding}>
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
            <span className={styles.citationType}>{citationTypeLabel(c.type)}</span>
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
            className={styles.action}
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

// ── Tab nav ──

function TabNav({
  active,
  onChange,
}: {
  active: RunTab;
  onChange: (t: RunTab) => void;
}): ReactNode {
  return (
    <div className={styles.tabNav} role="tablist">
      {RUN_TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          className={clsx(styles.tabButton, active === id && styles.tabActive)}
          onClick={() => onChange(id)}
        >
          {TAB_LABELS[id]}
        </button>
      ))}
    </div>
  );
}

// ── Tab bodies ──

function FindingsTab({ findings }: { findings: Finding[] }): ReactNode {
  return (
    <div className={styles.findingsList}>
      {findings.map((f) => (
        <FindingCard key={f.id} finding={f} />
      ))}
    </div>
  );
}

function StepsTab({ stages }: { stages: string[] }): ReactNode {
  return (
    <ol className={styles.stepsList}>
      {stages.map((stage) => (
        <li key={stage} className={styles.step}>
          <span className={styles.stepCheck} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 6.5l2.5 2.5 4.5-5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className={styles.stepName}>{stage.replace(/-/g, ' ')}</span>
        </li>
      ))}
    </ol>
  );
}

function SourcesTab({ stats }: { stats: CompletedReport['stats'] }): ReactNode {
  return (
    <div className={styles.statsRow}>
      <div className={styles.statsItem}>
        <span className={styles.statsLabel}>Sessions read</span>
        <span className={styles.statsValue}>{stats.sessionsRead}</span>
      </div>
      <div className={styles.statsItem}>
        <span className={styles.statsLabel}>Files read</span>
        <span className={styles.statsValue}>{stats.filesRead}</span>
      </div>
      <div className={styles.statsItem}>
        <span className={styles.statsLabel}>Tokens</span>
        <span className={styles.statsValue}>{(stats.tokensUsed / 1000).toFixed(0)}K</span>
      </div>
      <div className={styles.statsItem}>
        <span className={styles.statsLabel}>Cost</span>
        <span className={styles.statsValue}>${stats.estimatedCost.toFixed(2)}</span>
      </div>
    </div>
  );
}

function RunHeader({
  report,
  statusLine,
  onBack,
}: {
  report: ReportDef;
  statusLine: string;
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
      <h1 className={styles.headerTitle}>{report.name}</h1>
      <p className={styles.headerStatusLine}>{statusLine}</p>
    </header>
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
  const parts = [`complete`, `${completed.findings.length} findings`];
  if (critCount > 0) parts.push(`${critCount} critical`);
  const statusLine = parts.join(' · ');
  const hex = reportHex(report);

  const [activeTab, setActiveTab] = useState<RunTab>('findings');

  return (
    <div
      className={styles.run}
      style={
        {
          '--report-color': hex,
        } as React.CSSProperties
      }
    >
      <RunHeader report={report} statusLine={statusLine} onBack={onBack} />

      <TabNav active={activeTab} onChange={setActiveTab} />

      <section className={styles.body}>
        {activeTab === 'findings' && <FindingsTab findings={completed.findings} />}
        {activeTab === 'steps' && <StepsTab stages={report.stages} />}
        {activeTab === 'sources' && <SourcesTab stats={completed.stats} />}
      </section>
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
  const reportsData = useDemoReports();
  const run = getRun(reportsData, runId);
  if (!run) return <NotFound onBack={onBack} />;
  const report = findReport(run.reportId);
  if (!report) return <NotFound onBack={onBack} />;

  if (run.status === 'running') {
    // Running runs are surfaced inline on the detail view now; bounce
    // to the detail page instead of rendering a dedicated view.
    return <NotFound onBack={onBack} />;
  }

  if (run.status === 'queued') {
    return (
      <div className={styles.run}>
        <RunHeader
          report={report}
          statusLine="queued · waiting for your cli to come online"
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
        <RunHeader report={report} statusLine="failed · run did not complete" onBack={onBack} />
        <div className={styles.failedBody}>
          <p>This run failed early. No findings were produced.</p>
          <button type="button" className={styles.footerBtnPrimary} onClick={onBack}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const completed =
    getCompletedReport(reportsData, run.id) ?? getCompletedReportFor(reportsData, run.reportId);
  if (!completed) return <NotFound onBack={onBack} />;
  return <CompletedBody report={report} completed={completed} onBack={onBack} />;
}

import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { useQueryParam, setQueryParam } from '../../lib/router.js';
import { agentGradient } from '../../lib/agentGradient.js';
import { projectGradient } from '../../lib/projectGradient.js';
import { REPORT_CATALOG, reportHex, type ReportDef } from './report-catalog.js';
import { reportMesh, hexToHue } from './reportMesh.js';
import { ReportMark, reportGradientId } from './ReportMark.js';
import { getLatestRun, getRunsForReport } from './mock-runs.js';
import { computeFreshness, formatFreshness } from './freshness.js';
import { getPathAvailability } from './reports-path.js';
import type { MockRun } from './types.js';
import ReportRunView from './ReportRunView.js';
import ReportDetailView from './ReportDetailView.js';
import styles from './ReportsView.module.css';

// ── format helpers ──

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

// ── Per-report icon gradient defs ──
//
// Each Lucide icon in a row references its own <linearGradient> by id
// (via `color="url(#...)"`). The gradients live in one hidden SVG at
// the top of the catalog — cross-SVG id references work as long as
// everything lives in the same document.

function ReportGradientDefs(): ReactNode {
  return (
    <svg width={0} height={0} aria-hidden="true" className={styles.gradientDefs}>
      <defs>
        {REPORT_CATALOG.map((report) => {
          const hex = reportHex(report);
          const h = hexToHue(hex);
          const accent = (h + 160) % 360;
          return (
            <linearGradient
              key={report.id}
              id={reportGradientId(report.id)}
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor={`hsl(${h}, 78%, 58%)`} />
              <stop offset="100%" stopColor={`hsl(${accent}, 62%, 66%)`} />
            </linearGradient>
          );
        })}
      </defs>
    </svg>
  );
}

// ── Column header row (matches the row grid template) ──

function CatalogHeader(): ReactNode {
  return (
    <div className={styles.catalogHeader} aria-hidden="true">
      <span />
      <span className={styles.headerLabel}>Report</span>
      <span className={styles.headerLabel}>Last run</span>
      <span />
    </div>
  );
}

// ── Report row ──

interface ReportRowProps {
  report: ReportDef;
  freshnessText: string;
  onHoverChange: (reportId: string | null, x?: number, y?: number) => void;
  onView: (report: ReportDef) => void;
}

const ReportRow = memo(function ReportRow({
  report,
  freshnessText,
  onHoverChange,
  onView,
}: ReportRowProps): ReactNode {
  const hex = reportHex(report);

  return (
    <button
      type="button"
      className={styles.row}
      style={
        {
          '--report-color': hex,
          '--report-gradient': agentGradient(hex),
          '--report-mesh': reportMesh(hex, report.id),
        } as React.CSSProperties
      }
      onMouseEnter={(e) => onHoverChange(report.id, e.clientX, e.clientY)}
      onMouseMove={(e) => onHoverChange(report.id, e.clientX, e.clientY)}
      onClick={() => onView(report)}
    >
      <div className={styles.rowArt} aria-hidden="true">
        <ReportMark reportId={report.id} />
      </div>

      <div className={styles.rowBody}>
        <h3 className={styles.rowName}>{report.name}</h3>
        <p className={styles.rowTagline}>{report.tagline}</p>
      </div>

      <span className={styles.freshness}>{freshnessText}</span>

      <span className={styles.rowView} aria-hidden="true">
        View
      </span>
    </button>
  );
});

// ── Hover preview tooltip (positioned adjacent to card) ──

function HoverTooltip({
  report,
  pastRuns,
  latestRun,
  style,
  visible,
}: {
  report: ReportDef;
  pastRuns: MockRun[];
  latestRun: MockRun | undefined;
  style: CSSProperties | undefined;
  visible: boolean;
}): ReactNode {
  const hex = reportHex(report);
  const path = getPathAvailability();

  return (
    <div
      className={clsx(styles.tooltip, visible && styles.tooltipVisible)}
      style={
        {
          ...style,
          '--report-color': hex,
          '--report-mesh': reportMesh(hex, report.id),
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <div className={styles.tooltipHeader}>
        <span className={styles.tooltipName}>{report.name}</span>
      </div>

      <p className={styles.tooltipDescription}>{report.description}</p>

      <div className={styles.tooltipChipBlock}>
        <span className={styles.tooltipChipLabel}>Reads</span>
        <div className={styles.tooltipChips}>
          {report.reads.slice(0, 4).map((r) => (
            <span key={r} className={styles.tooltipChip}>
              {r}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.tooltipExample}>
        <span className={styles.tooltipExampleLabel}>Example finding</span>
        <p className={styles.tooltipExampleText}>{report.exampleInsight}</p>
      </div>

      {pastRuns.length > 0 && latestRun && (
        <div className={styles.tooltipRunsBlock}>
          <span className={styles.tooltipRunsLabel}>Past runs · {pastRuns.length}</span>
          {latestRun.status === 'complete' && (
            <span className={styles.tooltipRunsLatest}>
              Last: {formatRelativeDate(latestRun.completedAt ?? latestRun.startedAt)} ·{' '}
              {latestRun.findingsCount ?? 0} findings
              {latestRun.criticalCount ? ` · ${latestRun.criticalCount} critical` : ''}
            </span>
          )}
          {latestRun.status === 'running' && (
            <span className={styles.tooltipRunsLatest}>
              Currently running · {latestRun.currentPhase ?? 'starting'}
            </span>
          )}
          {latestRun.status === 'queued' && (
            <span className={styles.tooltipRunsLatest}>Queued · waiting for CLI</span>
          )}
        </div>
      )}

      <p className={styles.tooltipTrust}>{path.trustLine}</p>

      <div className={styles.tooltipActions}>
        <span className={styles.tooltipAction}>
          <kbd className={styles.kbd}>Enter</kbd> View details
        </span>
        <span className={styles.tooltipAction}>
          <kbd className={styles.kbd}>L</kbd> Launch run
        </span>
      </div>
    </div>
  );
}

// ── Main view ──

export default function ReportsView(): ReactNode {
  const runIdParam = useQueryParam('run');
  const reportIdParam = useQueryParam('report');

  if (runIdParam) {
    return <ReportRunView runId={runIdParam} onBack={() => setQueryParam('run', null)} />;
  }

  if (reportIdParam) {
    return (
      <ReportDetailView reportId={reportIdParam} onBack={() => setQueryParam('report', null)} />
    );
  }

  return <CatalogView />;
}

// ── Catalog ──

function CatalogView(): ReactNode {
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const activeTeam = useMemo(
    () => teams.find((t) => t.team_id === activeTeamId) ?? teams[0] ?? null,
    [teams, activeTeamId],
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Content state is separate from visibility so the tooltip stays mounted
  // across mouse-leave. Only changes on mouse-enter. Pre-seeded with the
  // first report so the tooltip DOM is laid out on initial paint — first
  // hover pays no mount cost, only an opacity transition.
  const [displayReportId, setDisplayReportId] = useState<string | null>(
    REPORT_CATALOG[0]?.id ?? null,
  );
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const handleHover = useCallback((reportId: string | null, x?: number, y?: number) => {
    if (reportId === null) {
      setHoveredId(null);
      return;
    }
    if (x != null && y != null) {
      setHoveredId(reportId);
      setDisplayReportId(reportId);
      setHoverPos({ x, y });
    }
  }, []);

  // mouseLeave on the catalog (not individual rows) — so cursor crossing
  // between rows keeps the tooltip visible instead of flickering it out
  // and back in.
  const handleCatalogLeave = useCallback(() => {
    setHoveredId(null);
  }, []);

  const handleView = useCallback((report: ReportDef) => {
    setQueryParam('report', report.id);
  }, []);

  // Keyboard shortcuts on the hovered row. Mirrors DirectoryView: while a
  // row is hovered, Enter navigates to the detail view and L launches a
  // fresh run directly (skipping the detail page). Guarded against focus
  // inside any text input so typing elsewhere on the page is unaffected.
  useEffect(() => {
    if (!hoveredId) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter') {
        setQueryParam('report', hoveredId);
        e.preventDefault();
      } else if (e.key === 'l' || e.key === 'L') {
        setQueryParam('run', `live-${hoveredId}-${Date.now()}`);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hoveredId]);

  // Cursor-relative tooltip position. Captured once on mouseEnter so it
  // stays stable while the user reads — no move-tracking jitter. Flips
  // horizontally off the right edge, and flips its vertical anchor
  // (top-at-cursor vs bottom-at-cursor) based on which half of the
  // viewport the cursor is in — so the tooltip edge is always at the
  // cursor, never clamped to the viewport and never visually adrift.
  // Mirrors the DirectoryView pattern.
  const tooltipStyle: CSSProperties | undefined = useMemo(() => {
    if (!hoverPos) return undefined;
    const w = 380;
    const gap = 18;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1400;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;

    let left = hoverPos.x + gap;
    if (left + w > vw - 16) left = hoverPos.x - gap - w;
    if (left < 16) left = 16;

    if (hoverPos.y < vh * 0.6) {
      return { left, top: hoverPos.y, bottom: 'auto' };
    }
    return { left, bottom: vh - hoverPos.y, top: 'auto' };
  }, [hoverPos]);

  const displayReport = displayReportId
    ? (REPORT_CATALOG.find((r) => r.id === displayReportId) ?? null)
    : null;

  return (
    <div className={styles.reports}>
      <ViewHeader eyebrow="On-demand analysis" title="Reports" />

      {activeTeam && (
        <div className={styles.toolbar}>
          <span className={styles.projectBadge} title={activeTeam.team_name || activeTeam.team_id}>
            <span
              className={styles.projectBadgeSwatch}
              style={{ background: projectGradient(activeTeam.team_id) }}
              aria-hidden="true"
            />
            <span className={styles.projectBadgeLabel}>
              {activeTeam.team_name || activeTeam.team_id}
            </span>
          </span>
        </div>
      )}

      <ReportGradientDefs />

      <CatalogHeader />

      <div className={styles.catalog} onMouseLeave={handleCatalogLeave}>
        {REPORT_CATALOG.map((report) => {
          const latest = getLatestRun(report.id);
          const freshnessText = formatFreshness(computeFreshness(report, latest));
          return (
            <ReportRow
              key={report.id}
              report={report}
              freshnessText={freshnessText}
              onHoverChange={handleHover}
              onView={handleView}
            />
          );
        })}
      </div>

      {/* Portal to document.body — escapes any ancestor containing block.
          .reports has `animation: ... both` with translateY(0) in the
          end keyframe, which per spec establishes a containing block for
          fixed descendants and offsets the tooltip by the .reports
          element's position on the page. Portaling sidesteps that. */}
      {displayReport &&
        typeof document !== 'undefined' &&
        createPortal(
          <HoverTooltip
            report={displayReport}
            pastRuns={getRunsForReport(displayReport.id)}
            latestRun={getLatestRun(displayReport.id)}
            style={tooltipStyle}
            visible={!!hoveredId}
          />,
          document.body,
        )}
    </div>
  );
}

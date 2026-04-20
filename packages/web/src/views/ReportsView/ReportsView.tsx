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
import { reportRunsActions } from '../../lib/stores/reportRuns.js';
import { REPORT_CATALOG, reportHex, type ReportDef } from './report-catalog.js';
import { ReportMark } from './ReportMark.js';
import { getLatestRun, getRunsForReport } from './mock-runs.js';
import { computeFreshness, formatFreshness } from './freshness.js';
import type { MockRun } from './types.js';
import ReportRunView from './ReportRunView.js';
import ReportDetailView from './ReportDetailView.js';
import styles from './ReportsView.module.css';

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
        } as React.CSSProperties
      }
      onMouseEnter={(e) => onHoverChange(report.id, e.clientX, e.clientY)}
      onMouseMove={(e) => onHoverChange(report.id, e.clientX, e.clientY)}
      onClick={() => onView(report)}
    >
      <div className={styles.rowArt} aria-hidden="true">
        <ReportMark reportId={report.id} color={hex} />
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
//
// Two states, one panel. Collapsed: title, description, action bar.
// `D` expands to reveal Reads and a runs-total microline. `D` again
// or hovering a different report resets to collapsed.

function HoverTooltip({
  report,
  pastRuns,
  expanded,
  style,
  visible,
}: {
  report: ReportDef;
  pastRuns: MockRun[];
  expanded: boolean;
  style: CSSProperties | undefined;
  visible: boolean;
}): ReactNode {
  const hex = reportHex(report);

  return (
    <div
      className={clsx(
        styles.tooltip,
        visible && styles.tooltipVisible,
        expanded && styles.tooltipExpanded,
      )}
      style={
        {
          ...style,
          '--report-color': hex,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <span className={styles.tooltipName}>{report.name}</span>

      <p className={styles.tooltipDescription}>{report.description}</p>

      {expanded && (
        <>
          <div className={styles.tooltipBlock}>
            <span className={styles.tooltipBlockLabel}>Reads</span>
            <p className={styles.tooltipReadsText}>
              {report.reads.map((r) => r.toLowerCase()).join(', ')}.
            </p>
          </div>

          {pastRuns.length > 0 && (
            <span className={styles.tooltipHint}>
              {pastRuns.length} run{pastRuns.length === 1 ? '' : 's'} total
            </span>
          )}
        </>
      )}

      <div className={styles.tooltipActions}>
        <span className={styles.tooltipAction}>
          <kbd className={styles.kbd}>Enter</kbd> open
        </span>
        <span className={styles.tooltipAction}>
          <kbd className={styles.kbd}>L</kbd> launch
        </span>
        <span className={styles.tooltipAction}>
          <kbd className={styles.kbd}>D</kbd> {expanded ? 'hide details' : 'show details'}
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
  // Expansion is per-hover. Reset whenever the displayed report changes so
  // a user who expanded report A and sweeps to report B doesn't see B's
  // content pre-expanded.
  const [isExpanded, setIsExpanded] = useState(false);

  const handleHover = useCallback(
    (reportId: string | null, x?: number, y?: number) => {
      if (reportId === null) {
        setHoveredId(null);
        return;
      }
      if (x != null && y != null) {
        setHoveredId(reportId);
        if (reportId !== displayReportId) {
          setDisplayReportId(reportId);
          setIsExpanded(false);
        }
        setHoverPos({ x, y });
      }
    },
    [displayReportId],
  );

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
  // row is hovered, Enter navigates to the detail view, L launches a fresh
  // run directly (skipping the detail page), and D toggles the hover
  // between collapsed and expanded. Guarded against focus inside any text
  // input so typing elsewhere on the page is unaffected.
  useEffect(() => {
    if (!hoveredId) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter') {
        setQueryParam('report', hoveredId);
        e.preventDefault();
      } else if (e.key === 'l' || e.key === 'L') {
        reportRunsActions.launch(hoveredId);
        setQueryParam('report', hoveredId);
        e.preventDefault();
      } else if (e.key === 'd' || e.key === 'D') {
        setIsExpanded((prev) => !prev);
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
            expanded={isExpanded}
            style={tooltipStyle}
            visible={!!hoveredId}
          />,
          document.body,
        )}
    </div>
  );
}

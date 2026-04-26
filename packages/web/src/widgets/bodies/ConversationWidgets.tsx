import { type CSSProperties } from 'react';
import clsx from 'clsx';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
import { setQueryParams } from '../../lib/router.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import styles from './ConversationWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { MoreHidden, StatWidget } from './shared.js';

// Conversations category. Three widgets, all using sentiment/topic as
// INPUTS to coordination questions (never headline) per ANALYTICS_SPEC §10.
//
// Visual vocabulary matches the live category: subgrid table + named
// header + body rows with negative-margin hover compensation. Substrate-
// unique viz lives inside cells (per-session outcome stripe for files;
// tool-icon route for handoffs) so the widgets earn distinct identity
// without forking the table primitive.

const CONFUSED_FILES_VISIBLE = 8;
const CROSS_TOOL_HANDOFFS_VISIBLE = 8;
const CONFUSED_DOTS_MAX = 12;

// ── confused-files (6×3) ────────────────────────────
//
// Files where the user-side conversation expressed confusion or
// frustration in 2+ sessions. Surfaces the file (coordination axis),
// not the sentiment polarity. Sessions cell: one dot per confused
// session; abandoned-outcome dots are tinted --danger. The dot stripe
// encodes magnitude + severity in a single chromeless mark — distinct
// from the file-friction primitive used by file-rework and audit-
// staleness so two file-axis widgets don't read as visual duplicates.
function ConfusedFilesWidget({ analytics }: WidgetBodyProps) {
  const cf = analytics.confused_files;
  if (cf.length === 0) {
    return (
      <SectionEmpty>
        Files where the agent struggled appear after 2+ sessions show confused or frustrated
        messages.
      </SectionEmpty>
    );
  }
  const visible = cf.slice(0, CONFUSED_FILES_VISIBLE);
  const hidden = cf.length - visible.length;
  return (
    <>
      <div className={clsx(styles.convoTable, styles.confusedTable)}>
        <div className={styles.convoHeader}>
          <span>File</span>
          <span>Sessions</span>
          <span className={styles.convoHeaderNum}>Total</span>
        </div>
        <div className={styles.convoBody}>
          {visible.map((f, i) => {
            const { name, parent } = splitFile(f.file);
            return (
              <button
                key={f.file}
                type="button"
                className={styles.convoRow}
                style={{ '--row-index': i } as CSSProperties}
                title={f.file}
                aria-label={`${name}: ${f.confused_sessions} confused sessions, ${f.retried_sessions} abandoned`}
                onClick={() => setQueryParams({ file: f.file, sentiment: 'confused' })}
              >
                <span className={styles.fileCell}>
                  <span className={styles.fileName}>{name}</span>
                  {parent && <span className={styles.fileParent}>{parent}</span>}
                </span>
                <ConfusedSessionsStripe
                  total={f.confused_sessions}
                  abandoned={f.retried_sessions}
                />
                <span className={styles.confusedTotal}>{f.confused_sessions}</span>
              </button>
            );
          })}
        </div>
      </div>
      <MoreHidden count={hidden} />
    </>
  );
}

// One dot per confused session. Abandoned dots come first (left) so
// the visual severity reads at a glance — a row that's mostly red on
// the left is more urgent than one with a single trailing red dot.
// Caps at CONFUSED_DOTS_MAX so saturation doesn't break row height;
// excess shows as "+N".
function ConfusedSessionsStripe({ total, abandoned }: { total: number; abandoned: number }) {
  const visible = Math.min(total, CONFUSED_DOTS_MAX);
  const overflow = total - visible;
  const visibleAbandoned = Math.min(abandoned, visible);
  return (
    <span className={styles.confusedSessionsCell} aria-hidden="true">
      {Array.from({ length: visible }).map((_, i) => (
        <span
          key={i}
          className={clsx(styles.confusedDot, i < visibleAbandoned && styles.confusedDotAbandoned)}
        />
      ))}
      {overflow > 0 && <span className={styles.fileParent}>+{overflow}</span>}
    </span>
  );
}

// ── cross-tool-handoff-questions (6×3) ──────────────
//
// Substrate-unique events: one tool abandoned mid-question, another
// tool picked up the same file with another question or confused turn
// within 24h. Route cell renders both tool icons with their labels
// flanking a directional arrow — visually it reads as a flow, which
// is the substrate signal no single-tool surface can show.
function CrossToolHandoffsWidget({ analytics }: WidgetBodyProps) {
  const events = analytics.cross_tool_handoff_questions;
  if (events.length === 0) {
    return (
      <SectionEmpty>
        Handoffs appear when one tool ends a session abandoned mid-question and a different tool
        picks up the same file within 24 hours.
      </SectionEmpty>
    );
  }
  const visible = events.slice(0, CROSS_TOOL_HANDOFFS_VISIBLE);
  const hidden = events.length - visible.length;
  return (
    <>
      <div className={clsx(styles.convoTable, styles.handoffTable)}>
        <div className={styles.convoHeader}>
          <span>Route</span>
          <span className={styles.convoHeaderNum}>Gap</span>
          <span>File</span>
        </div>
        <div className={styles.convoBody}>
          {visible.map((e, i) => {
            const { name, parent } = splitFile(e.file);
            const fromLabel = getToolMeta(e.tool_from).label;
            const toLabel = getToolMeta(e.tool_to).label;
            return (
              <button
                key={`${e.handoff_at}-${e.file}-${e.tool_from}-${e.tool_to}`}
                type="button"
                className={styles.convoRow}
                style={{ '--row-index': i } as CSSProperties}
                title={e.file}
                aria-label={`${fromLabel} to ${toLabel} on ${name}, ${formatGap(e.gap_minutes)} gap`}
                onClick={() =>
                  setQueryParams({
                    tool: e.tool_to,
                    file: e.file,
                    since: e.handoff_at,
                  })
                }
              >
                <span className={styles.routeCell}>
                  <span className={styles.routeTool}>
                    <ToolIcon tool={e.tool_from} size={14} />
                    <span>{fromLabel}</span>
                  </span>
                  <span className={styles.routeArrow} aria-hidden="true">
                    →
                  </span>
                  <span className={styles.routeTool}>
                    <ToolIcon tool={e.tool_to} size={14} />
                    <span>{toLabel}</span>
                  </span>
                </span>
                <span className={styles.gapCell}>{formatGap(e.gap_minutes)}</span>
                <span className={styles.fileCell}>
                  <span className={styles.fileName}>{name}</span>
                  {parent && <span className={styles.fileParent}>{parent}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <MoreHidden count={hidden} />
    </>
  );
}

// ── unanswered-questions (4×2) ──────────────────────
//
// Bare hero stat. The widget title carries the metric name; the body
// is just the number + drill arrow when there's something to read.
// Same primitive as Stuckness, OneShotRate, Sessions.
function UnansweredQuestionsWidget({ analytics }: WidgetBodyProps) {
  const uq = analytics.unanswered_questions;
  const drillable = uq.count > 0;
  return (
    <StatWidget
      value={uq.count.toLocaleString()}
      onOpenDetail={
        drillable
          ? () => setQueryParams({ outcome: 'abandoned', has_user_question: 'true' })
          : undefined
      }
      detailAriaLabel={drillable ? 'Open questions left open' : undefined}
    />
  );
}

// ── helpers ─────────────────────────────────────────

function splitFile(filePath: string): { name: string; parent: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash < 0) return { name: filePath, parent: '' };
  const name = filePath.slice(lastSlash + 1);
  const before = filePath.slice(0, lastSlash);
  const prevSlash = before.lastIndexOf('/');
  const parent = prevSlash < 0 ? before : before.slice(prevSlash + 1);
  return { name, parent: parent ? `${parent}/` : '' };
}

// Compact gap formatter. Window is capped at 24h server-side so the
// day branch is defensive only.
function formatGap(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export const conversationWidgets: WidgetRegistry = {
  'confused-files': ConfusedFilesWidget,
  'cross-tool-handoff-questions': CrossToolHandoffsWidget,
  'unanswered-questions': UnansweredQuestionsWidget,
};

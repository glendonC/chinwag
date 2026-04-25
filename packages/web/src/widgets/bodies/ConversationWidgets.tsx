import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import FileFrictionRow from '../../components/viz/file/FileFrictionRow.js';
import { setQueryParams } from '../../lib/router.js';
import styles from '../widget-shared.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import {
  CoverageNote,
  GhostStatRow,
  MoreHidden,
  StatWidget,
  capabilityCoverageNote,
} from './shared.js';

// Conversations category was dissolved in the 2026-04-25 audit (3 cuts:
// topics, prompt-clarity, conversation-depth) for §10 anti-pattern
// violations. The category is revived thin with two file-axis widgets that
// use sentiment/topic as INPUTS to coordination questions, not as the
// headline metric. This is the framing §10 explicitly endorses for
// conversation data ("use as input to Failure Analysis, never alone").

const CONFUSED_FILES_VISIBLE = 10;

// confused-files: top files where the agent's user-side conversation
// expressed confusion or frustration in 2+ sessions. The widget surfaces
// FILES (a coordination axis), not sentiment polarity. Same E4 standing
// as `file-rework` and `live-conflicts` — system-language framing about
// where the work struggled, not personal commentary about messages.
//
// Phase 3b: lifted onto FileFrictionRow so the row reads as a member of
// the file-friction widget family. Severity-tinted bar carries the rank
// signal; trailing meta carries attribution. Color escalates --warn →
// --danger when retried_sessions > 0 (boolean threshold; revisit per
// open question in conversations-design.md once real data shape lands).
//
// Drill target: existing session-list filtered by file + sentiment=confused.
// That route does not exist as of Phase 3b — the URL params written here
// match the spec's intended shape so the drill is URL-traceable today and
// becomes a live drill the moment the filter view ships. Until then, the
// affordance is a hollow promise (documented gap, mirrors team-widget
// Reports gap).
function ConfusedFilesWidget({ analytics }: WidgetBodyProps) {
  const cf = analytics.confused_files;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'conversationLogs');
  if (cf.length === 0) {
    return (
      <>
        <SectionEmpty>
          Files where the agent struggled appear after 2+ sessions show confused or frustrated
          messages.
        </SectionEmpty>
        <CoverageNote text={note} />
      </>
    );
  }
  const visible = cf.slice(0, CONFUSED_FILES_VISIBLE);
  const hidden = cf.length - visible.length;
  const maxConfused = Math.max(...visible.map((f) => f.confused_sessions), 1);
  return (
    <>
      <div className={styles.dataList}>
        {visible.map((f, i) => {
          const barColor = f.retried_sessions > 0 ? 'var(--danger)' : 'var(--warn)';
          const labelText = f.file.split('/').slice(-2).join('/');
          return (
            <FileFrictionRow
              key={f.file}
              index={i}
              label={labelText}
              title={f.file}
              barFill={f.confused_sessions / maxConfused}
              barColor={barColor}
              meta={
                <>
                  {f.confused_sessions} confused · {f.retried_sessions} abandoned
                </>
              }
              onClick={() => setQueryParams({ file: f.file, sentiment: 'confused' })}
            />
          );
        })}
      </div>
      <MoreHidden count={hidden} />
      <CoverageNote text={note} />
    </>
  );
}

// unanswered-questions: count of user messages classified topic='question'
// inside sessions that ended abandoned. Frame is navigation aid (same shape
// as live-conflicts and files-in-play) — number drives drill into sessions
// to read what was asked, then save context as memory or spawn a follow-up.
// Not a metric in the §10-anti-pattern sense; the action is "go read these,"
// not "track this number."
//
// Phase 3b: promoted to StatWidget.onOpenDetail so the trailing ↗ makes the
// drill affordance real instead of implied. Label reframed from "questions
// abandoned" to "questions left open" — same number, slightly more action-
// coded verb. Empty-state copy gains an explicit appears-when line so the
// honesty matches confused-files's empty branch.
//
// Drill target: existing session-list filtered to abandoned + has_user_
// question=true. That route does not exist as of Phase 3b — the URL params
// written here match the spec's intended shape so the drill is URL-
// traceable today and becomes a live drill the moment the filter view
// ships. The widget is in SELF_DRILLING_WIDGETS so the renderer wrapper
// doesn't double-wrap the inner button.
function UnansweredQuestionsWidget({ analytics }: WidgetBodyProps) {
  const uq = analytics.unanswered_questions;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'conversationLogs');
  if (uq.count === 0) {
    return (
      <>
        <GhostStatRow labels={['questions left open']} />
        <div className={styles.coverageNote}>
          Appears when a session ends abandoned with an open user question.
        </div>
        <CoverageNote text={note} />
      </>
    );
  }
  return (
    <>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <StatWidget
            value={uq.count.toLocaleString()}
            onOpenDetail={() => setQueryParams({ outcome: 'abandoned', has_user_question: 'true' })}
            detailAriaLabel="Open questions left open"
          />
          <span className={styles.statBlockLabel}>questions left open</span>
        </div>
      </div>
      <CoverageNote text={note} />
    </>
  );
}

export const conversationWidgets: WidgetRegistry = {
  'confused-files': ConfusedFilesWidget,
  'unanswered-questions': UnansweredQuestionsWidget,
};

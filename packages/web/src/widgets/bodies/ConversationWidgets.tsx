import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import styles from '../widget-shared.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { CoverageNote, GhostStatRow, capabilityCoverageNote } from './shared.js';

// Conversations category was dissolved in the 2026-04-25 audit (3 cuts:
// topics, prompt-clarity, conversation-depth) for §10 anti-pattern
// violations. The category is revived thin with two file-axis widgets that
// use sentiment/topic as INPUTS to coordination questions, not as the
// headline metric. This is the framing §10 explicitly endorses for
// conversation data ("use as input to Failure Analysis, never alone").

// confused-files: top files where the agent's user-side conversation
// expressed confusion or frustration in 2+ sessions. The widget surfaces
// FILES (a coordination axis), not sentiment polarity. Same E4 standing
// as `file-rework` and `live-conflicts` — system-language framing about
// where the work struggled, not personal commentary about messages.
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
  return (
    <>
      <div className={styles.dataList}>
        {cf.slice(0, 10).map((f, i) => (
          <div
            key={f.file}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName} title={f.file}>
              {f.file.split('/').slice(-2).join('/')}
            </span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{f.confused_sessions}</span>{' '}
                {f.confused_sessions === 1 ? 'session' : 'sessions'}
              </span>
              {f.retried_sessions > 0 && (
                <span className={styles.dataStat} style={{ color: 'var(--warn)' }}>
                  <span className={styles.dataStatValue}>{f.retried_sessions}</span> abandoned
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
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
function UnansweredQuestionsWidget({ analytics }: WidgetBodyProps) {
  const uq = analytics.unanswered_questions;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'conversationLogs');
  if (uq.count === 0) {
    return (
      <>
        <GhostStatRow labels={['questions abandoned']} />
        <CoverageNote text={note} />
      </>
    );
  }
  return (
    <>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{uq.count.toLocaleString()}</span>
          <span className={styles.statBlockLabel}>questions abandoned</span>
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

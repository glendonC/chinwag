import { getToolsWithCapability } from '@chinwag/shared/tool-registry.js';
import styles from '../OverviewView.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { GhostBars, SENTIMENT_COLORS, CoverageNote } from './shared.js';

function conversationCoverageNote(analytics: WidgetBodyProps['analytics']): string | null {
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const capable = getToolsWithCapability('conversationLogs');
  const reporting = tools.filter((t) => capable.includes(t));
  if (reporting.length === 0 || reporting.length === tools.length) return null;
  return `Conversation data from ${reporting.join(', ')}`;
}

function TopicsWidget({ conversationData, analytics }: WidgetBodyProps) {
  const data = conversationData.topic_distribution;
  if (data.length === 0) return <GhostBars count={3} />;
  const maxC = Math.max(...data.map((t) => t.count), 1);
  const note = conversationCoverageNote(analytics);
  return (
    <>
      <div className={styles.metricBars}>
        {data.slice(0, 8).map((t) => (
          <div key={t.topic} className={styles.metricRow}>
            <span className={styles.metricLabel}>{t.topic}</span>
            <div className={styles.metricBarTrack}>
              <div
                className={styles.metricBarFill}
                style={{ width: `${(t.count / maxC) * 100}%` }}
              />
            </div>
            <span className={styles.durationCount}>{t.count}</span>
          </div>
        ))}
      </div>
      <CoverageNote text={note} />
    </>
  );
}

function SentimentOutcomesWidget({ conversationData, analytics }: WidgetBodyProps) {
  const soc = conversationData.sentiment_outcome_correlation;
  if (!soc || soc.length === 0) return <GhostBars count={3} />;
  const note = conversationCoverageNote(analytics);
  return (
    <>
      <div className={styles.metricBars}>
        {soc.map((s) => (
          <div key={s.dominant_sentiment} className={styles.metricRow}>
            <span className={styles.metricLabel}>{s.dominant_sentiment}</span>
            <div className={styles.metricBarTrack}>
              <div
                className={styles.metricBarFill}
                style={{
                  width: `${s.completion_rate}%`,
                  background: SENTIMENT_COLORS[s.dominant_sentiment] || 'var(--ghost)',
                  opacity: 0.6,
                }}
              />
            </div>
            <span className={styles.metricValue}>
              {s.completion_rate}% · {s.sessions}
            </span>
          </div>
        ))}
      </div>
      <CoverageNote text={note} />
    </>
  );
}

function ConversationDepthWidget({ analytics }: WidgetBodyProps) {
  const ced = analytics.conversation_edit_correlation;
  if (ced.length === 0) return <GhostBars count={4} />;
  const maxCed = Math.max(...ced.map((c) => c.avg_edits), 1);
  const note = conversationCoverageNote(analytics);
  return (
    <>
      <div className={styles.metricBars}>
        {ced.map((c) => (
          <div key={c.bucket} className={styles.metricRow}>
            <span className={styles.metricLabel}>{c.bucket} turns</span>
            <div className={styles.metricBarTrack}>
              <div
                className={styles.metricBarFill}
                style={{ width: `${(c.avg_edits / maxCed) * 100}%` }}
              />
            </div>
            <span className={styles.metricValue}>
              {c.avg_edits.toFixed(1)} edits · {c.completion_rate}%
            </span>
          </div>
        ))}
      </div>
      <CoverageNote text={note} />
    </>
  );
}

export const conversationWidgets: WidgetRegistry = {
  topics: TopicsWidget,
  'sentiment-outcomes': SentimentOutcomesWidget,
  'conversation-depth': ConversationDepthWidget,
};

import styles from '../OverviewView.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { GhostBars, GhostStatRow, SENTIMENT_COLORS } from './shared.js';

function SentimentWidget({ conversationData }: WidgetBodyProps) {
  const data = conversationData.sentiment_distribution;
  if (data.length === 0) {
    return (
      <div className={styles.metricBars} style={{ opacity: 0.25 }}>
        {['positive', 'neutral', 'frustrated'].map((s) => (
          <div key={s} className={styles.metricRow}>
            <span className={styles.metricLabel}>{s}</span>
            <div className={styles.metricBarTrack} />
            <span className={styles.durationCount}>—</span>
          </div>
        ))}
      </div>
    );
  }
  const maxC = Math.max(...data.map((s) => s.count), 1);
  return (
    <div className={styles.metricBars}>
      {data.map((s) => (
        <div key={s.sentiment} className={styles.metricRow}>
          <span className={styles.metricLabel}>{s.sentiment}</span>
          <div className={styles.metricBarTrack}>
            <div
              className={styles.metricBarFill}
              style={{
                width: `${(s.count / maxC) * 100}%`,
                background: SENTIMENT_COLORS[s.sentiment] || 'var(--ghost)',
              }}
            />
          </div>
          <span className={styles.durationCount}>{s.count}</span>
        </div>
      ))}
    </div>
  );
}

function TopicsWidget({ conversationData }: WidgetBodyProps) {
  const data = conversationData.topic_distribution;
  if (data.length === 0) {
    return (
      <div className={styles.metricBars} style={{ opacity: 0.25 }}>
        {['bug-fix', 'feature', 'refactor'].map((t) => (
          <div key={t} className={styles.metricRow}>
            <span className={styles.metricLabel}>{t}</span>
            <div className={styles.metricBarTrack} />
            <span className={styles.durationCount}>—</span>
          </div>
        ))}
      </div>
    );
  }
  const maxC = Math.max(...data.map((t) => t.count), 1);
  return (
    <div className={styles.metricBars}>
      {data.slice(0, 8).map((t) => (
        <div key={t.topic} className={styles.metricRow}>
          <span className={styles.metricLabel}>{t.topic}</span>
          <div className={styles.metricBarTrack}>
            <div className={styles.metricBarFill} style={{ width: `${(t.count / maxC) * 100}%` }} />
          </div>
          <span className={styles.durationCount}>{t.count}</span>
        </div>
      ))}
    </div>
  );
}

function SentimentOutcomesWidget({ conversationData }: WidgetBodyProps) {
  const soc = conversationData.sentiment_outcome_correlation;
  if (!soc || soc.length === 0) return <GhostBars count={3} />;
  return (
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
  );
}

function ConversationDepthWidget({ analytics }: WidgetBodyProps) {
  const ced = analytics.conversation_edit_correlation;
  if (ced.length === 0) return <GhostBars count={4} />;
  const maxCed = Math.max(...ced.map((c) => c.avg_edits), 1);
  return (
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
  );
}

function MessageLengthWidget({ conversationData }: WidgetBodyProps) {
  const u = conversationData.avg_user_char_count;
  const a = conversationData.avg_assistant_char_count;
  if (u === 0 && a === 0) return <GhostStatRow labels={['your prompts', 'responses']} />;
  return (
    <div className={styles.statRow}>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{Math.round(u).toLocaleString()}</span>
        <span className={styles.statBlockLabel}>your chars</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{Math.round(a).toLocaleString()}</span>
        <span className={styles.statBlockLabel}>response chars</span>
      </div>
      {u > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{Math.round(a / u)}×</span>
          <span className={styles.statBlockLabel}>response ratio</span>
        </div>
      )}
    </div>
  );
}

export const conversationWidgets: WidgetRegistry = {
  sentiment: SentimentWidget,
  topics: TopicsWidget,
  'sentiment-outcomes': SentimentOutcomesWidget,
  'conversation-depth': ConversationDepthWidget,
  'message-length': MessageLengthWidget,
};

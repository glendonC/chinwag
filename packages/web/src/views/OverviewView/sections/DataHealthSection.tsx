import { useMemo, type CSSProperties } from 'react';
import { aggregateModels } from '../overview-utils.js';
import type { UserAnalytics, ConversationAnalytics } from '../../../lib/apiSchemas.js';
import styles from '../OverviewView.module.css';

interface CategoryHealth {
  id: string;
  label: string;
  total: number;
  active: number;
  hint: string;
}

function computeCategories(a: UserAnalytics, conv: ConversationAnalytics): CategoryHealth[] {
  const models = aggregateModels(a.model_outcomes);

  return [
    {
      id: 'sessions',
      label: 'Session basics',
      total: 6,
      active: [
        a.stuckness.total_sessions > 0,
        a.hourly_distribution.length > 0 || a.duration_distribution.some((d) => d.count > 0),
        a.work_type_distribution.length > 0 &&
          a.work_type_distribution.reduce((s, w) => s + w.sessions, 0) > 0,
        a.work_type_outcomes.length > 0,
        a.scope_complexity.length > 0,
        a.first_edit_stats.avg_minutes_to_first_edit > 0 || a.first_edit_stats.by_tool.length > 0,
      ].filter(Boolean).length,
      hint: 'Run a few coding sessions',
    },
    {
      id: 'outcomes',
      label: 'Outcome analysis',
      total: 6,
      active: [
        a.period_comparison.current.total_sessions > 0 && a.period_comparison.previous !== null,
        a.hourly_effectiveness.length > 0,
        a.tool_outcomes.length > 0,
        a.conflict_correlation.length > 0,
        a.outcome_tags.length > 0,
        a.member_analytics.length > 0,
      ].filter(Boolean).length,
      hint: 'Complete or close some sessions',
    },
    {
      id: 'edits',
      label: 'Edit intelligence',
      total: 8,
      active: [
        a.edit_velocity.length >= 2,
        a.daily_trends.length >= 2,
        a.prompt_efficiency.length >= 2,
        a.file_heatmap.length > 0,
        a.directory_heatmap.length > 0,
        a.file_churn.length > 0,
        a.file_rework.length > 0,
        a.audit_staleness.length > 0,
      ].filter(Boolean).length,
      hint: 'Let agents make file edits',
    },
    {
      id: 'toolcalls',
      label: 'Tool call analytics',
      total: 3,
      active: [
        a.tool_call_stats.total_calls > 0,
        a.tool_call_stats.frequency.length > 0,
        a.tool_call_stats.error_patterns.length > 0,
      ].filter(Boolean).length,
      hint: 'Runs automatically with Claude Code',
    },
    {
      id: 'conversations',
      label: 'Conversation insights',
      total: 2,
      active: [
        a.conversation_edit_correlation.length > 0,
        conv.total_messages > 0 || conv.sessions_with_conversations > 0,
      ].filter(Boolean).length,
      hint: 'Use a tool with conversation capture',
    },
    {
      id: 'memory',
      label: 'Memory intelligence',
      total: 3,
      active: [
        a.memory_usage.total_memories > 0 || a.memory_usage.searches > 0,
        a.memory_outcome_correlation.length > 0,
        a.top_memories.length > 0,
      ].filter(Boolean).length,
      hint: 'Save or search shared memories',
    },
    {
      id: 'multitool',
      label: 'Multi-tool analysis',
      total: 3,
      active: [
        models.length >= 2,
        a.tool_handoffs.length > 0,
        a.concurrent_edits.length > 0,
      ].filter(Boolean).length,
      hint: 'Connect a second tool',
    },
    {
      id: 'tokens',
      label: 'Token usage',
      total: 2,
      active: [
        a.token_usage.sessions_with_token_data > 0,
        a.data_coverage !== undefined && a.data_coverage.tools_reporting.length > 0,
      ].filter(Boolean).length,
      hint: 'Use a tool that reports tokens',
    },
    {
      id: 'tools',
      label: 'Tool comparison',
      total: 2,
      active: [a.tool_comparison.length > 0, a.tool_work_type.length > 0].filter(Boolean).length,
      hint: 'Connect at least one tool',
    },
  ];
}

interface Props {
  analytics: UserAnalytics;
  conversationData: ConversationAnalytics;
}

export function DataHealthSection({ analytics, conversationData }: Props) {
  const categories = useMemo(
    () => computeCategories(analytics, conversationData),
    [analytics, conversationData],
  );

  const totalActive = categories.reduce((s, c) => s + c.active, 0);
  const totalPossible = categories.reduce((s, c) => s + c.total, 0);
  const waiting = categories.filter((c) => c.active < c.total);

  // All insights are active — no need to show this section
  if (waiting.length === 0) return null;

  const totalWaiting = totalPossible - totalActive;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Insights</span>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{totalActive}</span>
          <span className={styles.statBlockLabel}>active</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{totalWaiting}</span>
          <span className={styles.statBlockLabel}>waiting for data</span>
        </div>
      </div>
      <div className={styles.dataList}>
        {waiting.map((cat, i) => (
          <div
            key={cat.id}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName}>{cat.label}</span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>
                  {cat.active}/{cat.total}
                </span>
              </span>
              <span className={styles.dataStat} style={{ color: 'var(--muted)' }}>
                {cat.hint}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
import SectionEmpty from '../../../components/SectionEmpty/SectionEmpty.js';
import { aggregateModels } from '../overview-utils.js';
import type { UserAnalytics, ConversationAnalytics } from '../../../lib/apiSchemas.js';
import styles from '../OverviewView.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

interface CoverageCategory {
  id: string;
  label: string;
  total: number;
  active: number;
  hint: string;
}

function computeDataCoverage(a: UserAnalytics, conv: ConversationAnalytics): CoverageCategory[] {
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
        a.outcome_predictors.length > 0,
        a.tool_outcomes.length > 0,
        a.conflict_correlation.length > 0,
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

function DataCoverageWidget({ analytics, conversationData }: WidgetBodyProps) {
  const cats = computeDataCoverage(analytics, conversationData);
  const totalActive = cats.reduce((s, c) => s + c.active, 0);
  const totalPossible = cats.reduce((s, c) => s + c.total, 0);
  const waiting = cats.filter((c) => c.active < c.total);
  return (
    <>
      <div className={styles.statRow} style={{ marginBottom: 12 }}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{totalActive}</span>
          <span className={styles.statBlockLabel}>active</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{totalPossible - totalActive}</span>
          <span className={styles.statBlockLabel}>waiting</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>
            {Math.round((totalActive / Math.max(totalPossible, 1)) * 100)}%
          </span>
          <span className={styles.statBlockLabel}>coverage</span>
        </div>
      </div>
      {waiting.length === 0 ? (
        <SectionEmpty>All insights have data</SectionEmpty>
      ) : (
        <div className={styles.dataList}>
          {waiting.slice(0, 8).map((cat, i) => (
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
      )}
    </>
  );
}

export const dataCoverageWidgets: WidgetRegistry = {
  'data-coverage': DataCoverageWidget,
};

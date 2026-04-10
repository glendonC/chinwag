import { useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import { formatDuration } from '../../lib/utils.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import { ShimmerText, SkeletonRows } from '../../components/Skeleton/Skeleton.jsx';
import styles from '../OverviewView/OverviewView.module.css';

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];

const WORK_TYPE_COLORS: Record<string, string> = {
  frontend: '#5878ff',
  backend: '#34d68a',
  test: '#ffb366',
  styling: '#a585ff',
  docs: '#7e7af0',
  config: '#ff8a7a',
  other: '#98989d',
};

interface Props {
  analytics: UserAnalytics;
  isLoading: boolean;
  rangeDays: RangeDays;
  onRangeChange: (days: RangeDays) => void;
}

export default function ProjectAnalyticsTab({
  analytics,
  isLoading,
  rangeDays,
  onRangeChange,
}: Props) {
  const a = analytics;

  if (isLoading) {
    return (
      <div>
        <ShimmerText as="div" className={styles.sectionLabel}>
          Loading analytics
        </ShimmerText>
        <SkeletonRows count={4} columns={3} />
      </div>
    );
  }

  const hasData = a.completion_summary.total_sessions > 0;

  if (!hasData) {
    return (
      <EmptyState
        title="No analytics yet"
        hint="Session data will appear here once agents run in this project."
      />
    );
  }

  const cs = a.completion_summary;

  return (
    <div>
      {/* Range selector */}
      <div style={{ marginBottom: 32 }}>
        <div className={styles.rangeSelector} role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={clsx(styles.rangeButton, rangeDays === r && styles.rangeActive)}
              onClick={() => onRangeChange(r)}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {/* ── Headline stats ── */}
      <div className={styles.section}>
        <div className={styles.statRow}>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{cs.completion_rate}%</span>
            <span className={styles.statBlockLabel}>completion rate</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{cs.total_sessions}</span>
            <span className={styles.statBlockLabel}>sessions</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{cs.completed}</span>
            <span className={styles.statBlockLabel}>completed</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{cs.abandoned}</span>
            <span className={styles.statBlockLabel}>abandoned</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{cs.failed}</span>
            <span className={styles.statBlockLabel}>failed</span>
          </div>
        </div>
      </div>

      {/* ── Session health ── */}
      {a.stuckness.total_sessions > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Session health</span>
          <div className={styles.statRow}>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{a.stuckness.stuckness_rate}%</span>
              <span className={styles.statBlockLabel}>got stuck</span>
            </div>
            {a.stuckness.stuck_sessions > 0 && (
              <div className={styles.statBlock}>
                <span className={styles.statBlockValue}>{a.stuckness.stuck_completion_rate}%</span>
                <span className={styles.statBlockLabel}>stuck completed</span>
              </div>
            )}
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{a.stuckness.normal_completion_rate}%</span>
              <span className={styles.statBlockLabel}>normal completed</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Agent warmup ── */}
      {(a.first_edit_stats.avg_minutes_to_first_edit > 0 ||
        a.first_edit_stats.by_tool.length > 0) && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Agent warmup</span>
          <div className={styles.statRow}>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {formatDuration(a.first_edit_stats.avg_minutes_to_first_edit)}
              </span>
              <span className={styles.statBlockLabel}>avg to first edit</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {formatDuration(a.first_edit_stats.median_minutes_to_first_edit)}
              </span>
              <span className={styles.statBlockLabel}>median</span>
            </div>
          </div>
          {a.first_edit_stats.by_tool.length > 1 && (
            <div className={styles.metricBars} style={{ marginTop: 16 }}>
              {a.first_edit_stats.by_tool.map((t) => {
                const max = Math.max(...a.first_edit_stats.by_tool.map((x) => x.avg_minutes), 1);
                const pct = (t.avg_minutes / max) * 100;
                const meta = getToolMeta(t.host_tool);
                return (
                  <div key={t.host_tool} className={styles.metricRow}>
                    <span className={styles.metricLabel}>{meta.label}</span>
                    <div className={styles.metricBarTrack}>
                      <div className={styles.metricBarFill} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={styles.metricValue}>
                      {formatDuration(t.avg_minutes)} ({t.sessions})
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tool comparison ── */}
      {a.tool_comparison.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Tool effectiveness</span>
          <div className={styles.dataList}>
            {a.tool_comparison.map((t, i) => {
              const meta = getToolMeta(t.host_tool);
              return (
                <div
                  key={t.host_tool}
                  className={styles.dataRow}
                  style={{ '--row-index': i } as CSSProperties}
                >
                  <span className={styles.dataName}>{meta.label}</span>
                  <div className={styles.dataMeta}>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>{t.completion_rate}%</span> rate
                    </span>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>{t.sessions}</span> sessions
                    </span>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>
                        {formatDuration(t.avg_duration_min)}
                      </span>{' '}
                      avg
                    </span>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>
                        {(t.total_lines_added + t.total_lines_removed).toLocaleString()}
                      </span>{' '}
                      lines
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Work type outcomes ── */}
      {a.work_type_outcomes.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Completion by work type</span>
          <div className={styles.metricBars}>
            {a.work_type_outcomes.map((o) => {
              const maxSessions = Math.max(...a.work_type_outcomes.map((x) => x.sessions), 1);
              const pct = (o.sessions / maxSessions) * 100;
              return (
                <div key={o.work_type} className={styles.metricRow}>
                  <span className={styles.metricLabel}>{o.work_type}</span>
                  <div className={styles.metricBarTrack}>
                    <div
                      className={styles.metricBarFill}
                      style={{
                        width: `${pct}%`,
                        background: WORK_TYPE_COLORS[o.work_type] || WORK_TYPE_COLORS.other,
                        opacity: 0.5,
                      }}
                    />
                  </div>
                  <span className={styles.metricValue}>{o.completion_rate}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Edit velocity ── */}
      {a.edit_velocity.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Edit velocity</span>
          <div className={styles.statRow}>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {a.edit_velocity.length > 0
                  ? Math.round(
                      (a.edit_velocity.reduce((s, d) => s + d.edits_per_hour, 0) /
                        a.edit_velocity.length) *
                        10,
                    ) / 10
                  : 0}
              </span>
              <span className={styles.statBlockLabel}>avg edits/hr</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {Math.round(a.edit_velocity.reduce((s, d) => s + d.total_session_hours, 0))}
              </span>
              <span className={styles.statBlockLabel}>total session hours</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Conversation depth ── */}
      {a.conversation_edit_correlation.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Conversation depth</span>
          <div className={styles.dataList}>
            {a.conversation_edit_correlation.map((d, i) => (
              <div
                key={d.bucket}
                className={styles.dataRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.dataName}>{d.bucket}</span>
                <div className={styles.dataMeta}>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{d.sessions}</span> sessions
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{d.avg_edits}</span> avg edits
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{d.avg_lines}</span> avg lines
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{d.completion_rate}%</span> completed
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Directory heatmap ── */}
      {a.directory_heatmap.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Directory heatmap</span>
          <div className={styles.metricBars}>
            {a.directory_heatmap.slice(0, 15).map((d) => {
              const max = Math.max(...a.directory_heatmap.map((x) => x.touch_count), 1);
              const pct = (d.touch_count / max) * 100;
              return (
                <div key={d.directory} className={styles.metricRow}>
                  <span className={styles.metricLabel} title={d.directory}>
                    {d.directory}
                  </span>
                  <div className={styles.metricBarTrack}>
                    <div className={styles.metricBarFill} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={styles.metricValue}>{d.touch_count}</span>
                  <span
                    className={
                      d.completion_rate >= 70
                        ? styles.dataStatSuccess
                        : d.completion_rate < 50
                          ? styles.dataStatDanger
                          : styles.dataStatWarn
                    }
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 'var(--text-xs)',
                      width: 40,
                      textAlign: 'right',
                      flexShrink: 0,
                    }}
                  >
                    {d.completion_rate.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── File rework ── */}
      {a.file_rework.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>File rework</span>
          <div className={styles.dataList}>
            {a.file_rework.slice(0, 15).map((f, i) => (
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
                    <span className={styles.dataStatDanger}>{f.rework_ratio}%</span> rework
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{f.failed_edits}</span>/{f.total_edits}{' '}
                    failed
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── File churn ── */}
      {a.file_churn.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>High-churn files</span>
          <div className={styles.dataList}>
            {a.file_churn.slice(0, 15).map((f, i) => (
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
                    <span className={styles.dataStatValue}>{f.session_count}</span> sessions
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{f.total_edits}</span> edits
                  </span>
                  {f.total_lines > 0 && (
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>{f.total_lines.toLocaleString()}</span>{' '}
                      lines
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Audit staleness ── */}
      {a.audit_staleness.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Audit staleness</span>
          <div className={styles.dataList}>
            {a.audit_staleness.map((s, i) => (
              <div
                key={s.directory}
                className={styles.dataRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.dataName}>{s.directory}</span>
                <div className={styles.dataMeta}>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatWarn}>{s.days_since}d</span> since last edit
                  </span>
                  <span className={styles.dataStat}>{s.last_edit.slice(0, 10)}</span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{s.prior_edit_count}</span> prior edits
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Team members ── */}
      {a.member_analytics.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Team members</span>
          <div className={styles.dataList}>
            {a.member_analytics.map((m, i) => {
              const meta = m.primary_tool ? getToolMeta(m.primary_tool) : null;
              return (
                <div
                  key={m.handle}
                  className={styles.dataRow}
                  style={{ '--row-index': i } as CSSProperties}
                >
                  <span className={styles.dataName}>
                    {m.handle}
                    {meta && (
                      <span className={styles.dataStat} style={{ marginLeft: 8 }}>
                        {meta.label}
                      </span>
                    )}
                  </span>
                  <div className={styles.dataMeta}>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>{m.completion_rate}%</span> rate
                    </span>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>{m.sessions}</span> sessions
                    </span>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>{m.total_edits.toLocaleString()}</span>{' '}
                      edits
                    </span>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>
                        {(m.total_lines_added + m.total_lines_removed).toLocaleString()}
                      </span>{' '}
                      lines
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Multi-agent files ── */}
      {a.concurrent_edits.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Multi-agent files</span>
          <div className={styles.dataList}>
            {a.concurrent_edits.slice(0, 15).map((e, i) => (
              <div
                key={e.file}
                className={styles.dataRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.dataName} title={e.file}>
                  {e.file.split('/').slice(-2).join('/')}
                </span>
                <div className={styles.dataMeta}>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{e.agents}</span> agents
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{e.edit_count}</span> edits
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── File overlap ── */}
      {a.file_overlap.total_files > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>File overlap</span>
          <div className={styles.statRow}>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{a.file_overlap.overlap_rate}%</span>
              <span className={styles.statBlockLabel}>files shared</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{a.file_overlap.overlapping_files}</span>
              <span className={styles.statBlockLabel}>overlapping</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{a.file_overlap.total_files}</span>
              <span className={styles.statBlockLabel}>total files</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Conflict impact ── */}
      {a.conflict_correlation.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Conflict impact</span>
          <div className={styles.compareRow}>
            {a.conflict_correlation.map((d) => (
              <div key={d.bucket} className={styles.compareBlock}>
                <span className={styles.compareValue}>{d.completion_rate}%</span>
                <span className={styles.compareLabel}>
                  {d.bucket} ({d.sessions})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Retry patterns ── */}
      {a.retry_patterns.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Retry patterns</span>
          <div className={styles.dataList}>
            {a.retry_patterns.slice(0, 15).map((r, i) => (
              <div
                key={`${r.handle}-${r.file}`}
                className={styles.dataRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.dataName} title={r.file}>
                  <span style={{ fontWeight: 600 }}>{r.handle}</span>{' '}
                  {r.file.split('/').slice(-2).join('/')}
                </span>
                <div className={styles.dataMeta}>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{r.attempts}</span> attempts
                  </span>
                  <span className={styles.dataStat}>
                    <span className={r.resolved ? styles.dataStatSuccess : styles.dataStatDanger}>
                      {r.resolved ? 'resolved' : r.final_outcome || 'unresolved'}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Memory health ── */}
      {(a.memory_usage.total_memories > 0 || a.memory_usage.searches > 0) && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Memory health</span>
          <div className={styles.statRow}>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{a.memory_usage.total_memories}</span>
              <span className={styles.statBlockLabel}>total</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{a.memory_usage.search_hit_rate}%</span>
              <span className={styles.statBlockLabel}>hit rate</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {a.memory_usage.memories_created_period}
              </span>
              <span className={styles.statBlockLabel}>created this period</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {a.memory_usage.memories_updated_period}
              </span>
              <span className={styles.statBlockLabel}>updated this period</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{a.memory_usage.stale_memories}</span>
              <span className={styles.statBlockLabel}>stale (30d+)</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Memory impact ── */}
      {a.memory_outcome_correlation.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Memory impact</span>
          <div className={styles.compareRow}>
            {a.memory_outcome_correlation.map((d) => (
              <div key={d.bucket} className={styles.compareBlock}>
                <span className={styles.compareValue}>{d.completion_rate}%</span>
                <span className={styles.compareLabel}>
                  {d.bucket} ({d.sessions})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Top memories ── */}
      {a.top_memories.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Most accessed memories</span>
          <div className={styles.dataList}>
            {a.top_memories.slice(0, 10).map((m, i) => (
              <div
                key={m.id}
                className={styles.dataRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.memoryPreview}>{m.text_preview}</span>
                <div className={styles.dataMeta}>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{m.access_count}</span> hits
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Task scope vs outcome ── */}
      {a.scope_complexity.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Task scope vs outcome</span>
          <div className={styles.dataList}>
            {a.scope_complexity.map((d, i) => (
              <div
                key={d.bucket}
                className={styles.dataRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.dataName}>{d.bucket}</span>
                <div className={styles.dataMeta}>
                  <span className={styles.dataStat}>
                    <span
                      className={
                        d.completion_rate < 50 ? styles.dataStatDanger : styles.dataStatValue
                      }
                    >
                      {d.completion_rate}%
                    </span>{' '}
                    completed
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{d.sessions}</span> sessions
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{d.avg_edits}</span> avg edits
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>
                      {formatDuration(d.avg_duration_min)}
                    </span>{' '}
                    avg time
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Prompt efficiency ── */}
      {a.prompt_efficiency.length >= 2 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Prompt efficiency</span>
          <div className={styles.statRow}>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {Math.round(
                  (a.prompt_efficiency.reduce((s, d) => s + d.avg_turns_per_edit, 0) /
                    a.prompt_efficiency.length) *
                    10,
                ) / 10}
              </span>
              <span className={styles.statBlockLabel}>avg turns per edit</span>
            </div>
          </div>
        </div>
      )}

      {/* ── When you work best ── */}
      {a.hourly_effectiveness.length > 0 &&
        (() => {
          const withData = a.hourly_effectiveness.filter((d) => d.sessions > 0);
          if (withData.length === 0) return null;
          const best = [...withData].sort((x, y) => y.completion_rate - x.completion_rate)[0];
          const fmtHour = (h: number) =>
            h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
          return (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>When you work best</span>
              <div className={styles.statRow} style={{ marginBottom: 16 }}>
                <div className={styles.statBlock}>
                  <span className={styles.statBlockValue}>{fmtHour(best.hour)}</span>
                  <span className={styles.statBlockLabel}>best hour ({best.completion_rate}%)</span>
                </div>
              </div>
              <div className={styles.metricBars}>
                {withData.map((d) => (
                  <div key={d.hour} className={styles.metricRow}>
                    <span className={styles.metricLabel}>{fmtHour(d.hour)}</span>
                    <div className={styles.metricBarTrack}>
                      <div
                        className={clsx(
                          styles.metricBarFill,
                          d.completion_rate < 50 && styles.metricBarWarn,
                        )}
                        style={{ width: `${d.completion_rate}%` }}
                      />
                    </div>
                    <span className={styles.metricValue}>
                      {d.completion_rate}% / {d.avg_edits}e
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      {/* ── Cross-tool handoffs ── */}
      {a.tool_handoffs.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Cross-tool handoffs</span>
          <div className={styles.dataList}>
            {a.tool_handoffs.map((d, i) => {
              const fromMeta = getToolMeta(d.from_tool);
              const toMeta = getToolMeta(d.to_tool);
              return (
                <div
                  key={`${d.from_tool}-${d.to_tool}`}
                  className={styles.dataRow}
                  style={{ '--row-index': i } as CSSProperties}
                >
                  <span className={styles.dataName}>
                    {fromMeta.label} → {toMeta.label}
                  </span>
                  <div className={styles.dataMeta}>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>{d.file_count}</span> files
                    </span>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>{d.handoff_completion_rate}%</span>{' '}
                      completed
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Failure reasons ── */}
      {a.outcome_tags.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Failure reasons</span>
          <div className={styles.metricBars}>
            {a.outcome_tags.slice(0, 15).map((d) => {
              const max = Math.max(...a.outcome_tags.map((x) => x.count), 1);
              const pct = (d.count / max) * 100;
              return (
                <div key={`${d.tag}-${d.outcome}`} className={styles.metricRow}>
                  <span className={styles.metricLabel} title={d.tag}>
                    {d.tag}
                  </span>
                  <div className={styles.metricBarTrack}>
                    <div
                      className={clsx(
                        styles.metricBarFill,
                        d.outcome === 'failed' ? styles.metricBarDanger : styles.metricBarWarn,
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={styles.metricValue}>{d.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── First edit timing by outcome ── */}
      {a.outcome_predictors.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>First edit timing by outcome</span>
          <div className={styles.compareRow}>
            {a.outcome_predictors.map((d) => (
              <div key={d.outcome} className={styles.compareBlock}>
                <span className={styles.compareValue}>{formatDuration(d.avg_first_edit_min)}</span>
                <span className={styles.compareLabel}>
                  {d.outcome} ({d.sessions})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

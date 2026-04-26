import { useState, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import s from './MemoryWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

/* Memory category bodies — chromeless tiles built from the same primitives
 * the live and outcomes categories use.
 *
 *   memory          → KPI hero (count + age + stale)
 *   memory hygiene  → KPI hero (pending + caption)
 *   secrets blocked → KPI hero (count + caption)
 *   freshness       → 4-bucket terrace (mirrors scope-complexity)
 *   cross-tool flow → subgrid table (mirrors live-agents)
 *   concentration   → subgrid table with hero share % per row
 *   categories      → type ladder (weight encodes rank, no bars)
 *   outcomes        → proportional bars (real height, not hairlines)
 *
 * One color signal per widget. Color tokens never decorate; they encode
 * tool identity (cross-tool flow) or severity tone (freshness, concentration,
 * outcomes). Mono for measurements, sans/display for identifiers.
 */

const MEMORY_OUTCOMES_MIN_SESSIONS = 10;
const TOP_CATEGORIES_VISIBLE = 8;
const FLOW_PAIRS_VISIBLE = 6;
const SINGLE_AUTHOR_VISIBLE = 8;
const TOP_MEMORIES_VISIBLE = 8;

function fmt(n: number): string {
  return n.toLocaleString();
}

// Severity-tinted age palette for the freshness terrace. Fresh reads as
// success, mid-age as ink, late as warn, stale as soft. Color is the only
// place the bucket boundaries register visually — the height already carries
// the count.
const AGE_COLORS: Record<string, string> = {
  '0-7d': 'var(--success)',
  '8-30d': 'var(--ink)',
  '31-90d': 'var(--warn)',
  '90d+': 'var(--soft)',
};

function completionTone(rate: number): string {
  if (rate >= 70) return 'var(--success)';
  if (rate >= 40) return 'var(--warn)';
  return 'var(--danger)';
}

// ── memory (KPI hero: count + age + stale) ──────────

function MemoryHealthWidget({ analytics }: WidgetBodyProps) {
  const m = analytics.memory_usage;
  if (m.total_memories === 0) {
    return (
      <div className={s.kpi}>
        <div className={s.kpiHero}>
          <span className={`${s.kpiHeroValue} ${s.kpiHeroValueIdle}`}>—</span>
        </div>
        <span className={s.kpiCaption}>no memories saved yet</span>
      </div>
    );
  }
  const avg = Math.round(m.avg_memory_age_days);
  return (
    <div className={s.kpi}>
      <div className={s.kpiHero}>
        <span className={s.kpiHeroValue}>{fmt(m.total_memories)}</span>
      </div>
      <span className={s.kpiCaption}>
        <span className={s.kpiCaptionAccent}>{avg}d</span> avg age
        {m.stale_memories > 0 && (
          <>
            {' · '}
            <span className={s.kpiCaptionWarn}>{fmt(m.stale_memories)}</span> stale
          </>
        )}
      </span>
    </div>
  );
}

// ── memory freshness (4-bucket terrace) ─────────────
//
// Hero %fresh on top; the terrace silhouette below is the substantive viz.
// Heights encode bucket counts; colors encode age tone. The shape itself is
// the answer — tall left = mostly fresh, tall right = mostly stale.

function MemoryAgingCurveWidget({ analytics }: WidgetBodyProps) {
  const a = analytics.memory_aging;
  const total = a.recent_7d + a.recent_30d + a.recent_90d + a.older;
  if (total === 0) {
    return (
      <div className={s.kpi}>
        <div className={s.kpiHero}>
          <span className={`${s.kpiHeroValue} ${s.kpiHeroValueIdle}`}>—</span>
        </div>
        <span className={s.kpiCaption}>aging curve appears after first save</span>
      </div>
    );
  }
  const freshPct = Math.round(((a.recent_7d + a.recent_30d) / total) * 100);
  const buckets = [
    { key: '0-7d', label: '0–7d', count: a.recent_7d },
    { key: '8-30d', label: '8–30d', count: a.recent_30d },
    { key: '31-90d', label: '31–90d', count: a.recent_90d },
    { key: '90d+', label: '90d+', count: a.older },
  ];
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className={s.kpiSplit}>
      <div className={s.kpiHero}>
        <span className={s.kpiHeroValue}>{freshPct}</span>
        <span className={s.kpiHeroSuffix}>% fresh</span>
      </div>
      <div className={s.terrace}>
        <div className={s.terraceViz}>
          {buckets.map((b, i) => (
            <span
              key={b.key}
              className={s.terraceStep}
              style={
                {
                  '--step-h': `${(b.count / maxCount) * 100}%`,
                  '--step-color': AGE_COLORS[b.key],
                  '--row-index': i,
                } as CSSProperties
              }
              title={`${b.label}: ${b.count}`}
            />
          ))}
        </div>
        <div className={s.terraceLabels}>
          {buckets.map((b, i) => (
            <span
              key={b.key}
              className={s.terraceLabel}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={s.terraceCount}>{b.count}</span>
              <span className={s.terraceBucket}>{b.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── memory across tools (subgrid table) ─────────────
//
// FROM | TO | MEMORIES | SESSIONS — same shape as live-agents. Tool-color
// dot beside each tool label. No bars; ranking is implicit in row order.

function MemoryCrossToolFlowWidget({ analytics }: WidgetBodyProps) {
  const flow = analytics.cross_tool_memory_flow;
  if (flow.length === 0) {
    return (
      <SectionEmpty>
        Cross-tool flow appears once two tools have memories and active sessions.
      </SectionEmpty>
    );
  }
  const sorted = [...flow].sort((a, b) => b.memories - a.memories);
  const visible = sorted.slice(0, FLOW_PAIRS_VISIBLE);
  return (
    <div className={s.flowTable}>
      <div className={s.tableHeader}>
        <span>From</span>
        <span>To</span>
        <span className={s.tableHeaderNum}>Memories</span>
        <span className={s.tableHeaderNum}>Sessions</span>
      </div>
      <div className={s.tableBody}>
        {visible.map((f, i) => {
          const from = getToolMeta(f.author_tool);
          const to = getToolMeta(f.consumer_tool);
          return (
            <div
              key={`${f.author_tool}-${f.consumer_tool}`}
              className={s.tableRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={s.tableTool}>
                <span className={s.tableToolDot} style={{ background: from.color }} />
                <span className={s.tableToolName}>{from.label}</span>
              </span>
              <span className={s.tableTool}>
                <span className={s.tableToolDot} style={{ background: to.color }} />
                <span className={s.tableToolName}>{to.label}</span>
              </span>
              <span className={s.tableNum}>{fmt(f.memories)}</span>
              <span className={s.tableNumSecondary}>{fmt(f.consumer_sessions)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── memory concentration (subgrid table, hero share %) ──
//
// DIRECTORY | SHARE | COUNT — share % rendered as a display-weight number,
// severity-tinted (warn at ≥80% single-author share). The number itself
// IS the bar; no separate viz strip.

function MemoryBusFactorWidget({ analytics }: WidgetBodyProps) {
  const dirs = analytics.memory_single_author_directories;
  if (dirs.length === 0) {
    return (
      <SectionEmpty>
        Concentration surfaces when 2+ authors save memories and a directory has only one.
      </SectionEmpty>
    );
  }
  const sorted = [...dirs].sort((a, b) => {
    const sa = a.total_count > 0 ? a.single_author_count / a.total_count : 0;
    const sb = b.total_count > 0 ? b.single_author_count / b.total_count : 0;
    return sb - sa;
  });
  const visible = sorted.slice(0, SINGLE_AUTHOR_VISIBLE);
  return (
    <div className={s.concTable}>
      <div className={s.tableHeader}>
        <span>Directory</span>
        <span className={s.tableHeaderNum}>Share</span>
        <span className={s.tableHeaderNum}>Count</span>
      </div>
      <div className={s.tableBody}>
        {visible.map((d, i) => {
          const share = d.total_count > 0 ? d.single_author_count / d.total_count : 0;
          const sharePct = Math.round(share * 100);
          const severe = share >= 0.8;
          return (
            <div
              key={d.directory}
              className={s.tableRow}
              style={{ '--row-index': i } as CSSProperties}
              title={d.directory}
            >
              <span className={s.concPath}>{d.directory}</span>
              <span className={`${s.concShare} ${severe ? s.concShareSevere : s.concShareNormal}`}>
                {sharePct}%
              </span>
              <span className={s.tableNumSecondary}>
                {d.single_author_count}/{d.total_count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── knowledge categories (type ladder) ──────────────
//
// Chromeless ranked list. The rank itself is the gesture: weight scales
// from 600 (top) → 400 (tail), and color fades from --ink to --soft. No
// bars, no fills, no dividers. The eye reads down the column and the type
// itself communicates importance.

function MemoryCategoriesWidget({ analytics }: WidgetBodyProps) {
  const cats = analytics.memory_categories;
  if (cats.length === 0) {
    return <SectionEmpty>Categories appear when agents tag memories on save.</SectionEmpty>;
  }
  const visible = cats.slice(0, TOP_CATEGORIES_VISIBLE);
  return (
    <div className={s.ladder}>
      {visible.map((c, i) => {
        const rank = i / Math.max(visible.length - 1, 1); // 0 → 1
        const weight = Math.round(600 - rank * 200); // 600 → 400
        const fontSize = `calc(var(--text-md) - ${(rank * 0.0625).toFixed(3)}rem)`; // 14px → 13px
        const color = i === 0 ? 'var(--ink)' : i < 3 ? 'var(--ink)' : 'var(--muted)';
        return (
          <div
            key={c.category}
            className={s.ladderRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span
              className={s.ladderName}
              style={
                {
                  '--ladder-weight': weight,
                  '--ladder-size': fontSize,
                  '--ladder-color': color,
                } as CSSProperties
              }
            >
              {c.category}
            </span>
            <span className={s.ladderCount}>{fmt(c.count)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── outcomes by memory (proportional bars) ──────────
//
// Three rows: mono label / 10px-tall proportional bar / mono percent +
// session count. Color tones the bar by completion-rate severity. Real
// height (not hairlines) so the bars register as data, not strokes.

function MemoryOutcomesWidget({ analytics }: WidgetBodyProps) {
  const moc = analytics.memory_outcome_correlation;
  const totalSessions = moc.reduce((sum, m) => sum + m.sessions, 0);
  if (totalSessions === 0) return <SectionEmpty>No sessions this period.</SectionEmpty>;
  if (totalSessions < MEMORY_OUTCOMES_MIN_SESSIONS) {
    return (
      <SectionEmpty>
        Need {MEMORY_OUTCOMES_MIN_SESSIONS}+ sessions for a reliable correlation.
      </SectionEmpty>
    );
  }
  return (
    <div className={s.outcomeBars}>
      {moc.map((m, i) => (
        <div key={m.bucket} className={s.outcomeRow} style={{ '--row-index': i } as CSSProperties}>
          <span className={s.outcomeLabel}>{m.bucket}</span>
          <span
            className={s.outcomeBar}
            style={
              {
                '--bar-w': `${m.completion_rate}%`,
                '--bar-color': completionTone(m.completion_rate),
              } as CSSProperties
            }
          />
          <span className={s.outcomeStat}>
            {m.completion_rate}%<span className={s.outcomeStatSessions}>· {fmt(m.sessions)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── memory hygiene (KPI hero: pending + flow caption) ──

function MemorySupersessionFlowWidget({ analytics }: WidgetBodyProps) {
  const sup = analytics.memory_supersession;
  const idle =
    sup.pending_proposals === 0 && sup.invalidated_period === 0 && sup.merged_period === 0;
  return (
    <div className={s.kpi}>
      <div className={s.kpiHero}>
        <span
          className={`${s.kpiHeroValue} ${
            sup.pending_proposals > 0 ? s.kpiHeroValueWarn : idle ? s.kpiHeroValueIdle : ''
          }`}
        >
          {fmt(sup.pending_proposals)}
        </span>
        <span className={s.kpiHeroSuffix}>pending</span>
      </div>
      <span className={s.kpiCaption}>
        {idle ? (
          'consolidation idle'
        ) : (
          <>
            <span className={s.kpiCaptionAccent}>{fmt(sup.invalidated_period)}</span> invalidated ·{' '}
            <span className={s.kpiCaptionAccent}>{fmt(sup.merged_period)}</span> merged
          </>
        )}
      </span>
    </div>
  );
}

// ── secrets blocked (KPI hero: blocked + 24h caption) ──

function MemorySecretsShieldWidget({ analytics }: WidgetBodyProps) {
  const ss = analytics.memory_secrets_shield;
  const idle = ss.blocked_period === 0 && ss.blocked_24h === 0;
  return (
    <div className={s.kpi}>
      <div className={s.kpiHero}>
        <span
          className={`${s.kpiHeroValue} ${
            ss.blocked_period > 0 ? s.kpiHeroValueWarn : s.kpiHeroValueIdle
          }`}
        >
          {fmt(ss.blocked_period)}
        </span>
        <span className={s.kpiHeroSuffix}>blocked</span>
      </div>
      <span className={s.kpiCaption}>
        {idle ? (
          'shield active'
        ) : (
          <>
            <span className={ss.blocked_24h > 0 ? s.kpiCaptionWarn : s.kpiCaptionAccent}>
              {fmt(ss.blocked_24h)}
            </span>{' '}
            in last 24h
          </>
        )}
      </span>
    </div>
  );
}

// ── top memories (type ladder, same primitive as categories) ──

function TopMemoriesWidget({ analytics }: WidgetBodyProps) {
  const [nowMs] = useState(() => Date.now());
  const tm = analytics.top_memories;
  if (tm.length === 0) return <SectionEmpty>No memories accessed.</SectionEmpty>;
  const visible = tm.slice(0, TOP_MEMORIES_VISIBLE);
  return (
    <div className={s.ladder}>
      {visible.map((m, i) => {
        const rank = i / Math.max(visible.length - 1, 1);
        const weight = Math.round(600 - rank * 200);
        const color = i === 0 ? 'var(--ink)' : i < 3 ? 'var(--ink)' : 'var(--muted)';
        const days = m.last_accessed_at
          ? Math.max(0, Math.floor((nowMs - new Date(m.last_accessed_at).getTime()) / 86_400_000))
          : null;
        return (
          <div
            key={m.id}
            className={s.ladderRow}
            style={{ '--row-index': i } as CSSProperties}
            title={m.text_preview}
          >
            <span
              className={s.ladderName}
              style={
                {
                  '--ladder-weight': weight,
                  '--ladder-color': color,
                } as CSSProperties
              }
            >
              {m.text_preview}
            </span>
            <span className={s.ladderCount}>
              {fmt(m.access_count)}
              {days !== null && ` · ${days === 0 ? 'today' : `${days}d`}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const memoryWidgets: WidgetRegistry = {
  'memory-outcomes': MemoryOutcomesWidget,
  'memory-cross-tool-flow': MemoryCrossToolFlowWidget,
  'memory-aging-curve': MemoryAgingCurveWidget,
  'memory-categories': MemoryCategoriesWidget,
  'top-memories': TopMemoriesWidget,
  'memory-health': MemoryHealthWidget,
  'memory-bus-factor': MemoryBusFactorWidget,
  'memory-supersession-flow': MemorySupersessionFlowWidget,
  'memory-secrets-shield': MemorySecretsShieldWidget,
};

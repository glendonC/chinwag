// Four new drill-in sections for StackToolDetail.
// All currently render from preview data keyed on the tool id. When
// real per-tool tool-call analytics land, swap the source to props.
//
// Sections:
//   - InternalUsageSection    — research-to-edit ratio + top internal tools
//   - SessionShapeSection     — timeline replay of a representative session
//   - ModelPairingsSection    — which models work best with this tool
//   - ScopeComplexitySection  — files-touched distribution

import type { CSSProperties } from 'react';
import {
  classifyToolCall,
  type ToolCallCategory,
} from '@chinmeister/shared/tool-call-categories.js';
import {
  PREVIEW_INTERNAL_USAGE,
  PREVIEW_SESSION_SHAPES,
  PREVIEW_SCOPE_COMPLEXITY,
  PREVIEW_TOOL_MODEL,
  type SessionEvent,
} from './previewData.js';
import Eyebrow from '../../components/Eyebrow/Eyebrow.js';
import styles from './DrillSections.module.css';

// Each drill section is framed in a local `drillSection` wrapper so the
// visual language matches the rest of the detail view but the layout
// stays independent of StackToolDetail.module.css.

interface SectionFrameProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  isPreview?: boolean;
  children: React.ReactNode;
}

function SectionFrame({ eyebrow, title, subtitle, isPreview, children }: SectionFrameProps) {
  return (
    <section className={styles.drillSection}>
      <header className={styles.sectionHeader}>
        <Eyebrow label={eyebrow} showPreview={isPreview} />
        <h3 className={styles.sectionTitle}>{title}</h3>
        {subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

// ── Internal usage ──────────────────────────────────────────

const CATEGORY_COLORS: Record<ToolCallCategory, string> = {
  research: '#9ac3e5',
  edit: '#f4c19a',
  exec: '#c8a3d4',
  memory: '#8ec0a4',
  other: '#aab1bd',
};

const CATEGORY_LABEL: Record<ToolCallCategory, string> = {
  research: 'Research',
  edit: 'Edit',
  exec: 'Exec',
  memory: 'Memory',
  other: 'Other',
};

export function InternalUsageSection({ toolId }: { toolId: string }) {
  const data = PREVIEW_INTERNAL_USAGE[toolId] ?? PREVIEW_INTERNAL_USAGE['claude-code'];
  const maxCalls = data.topTools.reduce((m, t) => Math.max(m, t.calls), 0);

  return (
    <SectionFrame
      eyebrow="How it works"
      title="What this tool does inside a session"
      subtitle="Every internal tool call captured from the agent — Read, Edit, Bash, Grep, and more. Error rate and latency reveal where the agent fights its environment."
      isPreview
    >
      <div className={styles.usageGrid}>
        <div className={styles.ratioCard}>
          <span className={styles.ratioValue}>{data.researchToEditRatio.toFixed(1)}:1</span>
          <span className={styles.ratioLabel}>Research-to-edit</span>
          <span className={styles.ratioHint}>
            Reads + searches per edit. Higher = more context-gathering before changing code.
          </span>
        </div>

        <ul className={styles.usageList}>
          {data.topTools.map((t, i) => {
            const widthPct = maxCalls > 0 ? (t.calls / maxCalls) * 100 : 0;
            // Category always comes from the shared classifier so preview
            // and live data go through the same code path. Any tool name
            // not in the canonical map falls through to 'other'.
            const category = classifyToolCall(t.name);
            return (
              <li
                key={t.name}
                className={styles.usageRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span
                  className={styles.categoryDot}
                  style={{ background: CATEGORY_COLORS[category] }}
                  title={CATEGORY_LABEL[category]}
                />
                <span className={styles.usageName}>{t.name}</span>
                <div className={styles.usageBarWrap}>
                  <div
                    className={styles.usageBar}
                    style={{
                      width: `${widthPct}%`,
                      background: CATEGORY_COLORS[category],
                    }}
                  />
                </div>
                <span className={styles.usageCount}>{t.calls.toLocaleString()}</span>
                <span className={styles.usageErr}>{t.errorRate.toFixed(1)}% err</span>
                <span className={styles.usageDur}>
                  {t.avgMs >= 1000 ? `${(t.avgMs / 1000).toFixed(1)}s` : `${t.avgMs}ms`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionFrame>
  );
}

// ── Session shape timeline ──────────────────────────────────

export function SessionShapeSection({ toolId }: { toolId: string }) {
  const events: SessionEvent[] =
    PREVIEW_SESSION_SHAPES[toolId] ?? PREVIEW_SESSION_SHAPES['claude-code'];
  const maxOffsetSec = events.reduce((m, e) => Math.max(m, e.offsetSec), 0);

  // Re-classify every event via the shared classifier so preview and
  // live data flow through one path.
  const enriched = events.map((e) => ({ ...e, category: classifyToolCall(e.tool) }));

  const categoryCounts = enriched.reduce<Record<ToolCallCategory, number>>(
    (acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    },
    { research: 0, edit: 0, exec: 0, memory: 0, other: 0 },
  );

  return (
    <SectionFrame
      eyebrow="Session shape"
      title="A representative session, one tool call at a time"
      subtitle="Each mark is a tool call placed where it happened in the session. Width reflects duration."
      isPreview
    >
      <div className={styles.shapeTrack} aria-label="Tool call timeline">
        {enriched.map((e, i) => {
          const left = maxOffsetSec > 0 ? (e.offsetSec / maxOffsetSec) * 100 : 0;
          const widthPx = Math.max(4, Math.min(60, Math.round(e.durationMs / 40)));
          return (
            <div
              key={`${e.tool}-${i}`}
              className={`${styles.shapeMark} ${e.isError ? styles.shapeMarkError : ''}`}
              style={{
                left: `${left}%`,
                width: `${widthPx}px`,
                background: CATEGORY_COLORS[e.category],
              }}
              title={`${e.tool} · ${e.durationMs}ms${e.isError ? ' · error' : ''}`}
            />
          );
        })}
      </div>
      <div className={styles.shapeLegend}>
        {(['research', 'edit', 'exec', 'memory'] as const).map((cat) => (
          <div key={cat} className={styles.shapeLegendItem}>
            <span className={styles.shapeDot} style={{ background: CATEGORY_COLORS[cat] }} />
            <span>{CATEGORY_LABEL[cat]}</span>
            <span className={styles.shapeLegendCount}>{categoryCounts[cat] ?? 0}</span>
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}

// ── Model pairings ──────────────────────────────────────────

export function ModelPairingsSection({ toolId }: { toolId: string }) {
  const cells = PREVIEW_TOOL_MODEL.filter((c) => c.toolId === toolId);
  if (cells.length === 0) return null;

  const sorted = [...cells].sort((a, b) => b.sessions - a.sessions);
  const maxSessions = sorted[0]?.sessions ?? 0;

  return (
    <SectionFrame
      eyebrow="Model pairings"
      title="Which models you've run with this tool"
      subtitle="Completion rate and volume for every model this tool has seen. Rank by what's proven on your own work."
      isPreview
    >
      <ul className={styles.pairingList}>
        {sorted.map((c, i) => {
          const volPct = maxSessions > 0 ? (c.sessions / maxSessions) * 100 : 0;
          return (
            <li
              key={c.model}
              className={styles.pairingRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.pairingName}>{c.model}</span>
              <div className={styles.pairingVolWrap}>
                <div className={styles.pairingVol} style={{ width: `${volPct}%` }} />
              </div>
              <span className={styles.pairingSessions}>{c.sessions} sess</span>
              <span className={styles.pairingRate}>{c.completionRate}%</span>
            </li>
          );
        })}
      </ul>
    </SectionFrame>
  );
}

// ── Scope complexity ────────────────────────────────────────

export function ScopeComplexitySection({ toolId }: { toolId: string }) {
  const buckets = PREVIEW_SCOPE_COMPLEXITY[toolId] ?? PREVIEW_SCOPE_COMPLEXITY['claude-code'];
  const maxSessions = buckets.reduce((m, b) => Math.max(m, b.sessions), 0);

  return (
    <SectionFrame
      eyebrow="Scope complexity"
      title="How big your sessions tend to get"
      subtitle="Number of files touched per session, bucketed. Completion rate shows how well this tool handles bigger scopes."
      isPreview
    >
      <div className={styles.scopeGrid}>
        {buckets.map((b, i) => {
          const heightPct = maxSessions > 0 ? (b.sessions / maxSessions) * 100 : 0;
          const completionColor =
            b.completionRate >= 80 ? '#8ec0a4' : b.completionRate >= 60 ? '#d4c28e' : '#d4a58e';
          return (
            <div
              key={b.label}
              className={styles.scopeBucket}
              style={{ '--row-index': i } as CSSProperties}
            >
              <div className={styles.scopeBar}>
                <div
                  className={styles.scopeFill}
                  style={{ height: `${heightPct}%`, background: completionColor }}
                />
              </div>
              <span className={styles.scopeLabel}>{b.label}</span>
              <span className={styles.scopeSessions}>{b.sessions} sess</span>
              <span className={styles.scopeRate}>{b.completionRate}% done</span>
            </div>
          );
        })}
      </div>
    </SectionFrame>
  );
}

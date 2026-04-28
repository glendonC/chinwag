import type { CSSProperties } from 'react';
import type { DataCapabilities } from '@chinmeister/shared/tool-registry.js';
import styles from './ToolCoverageMatrix.module.css';

/** Capability keys in `DataCapabilities` whose state the matrix renders.
 *  Limited to boolean-shaped fields - `costSource` and `tokenFormat` are
 *  format enums and don't fit a "tool can answer this" affordance. */
export type ToolCoverageCapability =
  | 'conversationLogs'
  | 'tokenUsage'
  | 'toolCallLogs'
  | 'hooks'
  | 'commitTracking';

export interface ToolCoverageEntry {
  id: string;
  label: string;
  /** Brand color for the leading dot. CSS color string (token or HSL). */
  color: string;
  /** State per capability:
   *   - true:      filled solid (covered)
   *   - 'partial': hatched (some flavor - e.g. tokens estimated, not first-party)
   *   - false / missing: ghost outline (uncovered) */
  capabilities: Partial<Record<ToolCoverageCapability, boolean | 'partial'>>;
}

interface Props {
  tools: ReadonlyArray<ToolCoverageEntry>;
  /** Which capabilities to render as columns, in render order. Defaults to
   *  the standard five used by Tools' coverage question. Pass a smaller
   *  list when only a subset is relevant to the surrounding question. */
  capabilities?: ReadonlyArray<ToolCoverageCapability>;
  /** Override the column header label for a capability. The default labels
   *  are short - pass overrides when a tighter slot demands them. */
  labels?: Partial<Record<ToolCoverageCapability, string>>;
}

const DEFAULT_CAPABILITIES: ToolCoverageCapability[] = [
  'conversationLogs',
  'tokenUsage',
  'toolCallLogs',
  'hooks',
  'commitTracking',
];

const DEFAULT_LABELS: Record<ToolCoverageCapability, string> = {
  conversationLogs: 'Conversations',
  tokenUsage: 'Tokens',
  toolCallLogs: 'Tool calls',
  hooks: 'Hooks',
  commitTracking: 'Commits',
};

// Type-system note: ToolCoverageCapability is a strict subset of the boolean
// fields on DataCapabilities. The aliasing line below assists callers who
// build entries directly from `getDataCapabilities(toolId)` - it keeps the
// matrix consumable without forcing an intermediate map step.
type _Assert = ToolCoverageCapability extends keyof DataCapabilities ? true : never;
const _check: _Assert = true;
void _check;

/**
 * Tools × capabilities affordance matrix. Rows are tools, columns are
 * capabilities. Cells encode coverage state with shape - not numbers -
 * because the question is "which tool can answer this," not "how much
 * data has it produced." The latter is a different lens and lives in
 * the workload widgets.
 *
 * Apple-minimalistic styling: no card chrome, dotted-line dividers, mono
 * column labels, single brand-dot row identifier. Designed to read as
 * a small, dense reference at the bottom of a question rather than the
 * primary viz.
 */
export default function ToolCoverageMatrix({
  tools,
  capabilities = DEFAULT_CAPABILITIES,
  labels,
}: Props) {
  const colCount = capabilities.length;
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `minmax(0, 1.4fr) repeat(${colCount}, minmax(0, 1fr))`,
  };
  const labelFor = (cap: ToolCoverageCapability) => labels?.[cap] ?? DEFAULT_LABELS[cap];

  return (
    <div className={styles.wrap}>
      <div className={styles.grid} style={gridStyle} role="table">
        <div className={styles.headerCorner} role="columnheader" aria-hidden="true" />
        {capabilities.map((cap) => (
          <div key={cap} className={styles.headerCell} role="columnheader">
            {labelFor(cap)}
          </div>
        ))}
        {tools.map((t, i) => (
          <Row key={t.id} entry={t} capabilities={capabilities} rowIndex={i} labelFor={labelFor} />
        ))}
      </div>
    </div>
  );
}

function Row({
  entry,
  capabilities,
  rowIndex,
  labelFor,
}: {
  entry: ToolCoverageEntry;
  capabilities: ReadonlyArray<ToolCoverageCapability>;
  rowIndex: number;
  labelFor: (cap: ToolCoverageCapability) => string;
}) {
  const animVar = { '--row-index': rowIndex } as CSSProperties;
  return (
    <>
      <div className={styles.toolCell} style={animVar} role="rowheader">
        <span className={styles.toolDot} style={{ background: entry.color }} aria-hidden="true" />
        <span className={styles.toolLabel}>{entry.label}</span>
      </div>
      {capabilities.map((cap) => {
        const state = entry.capabilities[cap];
        const cls =
          state === true
            ? styles.markFull
            : state === 'partial'
              ? styles.markPartial
              : styles.markEmpty;
        const aria =
          state === true
            ? `${entry.label}: ${labelFor(cap)} covered`
            : state === 'partial'
              ? `${entry.label}: ${labelFor(cap)} partial`
              : `${entry.label}: ${labelFor(cap)} not covered`;
        return (
          <div key={cap} className={styles.cell} style={animVar} role="cell">
            <span className={`${styles.mark} ${cls}`} role="img" aria-label={aria} />
          </div>
        );
      })}
    </>
  );
}

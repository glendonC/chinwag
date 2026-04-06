import { getToolMeta } from '../../lib/toolMeta.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import styles from './ToolsView.module.css';

interface VerdictBadgeProps {
  verdict: string | undefined;
}

const VERDICT_MAP: Record<string, { className: string; label: string }> = {
  integrated: { className: styles.verdictCompatible, label: 'Integrated' },
  installable: { className: styles.verdictPartial, label: 'Installable' },
  listed: { className: styles.verdictIncompatible, label: 'Listed' },
  // Legacy verdicts from cached data
  compatible: { className: styles.verdictCompatible, label: 'Integrated' },
  partial: { className: styles.verdictPartial, label: 'Installable' },
  incompatible: { className: styles.verdictIncompatible, label: 'Listed' },
};

export function VerdictBadge({ verdict }: VerdictBadgeProps) {
  const config = (verdict && VERDICT_MAP[verdict]) || VERDICT_MAP.listed;
  return <span className={config.className}>{config.label}</span>;
}

/** Evaluation entry from the tool directory API. */
interface Evaluation {
  id: string;
  name: string;
  category?: string;
  verdict?: string;
  tagline?: string;
  integration_tier?: string;
  mcp_support?: boolean | string;
  metadata?: Record<string, unknown>;
  confidence?: string;
  evaluated_by?: string;
  evaluated_at?: string;
  [k: string]: unknown;
}

interface DirectoryRowProps {
  evaluation: Evaluation;
  categories: Record<string, string>;
  onSelect: () => void;
}

export default function DirectoryRow({ evaluation, categories, onSelect }: DirectoryRowProps) {
  const meta = getToolMeta(evaluation.id);
  const categoryLabel = categories[evaluation.category ?? ''] || evaluation.category || '';

  return (
    <button className={styles.directoryRow} onClick={onSelect} type="button">
      <div className={styles.rowIdentity}>
        <ToolIcon
          tool={evaluation.id}
          website={evaluation.metadata?.website as string | undefined}
          size={18}
        />
        <span className={styles.rowLabel}>{evaluation.name || meta.label}</span>
      </div>
      <VerdictBadge verdict={evaluation.verdict} />
      <span className={styles.dirStub}>{'\u2014'}</span>
      <span className={styles.dirCategory}>{categoryLabel}</span>
      <span className={styles.dirStub}>{'\u2014'}</span>
      <span className={styles.dirTagline}>
        {evaluation.tagline
          ? evaluation.tagline.length > 60
            ? evaluation.tagline.slice(0, 60) + '\u2026'
            : evaluation.tagline
          : ''}
      </span>
    </button>
  );
}

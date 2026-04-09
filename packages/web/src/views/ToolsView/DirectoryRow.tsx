import { getToolMeta } from '../../lib/toolMeta.js';
import { formatStars } from '../../lib/signalScore.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import styles from './ToolsView.module.css';

interface VerdictBadgeProps {
  verdict: string | undefined;
}

const VERDICT_MAP: Record<string, { className: string; label: string }> = {
  integrated: { className: styles.verdictCompatible, label: 'Supported' },
  installable: { className: styles.verdictPartial, label: 'Available' },
  listed: { className: styles.verdictIncompatible, label: 'Coming soon' },
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
  onHoverChange?: (evalId: string | null, x?: number, y?: number) => void;
}

export default function DirectoryRow({
  evaluation,
  categories,
  onSelect,
  onHoverChange,
}: DirectoryRowProps) {
  const meta = getToolMeta(evaluation.id);
  const categoryLabel = categories[evaluation.category ?? ''] || evaluation.category || '';
  const md = evaluation.metadata ?? {};
  const pricingTier = typeof md.pricing_tier === 'string' ? md.pricing_tier : null;
  const githubStars = typeof md.github_stars === 'number' ? md.github_stars : null;

  return (
    <button
      className={styles.directoryRow}
      onClick={onSelect}
      type="button"
      onMouseEnter={(e) => onHoverChange?.(evaluation.id, e.clientX, e.clientY)}
      onMouseLeave={() => onHoverChange?.(null)}
    >
      <div className={styles.rowIdentity}>
        <ToolIcon
          tool={evaluation.id}
          website={evaluation.metadata?.website as string | undefined}
          iconUrl={evaluation.metadata?.icon_url as string | undefined}
          favicon={evaluation.metadata?.favicon as string | undefined}
          brandColor={evaluation.metadata?.brand_color as string | undefined}
          size={18}
        />
        <span className={styles.rowLabel}>{evaluation.name || meta.label}</span>
      </div>
      <VerdictBadge verdict={evaluation.verdict} />
      <span className={styles.dirStars}>
        {githubStars != null && githubStars > 0 ? formatStars(githubStars) : '\u2014'}
      </span>
      <span className={styles.dirCategory}>{categoryLabel}</span>
      <span className={styles.dirPricing}>{pricingTier || '\u2014'}</span>
      <span className={styles.dirTagline}>
        {evaluation.tagline
          ? evaluation.tagline.length > 60
            ? evaluation.tagline.slice(0, 60) + '\u2026'
            : evaluation.tagline
          : ''}
      </span>
      <span className={styles.viewButton}>View</span>
    </button>
  );
}

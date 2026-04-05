import clsx from 'clsx';
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

interface ConfidenceDotProps {
  level: string | undefined;
}

const CONFIDENCE_MAP: Record<string, string> = {
  high: styles.confidenceHigh,
  medium: styles.confidenceMedium,
  low: styles.confidenceLow,
};

export function ConfidenceDot({ level }: ConfidenceDotProps) {
  return (
    <span
      className={clsx(styles.confidence, (level && CONFIDENCE_MAP[level]) || CONFIDENCE_MAP.low)}
    >
      {level || 'unknown'}
    </span>
  );
}

interface Citation {
  url: string;
  title?: string;
}

interface Source {
  claim: string;
  citations?: Citation[];
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
  sources?: Source[];
  [k: string]: unknown;
}

interface DirectoryRowProps {
  evaluation: Evaluation;
  categories: Record<string, string>;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function DirectoryRow({
  evaluation,
  categories,
  isExpanded,
  onToggle,
}: DirectoryRowProps) {
  const meta = getToolMeta(evaluation.id);
  const categoryLabel = categories[evaluation.category ?? ''] || evaluation.category || '';

  return (
    <div className={styles.directoryEntry}>
      <button
        className={styles.directoryRow}
        onClick={onToggle}
        type="button"
        aria-expanded={isExpanded}
      >
        <div className={styles.rowIdentity}>
          <ToolIcon
            tool={evaluation.id}
            website={evaluation.metadata?.website as string | undefined}
            size={18}
          />
          <span className={styles.rowLabel}>{evaluation.name || meta.label}</span>
        </div>
        <VerdictBadge verdict={evaluation.verdict} />
        <span className={styles.dirMcp}>{evaluation.mcp_support ? 'MCP' : '\u2014'}</span>
        <span className={styles.dirCategory}>{categoryLabel}</span>
        <ConfidenceDot level={evaluation.confidence} />
        <span className={styles.dirTagline}>
          {evaluation.tagline
            ? evaluation.tagline.length > 60
              ? evaluation.tagline.slice(0, 60) + '\u2026'
              : evaluation.tagline
            : ''}
        </span>
      </button>

      {isExpanded ? (
        <div className={styles.expandedDetail}>
          {evaluation.tagline ? <p className={styles.detailTagline}>{evaluation.tagline}</p> : null}

          {evaluation.metadata?.notable ? (
            <p className={styles.detailNotable}>{evaluation.metadata.notable as string}</p>
          ) : null}

          <div className={styles.detailMeta}>
            {evaluation.metadata?.website ? (
              <div className={styles.detailMetaItem}>
                <span className={styles.detailMetaLabel}>Website</span>
                <a
                  href={evaluation.metadata.website as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.detailLink}
                >
                  {(evaluation.metadata.website as string).replace(/^https?:\/\/(www\.)?/, '')}
                </a>
              </div>
            ) : null}
            {evaluation.metadata?.github ? (
              <div className={styles.detailMetaItem}>
                <span className={styles.detailMetaLabel}>GitHub</span>
                <a
                  href={evaluation.metadata.github as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.detailLink}
                >
                  {(evaluation.metadata.github as string).replace('https://github.com/', '')}
                </a>
              </div>
            ) : null}
            {evaluation.metadata?.install_command ? (
              <div className={styles.detailMetaItem}>
                <span className={styles.detailMetaLabel}>Install</span>
                <code className={styles.detailInstall}>
                  {evaluation.metadata.install_command as string}
                </code>
              </div>
            ) : null}
          </div>

          {evaluation.sources && evaluation.sources.length > 0 ? (
            <details className={styles.sourcesCollapsible}>
              <summary className={styles.sourcesToggle}>
                {evaluation.sources.reduce(
                  (n: number, s: Source) => n + (s.citations?.length || 0),
                  0,
                )}{' '}
                sources cited
              </summary>
              <div className={styles.sourcesList}>
                {evaluation.sources
                  .filter((s: Source) => s.citations && s.citations.length > 0)
                  .map((source: Source, si: number) => (
                    <div key={si} className={styles.sourceEntry}>
                      <span className={styles.sourceClaim}>{source.claim}</span>
                      <div className={styles.sourceCitations}>
                        {source.citations!.map((cite: Citation, ci: number) => (
                          <a
                            key={ci}
                            href={cite.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.citationLink}
                          >
                            {cite.title || new URL(cite.url).hostname}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </details>
          ) : null}

          <div className={styles.detailFooter}>
            <span className={styles.detailEvaluatedBy}>{evaluation.evaluated_by || 'unknown'}</span>
            {evaluation.evaluated_at ? (
              <span className={styles.detailDate}>
                {new Date(evaluation.evaluated_at).toLocaleDateString()}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { getToolMeta } from '../../lib/toolMeta.js';
import type { ToolDirectoryEvaluation } from '../../lib/apiSchemas.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import { VerdictBadge } from './DirectoryRow.jsx';
import styles from './ToolDetailView.module.css';

interface ToolDetailViewProps {
  evaluation: ToolDirectoryEvaluation;
  categories: Record<string, string>;
  onBack: () => void;
}

export default function ToolDetailView({ evaluation, categories, onBack }: ToolDetailViewProps) {
  const meta = getToolMeta(evaluation.id);
  const md = (evaluation.metadata ?? {}) as Record<string, unknown>;
  const evExtra = evaluation as Record<string, unknown>;
  const categoryLabel = categories[evaluation.category ?? ''] || evaluation.category || '';
  const sources = evExtra.sources as
    | Array<{ claim: string; citations?: Array<{ url: string; title?: string }> }>
    | undefined;

  return (
    <div className={styles.detail}>
      {/* Header — eyebrow as back nav, title at display scale */}
      <header className={styles.header}>
        <button className={styles.eyebrowBack} onClick={onBack} type="button">
          {'\u2190'} Directory
        </button>
        <div className={styles.titleRow}>
          <ToolIcon tool={evaluation.id} website={md.website as string | undefined} size={40} />
          <h1 className={styles.title}>{evaluation.name || meta.label}</h1>
        </div>
        {evaluation.tagline && <p className={styles.tagline}>{evaluation.tagline}</p>}
      </header>

      {/* Stat grid */}
      <div className={styles.statGrid}>
        <div className={styles.statCell}>
          <span className={styles.statLabel}>Verdict</span>
          <VerdictBadge verdict={evaluation.verdict} />
        </div>
        <div className={styles.statCell}>
          <span className={styles.statLabel}>Category</span>
          <span className={styles.statValue}>{categoryLabel || '\u2014'}</span>
        </div>
        <div className={styles.statCell}>
          <span className={styles.statLabel}>MCP</span>
          <span className={styles.statValue}>
            {evaluation.mcp_support ? 'Supported' : '\u2014'}
          </span>
        </div>
        <div className={styles.statCell}>
          <span className={styles.statLabel}>Pricing</span>
          <span className={styles.statStub}>{'\u2014'}</span>
        </div>
        <div className={styles.statCell}>
          <span className={styles.statLabel}>Setup</span>
          <span className={styles.statStub}>{'\u2014'}</span>
        </div>
        <div className={styles.statCell}>
          <span className={styles.statLabel}>Confidence</span>
          <span className={styles.statValue}>
            {(typeof evExtra.confidence === 'string' && evExtra.confidence) || '\u2014'}
          </span>
        </div>
      </div>

      {/* Setup CTA */}
      <button className={styles.setupCta} disabled type="button">
        Set up
      </button>

      {/* Notable */}
      {typeof md.notable === 'string' && md.notable && (
        <p className={styles.notable}>{md.notable}</p>
      )}

      {/* Metadata links */}
      <div className={styles.metaSection}>
        {typeof md.website === 'string' && md.website && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Website</span>
            <a
              href={md.website}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.metaLink}
            >
              {md.website.replace(/^https?:\/\/(www\.)?/, '')}
            </a>
          </div>
        )}
        {typeof md.github === 'string' && md.github && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>GitHub</span>
            <a
              href={md.github}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.metaLink}
            >
              {md.github.replace('https://github.com/', '')}
            </a>
          </div>
        )}
        {typeof md.install_command === 'string' && md.install_command && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Install</span>
            <code className={styles.installCmd}>{md.install_command}</code>
          </div>
        )}
      </div>

      {/* Sources */}
      {sources && sources.length > 0 && (
        <details className={styles.sourcesCollapsible}>
          <summary className={styles.sourcesToggle}>
            {sources.reduce((n, s) => n + (s.citations?.length || 0), 0)} sources cited
          </summary>
          <div className={styles.sourcesList}>
            {sources
              .filter((s) => s.citations && s.citations.length > 0)
              .map((source, si) => (
                <div key={si} className={styles.sourceEntry}>
                  <span className={styles.sourceClaim}>{source.claim}</span>
                  <div className={styles.sourceCitations}>
                    {source.citations!.map((cite, ci) => (
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
      )}

      {/* Footer */}
      <div className={styles.footer}>
        {typeof evExtra.evaluated_by === 'string' && evExtra.evaluated_by && (
          <span className={styles.footerMeta}>{evExtra.evaluated_by}</span>
        )}
        {typeof evExtra.evaluated_at === 'string' && evExtra.evaluated_at && (
          <span className={styles.footerMeta}>
            {new Date(evExtra.evaluated_at).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

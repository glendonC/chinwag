import { getToolMeta } from '../../lib/toolMeta.js';
import {
  computeSignalScore,
  extractScoringInput,
  scoreTier,
  scoreTierColor,
  formatStars,
  DIMENSION_LABELS,
  type SignalBreakdown,
} from '../../lib/signalScore.js';
import type { ToolDirectoryEvaluation } from '../../lib/apiSchemas.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import { VerdictBadge } from './DirectoryRow.jsx';
import styles from './ToolDetailView.module.css';

interface ToolDetailViewProps {
  evaluation: ToolDirectoryEvaluation;
  categories: Record<string, string>;
  onBack: () => void;
}

function DemoEmbed({ url }: { url: string }) {
  const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
  if (isYouTube) {
    const embedUrl = url
      .replace('youtube.com/watch?v=', 'youtube.com/embed/')
      .replace('youtu.be/', 'youtube.com/embed/');
    return (
      <iframe
        src={`${embedUrl}?rel=0`}
        className={styles.demoEmbed}
        allow="accelerometer; autoplay; encrypted-media; gyroscope"
        allowFullScreen
        title="Product demo"
      />
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={styles.demoLink}>
      Watch demo {'\u2192'}
    </a>
  );
}

function SignalScoreDisplay({ score }: { score: SignalBreakdown }) {
  const tier = scoreTier(score.total);
  const tierColor = scoreTierColor(score.total);
  const dims = ['craft', 'activity', 'ecosystem', 'reach'] as const;

  return (
    <div className={styles.scoreSection}>
      <div className={styles.scoreHeader}>
        <span className={styles.scoreTotal}>{score.total}</span>
        <span className={styles.scoreTier} data-tier={tierColor}>
          {tier}
        </span>
      </div>
      <div className={styles.scoreBars}>
        {dims.map((dim) => (
          <div key={dim} className={styles.scoreRow}>
            <span className={styles.scoreLabel}>{DIMENSION_LABELS[dim]}</span>
            <div className={styles.scoreTrack}>
              <div
                className={styles.scoreFill}
                data-dim={dim}
                style={{ width: `${(score[dim] / 25) * 100}%` }}
              />
            </div>
            <span className={styles.scoreValue}>{score[dim]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ToolDetailView({ evaluation, categories, onBack }: ToolDetailViewProps) {
  const meta = getToolMeta(evaluation.id);
  const md = (evaluation.metadata ?? {}) as Record<string, unknown>;
  const evExtra = evaluation as Record<string, unknown>;
  const categoryLabel = categories[evaluation.category ?? ''] || evaluation.category || '';
  const sources = evExtra.sources as
    | Array<{ claim: string; citations?: Array<{ url: string; title?: string }> }>
    | undefined;

  // Enrichment data
  const aiSummary = typeof md.ai_summary === 'string' ? md.ai_summary : null;
  const strengths = Array.isArray(md.strengths) ? (md.strengths as string[]).slice(0, 3) : [];
  const pricingTier = typeof md.pricing_tier === 'string' ? md.pricing_tier : null;
  const pricingDetail = typeof md.pricing_detail === 'string' ? md.pricing_detail : null;
  const platform = Array.isArray(md.platform) ? (md.platform as string[]) : [];
  const integrationType = typeof md.integration_type === 'string' ? md.integration_type : null;
  const githubStars = typeof md.github_stars === 'number' ? md.github_stars : null;
  const isOss = md.open_source === true || evExtra.open_source === 1;
  const demoUrl = typeof md.demo_url === 'string' ? md.demo_url : null;

  // Signal score
  const scoringInput = extractScoringInput(evExtra);
  const score = computeSignalScore(scoringInput);

  return (
    <div className={styles.detail}>
      {/* Header — eyebrow back nav, title, badges */}
      <header className={styles.header}>
        <button className={styles.eyebrowBack} onClick={onBack} type="button">
          {'\u2190'} Directory
        </button>
        <div className={styles.titleRow}>
          <ToolIcon tool={evaluation.id} website={md.website as string | undefined} size={40} />
          <h1 className={styles.title}>{evaluation.name || meta.label}</h1>
        </div>
        <div className={styles.badges}>
          {isOss && <span className={`${styles.badge} ${styles.badgeOss}`}>Open source</span>}
          {evaluation.mcp_support && (
            <span className={`${styles.badge} ${styles.badgeMcp}`}>MCP</span>
          )}
          {githubStars != null && githubStars > 0 && (
            <span className={`${styles.badge} ${styles.badgeTier}`}>
              {formatStars(githubStars)} stars
            </span>
          )}
          {pricingTier && (
            <span className={`${styles.badge} ${styles.badgeTier}`}>{pricingTier}</span>
          )}
        </div>
      </header>

      {/* AI Summary — primary description */}
      {(aiSummary || evaluation.tagline) && (
        <p className={styles.summary}>{aiSummary || evaluation.tagline}</p>
      )}

      {/* Strengths pills */}
      {strengths.length > 0 && (
        <div className={styles.strengths}>
          {strengths.map((s, i) => (
            <span key={i} className={styles.strength}>
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Signal Score */}
      <SignalScoreDisplay score={score} />

      {/* Stat grid — key facts */}
      <div className={styles.statGrid}>
        <div className={styles.statCell}>
          <span className={styles.statLabel}>Status</span>
          <VerdictBadge verdict={evaluation.verdict} />
        </div>
        <div className={styles.statCell}>
          <span className={styles.statLabel}>Category</span>
          <span className={styles.statValue}>{categoryLabel || '\u2014'}</span>
        </div>
        {integrationType && (
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Type</span>
            <span className={styles.statValue}>{integrationType}</span>
          </div>
        )}
        {platform.length > 0 && (
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Platform</span>
            <span className={styles.statValue}>{platform.join(', ')}</span>
          </div>
        )}
        {pricingDetail && (
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Pricing</span>
            <span className={styles.statValue}>{pricingDetail}</span>
          </div>
        )}
        <div className={styles.statCell}>
          <span className={styles.statLabel}>Confidence</span>
          <span className={styles.statValue}>
            {(typeof evExtra.confidence === 'string' && evExtra.confidence) || '\u2014'}
          </span>
        </div>
      </div>

      {/* Demo video */}
      {demoUrl && (
        <div className={styles.demoSection}>
          <div className={styles.demoLabel}>Demo</div>
          <DemoEmbed url={demoUrl} />
        </div>
      )}

      {/* Setup CTA */}
      <button className={styles.setupCta} disabled type="button">
        Set up
      </button>

      {/* Notable */}
      {typeof md.notable === 'string' && md.notable && !aiSummary && (
        <p className={styles.summary}>{md.notable}</p>
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

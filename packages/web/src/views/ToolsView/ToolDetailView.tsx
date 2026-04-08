import { getToolMeta } from '../../lib/toolMeta.js';
import { formatStars } from '../../lib/signalScore.js';
import type { ToolDirectoryEvaluation } from '../../lib/apiSchemas.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import { VerdictBadge } from './DirectoryRow.jsx';
import styles from './ToolDetailView.module.css';

// Human-readable labels for legacy raw field names in sources.
const CLAIM_LABELS: Record<string, string> = {
  name: 'Product name',
  tagline: 'Description',
  category: 'Category',
  mcp_support: 'MCP support',
  has_cli: 'CLI available',
  open_source: 'Open source',
  website: 'Website',
  github: 'Repository',
  install_command: 'Install method',
  notable: 'Differentiator',
  ai_summary: 'Product summary',
  strengths: 'Key strengths',
  integration_type: 'Integration type',
  platforms: 'Platform support',
  pricing_tier: 'Pricing model',
  pricing_detail: 'Pricing details',
  github_stars: 'GitHub stars',
  demo_url: 'Demo video',
};

const PROVENANCE_LABELS: Record<string, string> = {
  chinwag: 'chinwag directory',
};

interface ToolDetailViewProps {
  evaluation: ToolDirectoryEvaluation;
  categories: Record<string, string>;
  isConfigured?: boolean;
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

/** Quick fact — only renders if value is truthy. */
function QuickFact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className={styles.quickFact}>
      <span className={styles.quickFactLabel}>{label}</span>
      <span className={styles.quickFactValue}>{value}</span>
    </div>
  );
}

export default function ToolDetailView({
  evaluation,
  categories,
  isConfigured,
  onBack,
}: ToolDetailViewProps) {
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
  const pricingDetail = typeof md.pricing_detail === 'string' ? md.pricing_detail : null;
  const pricingTier = typeof md.pricing_tier === 'string' ? md.pricing_tier : null;
  const platform = Array.isArray(md.platform) ? (md.platform as string[]) : [];
  const integrationType = typeof md.integration_type === 'string' ? md.integration_type : null;
  const githubStars = typeof md.github_stars === 'number' ? md.github_stars : null;
  const isOss = md.open_source === true || evExtra.open_source === 1;
  const demoUrl = typeof md.demo_url === 'string' ? md.demo_url : null;

  // Summary text: AI summary > tagline > notable
  const summaryText =
    aiSummary || evaluation.tagline || (typeof md.notable === 'string' ? md.notable : null);

  // Provenance
  const evaluatedBy = typeof evExtra.evaluated_by === 'string' ? evExtra.evaluated_by : null;
  const evaluatedAt = typeof evExtra.evaluated_at === 'string' ? evExtra.evaluated_at : null;
  const citationCount = sources ? sources.reduce((n, s) => n + (s.citations?.length || 0), 0) : 0;

  return (
    <div className={styles.detail}>
      {/* ── Zone 1: Hero ── */}
      <header className={styles.header}>
        <button className={styles.eyebrowBack} onClick={onBack} type="button">
          {'\u2190'} Directory
        </button>
        <div className={styles.titleRow}>
          <ToolIcon
            tool={evaluation.id}
            website={md.website as string | undefined}
            iconUrl={md.icon_url as string | undefined}
            favicon={md.favicon as string | undefined}
            brandColor={md.brand_color as string | undefined}
            size={40}
          />
          <h1 className={styles.title}>{evaluation.name || meta.label}</h1>
          {isConfigured && <span className={styles.configuredBadge}>In your stack</span>}
        </div>
      </header>

      {/* ── Zone 2: Quick Facts ── */}
      <div className={styles.quickFacts}>
        <div className={styles.quickFact}>
          <span className={styles.quickFactLabel}>Status</span>
          <VerdictBadge verdict={evaluation.verdict} />
        </div>
        <QuickFact label="Category" value={categoryLabel} />
        <QuickFact label="Type" value={integrationType} />
        <QuickFact label="Platform" value={platform.length > 0 ? platform.join(', ') : null} />
        <QuickFact label="Pricing" value={pricingDetail || pricingTier} />
        <QuickFact label="Open source" value={isOss ? 'Yes' : 'No'} />
        <QuickFact label="MCP" value={evaluation.mcp_support ? 'Supported' : 'Not yet'} />
        <QuickFact label="Stars" value={githubStars != null ? formatStars(githubStars) : null} />
      </div>

      {/* ── Zone 3: Strengths ── */}
      {strengths.length > 0 ? (
        <div className={styles.strengths}>
          {strengths.map((s, i) => (
            <span key={i} className={styles.strength}>
              {s}
            </span>
          ))}
        </div>
      ) : null}

      {/* ── Zone 4: Summary ── */}
      {summaryText && <p className={styles.summary}>{summaryText}</p>}

      {/* ── Zone 5: Links ── */}
      {md.website || md.github || md.install_command ? (
        <div className={styles.links}>
          {typeof md.website === 'string' && md.website && (
            <a href={md.website} target="_blank" rel="noopener noreferrer" className={styles.link}>
              {md.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
            </a>
          )}
          {typeof md.github === 'string' && md.github && (
            <a href={md.github} target="_blank" rel="noopener noreferrer" className={styles.link}>
              {md.github.replace('https://github.com/', '')}
            </a>
          )}
          {typeof md.install_command === 'string' && md.install_command && (
            <code className={styles.installCmd}>{md.install_command}</code>
          )}
        </div>
      ) : null}

      {/* ── Zone 6: Demo ── */}
      {demoUrl && (
        <div className={styles.demoSection}>
          <DemoEmbed url={demoUrl} />
        </div>
      )}

      {/* ── Zone 7: Provenance ── */}
      <div className={styles.provenance}>
        <span className={styles.provenanceText}>
          {evaluatedBy && (PROVENANCE_LABELS[evaluatedBy] || evaluatedBy)}
          {evaluatedAt && (
            <>
              {evaluatedBy && <span className={styles.provenanceSep}> — </span>}
              {new Date(evaluatedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </>
          )}
        </span>

        {sources && citationCount > 0 && (
          <details className={styles.sourcesCollapsible}>
            <summary className={styles.sourcesToggle}>
              {citationCount} source{citationCount !== 1 ? 's' : ''} cited
            </summary>
            <div className={styles.sourcesList}>
              {sources
                .filter((s) => s.citations && s.citations.length > 0)
                .map((source, si) => (
                  <div key={si} className={styles.sourceEntry}>
                    <span className={styles.sourceClaim}>
                      {CLAIM_LABELS[source.claim] || source.claim}
                    </span>
                    <div className={styles.sourceCitations}>
                      {source.citations!.map((cite, ci) => {
                        let label: string;
                        try {
                          label = cite.title || new URL(cite.url).hostname;
                        } catch {
                          label = cite.url;
                        }
                        return (
                          <a
                            key={ci}
                            href={cite.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.citationLink}
                          >
                            {label}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

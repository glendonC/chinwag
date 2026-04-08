// Data completeness utilities for the tool directory.
// Tracks which evaluation passes (core/enrichment/credibility) have completed
// so the UI can adapt gracefully for tools with sparse data.

interface PassRecord {
  completed_at: string;
  success: boolean;
}

interface DataPasses {
  core?: PassRecord;
  enrichment?: PassRecord;
  credibility?: PassRecord;
}

export type CompletenessLevel = 'minimal' | 'core' | 'enriched' | 'complete';

export function getCompletenessLevel(
  dataPasses?: DataPasses | Record<string, unknown>,
): CompletenessLevel {
  const dp = dataPasses as DataPasses | undefined;
  if (!dp) return 'minimal';
  const core = dp.core?.success;
  const enrichment = dp.enrichment?.success;
  const credibility = dp.credibility?.success;

  if (core && enrichment && credibility) return 'complete';
  if (core && enrichment) return 'enriched';
  if (core) return 'core';
  return 'minimal';
}

export function hasEnrichment(dataPasses?: DataPasses | Record<string, unknown>): boolean {
  return !!(dataPasses as DataPasses | undefined)?.enrichment?.success;
}

export function hasCredibility(dataPasses?: DataPasses | Record<string, unknown>): boolean {
  return !!(dataPasses as DataPasses | undefined)?.credibility?.success;
}

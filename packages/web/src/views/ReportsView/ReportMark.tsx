// Per-report Lucide icon. Stroke is painted with a per-report SVG
// linear gradient defined in ReportGradientDefs (same document), so the
// icon's silhouette carries the same hue-family as the row's mesh.

import type { ReactNode } from 'react';
import {
  Compass,
  Database,
  Flame,
  GitBranch,
  GitMerge,
  Radio,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';

const MARKS: Record<string, LucideIcon> = {
  'failure-hotspots': Flame,
  'prompt-coach': Radio,
  'roi-optimizer': TrendingDown,
  'knowledge-health': Database,
  'coordination-auditor': GitMerge,
  'failure-patterns': GitBranch,
  'onboarding-brief': Compass,
};

export function reportGradientId(reportId: string): string {
  return `report-icon-grad-${reportId}`;
}

export function ReportMark({
  reportId,
  size = 56,
}: {
  reportId: string;
  size?: number;
}): ReactNode {
  const Icon = MARKS[reportId];
  if (!Icon) return null;
  return (
    <Icon
      size={size}
      strokeWidth={1.5}
      absoluteStrokeWidth
      color={`url(#${reportGradientId(reportId)})`}
    />
  );
}

// Per-report Lucide icon. Stroke is painted with a per-report SVG
// linear gradient defined in ReportGradientDefs (same document), so the
// icon's silhouette carries the same hue-family as the row's mesh.

import type { ReactNode } from 'react';
import { Compass, Flame, GitMerge, Radio, type LucideIcon } from 'lucide-react';

const MARKS: Record<string, LucideIcon> = {
  'failure-analysis': Flame,
  'prompt-patterns': Radio,
  'coordination-audit': GitMerge,
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

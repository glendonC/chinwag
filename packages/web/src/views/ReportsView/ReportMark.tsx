// Per-report Lucide icon. Stroke is painted in a single solid color -
// the report's accent - giving each report a quiet identity cue
// without the gradient decoration that previously made the catalog
// feel performative.

import type { ReactNode } from 'react';
import { Brain, Compass, Flame, GitMerge, type LucideIcon } from 'lucide-react';

const MARKS: Record<string, LucideIcon> = {
  'failure-analysis': Flame,
  'coordination-audit': GitMerge,
  'onboarding-brief': Compass,
  'memory-hygiene': Brain,
};

export function ReportMark({
  reportId,
  color,
  size = 56,
}: {
  reportId: string;
  color?: string;
  size?: number;
}): ReactNode {
  const Icon = MARKS[reportId];
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={1.5} absoluteStrokeWidth color={color ?? 'currentColor'} />;
}

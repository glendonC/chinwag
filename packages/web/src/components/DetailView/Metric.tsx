import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Metric.module.css';

export type MetricTone = 'neutral' | 'positive' | 'warning' | 'negative';

interface Props {
  /** Semantic tone. Tones are not decoration - they tie a number in the
   *  prose to the same-colored feature in the viz below. A green "73%"
   *  in the sentence connects visually to the green dots in a
   *  completion matrix, so the reader's eye links prose to chart.
   *
   *  - `neutral` (default): ink. Use for time, count, date, cost, or
   *    anything without inherent good/bad direction.
   *  - `positive`: success green. Completion rates, green outcomes, any
   *    metric where up/higher is good.
   *  - `warning`: warn amber. Stalled rates, abandon rates, approaching
   *    trouble. Not yet a failure, but not the happy path.
   *  - `negative`: danger red. Failure rates, errors, hard breakage. */
  tone?: MetricTone;
  children: ReactNode;
}

/**
 * Semantic emphasis inside an answer line. Same weight + tabular-nums
 * as a plain <strong>, plus a color drawn from the design tokens so
 * prose and viz share one visual vocabulary.
 *
 * Prefer <Metric> over <strong> in answer prose. Reserve <strong> for
 * neutral emphasis that isn't a metric (a tool name, a file path).
 */
export default function Metric({ tone = 'neutral', children }: Props) {
  return <span className={clsx(styles.metric, styles[tone])}>{children}</span>;
}

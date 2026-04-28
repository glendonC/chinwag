import type { ReactNode } from 'react';
import { navigateToDetail, type DetailViewKey } from '../../lib/router.js';
import styles from './CrossViewLink.module.css';

interface Props {
  /** Visible label. Phrased as a destination ("See per-tool breakdown"),
   *  not a verb ("Click here"). The eye is the primary affordance - the
   *  trailing arrow is the secondary cue. */
  label: ReactNode;
  /** Target detail view (drill-param key). Must match a DETAIL_DRILL_KEYS
   *  entry, enforced by the type system. */
  view: DetailViewKey;
  /** Target tab id within the destination view. */
  tab: string;
  /** Optional question id (?q=) to land on inside the destination tab. */
  q?: string;
}

/**
 * Inline navigation chip that jumps from one detail view to another in a
 * single history entry. Renders inside a question's `relatedLinks` slot
 * (FocusedDetailView), never inside answer prose - clicking inside a
 * sentence is a B1 affordance violation.
 *
 * Style: muted ink, subtle hover lift, trailing ↗. Same vocabulary as
 * StatWidget's drill arrow so users learn one drill primitive that works
 * across the entire detail surface.
 */
export default function CrossViewLink({ label, view, tab, q }: Props) {
  return (
    <button type="button" className={styles.chip} onClick={() => navigateToDetail(view, tab, q)}>
      <span className={styles.label}>{label}</span>
      <span className={styles.arrow} aria-hidden="true">
        ↗
      </span>
    </button>
  );
}

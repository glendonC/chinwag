import { memo, useCallback, type KeyboardEvent } from 'react';
import SectionTitle from '../components/SectionTitle/SectionTitle.js';
import SectionEmpty from '../components/SectionEmpty/SectionEmpty.js';
import styles from './WidgetRenderer.module.css';
import { getWidget } from './widget-catalog.js';
import { widgetBodies } from './bodies/registry.js';
import { navigateToDetail } from '../lib/router.js';
import type { WidgetBodyProps } from './bodies/types.js';

interface WidgetRendererProps extends WidgetBodyProps {
  widgetId: string;
}

/**
 * Widgets whose body owns its own click affordance (StatWidget with
 * onOpenDetail) should NOT be wrapped — the inner button captures clicks
 * and double-wrapping creates nested-button accessibility errors. The
 * catalog still declares `drillTarget` on these for documentation +
 * future migration; the renderer skips wrapping them by id. Follow-up:
 * migrate these bodies to drop their inline drill and rely on the
 * wrapper instead, then remove this set.
 */
const SELF_DRILLING_WIDGETS = new Set([
  'sessions',
  'edits',
  'lines-added',
  'lines-removed',
  'files-touched',
  'cost',
  'cost-per-edit',
  'unanswered-questions',
]);

function WidgetRendererInner({ widgetId, ...bodyProps }: WidgetRendererProps) {
  const def = getWidget(widgetId);
  const drill = def?.drillTarget;
  const wrapClick = drill && !SELF_DRILLING_WIDGETS.has(widgetId);

  const handleClick = useCallback(() => {
    if (!drill) return;
    navigateToDetail(drill.view, drill.tab, drill.q);
  }, [drill]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!drill) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigateToDetail(drill.view, drill.tab, drill.q);
      }
    },
    [drill],
  );

  if (!def) return null;
  const Body = widgetBodies[widgetId];
  const body = Body ? <Body {...bodyProps} /> : <SectionEmpty>Unknown widget</SectionEmpty>;

  if (!wrapClick) {
    return (
      <>
        <div className={styles.widgetHead} data-widget-zone="head">
          <SectionTitle>{def.name}</SectionTitle>
        </div>
        <div className={styles.widgetBody} data-widget-zone="body">
          {body}
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.widgetHead} data-widget-zone="head">
        <SectionTitle>{def.name}</SectionTitle>
      </div>
      <div
        className={styles.widgetBodyClickable}
        data-widget-zone="body"
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={`Open ${def.name} detail`}
      >
        <span className={styles.drillArrow} aria-hidden="true">
          ↗
        </span>
        {body}
      </div>
    </>
  );
}

export const WidgetRenderer = memo(WidgetRendererInner);

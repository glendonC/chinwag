import { memo, useCallback, type KeyboardEvent } from 'react';
import SectionTitle from '../components/SectionTitle/SectionTitle.js';
import SectionEmpty from '../components/SectionEmpty/SectionEmpty.js';
import styles from './WidgetRenderer.module.css';
import { getWidget } from './widget-catalog.js';
import { widgetBodies } from './bodies/registry.js';
import { navigateToDetail } from '../lib/router.js';
import { CapabilityFooter } from './bodies/shared.js';
import type { WidgetBodyProps } from './bodies/types.js';

interface WidgetRendererProps extends WidgetBodyProps {
  widgetId: string;
}

function WidgetRendererInner({ widgetId, ...bodyProps }: WidgetRendererProps) {
  const def = getWidget(widgetId);
  const drill = def?.drillTarget;
  // Wrap the body in an outer click affordance only when the body doesn't
  // already own its drill. Tables with per-row View buttons and stats with
  // inline `onOpenDetail` set `ownsClick: true` in the catalog so the
  // wrapper's full-container hover and ↗ corner arrow don't stack on top
  // of an already-clickable interior. See `WidgetDef.ownsClick`.
  const wrapClick = drill && !def?.ownsClick;

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

  // Catalog-driven A3 coverage disclosure: when a widget declares
  // `requiredCapability` and doesn't paint its own note inline, wire the
  // standard footer so silent widgets can't ship without explaining the
  // em-dashes. Body-painted notes (cost, one-shot-rate, the team widgets)
  // opt out via `ownsCoverageNote: true` so two notes don't stack.
  const capabilityFooter =
    def.requiredCapability && !def.ownsCoverageNote ? (
      <CapabilityFooter
        capability={def.requiredCapability}
        toolsReporting={bodyProps.analytics.data_coverage?.tools_reporting ?? []}
      />
    ) : null;

  if (!wrapClick) {
    return (
      <>
        <div className={styles.widgetHead} data-widget-zone="head">
          <SectionTitle>{def.name}</SectionTitle>
        </div>
        <div className={styles.widgetBody} data-widget-zone="body">
          {body}
          {capabilityFooter}
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
        {capabilityFooter}
      </div>
    </>
  );
}

export const WidgetRenderer = memo(WidgetRendererInner);

import { memo } from 'react';
import SectionTitle from '../../components/SectionTitle/SectionTitle.js';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { getWidget } from './widget-catalog.js';
import { widgetBodies } from './widgets/registry.js';
import type { WidgetBodyProps } from './widgets/types.js';

interface WidgetRendererProps extends WidgetBodyProps {
  widgetId: string;
}

function WidgetRendererInner({ widgetId, ...bodyProps }: WidgetRendererProps) {
  const def = getWidget(widgetId);
  if (!def) return null;
  const Body = widgetBodies[widgetId];
  return (
    <>
      <SectionTitle>{def.name}</SectionTitle>
      {Body ? <Body {...bodyProps} /> : <SectionEmpty>Unknown widget</SectionEmpty>}
    </>
  );
}

export const WidgetRenderer = memo(WidgetRendererInner);

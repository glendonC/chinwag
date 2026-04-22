import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { computeDataCoverage } from '../utils.js';
import styles from '../widget-shared.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { MoreHidden } from './shared.js';

const WAITING_LIST_CAP = 8;

function DataCoverageWidget({ analytics, conversationData }: WidgetBodyProps) {
  const cats = computeDataCoverage(analytics, conversationData);
  const totalActive = cats.reduce((s, c) => s + c.active, 0);
  const totalPossible = cats.reduce((s, c) => s + c.total, 0);
  const waiting = cats.filter((c) => c.active < c.total);
  const visibleWaiting = waiting.slice(0, WAITING_LIST_CAP);
  const hiddenWaiting = waiting.length - visibleWaiting.length;
  return (
    <>
      <div className={styles.statRow} style={{ marginBottom: 12 }}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{totalActive}</span>
          <span className={styles.statBlockLabel}>active</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{totalPossible - totalActive}</span>
          <span className={styles.statBlockLabel}>waiting</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>
            {Math.round((totalActive / Math.max(totalPossible, 1)) * 100)}%
          </span>
          <span className={styles.statBlockLabel}>coverage</span>
        </div>
      </div>
      {waiting.length === 0 ? (
        <SectionEmpty>All insights have data</SectionEmpty>
      ) : (
        <div className={styles.dataList}>
          {visibleWaiting.map((cat, i) => (
            <div
              key={cat.id}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName}>{cat.label}</span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>
                    {cat.active}/{cat.total}
                  </span>
                </span>
                <span className={styles.dataStat} style={{ color: 'var(--muted)' }}>
                  {cat.hint}
                </span>
              </div>
            </div>
          ))}
          <MoreHidden count={hiddenWaiting} />
        </div>
      )}
    </>
  );
}

export const dataCoverageWidgets: WidgetRegistry = {
  'data-coverage': DataCoverageWidget,
};

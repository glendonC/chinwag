import { useState } from 'react';
import TrueShareBars, { type TrueShareEntry } from '../compare/TrueShareBars.js';
import { workTypeColor } from '../../../widgets/utils.js';
import styles from './FileHeatgrid.module.css';

export interface FileHeatgridEntry {
  file: string;
  touch_count: number;
  work_type?: string | null;
  total_lines_added?: number;
  total_lines_removed?: number;
}

interface Props {
  entries: ReadonlyArray<FileHeatgridEntry>;
  /** Uncapped COUNT(DISTINCT file_path) for the period. If greater than
   *  entries.length, the heatmap was truncated and the caption will show
   *  "Showing top N of M". */
  totalFiles?: number;
  /** How many rows to show before expand. Default 12. */
  collapsedLimit?: number;
}

function splitPath(file: string): { dir: string; name: string } {
  const idx = file.lastIndexOf('/');
  if (idx < 0) return { dir: '', name: file };
  return { dir: file.slice(0, idx + 1), name: file.slice(idx + 1) };
}

export default function FileHeatgrid({ entries, totalFiles, collapsedLimit = 12 }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;

  const visible = expanded ? entries : entries.slice(0, collapsedLimit);
  const captureCount = entries.length;
  const canExpand = captureCount > collapsedLimit;
  const shownOfTotal = totalFiles && totalFiles > captureCount ? totalFiles : null;

  const rows: TrueShareEntry[] = visible.map((f) => {
    const { dir, name } = splitPath(f.file);
    const churn = (f.total_lines_added ?? 0) + (f.total_lines_removed ?? 0);
    const density = f.touch_count > 0 ? churn / f.touch_count : 0;
    return {
      key: f.file,
      label: (
        <>
          {dir && <span className={styles.dir}>{dir}</span>}
          <span className={styles.name}>{name}</span>
        </>
      ),
      value: f.touch_count,
      color: workTypeColor(f.work_type ?? 'other'),
      title: f.file,
      meta: density > 0 ? `${density.toFixed(0)} lines/touch` : null,
    };
  });

  return (
    <div className={styles.wrap}>
      {(shownOfTotal !== null || canExpand) && (
        <div className={styles.caption}>
          {shownOfTotal !== null
            ? `Top ${captureCount} of ${shownOfTotal.toLocaleString()} files touched`
            : `${captureCount} files touched`}
        </div>
      )}
      <TrueShareBars
        entries={rows}
        formatValue={(n) => `${n.toLocaleString()} touches`}
        formatShare={() => ''}
      />
      {canExpand && (
        <button type="button" className={styles.expand} onClick={() => setExpanded((x) => !x)}>
          {expanded ? 'Show less' : `Show all ${captureCount}`}
        </button>
      )}
    </div>
  );
}

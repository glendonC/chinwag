import clsx from 'clsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import styles from './ToolIcon.module.css';

function faviconUrl(website: string | undefined): string | null {
  if (!website) return null;
  try {
    const { hostname } = new URL(website);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
  } catch {
    return null;
  }
}

interface Props {
  tool: string;
  website?: string;
  size?: number;
  monochrome?: boolean;
  className?: string;
  ariaHidden?: boolean;
}

export default function ToolIcon({
  tool,
  website,
  size = 18,
  monochrome = false,
  className = '',
  ariaHidden = true,
}: Props) {
  const meta = getToolMeta(tool);
  const classes = clsx(styles.icon, monochrome && styles.monochrome, className);

  // 1. Local SVG (highest quality — hand-curated)
  if (meta.icon) {
    if (monochrome) {
      return (
        <span className={classes} style={{ width: size, height: size }} aria-hidden={ariaHidden}>
          <img src={meta.icon} alt="" />
        </span>
      );
    }

    return (
      <span
        className={classes}
        style={{
          width: size,
          height: size,
          backgroundColor: meta.color,
          WebkitMaskImage: `url(${meta.icon})`,
          maskImage: `url(${meta.icon})`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
        aria-hidden={ariaHidden}
      />
    );
  }

  // 2. Google favicon service — works for any domain, always returns an icon
  const gFavicon = faviconUrl(website);
  if (gFavicon) {
    return (
      <span className={classes} style={{ width: size, height: size }} aria-hidden={ariaHidden}>
        <img src={gFavicon} alt="" className={styles.favicon} />
      </span>
    );
  }

  // 3. Letter fallback
  return (
    <span
      className={clsx(classes, styles.fallback)}
      style={{ width: size, height: size, backgroundColor: meta.color }}
      aria-hidden={ariaHidden}
    >
      {meta.label.slice(0, 1)}
    </span>
  );
}

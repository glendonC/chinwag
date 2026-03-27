import { getToolMeta } from '../../lib/toolMeta.js';
import styles from './ToolIcon.module.css';

export default function ToolIcon({
  tool,
  size = 18,
  monochrome = false,
  className = '',
  ariaHidden = true,
}) {
  const meta = getToolMeta(tool);
  const classes = [
    styles.icon,
    monochrome ? styles.monochrome : '',
    className,
  ].filter(Boolean).join(' ');

  if (meta.icon) {
    return (
      <span
        className={classes}
        style={{ width: size, height: size, color: meta.color }}
        aria-hidden={ariaHidden}
      >
        <img src={meta.icon} alt="" />
      </span>
    );
  }

  return (
    <span
      className={`${classes} ${styles.fallback}`}
      style={{ width: size, height: size, color: meta.color }}
      aria-hidden={ariaHidden}
    >
      {meta.label.slice(0, 1)}
    </span>
  );
}

import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './DetailSection.module.css';

interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  label: ReactNode;
  children: ReactNode;
}

/**
 * One section inside a DetailView panel. Mono uppercase label above
 * the content. The dominant structural primitive in every detail
 * view panel — "By tool", "Daily outcome mix", "Session duration", etc.
 */
export default function DetailSection({ label, children, className, ...rest }: Props) {
  return (
    <section className={clsx(styles.section, className)} {...rest}>
      <span className={styles.label}>{label}</span>
      {children}
    </section>
  );
}

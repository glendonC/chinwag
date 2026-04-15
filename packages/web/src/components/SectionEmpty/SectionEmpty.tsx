import type { ReactNode } from 'react';
import styles from './SectionEmpty.module.css';

interface Props {
  children: ReactNode;
}

export default function SectionEmpty({ children }: Props) {
  return <span className={styles.sectionEmpty}>{children}</span>;
}

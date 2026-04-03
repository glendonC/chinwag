import styles from './ProjectView.module.css';

interface SummaryStatProps {
  label: string;
  value: number | string;
}

export default function SummaryStat({ label, value }: SummaryStatProps) {
  return (
    <div className={styles.summaryItem}>
      <span className={styles.summaryValue}>{value}</span>
      <span className={styles.summaryLabel}>{label}</span>
    </div>
  );
}

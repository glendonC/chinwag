import styles from './Skeleton.module.css';

export function SkeletonLine({ width = '100%', height = 14, delay = 0 }) {
  return (
    <span
      className={styles.line}
      style={{ width, height, animationDelay: `${delay}ms` }}
    />
  );
}

export function SkeletonStatGrid({ count = 4 }) {
  return (
    <div className={styles.statGrid}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.statCell} style={{ animationDelay: `${i * 60}ms` }}>
          <SkeletonLine width={56} height={10} delay={i * 60} />
          <SkeletonLine width="60%" height={48} delay={i * 60 + 40} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 4, columns = 3 }) {
  return (
    <div className={styles.rows}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.row} style={{ animationDelay: `${i * 50}ms` }}>
          <SkeletonLine width="40%" height={12} delay={i * 50} />
          {Array.from({ length: columns - 1 }, (_, j) => (
            <SkeletonLine key={j} width={48} height={12} delay={i * 50 + 30} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ShimmerText({ children, as: Tag = 'h2', className = '' }) {
  return (
    <Tag className={`${styles.shimmerText} ${className}`.trim()}>
      {children}
    </Tag>
  );
}

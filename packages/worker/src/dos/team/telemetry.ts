// Telemetry counter writes extracted from TeamDO.
//
// Writes a lifetime counter and a daily bucket for trend analysis. Both rows
// are upserted so the counter is safe to call from any RPC path without a
// pre-existence check.

export function recordMetric(sql: SqlStorage, metric: string): void {
  // Lifetime counter
  sql.exec(
    `INSERT INTO telemetry (metric, count, last_at) VALUES (?, 1, datetime('now'))
     ON CONFLICT(metric) DO UPDATE SET count = count + 1, last_at = datetime('now')`,
    metric,
  );
  // Daily bucket for trend analysis
  sql.exec(
    `INSERT INTO daily_metrics (date, metric, count) VALUES (date('now'), ?, 1)
     ON CONFLICT(date, metric) DO UPDATE SET count = count + 1`,
    metric,
  );
}

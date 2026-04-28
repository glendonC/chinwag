import { describe, it, expect, vi } from 'vitest';

// Mock cloudflare:workers so DO class imports resolve outside the Workers runtime
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import { buildDataCoverage } from '../lib/data-coverage.js';

describe('buildDataCoverage', () => {
  it('returns an all-zero shape for an empty active set', () => {
    const cov = buildDataCoverage(new Set());
    expect(cov.tools_reporting).toEqual([]);
    expect(cov.tools_without_data).toEqual([]);
    expect(cov.coverage_rate).toBe(0);
    // No tools means no capabilities to claim or miss.
    expect(cov.capabilities_available).toEqual([]);
    expect(cov.capabilities_missing).toEqual([]);
  });

  it('lists tokenUsage-capable tools as reporting', () => {
    // claude-code is the load-bearing tokenUsage tool for chinmeister today; if
    // this assertion ever flips, the cost widget's entire design premise
    // needs revisiting.
    const cov = buildDataCoverage(new Set(['claude-code']));
    expect(cov.tools_reporting).toContain('claude-code');
    expect(cov.capabilities_available).toContain('tokenUsage');
    expect(cov.coverage_rate).toBe(1);
  });

  it('puts unknown tool names into tools_without_data', () => {
    // A tool string not in the shared registry has no capabilities, so it
    // lands in the non-reporting bucket rather than crashing the helper.
    const cov = buildDataCoverage(new Set(['made-up-tool']));
    expect(cov.tools_reporting).toEqual([]);
    expect(cov.tools_without_data).toEqual(['made-up-tool']);
    expect(cov.coverage_rate).toBe(0);
    // With one active tool that has no capabilities, every capability lands
    // in missing - not skipped. That's the disclosure path for
    // "your active tool can't report cost."
    expect(cov.capabilities_missing.length).toBeGreaterThan(0);
  });

  it('partitions reporting vs non-reporting correctly when mixed', () => {
    // claude-code reports; made-up-tool doesn't. The split is structural -
    // the registry may evolve (e.g. cursor gaining tokenUsage via hooks),
    // so we verify the partition rule, not the list contents.
    const cov = buildDataCoverage(new Set(['claude-code', 'made-up-tool']));
    expect(cov.tools_reporting).toContain('claude-code');
    expect(cov.tools_without_data).toContain('made-up-tool');
    expect(cov.tools_reporting.length + cov.tools_without_data.length).toBe(2);
    // 1 reporting / 2 active = 0.5 coverage rate. Exact arithmetic.
    expect(cov.coverage_rate).toBe(0.5);
  });

  it('rounds coverage_rate to two decimal places', () => {
    // 1 reporting / 3 active = 0.333…, rounded to 0.33. Keeps the field
    // stable for snapshot tests and JSON comparisons.
    const cov = buildDataCoverage(new Set(['claude-code', 'fake-a', 'fake-b']));
    expect(cov.coverage_rate).toBe(0.33);
  });
});

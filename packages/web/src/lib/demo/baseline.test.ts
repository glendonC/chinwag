/**
 * Baseline-completeness drift safeguard.
 *
 * Walks the healthy baseline UserAnalytics payload and asserts every array
 * field has at least one element. Numeric scalars are not checked (zero is a
 * legal value for many of them - e.g. memory_secrets_shield.blocked_period
 * in a clean week). The trap this catches is the one we just hit: a new
 * schema field gets added (cross_tool_memory_flow, memory_categories, etc.),
 * the widget reads it, but baseline.ts forgets to populate it. Demo mode then
 * silently shows empty tiles for redesigned widgets.
 *
 * Allow-list entries are intentional empties - fields that should be `[]` in
 * a healthy team because the data only exists under specific conditions
 * (e.g. retry_patterns when no retries happened). Each allow-list entry must
 * carry a one-line rationale. Keep the list short.
 *
 * If this test fails: either populate the field in baseline.ts, or add it
 * here with a reason. Don't suppress the assertion; the cost of a one-line
 * decision now is much lower than the cost of empty cockpit tiles later.
 */
import { describe, it, expect } from 'vitest';
import { createBaselineAnalytics } from './baseline.js';
import { createBaselineConversation } from './conversation.js';

// Array fields that are legitimately empty in the healthy baseline. Each
// entry needs a reason. If a field starts being populated by real teams,
// move it out of here and add data to baseline.ts.
const ALLOW_EMPTY_ARRAYS: Record<string, string> = {
  // Conflict daily series renders a per-day count; in a healthy week with
  // zero blocked edits, every day is zero so the array can collapse. The
  // conflict-stats widget handles the empty case explicitly.
  'conflict_stats.daily_blocked': 'no blocked edits in healthy baseline',
  // Models the pricing layer has not yet priced. Healthy baseline assumes
  // every observed model is in the LiteLLM snapshot.
  'token_usage.models_without_pricing': 'healthy baseline assumes all models priced',
  // Token-coverage capabilities - when every reporting tool has full
  // capability coverage, capabilities_missing is empty.
  'data_coverage.capabilities_missing': 'healthy baseline has full capability coverage',
  'data_coverage.tools_without_data': 'healthy baseline has every tool reporting',
  // Conversation tool coverage breakdown - healthy baseline has every
  // conversation-capable tool reporting.
  'conversation.tool_coverage.unsupported_tools': 'healthy baseline has full conversation coverage',
};

interface FlatField {
  path: string;
  value: unknown;
}

function flatten(obj: unknown, prefix = ''): FlatField[] {
  if (obj === null || obj === undefined) return [];
  if (Array.isArray(obj)) return [{ path: prefix, value: obj }];
  if (typeof obj !== 'object') return [{ path: prefix, value: obj }];
  const out: FlatField[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(...flatten(value, path));
  }
  return out;
}

describe('healthy baseline completeness', () => {
  it('every array field on UserAnalytics has at least one element', () => {
    const analytics = createBaselineAnalytics();
    const empties: string[] = [];
    for (const { path, value } of flatten(analytics)) {
      if (Array.isArray(value) && value.length === 0 && !ALLOW_EMPTY_ARRAYS[path]) {
        empties.push(path);
      }
    }
    expect(
      empties,
      `Healthy baseline has empty arrays at:\n  ${empties.join('\n  ')}\n\n` +
        `Either populate them in packages/web/src/lib/demo/baseline.ts, or add ` +
        `them to ALLOW_EMPTY_ARRAYS in this file with a one-line reason.`,
    ).toEqual([]);
  });

  it('every array field on ConversationAnalytics has at least one element', () => {
    const conversation = createBaselineConversation();
    const empties: string[] = [];
    for (const { path, value } of flatten(conversation, 'conversation')) {
      if (Array.isArray(value) && value.length === 0 && !ALLOW_EMPTY_ARRAYS[path]) {
        empties.push(path);
      }
    }
    expect(
      empties,
      `Healthy baseline conversation has empty arrays at:\n  ${empties.join('\n  ')}\n\n` +
        `Populate them in packages/web/src/lib/demo/conversation.ts or add to ALLOW_EMPTY_ARRAYS.`,
    ).toEqual([]);
  });

  it('memory aging buckets sum to total_memories', () => {
    const a = createBaselineAnalytics();
    const sum =
      a.memory_aging.recent_7d +
      a.memory_aging.recent_30d +
      a.memory_aging.recent_90d +
      a.memory_aging.older;
    expect(sum, `aging buckets must sum to total_memories=${a.memory_usage.total_memories}`).toBe(
      a.memory_usage.total_memories,
    );
  });

  it('memory supersession.pending_proposals matches memory_usage.pending_consolidation_proposals', () => {
    const a = createBaselineAnalytics();
    expect(a.memory_supersession.pending_proposals).toBe(
      a.memory_usage.pending_consolidation_proposals,
    );
  });
});

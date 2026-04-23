import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function fixtureHome() {
  return join(
    tmpdir(),
    `chinmeister-health-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

// health.ts computes HEALTH_DIR from homedir() at module load time.
// Override HOME and re-import the module per test to isolate persistence.
async function loadHealth(home) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  vi.resetModules();
  return import('../extraction/health.js');
}

describe('SpecHealth persistence', () => {
  let home;
  let originalHome;

  beforeEach(() => {
    originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    home = fixtureHome();
    mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    process.env.HOME = originalHome.HOME;
    process.env.USERPROFILE = originalHome.USERPROFILE;
  });

  it('records the first attempt and persists to disk', async () => {
    const { recordAttempt, getToolHealth } = await loadHealth(home);
    recordAttempt('claude-code', {
      timestamp: new Date().toISOString(),
      success: true,
      specUsed: true,
      fallbackUsed: false,
      conversationCount: 5,
      tokenExtracted: true,
      toolCallCount: 3,
    });

    const health = getToolHealth('claude-code');
    expect(health).not.toBeNull();
    expect(health.attempts).toHaveLength(1);
    expect(existsSync(join(home, '.chinmeister', 'spec-health.json'))).toBe(true);
  });

  it('persisted file is valid JSON (atomic write, no partial data)', async () => {
    const { recordAttempt } = await loadHealth(home);
    recordAttempt('codex', {
      timestamp: new Date().toISOString(),
      success: false,
      specUsed: true,
      fallbackUsed: true,
      conversationCount: 0,
      tokenExtracted: false,
      toolCallCount: 0,
      error: 'field not found',
    });

    const raw = readFileSync(join(home, '.chinmeister', 'spec-health.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    expect(parsed.tools.codex.attempts[0].error).toBe('field not found');
  });

  it('caps the rolling window at 20 attempts', async () => {
    const { recordAttempt, getToolHealth } = await loadHealth(home);
    for (let i = 0; i < 25; i++) {
      recordAttempt('claude-code', {
        timestamp: new Date(Date.now() + i).toISOString(),
        success: i % 2 === 0,
        specUsed: true,
        fallbackUsed: false,
        conversationCount: i,
        tokenExtracted: true,
        toolCallCount: 0,
      });
    }
    const health = getToolHealth('claude-code');
    expect(health.attempts).toHaveLength(20);
    expect(health.attempts[0].conversationCount).toBe(5);
    expect(health.attempts[19].conversationCount).toBe(24);
  });
});

describe('diagnose()', () => {
  let home;
  let originalHome;

  beforeEach(() => {
    originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    home = fixtureHome();
    mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    process.env.HOME = originalHome.HOME;
    process.env.USERPROFILE = originalHome.USERPROFILE;
  });

  function attempt(success) {
    return {
      timestamp: new Date().toISOString(),
      success,
      specUsed: true,
      fallbackUsed: false,
      conversationCount: success ? 5 : 0,
      tokenExtracted: success,
      toolCallCount: 0,
    };
  }

  it('returns needsHealing=false for unknown tool', async () => {
    const { diagnose } = await loadHealth(home);
    const d = diagnose('unknown-tool');
    expect(d.needsHealing).toBe(false);
    expect(d.totalAttempts).toBe(0);
    expect(d.successRate).toBe(1);
  });

  it('does not trigger healing until minimum attempts reached', async () => {
    const { recordAttempt, diagnose } = await loadHealth(home);
    // 4 failures — under the min of 5
    for (let i = 0; i < 4; i++) recordAttempt('claude-code', attempt(false));
    expect(diagnose('claude-code').needsHealing).toBe(false);
  });

  it('triggers healing when success rate below 50% over 5+ attempts', async () => {
    const { recordAttempt, diagnose } = await loadHealth(home);
    recordAttempt('claude-code', attempt(true));
    for (let i = 0; i < 4; i++) recordAttempt('claude-code', attempt(false));
    const d = diagnose('claude-code');
    expect(d.totalAttempts).toBe(5);
    expect(d.successRate).toBe(0.2);
    expect(d.needsHealing).toBe(true);
  });

  it('does not trigger healing when success rate is healthy', async () => {
    const { recordAttempt, diagnose } = await loadHealth(home);
    for (let i = 0; i < 5; i++) recordAttempt('claude-code', attempt(true));
    const d = diagnose('claude-code');
    expect(d.successRate).toBe(1);
    expect(d.needsHealing).toBe(false);
  });
});

describe('markHealed()', () => {
  let home;
  let originalHome;

  beforeEach(() => {
    originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    home = fixtureHome();
    mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    process.env.HOME = originalHome.HOME;
    process.env.USERPROFILE = originalHome.USERPROFILE;
  });

  it('increments heal attempt counter and stamps lastHealedAt', async () => {
    const { recordAttempt, markHealed, getToolHealth } = await loadHealth(home);
    recordAttempt('claude-code', {
      timestamp: new Date().toISOString(),
      success: true,
      specUsed: true,
      fallbackUsed: false,
      conversationCount: 1,
      tokenExtracted: true,
      toolCallCount: 0,
    });
    markHealed('claude-code');
    markHealed('claude-code');

    const health = getToolHealth('claude-code');
    expect(health.healAttempts).toBe(2);
    expect(health.lastHealedAt).toBeDefined();
  });

  it('is a no-op for unknown tools', async () => {
    const { markHealed, getToolHealth } = await loadHealth(home);
    markHealed('never-seen');
    expect(getToolHealth('never-seen')).toBeNull();
  });
});

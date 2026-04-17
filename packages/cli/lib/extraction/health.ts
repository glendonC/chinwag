/**
 * SpecHealth tracking.
 *
 * Tracks extraction success/failure rates per tool in a rolling window.
 * Persisted to ~/.chinwag/spec-health.json so health survives restarts.
 * The healer reads health to decide when to trigger re-discovery.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createLogger } from '@chinwag/shared';
import { writeFileAtomicSync } from '@chinwag/shared/fs-atomic.js';

const log = createLogger('spec-health');

const HEALTH_DIR = join(homedir(), '.chinwag');
const HEALTH_FILE = join(HEALTH_DIR, 'spec-health.json');
const ROLLING_WINDOW = 20;
const FAILURE_THRESHOLD = 0.5;
const MIN_ATTEMPTS_FOR_TRIGGER = 5;

export interface ExtractionAttempt {
  timestamp: string;
  success: boolean;
  specUsed: boolean;
  fallbackUsed: boolean;
  conversationCount: number;
  tokenExtracted: boolean;
  toolCallCount: number;
  error?: string;
}

export interface ToolHealth {
  tool: string;
  specVersion: string;
  attempts: ExtractionAttempt[];
  lastHealedAt?: string;
  healAttempts: number;
}

export interface SpecHealthStore {
  tools: Record<string, ToolHealth>;
  lastUpdated: string;
}

function loadStore(): SpecHealthStore {
  try {
    const raw = readFileSync(HEALTH_FILE, 'utf-8');
    return JSON.parse(raw) as SpecHealthStore;
  } catch {
    return { tools: {}, lastUpdated: new Date().toISOString() };
  }
}

function saveStore(store: SpecHealthStore): void {
  try {
    writeFileAtomicSync(HEALTH_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    log.warn(`failed to persist spec health: ${err}`);
  }
}

export function recordAttempt(toolId: string, attempt: ExtractionAttempt): void {
  const store = loadStore();

  if (!store.tools[toolId]) {
    store.tools[toolId] = {
      tool: toolId,
      specVersion: 'unknown',
      attempts: [],
      healAttempts: 0,
    };
  }

  const health = store.tools[toolId];
  health.attempts.push(attempt);

  // Keep only the rolling window
  if (health.attempts.length > ROLLING_WINDOW) {
    health.attempts = health.attempts.slice(-ROLLING_WINDOW);
  }

  store.lastUpdated = new Date().toISOString();
  saveStore(store);
}

export function getToolHealth(toolId: string): ToolHealth | null {
  const store = loadStore();
  return store.tools[toolId] || null;
}

export function getSuccessRate(toolId: string): number {
  const health = getToolHealth(toolId);
  if (!health || health.attempts.length === 0) return 1;

  const specAttempts = health.attempts.filter((a) => a.specUsed);
  if (specAttempts.length === 0) return 1;

  const successes = specAttempts.filter((a) => a.success).length;
  return successes / specAttempts.length;
}

export interface HealthDiagnosis {
  tool: string;
  successRate: number;
  needsHealing: boolean;
  recentFailureCount: number;
  totalAttempts: number;
  lastHealedAt?: string | undefined;
  healAttempts: number;
}

export function diagnose(toolId: string): HealthDiagnosis {
  const health = getToolHealth(toolId);
  if (!health) {
    return {
      tool: toolId,
      successRate: 1,
      needsHealing: false,
      recentFailureCount: 0,
      totalAttempts: 0,
      healAttempts: 0,
    };
  }

  const specAttempts = health.attempts.filter((a) => a.specUsed);
  const successRate =
    specAttempts.length > 0
      ? specAttempts.filter((a) => a.success).length / specAttempts.length
      : 1;

  const recentFailures = specAttempts.filter((a) => !a.success).length;
  const needsHealing =
    specAttempts.length >= MIN_ATTEMPTS_FOR_TRIGGER && successRate < FAILURE_THRESHOLD;

  return {
    tool: toolId,
    successRate,
    needsHealing,
    recentFailureCount: recentFailures,
    totalAttempts: specAttempts.length,
    lastHealedAt: health.lastHealedAt,
    healAttempts: health.healAttempts,
  };
}

export function markHealed(toolId: string): void {
  const store = loadStore();
  if (store.tools[toolId]) {
    store.tools[toolId].lastHealedAt = new Date().toISOString();
    store.tools[toolId].healAttempts++;
    store.lastUpdated = new Date().toISOString();
    saveStore(store);
  }
}

export function getAllHealth(): SpecHealthStore {
  return loadStore();
}

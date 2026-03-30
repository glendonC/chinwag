import { describe, expect, it } from 'vitest';
import { parseDoctorArgs, selectRepairTargets } from '../doctor-command.js';

describe('doctor command parsing', () => {
  it('defaults to scan mode', () => {
    expect(parseDoctorArgs([])).toEqual({
      action: 'scan',
      hostId: null,
      fixAll: false,
      onlyDetected: true,
    });
  });

  it('parses fix-all mode', () => {
    expect(parseDoctorArgs(['fix'])).toEqual({
      action: 'fix',
      hostId: null,
      fixAll: true,
      onlyDetected: true,
    });
  });

  it('parses fix mode for a specific host', () => {
    expect(parseDoctorArgs(['fix', 'cursor'])).toEqual({
      action: 'fix',
      hostId: 'cursor',
      fixAll: false,
      onlyDetected: true,
    });
  });
});

describe('doctor repair target selection', () => {
  const scanResults = [
    { id: 'cursor', detected: true, repairable: true, status: 'needs_setup' },
    { id: 'claude-code', detected: true, repairable: true, status: 'ready' },
    { id: 'windsurf', detected: false, repairable: true, status: 'not_detected' },
  ];

  it('selects only detected integrations needing repair for fix-all', () => {
    expect(selectRepairTargets(scanResults, { fixAll: true })).toEqual(['cursor']);
  });

  it('prefers an explicit host target', () => {
    expect(selectRepairTargets(scanResults, { hostId: 'claude-code', fixAll: false })).toEqual(['claude-code']);
  });
});

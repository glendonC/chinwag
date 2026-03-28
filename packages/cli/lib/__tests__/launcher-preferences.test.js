import { describe, expect, it } from 'vitest';
import {
  getLauncherPreference,
  resolvePreferredManagedTool,
  setLauncherPreference,
} from '../launcher-preferences.js';

describe('launcher preferences', () => {
  it('stores launcher preferences by scope without clobbering other config', () => {
    const config = {
      token: 'tok_123',
      handle: 'lazypug',
      launcherPreferences: {
        managedToolByScope: {
          team_a: 'claude-code',
        },
      },
    };

    const next = setLauncherPreference(config, 'team_b', 'codex');

    expect(next).toEqual({
      token: 'tok_123',
      handle: 'lazypug',
      launcherPreferences: {
        managedToolByScope: {
          team_a: 'claude-code',
          team_b: 'codex',
        },
      },
    });
    expect(config.launcherPreferences.managedToolByScope.team_b).toBeUndefined();
  });

  it('reads stored launcher preferences by scope', () => {
    const config = {
      launcherPreferences: {
        managedToolByScope: {
          team_a: 'claude-code',
        },
      },
    };

    expect(getLauncherPreference(config, 'team_a')).toBe('claude-code');
    expect(getLauncherPreference(config, 'team_b')).toBeNull();
  });

  it('prefers the remembered tool when available', () => {
    const tools = [
      { id: 'claude-code', name: 'Claude Code' },
      { id: 'codex', name: 'Codex' },
    ];

    expect(resolvePreferredManagedTool(tools, 'codex')).toEqual({ id: 'codex', name: 'Codex' });
  });

  it('falls back to the only ready tool when no preference exists', () => {
    const tools = [{ id: 'codex', name: 'Codex' }];

    expect(resolvePreferredManagedTool(tools, null)).toEqual({ id: 'codex', name: 'Codex' });
    expect(resolvePreferredManagedTool(tools, 'claude-code')).toEqual({ id: 'codex', name: 'Codex' });
  });

  it('requires a choice when multiple tools are ready and no preference matches', () => {
    const tools = [
      { id: 'claude-code', name: 'Claude Code' },
      { id: 'codex', name: 'Codex' },
    ];

    expect(resolvePreferredManagedTool(tools, null)).toBeNull();
    expect(resolvePreferredManagedTool(tools, 'cursor')).toBeNull();
  });
});

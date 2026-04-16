// Path detection for the Reports skeleton.
//
// At real-backend time, this will check whether the user's CLI daemon is
// connected and whether a managed agent (Claude Code / Codex / Aider) is
// available. Until then, it returns a mocked state that the skeleton can
// vary to demo both paths.
//
// Two paths:
//   - `primary`   = user's own managed agent
//   - `secondary` = chinwag-offered AI (metered / paid tier in real product)
//
// The skeleton defaults to primary. Flip the MOCK_STATE below to preview
// the "no managed agent" experience.

import type { RunPath } from './types.js';

export type PathAvailability = {
  /** Which path would be used if the user clicked Launch right now. */
  active: RunPath;
  /** Whether the primary path (user's managed agent) is available. */
  primaryAvailable: boolean;
  /** Whether the secondary path (chinwag-offered AI) is offered. */
  secondaryOffered: boolean;
  /** Display label for the active path. */
  label: string;
  /** Short copy for the trust line — what happens when the user launches. */
  trustLine: string;
};

type MockState = 'primary-ready' | 'no-managed-agent' | 'cli-offline';

const MOCK_STATE: MockState = 'primary-ready';

export function getPathAvailability(): PathAvailability {
  switch (MOCK_STATE) {
    case 'primary-ready':
      return {
        active: 'primary',
        primaryAvailable: true,
        secondaryOffered: true,
        label: 'Your Claude Code',
        trustLine: 'Runs on your Claude Code session · ~$0.40 on your subscription · high quality',
      };
    case 'no-managed-agent':
      return {
        active: 'secondary',
        primaryAvailable: false,
        secondaryOffered: true,
        label: 'chinwag AI',
        trustLine: 'No managed agent detected · runs on chinwag AI · basic quality · free tier',
      };
    case 'cli-offline':
      return {
        active: 'secondary',
        primaryAvailable: false,
        secondaryOffered: true,
        label: 'chinwag AI',
        trustLine: 'Your CLI is offline · runs on chinwag AI · basic quality · free tier',
      };
  }
}

/** Convenience helpers used by the UI. */
export function pathLabel(path: RunPath): string {
  return path === 'primary' ? 'Your Claude Code' : 'chinwag AI';
}

export function pathShortLabel(path: RunPath): string {
  return path === 'primary' ? 'Claude Code' : 'chinwag AI';
}

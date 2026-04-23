import { useEffect, useMemo, useState } from 'react';
import {
  configureHostIntegration,
  scanHostIntegrations,
  summarizeIntegrationScan,
} from '@chinmeister/shared/integration-doctor.js';
import type { IntegrationScanResult } from '@chinmeister/shared/integration-doctor.js';
import type { NoticeTone } from './reducer.js';

interface UseIntegrationDoctorParams {
  projectRoot: string | null;
  flash: (text: string, options?: { tone?: NoticeTone }) => void;
}

export interface UseIntegrationDoctorReturn {
  integrationStatuses: IntegrationScanResult[];
  integrationIssues: IntegrationScanResult[];
  refreshIntegrationStatuses: (options?: { showFlash?: boolean }) => IntegrationScanResult[];
  repairIntegrations: (hostIds?: string[] | null) => boolean;
}

export function useIntegrationDoctor({
  projectRoot,
  flash,
}: UseIntegrationDoctorParams): UseIntegrationDoctorReturn {
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationScanResult[]>([]);

  function refreshIntegrationStatuses({ showFlash = false } = {}): IntegrationScanResult[] {
    if (!projectRoot) return [];
    try {
      const results = scanHostIntegrations(projectRoot);
      setIntegrationStatuses(results);
      if (showFlash) {
        const summary = summarizeIntegrationScan(results);
        flash(summary.text, { tone: summary.tone as NoticeTone });
      }
      return results;
    } catch {
      flash('Could not scan integrations.', { tone: 'error' });
      return [];
    }
  }

  useEffect(() => {
    if (!projectRoot) return;
    refreshIntegrationStatuses();
  }, [projectRoot]);

  const integrationIssues = useMemo(
    () =>
      integrationStatuses.filter(
        (item) => item.detected && item.repairable && item.status !== 'ready',
      ),
    [integrationStatuses],
  );

  function repairIntegrations(hostIds: string[] | null = null): boolean {
    if (!projectRoot) {
      flash('No project found. Open a project directory first.', { tone: 'warning' });
      return false;
    }

    const targets = hostIds?.length ? hostIds : integrationIssues.map((item) => item.id);
    if (targets.length === 0) {
      flash('No issues to repair.', { tone: 'info' });
      return false;
    }

    const repaired: string[] = [];
    const failed: Array<{ hostId: string; error: string }> = [];
    for (const hostId of targets) {
      const result = configureHostIntegration(projectRoot, hostId);
      if (result.error) {
        failed.push({ hostId, error: result.error });
      } else {
        repaired.push(result.name || hostId);
      }
    }

    refreshIntegrationStatuses();

    if (repaired.length > 0 && failed.length === 0) {
      flash(`Repaired ${repaired.join(', ')}. Restart affected tools to reconnect.`, {
        tone: 'success',
      });
      return true;
    }

    if (repaired.length > 0) {
      flash(`Repaired ${repaired.join(', ')}, but some fixes failed.`, { tone: 'warning' });
      return true;
    }

    flash('Could not repair integrations.', { tone: 'error' });
    return false;
  }

  return {
    integrationStatuses,
    integrationIssues,
    refreshIntegrationStatuses,
    repairIntegrations,
  };
}

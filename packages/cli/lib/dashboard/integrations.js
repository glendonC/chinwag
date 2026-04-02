import { useEffect, useMemo, useState } from 'react';
import {
  configureHostIntegration,
  scanHostIntegrations,
  summarizeIntegrationScan,
} from '../../../shared/integration-doctor.js';

export function useIntegrationDoctor({ projectRoot, flash }) {
  const [integrationStatuses, setIntegrationStatuses] = useState([]);

  function refreshIntegrationStatuses({ showFlash = false } = {}) {
    if (!projectRoot) return [];
    try {
      const results = scanHostIntegrations(projectRoot);
      setIntegrationStatuses(results);
      if (showFlash) {
        const summary = summarizeIntegrationScan(results);
        flash(summary.text, { tone: summary.tone });
      }
      return results;
    } catch (err) {
      flash(`Could not scan integrations: ${err.message}`, { tone: 'error' });
      return [];
    }
  }

  useEffect(() => {
    if (!projectRoot) return;
    refreshIntegrationStatuses();
  }, [projectRoot]);

  const integrationIssues = useMemo(
    () => integrationStatuses.filter((item) => item.detected && item.repairable && item.status !== 'ready'),
    [integrationStatuses]
  );

  function repairIntegrations(hostIds = null) {
    if (!projectRoot) {
      flash('No project root available for integration repair.', { tone: 'warning' });
      return false;
    }

    const targets = hostIds?.length ? hostIds : integrationIssues.map((item) => item.id);
    if (targets.length === 0) {
      flash('No detected integration issues to repair.', { tone: 'info' });
      return false;
    }

    const repaired = [];
    const failed = [];
    for (const hostId of targets) {
      const result = configureHostIntegration(projectRoot, hostId);
      if (result.error) {
        failed.push({ hostId, error: result.error });
      } else {
        repaired.push(result.name);
      }
    }

    refreshIntegrationStatuses();

    if (repaired.length > 0 && failed.length === 0) {
      flash(`Repaired ${repaired.join(', ')}. Restart affected tools to reconnect.`, { tone: 'success' });
      return true;
    }

    if (repaired.length > 0) {
      flash(`Repaired ${repaired.join(', ')}, but some fixes failed.`, { tone: 'warning' });
      return true;
    }

    flash(failed[0]?.error || 'Could not repair integrations.', { tone: 'error' });
    return false;
  }

  return {
    integrationStatuses,
    integrationIssues,
    refreshIntegrationStatuses,
    repairIntegrations,
  };
}

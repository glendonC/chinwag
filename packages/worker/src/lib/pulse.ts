// Pulse check -- weekly cron that verifies tool directory data freshness.
// Checks GitHub repos for star counts, archive status, and last push date.
// Checks websites for uptime (HEAD request).
// Runs via scheduled handler every Monday at 3am UTC.

import type { Env } from '../types.js';
import { getDB, rpc } from './env.js';
import { createLogger } from './logger.js';

const log = createLogger('pulse');

/** Shape of evaluation records from listEvaluations, narrowed for pulse use. */
interface PulseEvaluation {
  id: string;
  name: string;
  verdict: string;
  evaluated_at: string;
  metadata: Record<string, unknown>;
  data_passes: Record<string, unknown>;
  [key: string]: unknown;
}

interface GitHubRepoResponse {
  stargazers_count?: number;
  archived?: boolean;
}

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

export async function runPulseCheck(env: Env): Promise<void> {
  const db = getDB(env);
  const result = rpc(await db.listEvaluations({ limit: 500, offset: 0 }));
  const evaluations: PulseEvaluation[] = result.evaluations || [];

  const githubTools = evaluations.filter((ev) => {
    const gh = ev.metadata?.github;
    return typeof gh === 'string' && gh.includes('github.com');
  });

  const websiteOnlyTools = evaluations.filter((ev) => {
    const gh = ev.metadata?.github;
    const website = ev.metadata?.website;
    const hasGithub = typeof gh === 'string' && gh.includes('github.com');
    return !hasGithub && typeof website === 'string' && website.startsWith('http');
  });

  log.info(
    `Pulse check: ${githubTools.length} GitHub tools, ${websiteOnlyTools.length} website-only tools`,
  );

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'chinwag-pulse',
  };
  // Use GitHub token if available for higher rate limit (5000/hr vs 60/hr)
  const token = env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const BATCH_SIZE = token ? 50 : 30; // Conservative without auth
  const toProcess = githubTools.slice(0, BATCH_SIZE);

  // --- GitHub repo checks ---
  for (const ev of toProcess) {
    const repo = parseGitHubRepo(ev.metadata?.github as string);
    if (!repo) continue;

    try {
      const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
        headers,
      });
      if (!res.ok) continue;

      const data = (await res.json()) as GitHubRepoResponse;
      const md: Record<string, unknown> = { ...ev.metadata };
      const oldStars = (md.github_stars as number) || 0;
      const newStars = data.stargazers_count ?? 0;

      md.github_stars = newStars;
      md.last_pulse_at = new Date().toISOString();

      if (data.archived) {
        md.pulse_status = 'archived';
      } else if (
        Math.abs(newStars - oldStars) > 100 ||
        (oldStars > 0 && Math.abs(newStars - oldStars) / oldStars > 0.1)
      ) {
        md.pulse_status = 'stars_changed';
      } else {
        md.pulse_status = 'ok';
      }

      await db.saveEvaluation({
        ...ev,
        metadata: md,
        data_passes: {
          ...(typeof ev.data_passes === 'object' && ev.data_passes ? ev.data_passes : {}),
          pulse: { completed_at: new Date().toISOString(), success: true },
        },
      });
    } catch {
      // Skip failed tools silently -- transient network errors shouldn't block the batch
    }
  }

  // --- Website-only checks (HEAD request) ---
  const websiteBatch = websiteOnlyTools.slice(0, Math.max(0, BATCH_SIZE - toProcess.length));
  for (const ev of websiteBatch) {
    const website = ev.metadata?.website;
    if (typeof website !== 'string') continue;

    const dataPasses = typeof ev.data_passes === 'object' && ev.data_passes ? ev.data_passes : {};

    try {
      const res = await fetch(website, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });

      const md: Record<string, unknown> = { ...ev.metadata };
      md.last_pulse_at = new Date().toISOString();

      if (res.status >= 400) {
        md.pulse_status = 'down';
      } else if (res.status === 301) {
        // Check if redirect goes to a different domain
        const location = res.headers.get('Location');
        if (location) {
          try {
            const originalHost = new URL(website).hostname;
            const redirectHost = new URL(location).hostname;
            md.pulse_status = originalHost !== redirectHost ? 'redirect' : 'ok';
          } catch {
            md.pulse_status = 'redirect';
          }
        } else {
          md.pulse_status = 'ok';
        }
      } else {
        md.pulse_status = 'ok';
      }

      await db.saveEvaluation({
        ...ev,
        metadata: md,
        data_passes: {
          ...dataPasses,
          pulse: { completed_at: new Date().toISOString(), success: true },
        },
      });
    } catch {
      // Timeout or network error -- mark as down
      const md: Record<string, unknown> = { ...ev.metadata };
      md.last_pulse_at = new Date().toISOString();
      md.pulse_status = 'down';

      try {
        await db.saveEvaluation({
          ...ev,
          metadata: md,
          data_passes: {
            ...dataPasses,
            pulse: { completed_at: new Date().toISOString(), success: false },
          },
        });
      } catch {
        // Double failure -- skip silently
      }
    }
  }

  log.info(
    `Pulse check complete: ${toProcess.length} GitHub + ${websiteBatch.length} website tools checked`,
  );
}

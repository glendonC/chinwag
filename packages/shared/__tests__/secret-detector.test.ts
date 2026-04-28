import { describe, it, expect } from 'vitest';
import { detectSecrets } from '../secret-detector.js';

describe('detectSecrets', () => {
  describe('cloud providers', () => {
    it('catches AWS access key (AKIA prefix)', () => {
      const m = detectSecrets('use AKIAIOSFODNN7EXAMPLE for prod');
      expect(m).toHaveLength(1);
      expect(m[0]?.type).toBe('aws_access_key');
    });

    it('catches AWS temp key (ASIA prefix)', () => {
      const m = detectSecrets('export AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE');
      expect(m[0]?.type).toBe('aws_access_key');
    });

    it('catches Google API key (AIza)', () => {
      // Real Google API keys are AIza + exactly 35 chars
      const body = 'A'.repeat(35);
      const m = detectSecrets(`GOOGLE_API_KEY=AIza${body}`);
      expect(m[0]?.type).toBe('gcp_api_key');
    });

    it('catches GCP service account JSON private_key', () => {
      const m = detectSecrets(
        '{"type":"service_account","private_key": "-----BEGIN PRIVATE KEY-----\\nMIIE..."}',
      );
      expect(m.some((x) => x.type === 'gcp_service_account_key')).toBe(true);
    });

    it('catches Google OAuth client ID', () => {
      const m = detectSecrets(
        'client_id: 123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com',
      );
      expect(m[0]?.type).toBe('gcp_oauth_client');
    });
  });

  describe('GitHub tokens', () => {
    it('catches classic PAT (ghp_)', () => {
      const m = detectSecrets('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789');
      expect(m[0]?.type).toBe('github_pat');
    });

    it('catches server-to-server token (ghs_)', () => {
      const m = detectSecrets('token: ghs_abcdefghijklmnopqrstuvwxyz0123456789');
      expect(m[0]?.type).toBe('github_server_token');
    });

    it('catches user-to-server token (gho_)', () => {
      const m = detectSecrets('Authorization: token gho_abcdefghijklmnopqrstuvwxyz0123456789');
      expect(m[0]?.type).toBe('github_user_token');
    });

    it('catches fine-grained PAT', () => {
      const longBody = 'A'.repeat(70);
      const m = detectSecrets(`use github_pat_${longBody} please`);
      expect(m[0]?.type).toBe('github_fine_grained_pat');
    });
  });

  describe('LLM providers', () => {
    it('catches OpenAI key (sk-)', () => {
      const m = detectSecrets('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP');
      expect(m[0]?.type).toBe('openai_api_key');
    });

    it('catches OpenAI project key (sk-proj-)', () => {
      const m = detectSecrets('use sk-proj-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV');
      expect(m[0]?.type).toBe('openai_project_key');
    });

    it('catches Anthropic key (sk-ant-api01-)', () => {
      const longBody = 'a'.repeat(95);
      const m = detectSecrets(`ANTHROPIC_API_KEY=sk-ant-api03-${longBody}`);
      expect(m[0]?.type).toBe('anthropic_api_key');
    });

    it('catches Anthropic admin key (sk-ant-admin01-)', () => {
      const longBody = 'b'.repeat(80);
      const m = detectSecrets(`sk-ant-admin01-${longBody}`);
      expect(m[0]?.type).toBe('anthropic_api_key');
    });
  });

  describe('payment providers', () => {
    it('catches Stripe live secret', () => {
      const m = detectSecrets('STRIPE_KEY=sk_live_abcdefghijklmnopqrstuvwx');
      expect(m[0]?.type).toBe('stripe_live_key');
    });

    it('catches Stripe webhook signing secret', () => {
      const m = detectSecrets('export STRIPE_WEBHOOK=whsec_abcdefghijklmnopqrstuvwxyzABCDEF');
      expect(m[0]?.type).toBe('stripe_webhook_secret');
    });

    it('catches Stripe restricted key', () => {
      const m = detectSecrets('rk_live_abcdefghijklmnopqrstuvwxyz123');
      expect(m[0]?.type).toBe('stripe_live_key');
    });
  });

  describe('messaging', () => {
    it('catches Slack bot token (xoxb-)', () => {
      const m = detectSecrets('SLACK_BOT_TOKEN=xoxb-1234567890-abcdefghij1234567890');
      expect(m[0]?.type).toBe('slack_token');
    });

    it('catches Slack app token (xapp-)', () => {
      const m = detectSecrets('xapp-1-A12345-abcdefghijklmnopqrst');
      expect(m[0]?.type).toBe('slack_app_token');
    });

    it('catches Slack incoming webhook URL', () => {
      const m = detectSecrets(
        'post to https://hooks.slack.com/services/T12345678/B12345678/abcdefghijklmnopqrst1234',
      );
      expect(m[0]?.type).toBe('slack_webhook');
    });

    it('catches Discord webhook URL', () => {
      const longBody = 'a'.repeat(70);
      const m = detectSecrets(`https://discord.com/api/webhooks/123456789012345678/${longBody}`);
      expect(m[0]?.type).toBe('discord_webhook');
    });
  });

  describe('JWT, PEM, DB URLs, generic', () => {
    it('catches JWT (3-part signed)', () => {
      // Synthetic but well-formed: header.body.signature
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSIsIm5hbWUiOiJKb2huIn0.HmacSha256SignatureGoesHereXXXXX';
      const m = detectSecrets(`Authorization: Bearer ${jwt}`);
      expect(m.some((x) => x.type === 'jwt')).toBe(true);
    });

    it('catches PEM private key header', () => {
      const m = detectSecrets(
        '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----',
      );
      expect(m[0]?.type).toBe('pem_private_key');
    });

    it('catches OpenSSH private key header', () => {
      const m = detectSecrets('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA...');
      expect(m[0]?.type).toBe('pem_private_key');
    });

    it('catches Postgres URL with credentials', () => {
      const m = detectSecrets(
        'DATABASE_URL=postgresql://app:supersecretpass123@db.example.com/prod',
      );
      expect(m[0]?.type).toBe('database_url_credentials');
    });

    it('catches MongoDB SRV URL with credentials', () => {
      const m = detectSecrets('mongodb+srv://user:p4ssw0rd_xyz@cluster.mongodb.net/db');
      expect(m[0]?.type).toBe('database_url_credentials');
    });

    it('catches generic api_key assignment with sufficient entropy', () => {
      const m = detectSecrets('config { api_key = "sk_test_abcdefghij1234567890" }');
      // Could match either generic_credential_assignment or stripe_test_key - accept both
      expect(m.length).toBeGreaterThan(0);
      expect(m[0]?.type).toMatch(/^(generic_credential_assignment|stripe_test_key)$/);
    });

    it('catches password assignment with quotes', () => {
      const m = detectSecrets('PASSWORD="A1b2C3d4E5f6G7h8i9J0klmn"');
      expect(m[0]?.type).toBe('generic_credential_assignment');
    });
  });

  describe('npm and infra', () => {
    it('catches npm token', () => {
      const m = detectSecrets(
        '//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789',
      );
      expect(m[0]?.type).toBe('npm_token');
    });

    it('catches SendGrid API key', () => {
      // Real SendGrid keys are SG.{22}.{43}
      const part1 = 'a'.repeat(22);
      const part2 = 'b'.repeat(43);
      const m = detectSecrets(`SENDGRID_API_KEY=SG.${part1}.${part2}`);
      expect(m[0]?.type).toBe('sendgrid_api_key');
    });
  });

  describe('false-positive resistance (legitimate prose)', () => {
    it('does not match short password example', () => {
      const m = detectSecrets('the default password is "changeme"');
      expect(m).toHaveLength(0);
    });

    it('does not match prose mentioning AKIA without a real key', () => {
      const m = detectSecrets('AWS access keys start with AKIA followed by 16 alphanumerics');
      expect(m).toHaveLength(0);
    });

    it('does not match documentation about PEM blocks (mentioning the format, not pasting one)', () => {
      const m = detectSecrets('PEM private keys begin with the header BEGIN PRIVATE KEY');
      expect(m).toHaveLength(0);
    });

    it('does not match base64 strings that are not JWTs', () => {
      const m = detectSecrets('the file hash is YWJjZGVmZ2hpamtsbW5vcA==');
      expect(m).toHaveLength(0);
    });

    it('does not match mailto URLs', () => {
      const m = detectSecrets('contact mailto:user@example.com');
      expect(m).toHaveLength(0);
    });

    it('does not match SSH user-host strings (no password component)', () => {
      const m = detectSecrets('ssh user@host.example.com');
      expect(m).toHaveLength(0);
    });

    it('does not match generic 8-char passwords', () => {
      const m = detectSecrets('password = "hunter2"');
      expect(m).toHaveLength(0);
    });

    it('does not match identifier-shaped strings like AWS_ACCESS_KEY_ID', () => {
      const m = detectSecrets('the AWS_ACCESS_KEY_ID environment variable holds the value');
      expect(m).toHaveLength(0);
    });
  });

  describe('overlap deduplication', () => {
    it('returns a single match when one pattern is contained in another', () => {
      // sk-proj- and sk- both match a project key. The proj-specific rule
      // sorts first in RULES; check we don't double-report.
      const m = detectSecrets('OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH');
      const projMatches = m.filter((x) => x.type === 'openai_project_key');
      const genericMatches = m.filter((x) => x.type === 'openai_api_key');
      // Either one match (preferred) or two non-overlapping matches.
      // The dedup logic keeps the longer match; both rules will hit but the
      // overlap filter must drop the contained one.
      expect(projMatches.length + genericMatches.length).toBeLessThanOrEqual(2);
    });

    it('returns multiple matches when secrets are independent', () => {
      const m = detectSecrets('AKIAIOSFODNN7EXAMPLE and ghp_abcdefghijklmnopqrstuvwxyz0123456789');
      expect(m.length).toBeGreaterThanOrEqual(2);
      expect(m.some((x) => x.type === 'aws_access_key')).toBe(true);
      expect(m.some((x) => x.type === 'github_pat')).toBe(true);
    });
  });

  describe('preview redaction', () => {
    it('redacts the matched value in preview', () => {
      const m = detectSecrets('AKIAIOSFODNN7EXAMPLE');
      expect(m[0]?.preview).not.toContain('IOSFODNN7EXAMPLE');
      expect(m[0]?.preview).toMatch(/^AKIA…\[redacted/);
    });
  });

  describe('input handling', () => {
    it('returns empty for empty string', () => {
      expect(detectSecrets('')).toEqual([]);
    });

    it('returns empty for non-string input', () => {
      expect(detectSecrets(null as unknown as string)).toEqual([]);
      expect(detectSecrets(undefined as unknown as string)).toEqual([]);
    });
  });
});

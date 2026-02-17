import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { GitHubRelayerService } from '../src/services/githubRelayer.js';

describe('GitHubRelayerService', () => {
  let relayer;

  beforeEach(() => {
    relayer = new GitHubRelayerService();
  });

  // ============ Webhook Signature Verification ============

  describe('verifyWebhookSignature', () => {
    it('should accept valid HMAC signature', () => {
      relayer.webhookSecret = 'test-secret';
      const payload = '{"test": true}';
      const sig = 'sha256=' + crypto
        .createHmac('sha256', 'test-secret')
        .update(payload, 'utf-8')
        .digest('hex');

      assert.ok(relayer.verifyWebhookSignature(payload, sig));
    });

    it('should reject invalid signature', () => {
      relayer.webhookSecret = 'test-secret';
      assert.ok(!relayer.verifyWebhookSignature('payload', 'sha256=invalid'));
    });

    it('should skip verification if no secret configured', () => {
      relayer.webhookSecret = null;
      assert.ok(relayer.verifyWebhookSignature('anything', null));
    });
  });

  // ============ Event Parsing ============

  describe('_parseGitHubEvent', () => {
    it('should parse push events with commits', () => {
      const payload = {
        repository: { full_name: 'WGlynn/VibeSwap' },
        sender: { login: 'wglynn' },
        commits: [
          {
            id: 'abc123',
            timestamp: '2026-02-16T12:00:00Z',
            author: { email: 'will@vibeswap.io', username: 'wglynn' },
            message: 'Fix bug',
            added: ['file1.js'],
            modified: ['file2.js'],
          },
          {
            id: 'def456',
            timestamp: '2026-02-16T12:01:00Z',
            author: { email: 'will@vibeswap.io', username: 'wglynn' },
            message: 'Add feature',
            added: [],
            modified: ['file3.js', 'file4.js'],
          },
        ],
      };

      const results = relayer._parseGitHubEvent('push', payload);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].repoFullName, 'WGlynn/VibeSwap');
      assert.strictEqual(results[0].commitSha, 'abc123');
      assert.strictEqual(results[0].contribType, 0); // COMMIT
      assert.strictEqual(results[0].authorUsername, 'wglynn');
      assert.strictEqual(results[1].commitSha, 'def456');
    });

    it('should parse merged pull request events', () => {
      const payload = {
        action: 'closed',
        repository: { full_name: 'WGlynn/VibeSwap' },
        pull_request: {
          number: 42,
          merged: true,
          merged_at: '2026-02-16T12:00:00Z',
          user: { login: 'wglynn' },
          title: 'Add Merkle tree',
          additions: 500,
          changed_files: 8,
        },
      };

      const results = relayer._parseGitHubEvent('pull_request', payload);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].contribType, 1); // PR_MERGED
      assert.strictEqual(results[0].commitSha, 'pr-42');
      assert.strictEqual(results[0].additions, 500);
    });

    it('should ignore non-merged PRs', () => {
      const payload = {
        action: 'closed',
        repository: { full_name: 'test/repo' },
        pull_request: { merged: false },
      };

      const results = relayer._parseGitHubEvent('pull_request', payload);
      assert.strictEqual(results.length, 0);
    });

    it('should parse review events', () => {
      const payload = {
        action: 'submitted',
        repository: { full_name: 'WGlynn/VibeSwap' },
        review: {
          id: 12345,
          submitted_at: '2026-02-16T12:00:00Z',
          user: { login: 'reviewer' },
          body: 'LGTM',
        },
        pull_request: { number: 42 },
      };

      const results = relayer._parseGitHubEvent('pull_request_review', payload);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].contribType, 2); // REVIEW
      assert.strictEqual(results[0].authorUsername, 'reviewer');
    });

    it('should parse closed issue events', () => {
      const payload = {
        action: 'closed',
        repository: { full_name: 'WGlynn/VibeSwap' },
        issue: {
          number: 99,
          closed_at: '2026-02-16T12:00:00Z',
          user: { login: 'reporter' },
          title: 'Bug in swap',
        },
      };

      const results = relayer._parseGitHubEvent('issues', payload);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].contribType, 3); // ISSUE_CLOSED
      assert.strictEqual(results[0].commitSha, 'issue-99');
    });

    it('should ignore unsupported events', () => {
      assert.strictEqual(relayer._parseGitHubEvent('star', {}).length, 0);
      assert.strictEqual(relayer._parseGitHubEvent('fork', {}).length, 0);
    });

    it('should handle empty commits array', () => {
      const results = relayer._parseGitHubEvent('push', {
        repository: { full_name: 'test/repo' },
        commits: [],
      });
      assert.strictEqual(results.length, 0);
    });
  });

  // ============ Contributor Resolution ============

  describe('contributor resolution', () => {
    it('should register and resolve contributors', () => {
      relayer.registerContributor('wglynn', '0x1234567890abcdef1234567890abcdef12345678');
      const addr = relayer._contributorCache.get('wglynn');
      assert.strictEqual(addr, '0x1234567890abcdef1234567890abcdef12345678');
    });

    it('should return null for unregistered contributors', async () => {
      const addr = await relayer._resolveContributor('unknown');
      assert.strictEqual(addr, null);
    });

    it('should return null for null/undefined username', async () => {
      assert.strictEqual(await relayer._resolveContributor(null), null);
      assert.strictEqual(await relayer._resolveContributor(undefined), null);
    });
  });

  // ============ Status ============

  describe('getStatus', () => {
    it('should return not initialized when not configured', async () => {
      const status = await relayer.getStatus();
      assert.strictEqual(status.initialized, false);
    });
  });
});

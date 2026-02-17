import { Router } from 'express';
import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';

/**
 * GitHub webhook routes for contribution tracking.
 *
 * POST /api/github/webhook  — receives GitHub webhook events
 * GET  /api/github/status   — relayer status (authorized, balance, pending)
 * POST /api/github/register — register GitHub username → address mapping
 * POST /api/github/flush    — force flush pending batch
 */
export function createGitHubRoutes(relayer) {
  const router = Router();

  // ============ Webhook Endpoint ============

  router.post('/webhook', async (req, res) => {
    try {
      // Verify GitHub webhook signature
      const signature = req.headers['x-hub-signature-256'];
      const rawBody = JSON.stringify(req.body);

      if (!relayer.verifyWebhookSignature(rawBody, signature)) {
        logger.warn('Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const eventType = req.headers['x-github-event'];
      if (!eventType) {
        return res.status(400).json({ error: 'Missing X-GitHub-Event header' });
      }

      // Process supported events
      const supported = ['push', 'pull_request', 'pull_request_review', 'issues'];
      if (!supported.includes(eventType)) {
        return res.status(200).json({ ignored: true, event: eventType });
      }

      const result = await relayer.processWebhookEvent(eventType, req.body);

      res.status(200).json({
        success: true,
        event: eventType,
        ...result,
      });
    } catch (err) {
      logger.error({ err }, 'Webhook processing failed');
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ============ Status Endpoint ============

  router.get('/status', async (_req, res) => {
    try {
      const status = await relayer.getStatus();
      res.json(status);
    } catch (err) {
      logger.error({ err }, 'Status check failed');
      res.status(500).json({ error: 'Failed to get status' });
    }
  });

  // ============ Register Contributor ============

  router.post('/register', (req, res) => {
    const { githubUsername, address } = req.body;

    if (!githubUsername || !address) {
      return res.status(400).json({ error: 'githubUsername and address required' });
    }

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    relayer.registerContributor(githubUsername, address);

    res.json({
      success: true,
      githubUsername,
      address,
    });
  });

  // ============ Force Flush ============

  router.post('/flush', async (_req, res) => {
    try {
      await relayer._flushBatch();
      res.json({ success: true, remaining: relayer.pendingBatch.length });
    } catch (err) {
      logger.error({ err }, 'Flush failed');
      res.status(500).json({ error: 'Flush failed' });
    }
  });

  return router;
}

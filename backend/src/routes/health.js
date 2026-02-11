import { Router } from 'express';
import { getSystemHealth } from '../services/healthCheck.js';

export function createHealthRoutes(priceFeed, wss) {
  const router = Router();

  // GET /api/health - Basic health check
  router.get('/', async (_req, res) => {
    const health = await getSystemHealth({ priceFeed, wss });
    const status = health.status === 'healthy' ? 200 : 503;
    res.status(status).json(health);
  });

  // GET /api/health/ready - Readiness probe (for k8s/Docker)
  router.get('/ready', async (_req, res) => {
    const health = await getSystemHealth({ priceFeed, wss });
    if (health.status === 'healthy') {
      res.status(200).json({ ready: true });
    } else {
      res.status(503).json({ ready: false, issues: health.issues });
    }
  });

  // GET /api/health/live - Liveness probe
  router.get('/live', (_req, res) => {
    res.status(200).json({ alive: true, timestamp: new Date().toISOString() });
  });

  return router;
}

// Keep default export for backwards compat if needed
export default createHealthRoutes();

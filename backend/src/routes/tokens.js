import { Router } from 'express';
import { TOKENS_BY_CHAIN } from '../utils/tokenRegistry.js';

const router = Router();

// GET /api/tokens - Get all supported tokens across chains
router.get('/', (_req, res) => {
  res.json({
    tokens: TOKENS_BY_CHAIN,
    totalChains: Object.keys(TOKENS_BY_CHAIN).length,
  });
});

// GET /api/tokens/:chainId - Get tokens for a specific chain
router.get('/:chainId', (req, res) => {
  const chainId = parseInt(req.params.chainId, 10);
  const tokens = TOKENS_BY_CHAIN[chainId];
  if (!tokens) {
    return res.status(404).json({
      error: 'Not Found',
      message: `No tokens registered for chain ID ${chainId}`,
    });
  }
  res.json({
    chainId,
    tokens,
    count: tokens.length,
  });
});

export default router;

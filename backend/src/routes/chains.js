import { Router } from 'express';
import { SUPPORTED_CHAINS } from '../utils/tokenRegistry.js';
import { validateChainId } from '../middleware/validate.js';

const router = Router();

// GET /api/chains - Get all supported chains
router.get('/', (_req, res) => {
  res.json({
    chains: SUPPORTED_CHAINS,
    count: SUPPORTED_CHAINS.length,
  });
});

// GET /api/chains/:chainId - Get specific chain info
router.get('/:chainId', validateChainId('chainId'), (req, res) => {
  const chainId = parseInt(req.params.chainId, 10);
  const chain = SUPPORTED_CHAINS.find(c => c.id === chainId);
  if (!chain) {
    return res.status(404).json({
      error: 'Not Found',
      message: `Chain ID ${chainId} not supported`,
    });
  }
  res.json(chain);
});

export default router;

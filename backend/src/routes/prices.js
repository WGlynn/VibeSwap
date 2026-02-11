import { Router } from 'express';
import { PriceFeedService } from '../services/priceFeed.js';
import { validateSymbol } from '../middleware/validate.js';

const router = Router();
const priceFeed = new PriceFeedService();

// GET /api/prices - Get all tracked token prices
router.get('/', async (_req, res, next) => {
  try {
    const result = await priceFeed.getAllPrices();
    res.json({
      prices: result.prices,
      lastFetchSuccess: result.lastFetchSuccess ? new Date(result.lastFetchSuccess).toISOString() : null,
      updatedAt: new Date().toISOString(),
      source: 'aggregated',
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/prices/:symbol - Get price for a specific token
router.get('/:symbol', validateSymbol('symbol'), async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const price = await priceFeed.getPrice(symbol.toUpperCase());
    if (!price) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Price for ${symbol} not available`,
      });
    }
    res.json({
      symbol: symbol.toUpperCase(),
      ...price,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/prices/pairs/:base/:quote - Get pair price
router.get('/pairs/:base/:quote', validateSymbol('base'), validateSymbol('quote'), async (req, res, next) => {
  try {
    const { base, quote } = req.params;
    const pairPrice = await priceFeed.getPairPrice(
      base.toUpperCase(),
      quote.toUpperCase()
    );
    if (!pairPrice) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Price for ${base}/${quote} not available`,
      });
    }
    res.json({
      pair: `${base.toUpperCase()}/${quote.toUpperCase()}`,
      ...pairPrice,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

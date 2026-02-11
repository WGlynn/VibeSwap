import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PriceFeedService } from '../src/services/priceFeed.js';

describe('PriceFeed Service', () => {
  it('should instantiate without errors', () => {
    const service = new PriceFeedService();
    assert.ok(service);
    assert.ok(service.cache instanceof Map);
  });

  it('should return prices (with fallback if no network)', async () => {
    const service = new PriceFeedService();
    const prices = await service.getAllPrices();
    assert.ok(typeof prices === 'object');
    // Should have at least fallback prices
    assert.ok(Object.keys(prices).length > 0);
  });

  it('should return null for unknown token', async () => {
    const service = new PriceFeedService();
    const price = await service.getPrice('UNKNOWN_TOKEN_XYZ');
    assert.strictEqual(price, null);
  });

  it('should calculate pair prices', async () => {
    const service = new PriceFeedService();
    // Force fallback prices
    service._setFallbackPrices();
    const pair = await service.getPairPrice('ETH', 'USDC');
    assert.ok(pair);
    assert.ok(typeof pair.rate === 'number');
    assert.ok(pair.rate > 0);
  });
});

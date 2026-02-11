// ============ Price Feed Service ============
// Aggregates prices from multiple sources with caching

const CACHE_TTL = parseInt(process.env.PRICE_CACHE_TTL || '30', 10) * 1000;

// CoinGecko IDs mapping
const COINGECKO_IDS = {
  ETH: 'ethereum',
  BTC: 'bitcoin',
  WBTC: 'bitcoin',
  WETH: 'ethereum',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  MATIC: 'matic-network',
  ARB: 'arbitrum',
  OP: 'optimism',
};

export class PriceFeedService {
  constructor() {
    this.cache = new Map();
    this.lastFetch = 0;
  }

  async fetchPrices() {
    const now = Date.now();
    if (now - this.lastFetch < CACHE_TTL && this.cache.size > 0) {
      return;
    }

    try {
      const ids = [...new Set(Object.values(COINGECKO_IDS))].join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();

      // Map CoinGecko data to our token symbols
      for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
        const priceData = data[geckoId];
        if (priceData) {
          this.cache.set(symbol, {
            price: priceData.usd,
            change24h: priceData.usd_24h_change,
            volume24h: priceData.usd_24h_vol,
            marketCap: priceData.usd_market_cap,
          });
        }
      }

      // Stablecoins default to $1 if not fetched
      for (const stable of ['USDC', 'USDT', 'DAI']) {
        if (!this.cache.has(stable)) {
          this.cache.set(stable, { price: 1.0, change24h: 0, volume24h: 0, marketCap: 0 });
        }
      }

      this.lastFetch = now;
    } catch (err) {
      console.error('[PriceFeed] Error fetching prices:', err.message);
      // Return cached data on error - stale data is better than no data
      if (this.cache.size === 0) {
        // Provide fallback prices if cache is empty
        this._setFallbackPrices();
      }
    }
  }

  _setFallbackPrices() {
    const fallbacks = {
      ETH: 3000, WETH: 3000, BTC: 60000, WBTC: 60000,
      USDC: 1, USDT: 1, DAI: 1, MATIC: 0.8, ARB: 1.2, OP: 2.5,
    };
    for (const [symbol, price] of Object.entries(fallbacks)) {
      this.cache.set(symbol, { price, change24h: 0, volume24h: 0, marketCap: 0 });
    }
    this.lastFetch = Date.now();
  }

  async getAllPrices() {
    await this.fetchPrices();
    const prices = {};
    for (const [symbol, data] of this.cache.entries()) {
      prices[symbol] = data;
    }
    return prices;
  }

  async getPrice(symbol) {
    await this.fetchPrices();
    return this.cache.get(symbol) || null;
  }

  async getPairPrice(base, quote) {
    await this.fetchPrices();
    const basePrice = this.cache.get(base);
    const quotePrice = this.cache.get(quote);
    if (!basePrice || !quotePrice) return null;
    return {
      rate: basePrice.price / quotePrice.price,
      basePrice: basePrice.price,
      quotePrice: quotePrice.price,
    };
  }
}

// Vercel Serverless: Price feed proxy
// Caches CoinGecko responses server-side, serves all clients (frontend + Jarvis bot)
// Eliminates CORS issues, manages rate limits, single source of truth

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

const COINGECKO_IDS = {
  ETH: 'ethereum',
  WBTC: 'wrapped-bitcoin',
  BTC: 'bitcoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  ARB: 'arbitrum',
  OP: 'optimism',
  SOL: 'solana',
  LINK: 'chainlink',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  BASE: 'base-protocol',
  CKB: 'nervos-network',
};

// Custom tokens not on CoinGecko (placeholder until TruePriceOracle)
const CUSTOM_TOKENS = {
  JUL: { price: 0.042, change24h: 0 },
  VIBE: { price: 0.85, change24h: 0 },
};

// In-memory cache (persists across warm invocations on Vercel)
let cachedPrices = null;
let lastFetch = 0;
const CACHE_TTL = 30_000; // 30s — CoinGecko free tier allows ~30 calls/min

async function fetchCoinGecko() {
  const ids = Object.values(COINGECKO_IDS).join(',');
  const url = `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`CoinGecko ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const prices = {};

    // Map CoinGecko IDs back to symbols
    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      if (data[geckoId]) {
        prices[symbol] = {
          price: data[geckoId].usd || 0,
          change24h: data[geckoId].usd_24h_change || 0,
        };
      }
    }

    // Inject custom tokens
    for (const [symbol, data] of Object.entries(CUSTOM_TOKENS)) {
      prices[symbol] = data;
    }

    // Ensure stablecoins have sane defaults
    for (const stable of ['USDC', 'USDT', 'DAI']) {
      if (!prices[stable] || prices[stable].price === 0) {
        prices[stable] = { price: 1, change24h: 0 };
      }
    }

    return prices;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export default async function handler(req, res) {
  // CORS — open for Jarvis bot + any frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Cache headers for CDN edge
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

  const now = Date.now();

  // Check query for specific symbol
  const symbol = req.query?.symbol?.toUpperCase();

  // Serve from cache if fresh
  if (cachedPrices && (now - lastFetch) < CACHE_TTL) {
    if (symbol) {
      const tokenData = cachedPrices[symbol];
      if (!tokenData) return res.status(404).json({ error: `Unknown symbol: ${symbol}` });
      return res.status(200).json({ symbol, ...tokenData, cached: true, timestamp: lastFetch });
    }
    return res.status(200).json({ prices: cachedPrices, cached: true, timestamp: lastFetch });
  }

  // Fetch fresh data
  try {
    const prices = await fetchCoinGecko();
    cachedPrices = prices;
    lastFetch = Date.now();

    if (symbol) {
      const tokenData = prices[symbol];
      if (!tokenData) return res.status(404).json({ error: `Unknown symbol: ${symbol}` });
      return res.status(200).json({ symbol, ...tokenData, cached: false, timestamp: lastFetch });
    }

    return res.status(200).json({ prices, cached: false, timestamp: lastFetch });
  } catch (err) {
    // Serve stale cache if available
    if (cachedPrices) {
      if (symbol) {
        const tokenData = cachedPrices[symbol];
        if (!tokenData) return res.status(404).json({ error: `Unknown symbol: ${symbol}` });
        return res.status(200).json({ symbol, ...tokenData, cached: true, stale: true, timestamp: lastFetch });
      }
      return res.status(200).json({ prices: cachedPrices, cached: true, stale: true, timestamp: lastFetch });
    }

    return res.status(502).json({ error: 'Price feed unavailable', detail: err.message });
  }
}

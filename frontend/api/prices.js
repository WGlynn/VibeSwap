// Vercel Serverless: Price feed proxy
// Three-source oracle: CoinGecko (primary) + Chainlink (validator) + TruePriceOracle (future sovereign)
// Caches responses server-side, serves all clients (frontend + Jarvis bot)
// Eliminates CORS issues, manages rate limits, single source of truth

import { ethers } from 'ethers';

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
  CKB: 'nervos-network',
};

// Custom tokens not on CoinGecko (placeholder until TruePriceOracle)
const CUSTOM_TOKENS = {
  JUL: { price: 0.042, change24h: 0 },
  VIBE: { price: 0.85, change24h: 0 },
};

// ============ Chainlink Price Feeds (Base Mainnet) ============
// AggregatorV3Interface — latestRoundData() returns (roundId, answer, startedAt, updatedAt, answeredInRound)
// answer is in 8 decimals for USD pairs

const CHAINLINK_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
];

// Base mainnet Chainlink feed addresses
// Source: https://docs.chain.link/data-feeds/price-feeds/addresses?network=base
const CHAINLINK_FEEDS = {
  ETH:  { address: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', decimals: 8 },
  BTC:  { address: '0xCCADC697c55bbB68dc5bCdf8d3CBe83CdD4E071E', decimals: 8 },
  LINK: { address: '0x17CAb8FE31cA45e4684a1C9469a4aDaE50B3b89f', decimals: 8 },
  USDC: { address: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B', decimals: 8 },
  DAI:  { address: '0x591e79239a7d679378eC8c847e5038150364C78F', decimals: 8 },
};

// Deviation threshold: flag if CoinGecko and Chainlink disagree by more than this
const DEVIATION_THRESHOLD_BPS = 100; // 1%

// Base mainnet RPC (public, rate-limited but fine for price reads)
const BASE_RPC = 'https://mainnet.base.org';

// ============ Caches ============

let cachedPrices = null;
let lastFetch = 0;
const CACHE_TTL = 30_000; // 30s

let cachedChainlink = null;
let lastChainlinkFetch = 0;
const CHAINLINK_CACHE_TTL = 60_000; // 60s — on-chain reads are slower, cache longer

// ============ CoinGecko Fetch ============

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

    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      if (data[geckoId]) {
        prices[symbol] = {
          price: data[geckoId].usd || 0,
          change24h: data[geckoId].usd_24h_change || 0,
          source: 'coingecko',
        };
      }
    }

    // Inject custom tokens
    for (const [symbol, tokenData] of Object.entries(CUSTOM_TOKENS)) {
      prices[symbol] = { ...tokenData, source: 'custom' };
    }

    // Stablecoin defaults
    for (const stable of ['USDC', 'USDT', 'DAI']) {
      if (!prices[stable] || prices[stable].price === 0) {
        prices[stable] = { price: 1, change24h: 0, source: 'default' };
      }
    }

    return prices;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ============ Chainlink Fetch ============

async function fetchChainlink() {
  const now = Date.now();
  if (cachedChainlink && (now - lastChainlinkFetch) < CHAINLINK_CACHE_TTL) {
    return cachedChainlink;
  }

  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const results = {};

  // Fetch all feeds in parallel
  const entries = Object.entries(CHAINLINK_FEEDS);
  const promises = entries.map(async ([symbol, feed]) => {
    try {
      const contract = new ethers.Contract(feed.address, CHAINLINK_ABI, provider);
      const [, answer, , updatedAt] = await contract.latestRoundData();
      const price = Number(answer) / (10 ** feed.decimals);
      const age = Math.floor(Date.now() / 1000) - Number(updatedAt);
      return { symbol, price, updatedAt: Number(updatedAt), age };
    } catch {
      return { symbol, price: null, error: true };
    }
  });

  const settled = await Promise.all(promises);

  for (const result of settled) {
    if (result.price !== null) {
      results[result.symbol] = {
        price: result.price,
        updatedAt: result.updatedAt,
        age: result.age,
        stale: result.age > 3600, // Flag if >1 hour old
      };
    }
  }

  cachedChainlink = results;
  lastChainlinkFetch = Date.now();
  return results;
}

// ============ Cross-Validate Prices ============

function crossValidate(geckoPrice, chainlinkData) {
  if (!chainlinkData || !geckoPrice) return null;

  const clPrice = chainlinkData.price;
  if (!clPrice || clPrice === 0) return null;

  const deviation = Math.abs(geckoPrice - clPrice) / clPrice;
  const deviationBps = Math.round(deviation * 10000);

  return {
    chainlinkPrice: clPrice,
    deviationBps,
    deviationPercent: (deviation * 100).toFixed(3),
    withinThreshold: deviationBps <= DEVIATION_THRESHOLD_BPS,
    chainlinkAge: chainlinkData.age,
    chainlinkStale: chainlinkData.stale,
  };
}

// ============ Handler ============

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
  const symbol = req.query?.symbol?.toUpperCase();
  const includeChainlink = req.query?.chainlink !== 'false'; // ?chainlink=false to skip

  // Serve from cache if fresh
  if (cachedPrices && (now - lastFetch) < CACHE_TTL) {
    return servePrices(res, cachedPrices, symbol, true, lastFetch, includeChainlink);
  }

  // Fetch fresh data
  try {
    const prices = await fetchCoinGecko();
    cachedPrices = prices;
    lastFetch = Date.now();

    return servePrices(res, prices, symbol, false, lastFetch, includeChainlink);
  } catch (err) {
    // Serve stale cache if available
    if (cachedPrices) {
      return servePrices(res, cachedPrices, symbol, true, lastFetch, includeChainlink, true);
    }

    return res.status(502).json({ error: 'Price feed unavailable', detail: err.message });
  }
}

async function servePrices(res, prices, symbol, cached, timestamp, includeChainlink, stale = false) {
  // Fetch Chainlink validation (non-blocking — don't let it slow down response)
  let chainlink = {};
  let validation = {};
  if (includeChainlink) {
    try {
      chainlink = await fetchChainlink();
      // Cross-validate each price that has a Chainlink feed
      for (const sym of Object.keys(CHAINLINK_FEEDS)) {
        if (prices[sym]) {
          const result = crossValidate(prices[sym].price, chainlink[sym]);
          if (result) {
            validation[sym] = result;
            // If Chainlink exists and CoinGecko price is way off, prefer Chainlink
            if (!result.withinThreshold && !result.chainlinkStale) {
              prices[sym].geckoPrice = prices[sym].price;
              prices[sym].price = result.chainlinkPrice;
              prices[sym].source = 'chainlink_override';
              prices[sym].deviationBps = result.deviationBps;
            }
          }
        }
      }
    } catch {
      // Chainlink fetch failed — not critical, CoinGecko prices still valid
    }
  }

  if (symbol) {
    const tokenData = prices[symbol];
    if (!tokenData) return res.status(404).json({ error: `Unknown symbol: ${symbol}` });
    const response = { symbol, ...tokenData, cached, timestamp };
    if (validation[symbol]) response.chainlink = validation[symbol];
    if (stale) response.stale = true;
    return res.status(200).json(response);
  }

  const response = { prices, cached, timestamp };
  if (Object.keys(validation).length > 0) response.chainlink = validation;
  if (stale) response.stale = true;
  return res.status(200).json(response);
}

// ============================================================
// Token Data — Canonical token metadata for consistent display
// Used by TokenBadge, SearchOverlay, SwapCore, PortfolioDashboard
// ============================================================

export const TOKENS = {
  ETH: { symbol: 'ETH', name: 'Ethereum', color: '#627eea', decimals: 18, chain: 'Ethereum' },
  WETH: { symbol: 'WETH', name: 'Wrapped Ether', color: '#627eea', decimals: 18, chain: 'Ethereum' },
  BTC: { symbol: 'BTC', name: 'Bitcoin', color: '#f7931a', decimals: 8, chain: 'Bitcoin' },
  WBTC: { symbol: 'WBTC', name: 'Wrapped Bitcoin', color: '#f7931a', decimals: 8, chain: 'Ethereum' },
  USDC: { symbol: 'USDC', name: 'USD Coin', color: '#2775ca', decimals: 6, chain: 'Ethereum' },
  USDT: { symbol: 'USDT', name: 'Tether', color: '#26a17b', decimals: 6, chain: 'Ethereum' },
  DAI: { symbol: 'DAI', name: 'Dai', color: '#f5ac37', decimals: 18, chain: 'Ethereum' },
  VIBE: { symbol: 'VIBE', name: 'VibeSwap', color: '#06b6d4', decimals: 18, chain: 'Base' },
  JUL: { symbol: 'JUL', name: 'Joule', color: '#8b5cf6', decimals: 18, chain: 'Base' },
  MATIC: { symbol: 'MATIC', name: 'Polygon', color: '#8247e5', decimals: 18, chain: 'Polygon' },
  ARB: { symbol: 'ARB', name: 'Arbitrum', color: '#28a0f0', decimals: 18, chain: 'Arbitrum' },
  OP: { symbol: 'OP', name: 'Optimism', color: '#ff0420', decimals: 18, chain: 'Optimism' },
  LINK: { symbol: 'LINK', name: 'Chainlink', color: '#2a5ada', decimals: 18, chain: 'Ethereum' },
  UNI: { symbol: 'UNI', name: 'Uniswap', color: '#ff007a', decimals: 18, chain: 'Ethereum' },
  AAVE: { symbol: 'AAVE', name: 'Aave', color: '#b6509e', decimals: 18, chain: 'Ethereum' },
  CRV: { symbol: 'CRV', name: 'Curve', color: '#a4a4a4', decimals: 18, chain: 'Ethereum' },
  MKR: { symbol: 'MKR', name: 'Maker', color: '#1aab9b', decimals: 18, chain: 'Ethereum' },
  SNX: { symbol: 'SNX', name: 'Synthetix', color: '#1e1a31', decimals: 18, chain: 'Ethereum' },
  COMP: { symbol: 'COMP', name: 'Compound', color: '#00d395', decimals: 18, chain: 'Ethereum' },
  LDO: { symbol: 'LDO', name: 'Lido DAO', color: '#00a3ff', decimals: 18, chain: 'Ethereum' },
  RPL: { symbol: 'RPL', name: 'Rocket Pool', color: '#ffb547', decimals: 18, chain: 'Ethereum' },
  GMX: { symbol: 'GMX', name: 'GMX', color: '#2d42fc', decimals: 18, chain: 'Arbitrum' },
  PENDLE: { symbol: 'PENDLE', name: 'Pendle', color: '#07d1aa', decimals: 18, chain: 'Ethereum' },
  CKB: { symbol: 'CKB', name: 'Nervos CKB', color: '#3cc68a', decimals: 8, chain: 'CKB' },
}

export const TOKEN_LIST = Object.values(TOKENS)

export function getToken(symbol) {
  return TOKENS[symbol?.toUpperCase()] || { symbol: symbol || '?', name: 'Unknown', color: '#666', decimals: 18, chain: 'Unknown' }
}

export function getTokenColor(symbol) {
  return getToken(symbol).color
}

export function getTokenAbbr(symbol) {
  const s = (symbol || '??').toUpperCase()
  return s.length <= 2 ? s : s.slice(0, 2)
}

// Fallback prices — used only when global cache and CoinGecko are both unavailable
const FALLBACK_PRICES = {
  ETH: 3520, WETH: 3520, BTC: 97500, WBTC: 97500,
  USDC: 1.0, USDT: 1.0, DAI: 1.0,
  VIBE: 0.85, JUL: 0.042,
  MATIC: 0.38, ARB: 1.12, OP: 2.85,
  LINK: 18.5, UNI: 12.3, AAVE: 285,
  CRV: 0.42, MKR: 1850, SNX: 3.2,
  COMP: 58, LDO: 2.1, RPL: 28,
  GMX: 42, PENDLE: 5.8, CKB: 0.012,
}

// Live price proxy — reads from global cache first, falls back to static
export const MOCK_PRICES = new Proxy(FALLBACK_PRICES, {
  get(target, prop) {
    const cache = window.__vibePriceCache
    if (cache && cache[prop] !== undefined) return cache[prop]
    return target[prop]
  }
})

export function getMockPrice(symbol) {
  const upper = symbol?.toUpperCase()
  // Global cache first (populated by usePriceFeed)
  const cache = window.__vibePriceCache
  if (cache?.[upper]) return cache[upper]
  return FALLBACK_PRICES[upper] || 0
}

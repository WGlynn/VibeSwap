// ============================================================
// Math Utilities — Formatting, calculations, constants
// Used across swap, pools, analytics, charts
// ============================================================

export const PHI = 1.618033988749895

// ============ Number Formatting ============

export function formatNumber(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '0'
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(decimals) + 'T'
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(decimals) + 'K'
  return n.toFixed(decimals)
}

export function formatUSD(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '$0.00'
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(decimals) + 'B'
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(decimals) + 'M'
  if (Math.abs(n) >= 1e3) return '$' + n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return '$' + n.toFixed(decimals)
}

export function formatPercent(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '0%'
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%'
}

export function formatTokenAmount(n, decimals = 4) {
  if (n === null || n === undefined || isNaN(n)) return '0'
  if (n === 0) return '0'
  if (Math.abs(n) < 0.0001) return '<0.0001'
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals })
}

// ============ Seeded PRNG ============

export function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Math Helpers ============

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function mapRange(value, inMin, inMax, outMin, outMax) {
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin
}

// Price impact for constant product AMM: x * y = k
export function priceImpact(amountIn, reserveIn, reserveOut) {
  if (reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0) return 0
  const amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
  const spotPrice = reserveOut / reserveIn
  const executionPrice = amountOut / amountIn
  return ((spotPrice - executionPrice) / spotPrice) * 100
}

// Impermanent loss calculation
export function impermanentLoss(priceRatio) {
  if (priceRatio <= 0) return 0
  return (2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1
}

// APR to APY conversion
export function aprToApy(apr, compoundingPeriods = 365) {
  return Math.pow(1 + apr / compoundingPeriods, compoundingPeriods) - 1
}

// Sharpe ratio
export function sharpeRatio(returns, riskFreeRate = 0.04) {
  if (!returns || returns.length < 2) return 0
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / (returns.length - 1)
  const stdDev = Math.sqrt(variance)
  if (stdDev === 0) return 0
  return (avg - riskFreeRate / 365) / stdDev
}

// ============================================================
// Global Formatters — Consistent number/date/address formatting
// Used across all pages for uniform display
// ============================================================

// Format USD amounts
export function formatUSD(value, compact = false) {
  if (value === null || value === undefined) return '$0.00'
  if (compact && Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`
  }
  if (compact && Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`
  }
  if (compact && Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`
  }
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Format token amounts (adaptive precision)
export function formatToken(amount, decimals) {
  if (amount === null || amount === undefined) return '0'
  const d = decimals ?? (amount >= 1000 ? 0 : amount >= 1 ? 2 : amount >= 0.01 ? 4 : 6)
  return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d })
}

// Format percentages
export function formatPercent(value, decimals = 2) {
  if (value === null || value === undefined) return '0%'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(decimals)}%`
}

// Shorten Ethereum address
export function shortenAddress(address, chars = 4) {
  if (!address) return ''
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

// Time ago formatter
export function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(date).toLocaleDateString()
}

// Format hash (tx hash, block hash)
export function formatHash(hash, chars = 6) {
  if (!hash) return ''
  return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`
}

// Format large numbers with commas
export function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined) return '0'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// Seeded PRNG for deterministic mock data
export function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

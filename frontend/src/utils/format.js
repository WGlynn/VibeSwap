import { ethers } from 'ethers'

/**
 * Format a number with commas and decimal places
 */
export function formatNumber(value, decimals = 2) {
  if (!value) return '0'

  const num = typeof value === 'string' ? parseFloat(value) : value

  if (isNaN(num)) return '0'

  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(decimals) + 'B'
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(decimals) + 'M'
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(decimals) + 'K'
  }

  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format a currency value
 */
export function formatCurrency(value, currency = 'USD') {
  if (!value) return '$0'

  const num = typeof value === 'string' ? parseFloat(value) : value

  if (isNaN(num)) return '$0'

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num)
}

/**
 * Format token amount from wei
 */
export function formatTokenAmount(amount, decimals = 18, displayDecimals = 4) {
  if (!amount) return '0'

  try {
    const formatted = ethers.formatUnits(amount.toString(), decimals)
    const num = parseFloat(formatted)

    if (num === 0) return '0'
    if (num < 0.0001) return '<0.0001'

    return num.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: displayDecimals,
    })
  } catch {
    return '0'
  }
}

/**
 * Parse token amount to wei
 */
export function parseTokenAmount(amount, decimals = 18) {
  if (!amount || amount === '') return BigInt(0)

  try {
    return ethers.parseUnits(amount.toString(), decimals)
  } catch {
    return BigInt(0)
  }
}

/**
 * Shorten an address
 */
export function shortenAddress(address, chars = 4) {
  if (!address) return ''
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

/**
 * Format a percentage
 */
export function formatPercent(value, decimals = 2) {
  if (!value) return '0%'

  const num = typeof value === 'string' ? parseFloat(value) : value

  if (isNaN(num)) return '0%'

  return num.toFixed(decimals) + '%'
}

/**
 * Format time remaining
 */
export function formatTimeRemaining(seconds) {
  if (seconds <= 0) return '0s'

  if (seconds < 60) {
    return `${Math.floor(seconds)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  return `${hours}h ${remainingMinutes}m`
}

/**
 * Format a transaction hash
 */
export function formatTxHash(hash, chars = 6) {
  if (!hash) return ''
  return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`
}

/**
 * Calculate price impact
 */
export function calculatePriceImpact(amountIn, amountOut, spotPrice) {
  if (!amountIn || !amountOut || !spotPrice) return 0

  const expectedOut = amountIn * spotPrice
  const impact = ((expectedOut - amountOut) / expectedOut) * 100

  return Math.abs(impact)
}

/**
 * Calculate minimum amount out with slippage
 */
export function calculateMinAmountOut(amountOut, slippagePercent) {
  if (!amountOut) return BigInt(0)

  const slippageBps = Math.floor(parseFloat(slippagePercent) * 100)
  const slippageFactor = 10000 - slippageBps

  return (BigInt(amountOut) * BigInt(slippageFactor)) / BigInt(10000)
}

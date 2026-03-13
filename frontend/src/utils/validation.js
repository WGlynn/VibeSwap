// ============================================================
// validation.js — Input validation utilities
// Used for forms, token amounts, addresses, parameters
// ============================================================

/**
 * Validate an Ethereum address (basic format check)
 */
export function isValidAddress(address) {
  if (!address) return false
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * Validate a transaction hash
 */
export function isValidTxHash(hash) {
  if (!hash) return false
  return /^0x[a-fA-F0-9]{64}$/.test(hash)
}

/**
 * Validate a positive number string (for token amounts)
 */
export function isValidAmount(value) {
  if (!value || value === '') return false
  const num = Number(value)
  return !isNaN(num) && num > 0 && isFinite(num)
}

/**
 * Validate slippage tolerance (0.01% to 50%)
 */
export function isValidSlippage(value) {
  const num = Number(value)
  return !isNaN(num) && num >= 0.01 && num <= 50
}

/**
 * Validate deadline in minutes (1 to 4320 = 3 days)
 */
export function isValidDeadline(minutes) {
  const num = Number(minutes)
  return Number.isInteger(num) && num >= 1 && num <= 4320
}

/**
 * Sanitize numeric input — only allow digits, one decimal point
 */
export function sanitizeNumericInput(value) {
  // Remove everything except digits and decimal point
  let cleaned = value.replace(/[^0-9.]/g, '')
  // Only allow one decimal point
  const parts = cleaned.split('.')
  if (parts.length > 2) {
    cleaned = parts[0] + '.' + parts.slice(1).join('')
  }
  // Prevent leading zeros (except 0.xxx)
  if (cleaned.length > 1 && cleaned[0] === '0' && cleaned[1] !== '.') {
    cleaned = cleaned.slice(1)
  }
  return cleaned
}

/**
 * Check if value exceeds balance
 */
export function exceedsBalance(amount, balance) {
  const a = Number(amount)
  const b = Number(balance)
  if (isNaN(a) || isNaN(b)) return false
  return a > b
}

/**
 * Validate token symbol (1-8 uppercase letters)
 */
export function isValidTokenSymbol(symbol) {
  if (!symbol) return false
  return /^[A-Z]{1,8}$/.test(symbol)
}

/**
 * Validate URL format
 */
export function isValidUrl(url) {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

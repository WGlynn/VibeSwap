// ============================================================
// Validators — Input validation for forms and user input
// Used across swap, bridge, send, settings pages
// ============================================================

export function isValidAddress(address) {
  if (!address) return false
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

export function isValidEmail(email) {
  if (!email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function isValidAmount(value, min = 0, max = Infinity) {
  const num = parseFloat(value)
  if (isNaN(num)) return false
  return num > min && num <= max
}

export function isValidSlippage(value) {
  const num = parseFloat(value)
  if (isNaN(num)) return false
  return num > 0 && num <= 50
}

export function sanitizeNumberInput(value) {
  return value.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1')
}

export function truncateAddress(address, start = 6, end = 4) {
  if (!address || address.length < start + end) return address || ''
  return `${address.slice(0, start)}...${address.slice(-end)}`
}

export function isValidUrl(url) {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

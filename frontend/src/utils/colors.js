// ============================================================
// colors — Color manipulation and palette utilities
// Used for dynamic theming, charts, data visualization
// ============================================================

export const CYAN = '#06b6d4'

export const PALETTE = {
  cyan: '#06b6d4',
  purple: '#8b5cf6',
  amber: '#f59e0b',
  pink: '#ec4899',
  green: '#22c55e',
  orange: '#f97316',
  blue: '#3b82f6',
  red: '#ef4444',
  indigo: '#6366f1',
  teal: '#14b8a6',
}

export const CHART_COLORS = [
  '#06b6d4', '#8b5cf6', '#f59e0b', '#ec4899', '#22c55e',
  '#f97316', '#3b82f6', '#ef4444', '#6366f1', '#14b8a6',
]

/**
 * Add alpha channel to hex color
 * @param {string} hex - hex color (#rrggbb)
 * @param {number} alpha - opacity (0-1)
 * @returns {string} rgba string
 */
export function withAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * Get color from a 0-1 gradient (red → yellow → green)
 * @param {number} value - 0 to 1
 * @returns {string} hex color
 */
export function getHeatColor(value) {
  const v = Math.max(0, Math.min(1, value))
  if (v < 0.5) {
    // Red to yellow
    const t = v * 2
    const r = 239
    const g = Math.round(68 + t * (158 - 68))
    const b = 68
    return `rgb(${r},${g},${b})`
  }
  // Yellow to green
  const t = (v - 0.5) * 2
  const r = Math.round(245 - t * (245 - 34))
  const g = Math.round(158 + t * (197 - 158))
  const b = Math.round(11 + t * (94 - 11))
  return `rgb(${r},${g},${b})`
}

/**
 * Get a deterministic color for a string (like a token symbol)
 * @param {string} str
 * @returns {string} hex color from CHART_COLORS
 */
export function colorForString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length]
}

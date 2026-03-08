// ============ Sankofa — "Look back to go forward" ============
// Akan wisdom: learn from the past to navigate the future.
// Tracks errors and successes to adapt the app's behavior.
// Named after the Sankofa bird that flies forward while looking back.

const SANKOFA_KEY = 'vibeswap-sankofa'
const MAX_ENTRIES = 50

function load() {
  try {
    return JSON.parse(localStorage.getItem(SANKOFA_KEY) || '[]')
  } catch { return [] }
}

function save(entries) {
  localStorage.setItem(SANKOFA_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
}

// Record an event — good or bad — so the system can learn
export function remember(type, context) {
  const entries = load()
  entries.push({
    type,       // 'error' | 'success' | 'slow' | 'retry'
    context,    // { page, action, detail, duration }
    ts: Date.now(),
  })
  save(entries)
}

// Look back — what patterns emerge?
export function lookBack() {
  const entries = load()
  const now = Date.now()
  const recent = entries.filter(e => now - e.ts < 24 * 60 * 60 * 1000) // last 24h

  const errors = recent.filter(e => e.type === 'error')
  const successes = recent.filter(e => e.type === 'success')
  const slow = recent.filter(e => e.type === 'slow')

  // Which pages have the most errors?
  const errorPages = {}
  errors.forEach(e => {
    const page = e.context?.page || 'unknown'
    errorPages[page] = (errorPages[page] || 0) + 1
  })

  // Which actions succeed most?
  const successActions = {}
  successes.forEach(e => {
    const action = e.context?.action || 'unknown'
    successActions[action] = (successActions[action] || 0) + 1
  })

  return {
    total: recent.length,
    errors: errors.length,
    successes: successes.length,
    slow: slow.length,
    errorPages,
    successActions,
    healthScore: recent.length > 0
      ? Math.round((successes.length / recent.length) * 100)
      : 100,
  }
}

// Forget old pain — clear entries older than 7 days
export function release() {
  const entries = load()
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  save(entries.filter(e => e.ts > cutoff))
}

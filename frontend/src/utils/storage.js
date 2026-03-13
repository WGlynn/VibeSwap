// ============================================================
// storage — LocalStorage helpers with JSON serialization
// Used for persisting user preferences, watchlists, settings
// ============================================================

const PREFIX = 'vibeswap:'

export function getItem(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw !== null ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function setItem(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable — fail silently
  }
}

export function removeItem(key) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // Ignore
  }
}

export function clear() {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    // Ignore
  }
}

export function getKeys() {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length))
  } catch {
    return []
  }
}

export function getSize() {
  try {
    let total = 0
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
    keys.forEach((k) => {
      total += k.length + (localStorage.getItem(k)?.length || 0)
    })
    return total
  } catch {
    return 0
  }
}

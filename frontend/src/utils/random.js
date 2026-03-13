// ============================================================
// random — Seeded PRNG and random data generation utilities
// Used for deterministic mock data across pages
// ============================================================

/**
 * Create a seeded PRNG (Lehmer/Park-Miller)
 * @param {number} seed
 * @returns {function} random() returns 0-1
 */
export function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

/**
 * Random integer between min and max (inclusive)
 */
export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min
}

/**
 * Random float between min and max
 */
export function randFloat(rng, min, max) {
  return rng() * (max - min) + min
}

/**
 * Pick random item from array
 */
export function randPick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

/**
 * Shuffle array using Fisher-Yates with seeded RNG
 */
export function shuffle(rng, arr) {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * Generate a mock Ethereum address
 */
export function randAddress(rng) {
  let addr = '0x'
  for (let i = 0; i < 40; i++) {
    addr += Math.floor(rng() * 16).toString(16)
  }
  return addr
}

/**
 * Generate a mock transaction hash
 */
export function randTxHash(rng) {
  let hash = '0x'
  for (let i = 0; i < 64; i++) {
    hash += Math.floor(rng() * 16).toString(16)
  }
  return hash
}

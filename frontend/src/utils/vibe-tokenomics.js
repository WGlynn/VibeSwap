// ============ VIBE Token Economics ============
//
// 21,000,000 VIBE — fixed supply, never changes.
// 4-year halvings like Bitcoin, with a twist:
//
// THE TWIST: Emissions accumulate in a POOL (the "Resonance Pool")
// like a lottery pot. VIBE doesn't drip — it BUILDS UP until someone
// makes a protocol-defining contribution, then the pool breaks and
// distributes to all contributors via Shapley values.
//
// This means:
// - Small contributions earn nothing immediately (they accumulate weight)
// - When someone drops a banger (protocol-defining), EVERYONE who
//   contributed to that epoch gets paid proportionally
// - The longer between pool breaks, the bigger the payout
// - Halvings reduce the RATE of accumulation, not the pool size
//
// Bitcoin: time → blocks → reward
// VIBE:    time → pool accumulates → protocol-defining moment → distribute
//
// A "protocol-defining contribution" is one that fundamentally changes
// VibeSwap's trajectory. Examples:
// - Matt's insight: "target the unbanked" → redesigned entire homepage
// - Bill's recovery system inspiration → 5-layer wallet recovery
// - Batch auction mechanism design → core protocol
//
// These are recognized by governance vote or Jarvis attribution graph.
// When recognized, the Resonance Pool breaks.
//
// "It's math, not a contract." — That's the whole thesis.
// Contracts live on one chain. Math lives everywhere. VIBE is math.
//
// Chain agnostic by construction. Deploy on any chain, bridge via
// LayerZero, verify anywhere. The emission schedule is deterministic —
// any node on any chain can independently compute the correct state.
// ============

// ============ Constants ============
export const TOTAL_SUPPLY = 21_000_000
export const HALVING_INTERVAL_DAYS = 365.25 * 4 // 4 years in days
export const INITIAL_DAILY_EMISSION = 14.38356164 // ~21M / (4 * 365.25 * sum_of_halving_series)
// Sum of geometric series: 1 + 0.5 + 0.25 + ... ≈ 2, so ~21M / (2 * 4 * 365.25) ≈ 7.19
// But we want 50% emitted in first 4 years = 10.5M / (4*365.25) ≈ 7191.78/day...
// Let's be precise:

// First era: 50% = 10,500,000 over 1461 days = 7,187.54 VIBE/day
// Second era: 25% = 5,250,000 over 1461 days = 3,593.77 VIBE/day
// Third era: 12.5%, etc.
export const ERAS = []
let remaining = TOTAL_SUPPLY
for (let era = 0; era < 32; era++) {
  const eraSupply = remaining / 2
  const dailyRate = eraSupply / HALVING_INTERVAL_DAYS
  ERAS.push({
    era,
    supply: eraSupply,
    dailyRate,
    startDay: era * HALVING_INTERVAL_DAYS,
    endDay: (era + 1) * HALVING_INTERVAL_DAYS,
  })
  remaining -= eraSupply
  if (dailyRate < 0.001) break // Negligible
}

// ============ Genesis Timestamp ============
// Protocol genesis: when the first contribution was recorded
export const GENESIS_TIMESTAMP = new Date('2025-01-15T00:00:00Z').getTime()

// ============ Resonance Pool State ============
// The pool accumulates VIBE from daily emissions.
// It breaks when a protocol-defining contribution is recognized.

export function createResonancePool() {
  return {
    accumulated: 0,          // VIBE sitting in pool
    totalDistributed: 0,     // VIBE distributed all-time
    totalMined: 0,           // VIBE emitted all-time (accumulated + distributed)
    breaks: [],              // History of pool breaks
    lastBreakTimestamp: GENESIS_TIMESTAMP,
    currentEra: 0,
  }
}

/**
 * Calculate how much VIBE has accumulated in the pool since last break.
 */
export function calculatePoolAccumulation(pool, nowTimestamp = Date.now()) {
  const daysSinceGenesis = (nowTimestamp - GENESIS_TIMESTAMP) / (86400 * 1000)
  const daysSinceLastBreak = (nowTimestamp - pool.lastBreakTimestamp) / (86400 * 1000)

  // Determine current era
  const currentEra = Math.min(
    Math.floor(daysSinceGenesis / HALVING_INTERVAL_DAYS),
    ERAS.length - 1
  )
  const era = ERAS[currentEra]
  if (!era) return { ...pool, currentEra }

  // Simple calculation: daily rate * days since last break
  // (In reality, would need to handle era transitions mid-accumulation)
  const accumulated = era.dailyRate * daysSinceLastBreak

  return {
    ...pool,
    accumulated: pool.accumulated + accumulated,
    totalMined: pool.totalDistributed + pool.accumulated + accumulated,
    currentEra,
    dailyRate: era.dailyRate,
    daysSinceLastBreak,
    nextHalvingDays: era.endDay - daysSinceGenesis,
    percentMined: ((pool.totalDistributed + pool.accumulated + accumulated) / TOTAL_SUPPLY) * 100,
  }
}

/**
 * Break the pool — distribute accumulated VIBE to contributors.
 *
 * @param {Object} pool - Current pool state
 * @param {string} triggerContributionId - The protocol-defining contribution
 * @param {Array} contributors - [{author, shapleyWeight}] — weights must sum to 1
 * @returns {Object} New pool state + distribution details
 */
export function breakPool(pool, triggerContributionId, contributors) {
  const now = Date.now()
  const updated = calculatePoolAccumulation(pool, now)
  const amountToDistribute = updated.accumulated

  const distribution = contributors.map(c => ({
    author: c.author,
    amount: amountToDistribute * c.shapleyWeight,
    shapleyWeight: c.shapleyWeight,
  }))

  const breakEvent = {
    id: `break-${now}`,
    timestamp: now,
    triggerContributionId,
    amount: amountToDistribute,
    distribution,
    era: updated.currentEra,
  }

  return {
    pool: {
      accumulated: 0,
      totalDistributed: updated.totalDistributed + amountToDistribute,
      totalMined: updated.totalMined,
      breaks: [...updated.breaks, breakEvent],
      lastBreakTimestamp: now,
      currentEra: updated.currentEra,
    },
    breakEvent,
  }
}

/**
 * Get human-readable pool status for the UI.
 */
export function getPoolStatus(pool) {
  const updated = calculatePoolAccumulation(pool)
  const era = ERAS[updated.currentEra]

  return {
    // Pool state
    poolBalance: updated.accumulated,
    poolBalanceFormatted: formatVIBE(updated.accumulated),

    // Emission info
    currentEra: updated.currentEra + 1, // Human-readable (era 1, not 0)
    dailyRate: era?.dailyRate || 0,
    dailyRateFormatted: formatVIBE(era?.dailyRate || 0),

    // Supply info
    totalSupply: TOTAL_SUPPLY,
    totalMined: updated.totalMined,
    totalMinedFormatted: formatVIBE(updated.totalMined),
    percentMined: updated.percentMined,
    remaining: TOTAL_SUPPLY - updated.totalMined,

    // Halving
    nextHalvingDays: Math.max(0, Math.floor(updated.nextHalvingDays || 0)),
    halvingsCompleted: updated.currentEra,

    // History
    totalBreaks: updated.breaks.length,
    totalDistributed: updated.totalDistributed,
    totalDistributedFormatted: formatVIBE(updated.totalDistributed),
    daysSinceLastBreak: Math.floor(updated.daysSinceLastBreak || 0),
  }
}

function formatVIBE(amount) {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`
  if (amount >= 1) return amount.toFixed(2)
  if (amount >= 0.01) return amount.toFixed(4)
  return '0'
}

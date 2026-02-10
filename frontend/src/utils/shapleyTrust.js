/**
 * Shapley-Based Trust & Reward System
 *
 * Based on: "A Cooperative Reward System for Decentralized Networks"
 * By William Thomas Glynn
 *
 * Core insight: Each value-creating event is an independent cooperative game.
 * The coalition = the trust chain that enabled the value.
 * Rewards distributed via Shapley values to all enablers.
 *
 * Properties:
 * - Efficiency: All realized value is distributed
 * - Symmetry: Equal contributors rewarded equally
 * - Null player: No contribution = no reward
 * - No inflation: Rewards cannot exceed realized value
 *
 * @version 1.0.0
 */

// ============================================================
// CONFIGURATION
// ============================================================

export const SHAPLEY_CONFIG = {
  // Decay factor per hop (voucher closer to actor gets more credit)
  CHAIN_DECAY: 0.6,           // Each hop back gets 60% of previous

  // Minimum contribution to distribute (prevents dust)
  MIN_VALUE_THRESHOLD: 1,

  // Actor (value creator) base share
  ACTOR_BASE_SHARE: 0.5,      // Actor keeps at least 50%

  // Maximum chain depth for rewards
  MAX_REWARD_DEPTH: 5,

  // Quality weight bounds
  MIN_QUALITY_WEIGHT: 0.1,
  MAX_QUALITY_WEIGHT: 2.0,

  // Epoch settings (quality weights update in epochs)
  EPOCH_DURATION_MS: 7 * 24 * 60 * 60 * 1000,  // 1 week
}

// ============================================================
// EVENT-BASED SHAPLEY DISTRIBUTION
// ============================================================

/**
 * Calculate Shapley distribution for a value-creating event
 *
 * Two value components:
 * 1. Local value: tied directly to the event
 * 2. Global multiplier: reflects network-wide growth/quality
 *
 * CRITICAL: Global multiplier applies to ENTIRE coalition equally.
 * This preserves symmetry and prevents gaming.
 *
 * @param {number} value - Total local value created by the event
 * @param {string[]} trustChain - Array from founder to actor: ['Founder', 'A', 'B', 'Actor']
 * @param {Object} qualityWeights - Quality weights per user (modify marginal contribution)
 * @param {number} globalMultiplier - Network-wide multiplier (applies to all equally)
 * @returns {Object} - Distribution: { 'Actor': 55, 'B': 25, 'A': 15, 'Founder': 5 }
 */
export function calculateShapleyDistribution(value, trustChain, qualityWeights = {}, globalMultiplier = 1.0) {
  if (value < SHAPLEY_CONFIG.MIN_VALUE_THRESHOLD || trustChain.length === 0) {
    return { distribution: {}, totalDistributed: 0 }
  }

  // The actor (last in chain) is the value creator
  const actor = trustChain[trustChain.length - 1]

  // If chain is just the actor (founder creating value), they get everything
  if (trustChain.length === 1) {
    return {
      distribution: { [actor]: value },
      totalDistributed: value,
    }
  }

  // Calculate raw Shapley shares based on position
  // Actor gets base share, rest decays along chain
  const distribution = {}
  const enablers = trustChain.slice(0, -1).reverse() // Closest voucher first

  // Actor's share
  let actorShare = SHAPLEY_CONFIG.ACTOR_BASE_SHARE
  distribution[actor] = actorShare

  // Distribute remaining among enablers with decay
  let remaining = 1 - actorShare
  let decayFactor = 1

  enablers.forEach((enabler, index) => {
    if (index >= SHAPLEY_CONFIG.MAX_REWARD_DEPTH) return

    decayFactor *= SHAPLEY_CONFIG.CHAIN_DECAY
    const share = remaining * decayFactor * (1 - SHAPLEY_CONFIG.CHAIN_DECAY)

    distribution[enabler] = (distribution[enabler] || 0) + share
  })

  // Apply quality weights
  let totalWeightedShares = 0
  const weightedDistribution = {}

  Object.entries(distribution).forEach(([user, share]) => {
    const weight = Math.min(
      SHAPLEY_CONFIG.MAX_QUALITY_WEIGHT,
      Math.max(SHAPLEY_CONFIG.MIN_QUALITY_WEIGHT, qualityWeights[user] || 1.0)
    )
    weightedDistribution[user] = share * weight
    totalWeightedShares += weightedDistribution[user]
  })

  // Normalize to ensure efficiency (all value distributed, no more)
  // Then apply global multiplier to ENTIRE coalition equally
  const effectiveValue = value * globalMultiplier

  const finalDistribution = {}
  Object.entries(weightedDistribution).forEach(([user, weightedShare]) => {
    finalDistribution[user] = Math.round((weightedShare / totalWeightedShares) * effectiveValue * 100) / 100
  })

  return {
    distribution: finalDistribution,
    totalDistributed: Object.values(finalDistribution).reduce((a, b) => a + b, 0),
    localValue: value,
    globalMultiplier,
    effectiveValue,
    trustChain,
    actor,
    enablers,
  }
}

// ============================================================
// CUMULATIVE REWARDS TRACKING
// ============================================================

/**
 * Track cumulative rewards for all users from value events
 */
export function createRewardLedger() {
  return {
    events: [],           // All value events
    balances: {},         // Current reward balances per user
    totalDistributed: 0,
    lastUpdated: Date.now(),
  }
}

/**
 * Record a value event and distribute rewards
 */
export function recordValueEvent(ledger, event) {
  const {
    eventId,
    eventType,      // 'contribution', 'upvote', 'implementation', etc.
    actor,          // Who created the value
    value,          // Amount of value created
    trustChain,     // Chain that enabled actor
    qualityWeights, // Optional quality weights
    globalMultiplier = 1.0,  // Network-wide multiplier (applies to all)
    timestamp = Date.now(),
  } = event

  // NO VALUE = NO REWARDS (prevents inflation)
  if (value <= 0) {
    return ledger
  }

  const distribution = calculateShapleyDistribution(value, trustChain, qualityWeights, globalMultiplier)

  // Update balances
  const newLedger = { ...ledger }
  Object.entries(distribution.distribution).forEach(([user, amount]) => {
    newLedger.balances[user] = (newLedger.balances[user] || 0) + amount
  })

  // Record event
  newLedger.events.push({
    id: eventId || `event-${timestamp}`,
    type: eventType,
    actor,
    value,
    distribution: distribution.distribution,
    timestamp,
  })

  newLedger.totalDistributed += distribution.totalDistributed
  newLedger.lastUpdated = timestamp

  return newLedger
}

// ============================================================
// QUALITY WEIGHT CALCULATION
// ============================================================

/**
 * Calculate quality weight for a user based on their history
 * Higher quality = more weight in Shapley distributions
 */
export function calculateQualityWeight(userStats) {
  const {
    contributionCount = 0,
    implementedCount = 0,
    totalUpvotes = 0,
    referralQuality = 1.0,    // From trust chain
    diversityScore = 1.0,     // From trust chain
    accountAgeDays = 0,
  } = userStats

  // Activity component (0 to 0.5)
  const activityScore = Math.min(0.5, (contributionCount * 0.05) + (implementedCount * 0.1))

  // Reputation component (0 to 0.3)
  const reputationScore = Math.min(0.3, totalUpvotes * 0.01)

  // Trust chain component (0 to 0.2)
  const trustScore = (referralQuality + diversityScore) / 2 * 0.2

  // Base weight = 1.0, adjusted by components
  const weight = 1.0 + activityScore + reputationScore + trustScore

  return Math.min(SHAPLEY_CONFIG.MAX_QUALITY_WEIGHT, Math.max(SHAPLEY_CONFIG.MIN_QUALITY_WEIGHT, weight))
}

// ============================================================
// PAIRWISE COMPARISON (ELO-STYLE)
// ============================================================

/**
 * ELO-style rating for users based on pairwise contribution comparisons
 * When two users' contributions are compared, winner gains rating, loser loses
 */
export function calculateEloRating(currentRating, opponentRating, won, kFactor = 32) {
  const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - currentRating) / 400))
  const actualScore = won ? 1 : 0
  return Math.round(currentRating + kFactor * (actualScore - expectedScore))
}

/**
 * Create ELO rating system for users
 */
export function createEloSystem() {
  return {
    ratings: {},        // { username: rating }
    matches: [],        // History of comparisons
    defaultRating: 1000,
  }
}

/**
 * Record a pairwise comparison result
 */
export function recordComparison(eloSystem, winner, loser) {
  const winnerRating = eloSystem.ratings[winner] || eloSystem.defaultRating
  const loserRating = eloSystem.ratings[loser] || eloSystem.defaultRating

  const newWinnerRating = calculateEloRating(winnerRating, loserRating, true)
  const newLoserRating = calculateEloRating(loserRating, winnerRating, false)

  return {
    ...eloSystem,
    ratings: {
      ...eloSystem.ratings,
      [winner]: newWinnerRating,
      [loser]: newLoserRating,
    },
    matches: [
      ...eloSystem.matches,
      { winner, loser, timestamp: Date.now(), winnerDelta: newWinnerRating - winnerRating },
    ],
  }
}

// ============================================================
// REFERRAL CHAIN REWARDS
// ============================================================

/**
 * When a new user joins via referral, record the enabling chain
 * No direct reward yet - rewards come when they CREATE VALUE
 */
export function recordReferral(trustGraph, referrer, newUser) {
  // The referrer's trust chain + newUser = newUser's chain
  const referrerChain = trustGraph.trustScores[referrer]?.trustChain || [referrer]

  return {
    newUser,
    referrer,
    trustChain: [...referrerChain, newUser],
    timestamp: Date.now(),
  }
}

/**
 * Calculate counterfactual value of a referral chain member
 * "If this person hadn't vouched, how much value would be lost?"
 */
export function calculateCounterfactualValue(ledger, username) {
  // Sum all rewards that flowed through events where this user was in the chain
  let enabledValue = 0
  let directValue = 0

  ledger.events.forEach(event => {
    if (event.actor === username) {
      directValue += event.value
    } else if (event.distribution[username]) {
      enabledValue += event.value
    }
  })

  return {
    username,
    directValue,      // Value they created directly
    enabledValue,     // Value created by people they enabled
    totalImpact: directValue + enabledValue,
    counterfactual: enabledValue,  // Network would lose this without them
  }
}

// ============================================================
// INTEGRATION WITH TRUST CHAIN
// ============================================================

/**
 * Get quality weight for Shapley distribution based on trust metrics
 */
export function getTrustBasedQualityWeight(trustScore, referralQuality, diversityScore) {
  // Trust score (0-1) * referral quality (0-1) * diversity (0-1)
  // Normalized to weight range
  const combined = (trustScore + referralQuality + diversityScore) / 3
  return SHAPLEY_CONFIG.MIN_QUALITY_WEIGHT +
    (combined * (SHAPLEY_CONFIG.MAX_QUALITY_WEIGHT - SHAPLEY_CONFIG.MIN_QUALITY_WEIGHT))
}

// ============================================================
// GLOBAL MULTIPLIER CALCULATION
// ============================================================

/**
 * Calculate global multiplier based on network health
 * Applies to ENTIRE coalition, preserving symmetry
 *
 * Factors:
 * - Network growth rate
 * - Average trust score
 * - Value creation velocity
 */
export function calculateGlobalMultiplier(networkStats) {
  const {
    userCount = 1,
    activeUsers = 1,
    avgTrustScore = 0.5,
    valueCreatedLastEpoch = 0,
    valueCreatedPrevEpoch = 1,
  } = networkStats

  // Activity ratio (0-1)
  const activityRatio = Math.min(1, activeUsers / Math.max(1, userCount))

  // Growth ratio (capped at 2x)
  const growthRatio = valueCreatedPrevEpoch > 0
    ? Math.min(2, valueCreatedLastEpoch / valueCreatedPrevEpoch)
    : 1

  // Trust health (0-1)
  const trustHealth = avgTrustScore

  // Combined multiplier: baseline 1.0, can range 0.5 to 1.5
  const multiplier = 0.5 + (activityRatio * 0.3) + (growthRatio * 0.1) + (trustHealth * 0.3)

  return Math.round(Math.max(0.5, Math.min(1.5, multiplier)) * 100) / 100
}

// ============================================================
// EPOCH-BASED WEIGHT UPDATES
// ============================================================

/**
 * Quality weights update in epochs to balance accuracy and computational cost
 */
export function createEpochTracker() {
  return {
    currentEpoch: 0,
    epochStartTime: Date.now(),
    qualityWeights: {},     // Frozen weights for current epoch
    pendingUpdates: {},     // Accumulate updates for next epoch
  }
}

/**
 * Check if epoch should advance, update weights if so
 */
export function advanceEpochIfNeeded(tracker, currentStats) {
  const now = Date.now()
  const epochElapsed = now - tracker.epochStartTime

  if (epochElapsed >= SHAPLEY_CONFIG.EPOCH_DURATION_MS) {
    // Advance to new epoch
    return {
      ...tracker,
      currentEpoch: tracker.currentEpoch + 1,
      epochStartTime: now,
      qualityWeights: { ...tracker.pendingUpdates },  // Pending becomes active
      pendingUpdates: {},  // Reset pending
      lastEpochStats: currentStats,
    }
  }

  return tracker
}

/**
 * Queue a quality weight update for next epoch
 */
export function queueWeightUpdate(tracker, username, newWeight) {
  return {
    ...tracker,
    pendingUpdates: {
      ...tracker.pendingUpdates,
      [username]: newWeight,
    },
  }
}

// ============================================================
// ANALYTICS
// ============================================================

/**
 * Get leaderboard by total rewards received
 */
export function getRewardLeaderboard(ledger) {
  return Object.entries(ledger.balances)
    .map(([user, balance]) => ({ user, balance }))
    .sort((a, b) => b.balance - a.balance)
}

/**
 * Get most valuable enablers (people whose referrals create most value)
 */
export function getTopEnablers(ledger) {
  const enablerValue = {}

  ledger.events.forEach(event => {
    Object.entries(event.distribution).forEach(([user, amount]) => {
      if (user !== event.actor) {
        enablerValue[user] = (enablerValue[user] || 0) + amount
      }
    })
  })

  return Object.entries(enablerValue)
    .map(([user, value]) => ({ user, enabledValue: value }))
    .sort((a, b) => b.enabledValue - a.enabledValue)
}

// ============================================================
// EXPORT
// ============================================================

export default {
  SHAPLEY_CONFIG,
  calculateShapleyDistribution,
  createRewardLedger,
  recordValueEvent,
  calculateQualityWeight,
  calculateEloRating,
  createEloSystem,
  recordComparison,
  recordReferral,
  calculateCounterfactualValue,
  getTrustBasedQualityWeight,
  getRewardLeaderboard,
  getTopEnablers,
  // Global multiplier & epochs
  calculateGlobalMultiplier,
  createEpochTracker,
  advanceEpochIfNeeded,
  queueWeightUpdate,
}

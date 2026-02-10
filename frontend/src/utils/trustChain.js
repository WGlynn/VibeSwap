/**
 * Trust Chain (Web of Trust) System
 *
 * Implements a DAG-based trust network where users can vouch for each other.
 * Users within the trust network get boosted voting power, creating
 * social/ethical weight to governance decisions.
 *
 * Key concepts:
 * - Handshake: Bidirectional trust confirmation between two users
 * - Vouching: One-way endorsement (becomes handshake if reciprocated)
 * - Trust Score: Based on position in trust DAG (depth from founders)
 * - Trust Chain: Path from user back to trusted founders
 *
 * @version 1.0.0
 */

// ============================================================
// CONFIGURATION
// ============================================================

export const TRUST_CONFIG = {
  // Founding trustees (immutable root of trust DAG)
  FOUNDERS: ['Faraday1'],

  // Trust mechanics
  MAX_VOUCH_PER_USER: 10,           // Each user can vouch for max 10 others
  MIN_VOUCHES_FOR_TRUSTED: 2,       // Need 2+ vouches from trusted users
  TRUST_DECAY_PER_HOP: 0.15,        // Trust decreases 15% per hop from founder
  MAX_TRUST_HOPS: 6,                // Max distance from founder

  // Voting power multipliers
  FOUNDER_MULTIPLIER: 3.0,          // Founders get 3x voting power
  TRUSTED_MULTIPLIER: 2.0,          // Fully trusted users get 2x
  PARTIAL_TRUST_MULTIPLIER: 1.5,    // Partially trusted get 1.5x
  UNTRUSTED_MULTIPLIER: 0.5,        // Untrusted users get 0.5x

  // Handshake requirements
  HANDSHAKE_COOLDOWN_MS: 86400000,  // 24h between handshakes with same user
  MAX_PENDING_VOUCHES: 20,          // Max pending vouch requests
}

// ============================================================
// TRUST GRAPH DATA STRUCTURE
// ============================================================

/**
 * Create an empty trust graph
 */
export function createTrustGraph() {
  return {
    vouches: {},        // { fromUser: { toUser: { timestamp, message } } }
    handshakes: [],     // [{ user1, user2, timestamp }] - confirmed bidirectional
    trustScores: {},    // { username: { score, hopsFromFounder, trustedBy } }
    lastUpdated: Date.now(),
  }
}

/**
 * Add a vouch (one-way endorsement)
 * @param {Object} graph - Trust graph
 * @param {string} from - Vouching user
 * @param {string} to - User being vouched for
 * @param {string} message - Optional endorsement message
 * @returns {Object} - { success, graph, isHandshake }
 */
export function addVouch(graph, from, to, message = '') {
  // Can't vouch for yourself
  if (from === to) {
    return { success: false, error: 'Cannot vouch for yourself' }
  }

  // Check vouch limit
  const existingVouches = Object.keys(graph.vouches[from] || {}).length
  if (existingVouches >= TRUST_CONFIG.MAX_VOUCH_PER_USER) {
    return {
      success: false,
      error: `Maximum ${TRUST_CONFIG.MAX_VOUCH_PER_USER} vouches reached`,
    }
  }

  // Check cooldown if re-vouching
  const existing = graph.vouches[from]?.[to]
  if (existing) {
    const timeSince = Date.now() - existing.timestamp
    if (timeSince < TRUST_CONFIG.HANDSHAKE_COOLDOWN_MS) {
      return {
        success: false,
        error: 'Cooldown period - already vouched recently',
        cooldownRemaining: TRUST_CONFIG.HANDSHAKE_COOLDOWN_MS - timeSince,
      }
    }
  }

  // Add the vouch
  const newGraph = { ...graph }
  if (!newGraph.vouches[from]) {
    newGraph.vouches[from] = {}
  }
  newGraph.vouches[from][to] = {
    timestamp: Date.now(),
    message,
  }

  // Check if this creates a handshake (bidirectional vouch)
  const isHandshake = graph.vouches[to]?.[from] != null
  if (isHandshake) {
    // Add to handshakes if not already there
    const handshakeExists = newGraph.handshakes.some(
      h => (h.user1 === from && h.user2 === to) || (h.user1 === to && h.user2 === from)
    )
    if (!handshakeExists) {
      newGraph.handshakes.push({
        user1: from,
        user2: to,
        timestamp: Date.now(),
        vouches: [
          { from, message },
          { from: to, message: graph.vouches[to][from].message },
        ],
      })
    }
  }

  newGraph.lastUpdated = Date.now()

  // Recalculate trust scores
  const updatedGraph = recalculateTrustScores(newGraph)

  return {
    success: true,
    graph: updatedGraph,
    isHandshake,
    message: isHandshake ? 'Handshake confirmed!' : 'Vouch recorded, awaiting reciprocation',
  }
}

/**
 * Revoke a vouch
 */
export function revokeVouch(graph, from, to) {
  if (!graph.vouches[from]?.[to]) {
    return { success: false, error: 'No vouch exists to revoke' }
  }

  const newGraph = { ...graph }
  delete newGraph.vouches[from][to]

  // Remove handshake if it existed
  newGraph.handshakes = newGraph.handshakes.filter(
    h => !((h.user1 === from && h.user2 === to) || (h.user1 === to && h.user2 === from))
  )

  newGraph.lastUpdated = Date.now()
  return {
    success: true,
    graph: recalculateTrustScores(newGraph),
  }
}

// ============================================================
// TRUST SCORE CALCULATION
// ============================================================

/**
 * Recalculate trust scores for all users in the graph
 * Uses BFS from founders to calculate distance-based trust
 */
export function recalculateTrustScores(graph) {
  const newGraph = { ...graph, trustScores: {} }

  // Initialize founders with max trust
  TRUST_CONFIG.FOUNDERS.forEach(founder => {
    newGraph.trustScores[founder] = {
      score: 1.0,
      hopsFromFounder: 0,
      trustedBy: [],
      isFounder: true,
      trustChain: [founder],
    }
  })

  // BFS from founders
  const visited = new Set(TRUST_CONFIG.FOUNDERS)
  const queue = TRUST_CONFIG.FOUNDERS.map(f => ({ user: f, hops: 0, chain: [f] }))

  while (queue.length > 0) {
    const { user, hops, chain } = queue.shift()

    // Find all users this person has vouched for
    const vouches = Object.keys(graph.vouches[user] || {})

    vouches.forEach(vouchedUser => {
      // Only process if we have a handshake (bidirectional trust)
      const hasHandshake = graph.vouches[vouchedUser]?.[user] != null

      if (hasHandshake && !visited.has(vouchedUser)) {
        const newHops = hops + 1

        if (newHops <= TRUST_CONFIG.MAX_TRUST_HOPS) {
          visited.add(vouchedUser)

          // Calculate trust score with decay
          const trustScore = Math.pow(1 - TRUST_CONFIG.TRUST_DECAY_PER_HOP, newHops)

          // Track who trusted this user
          const trustedBy = []
          Object.entries(graph.vouches).forEach(([voucher, targets]) => {
            if (targets[vouchedUser] && graph.vouches[vouchedUser]?.[voucher]) {
              trustedBy.push(voucher)
            }
          })

          newGraph.trustScores[vouchedUser] = {
            score: trustScore,
            hopsFromFounder: newHops,
            trustedBy,
            isFounder: false,
            trustChain: [...chain, vouchedUser],
          }

          queue.push({ user: vouchedUser, hops: newHops, chain: [...chain, vouchedUser] })
        }
      }
    })
  }

  return newGraph
}

/**
 * Get trust score for a user
 * @returns {Object} - { score, level, multiplier, trustChain }
 */
export function getTrustScore(graph, username) {
  const trustData = graph.trustScores[username]

  if (!trustData) {
    // User not in trust network
    return {
      score: 0,
      level: 'UNTRUSTED',
      multiplier: TRUST_CONFIG.UNTRUSTED_MULTIPLIER,
      hopsFromFounder: Infinity,
      trustChain: [],
      trustedBy: [],
      canVote: true,  // Can still vote, just with reduced power
      message: 'Not in trust network - seek vouches from trusted members',
    }
  }

  // Determine trust level and multiplier
  let level, multiplier

  if (trustData.isFounder) {
    level = 'FOUNDER'
    multiplier = TRUST_CONFIG.FOUNDER_MULTIPLIER
  } else if (trustData.score >= 0.7) {
    level = 'TRUSTED'
    multiplier = TRUST_CONFIG.TRUSTED_MULTIPLIER
  } else if (trustData.score >= 0.3) {
    level = 'PARTIAL_TRUST'
    multiplier = TRUST_CONFIG.PARTIAL_TRUST_MULTIPLIER
  } else {
    level = 'LOW_TRUST'
    multiplier = 1.0
  }

  return {
    score: trustData.score,
    level,
    multiplier,
    hopsFromFounder: trustData.hopsFromFounder,
    trustChain: trustData.trustChain,
    trustedBy: trustData.trustedBy,
    canVote: true,
    message: `${level}: ${trustData.hopsFromFounder} hops from founder`,
  }
}

// ============================================================
// VOTING POWER WITH TRUST
// ============================================================

/**
 * Calculate voting power including trust multiplier
 * @param {number} baseVotingPower - From governance.js
 * @param {Object} graph - Trust graph
 * @param {string} username - User to check
 * @returns {Object} - { adjustedPower, trustMultiplier, breakdown }
 */
export function getVotingPowerWithTrust(baseVotingPower, graph, username) {
  const trust = getTrustScore(graph, username)

  const adjustedPower = baseVotingPower * trust.multiplier

  return {
    basePower: baseVotingPower,
    trustMultiplier: trust.multiplier,
    adjustedPower,
    trustLevel: trust.level,
    trustScore: trust.score,
    trustChain: trust.trustChain,
    breakdown: {
      base: baseVotingPower,
      trustBonus: `${Math.round((trust.multiplier - 1) * 100)}%`,
      final: adjustedPower,
    },
  }
}

// ============================================================
// TRUST NETWORK ANALYTICS
// ============================================================

/**
 * Get statistics about the trust network
 */
export function getTrustNetworkStats(graph) {
  const scores = Object.values(graph.trustScores)

  const founderCount = scores.filter(s => s.isFounder).length
  const trustedCount = scores.filter(s => !s.isFounder && s.score >= 0.7).length
  const partialCount = scores.filter(s => s.score >= 0.3 && s.score < 0.7).length
  const lowTrustCount = scores.filter(s => s.score > 0 && s.score < 0.3).length

  // Calculate total trusted voting power vs untrusted
  // This shows how much of the vote is controlled by trusted users
  const trustedPowerShare = scores.length > 0
    ? scores.filter(s => s.score >= 0.3).length / scores.length
    : 1

  return {
    totalUsers: scores.length,
    founders: founderCount,
    trusted: trustedCount,
    partiallyTrusted: partialCount,
    lowTrust: lowTrustCount,
    handshakeCount: graph.handshakes.length,
    totalVouches: Object.values(graph.vouches).reduce(
      (sum, v) => sum + Object.keys(v).length, 0
    ),
    trustedPowerShare: Math.round(trustedPowerShare * 100),
    averageHops: scores.length > 0
      ? scores.reduce((sum, s) => sum + (s.hopsFromFounder || 0), 0) / scores.length
      : 0,
    lastUpdated: graph.lastUpdated,
  }
}

/**
 * Get pending vouch requests for a user
 */
export function getPendingVouchRequests(graph, username) {
  const pending = []

  Object.entries(graph.vouches).forEach(([voucher, targets]) => {
    if (targets[username] && !graph.vouches[username]?.[voucher]) {
      pending.push({
        from: voucher,
        timestamp: targets[username].timestamp,
        message: targets[username].message,
      })
    }
  })

  return pending.sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * Get users this person can vouch for (not yet vouched, not self)
 */
export function getVouchCandidates(graph, username, allUsers) {
  const alreadyVouched = Object.keys(graph.vouches[username] || {})

  return allUsers.filter(user =>
    user !== username && !alreadyVouched.includes(user)
  )
}

/**
 * Visualize trust chain as ASCII art
 */
export function visualizeTrustChain(trustChain) {
  if (trustChain.length === 0) return 'No trust chain'
  return trustChain.map((user, i) => {
    if (i === 0) return `[${user}]`  // Founder
    return ` → ${user}`
  }).join('')
}

// ============================================================
// REFERRAL QUALITY & SHAPLEY COUNTERFACTUALS
// ============================================================
//
// Core insight: Your vouches are skin in the game.
// If you vouch for bad actors, YOUR score suffers.
//
// Three mechanisms:
// 1. Referral Quality Score - avg quality of who you vouched for
// 2. Counterfactual Value - did your vouch actually matter?
// 3. Diversity Penalty - insular groups get penalized

/**
 * Calculate referral quality score for a user
 * Your trust is weighted by the quality of your referrals
 */
export function calculateReferralQuality(graph, username) {
  const vouches = Object.keys(graph.vouches[username] || {})

  if (vouches.length === 0) {
    return { score: 1.0, referralCount: 0, avgReferralScore: 0, penalty: 0 }
  }

  // Get trust scores of everyone you vouched for
  const referralScores = vouches.map(vouchee => {
    const trust = graph.trustScores[vouchee]
    return trust ? trust.score : 0
  })

  const avgReferralScore = referralScores.reduce((a, b) => a + b, 0) / referralScores.length

  // Count how many of your referrals turned out badly (score < 0.2)
  const badReferrals = referralScores.filter(s => s < 0.2).length
  const badReferralRatio = badReferrals / vouches.length

  // Penalty: each bad referral costs you 10% of your trust
  const penalty = Math.min(0.5, badReferralRatio * 0.5)

  return {
    score: 1.0 - penalty,
    referralCount: vouches.length,
    avgReferralScore: Math.round(avgReferralScore * 100) / 100,
    badReferrals,
    penalty: Math.round(penalty * 100) / 100,
  }
}

/**
 * Calculate counterfactual value of a vouch
 * "What would change if this vouch didn't exist?"
 */
export function calculateVouchCounterfactual(graph, voucher, vouchee) {
  // If no handshake, vouch has no trust value
  if (!graph.vouches[vouchee]?.[voucher]) {
    return { value: 0, reason: 'No reciprocal vouch (not a handshake)' }
  }

  const currentTrust = graph.trustScores[vouchee]
  if (!currentTrust) {
    return { value: 0, reason: 'Vouchee not in trust network' }
  }

  // Count alternative paths to vouchee (other people who vouch for them)
  const otherVouchers = Object.entries(graph.vouches)
    .filter(([v, targets]) => v !== voucher && targets[vouchee] && graph.vouches[vouchee]?.[v])
    .map(([v]) => v)

  // If this is the ONLY path, high counterfactual value
  if (otherVouchers.length === 0) {
    return {
      value: 1.0,
      reason: 'Sole trust path - critical vouch',
      isOnlyPath: true,
    }
  }

  // If many other paths exist, low counterfactual value
  // Value = 1 / (number of paths)
  const value = 1 / (otherVouchers.length + 1)

  return {
    value: Math.round(value * 100) / 100,
    reason: `${otherVouchers.length} alternative path(s) exist`,
    alternativePaths: otherVouchers.length,
    isOnlyPath: false,
  }
}

/**
 * Calculate diversity score - penalize insular groups
 * High diversity = vouched by people you DON'T vouch for
 */
export function calculateDiversityScore(graph, username) {
  const trustData = graph.trustScores[username]
  if (!trustData || !trustData.trustedBy || trustData.trustedBy.length === 0) {
    return { score: 0, diversity: 0, inwardVouches: 0, outwardVouches: 0 }
  }

  const trustedBy = trustData.trustedBy
  const iVouchFor = Object.keys(graph.vouches[username] || {})

  // Mutual vouches (I vouch for them AND they vouch for me)
  const mutualVouches = trustedBy.filter(v => iVouchFor.includes(v))

  // One-way inward (they vouch for me, I don't vouch for them)
  const inwardOnly = trustedBy.filter(v => !iVouchFor.includes(v))

  // Diversity = ratio of non-mutual to total vouches received
  // High diversity = you're vouched by people outside your circle
  const diversity = trustedBy.length > 0
    ? inwardOnly.length / trustedBy.length
    : 0

  // Penalty for pure echo chambers (0 diversity)
  const insularity = 1 - diversity
  const penalty = insularity > 0.8 ? (insularity - 0.8) * 2 : 0  // Penalty kicks in at 80% insularity

  return {
    score: Math.max(0, 1 - penalty),
    diversity: Math.round(diversity * 100) / 100,
    mutualVouches: mutualVouches.length,
    inwardOnly: inwardOnly.length,
    totalVouchesReceived: trustedBy.length,
    isInsular: diversity < 0.2,
    penalty: Math.round(penalty * 100) / 100,
  }
}

/**
 * Calculate final adjusted trust score with all modifiers
 */
export function getAdjustedTrustScore(graph, username) {
  const baseTrust = getTrustScore(graph, username)

  if (baseTrust.score === 0) {
    return { ...baseTrust, adjustedScore: 0, modifiers: {} }
  }

  const referralQuality = calculateReferralQuality(graph, username)
  const diversity = calculateDiversityScore(graph, username)

  // Final score = base * referral_quality * diversity
  const adjustedScore = baseTrust.score * referralQuality.score * diversity.score

  return {
    ...baseTrust,
    adjustedScore: Math.round(adjustedScore * 100) / 100,
    modifiers: {
      referralQuality: referralQuality.score,
      diversityScore: diversity.score,
      referralPenalty: referralQuality.penalty,
      insularityPenalty: diversity.penalty,
    },
    details: {
      referralQuality,
      diversity,
    },
    // Updated multiplier based on adjusted score
    adjustedMultiplier: getMultiplierFromScore(adjustedScore),
  }
}

function getMultiplierFromScore(score) {
  if (score >= 0.8) return TRUST_CONFIG.FOUNDER_MULTIPLIER
  if (score >= 0.5) return TRUST_CONFIG.TRUSTED_MULTIPLIER
  if (score >= 0.25) return TRUST_CONFIG.PARTIAL_TRUST_MULTIPLIER
  return TRUST_CONFIG.UNTRUSTED_MULTIPLIER
}

// ============================================================
// SYBIL RESISTANCE HELPERS
// ============================================================

/**
 * Check if a user is likely a Sybil based on trust network position
 */
export function checkSybilRisk(graph, username, allContributions) {
  const trust = getTrustScore(graph, username)
  const risks = []

  // No trust connection = high risk
  if (trust.level === 'UNTRUSTED') {
    risks.push({
      type: 'NO_TRUST_CHAIN',
      severity: 'HIGH',
      message: 'User has no trust chain to founders',
    })
  }

  // Very few connections
  if (trust.trustedBy.length === 1) {
    risks.push({
      type: 'SINGLE_VOUCHER',
      severity: 'MEDIUM',
      message: 'User only trusted by one person',
    })
  }

  // Check for isolated clusters (Sybil rings vouch for each other)
  if (trust.trustedBy.length >= 2) {
    const vouchersTrustScores = trust.trustedBy.map(v => getTrustScore(graph, v))
    const allLowTrust = vouchersTrustScores.every(v => v.score < 0.3)
    if (allLowTrust) {
      risks.push({
        type: 'LOW_TRUST_RING',
        severity: 'HIGH',
        message: 'Vouched only by low-trust users - possible Sybil ring',
      })
    }
  }

  return {
    username,
    trustScore: trust.score,
    trustLevel: trust.level,
    risks,
    riskScore: risks.reduce((sum, r) => {
      if (r.severity === 'HIGH') return sum + 40
      if (r.severity === 'MEDIUM') return sum + 20
      return sum + 10
    }, 0),
    recommendation: risks.length > 0
      ? 'Investigate user - possible Sybil'
      : 'User appears legitimate',
  }
}

// ============================================================
// EXPORT
// ============================================================

export default {
  TRUST_CONFIG,
  createTrustGraph,
  addVouch,
  revokeVouch,
  recalculateTrustScores,
  getTrustScore,
  getVotingPowerWithTrust,
  getTrustNetworkStats,
  getPendingVouchRequests,
  getVouchCandidates,
  visualizeTrustChain,
  checkSybilRisk,
  // Referral quality & Shapley counterfactuals
  calculateReferralQuality,
  calculateVouchCounterfactual,
  calculateDiversityScore,
  getAdjustedTrustScore,
}

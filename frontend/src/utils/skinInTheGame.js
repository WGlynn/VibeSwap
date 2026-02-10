/**
 * Skin in the Game - Unified Sybil Resistance
 *
 * Three problems, one root cause: lack of sustained commitment.
 * - Plagiarists want quick rewards without effort
 * - Sleepers want aged accounts without engagement
 * - Sybils want influence without real identity
 *
 * Solution: Make sustained commitment the only path to power.
 *
 * "Complexity is the enemy of security"
 *
 * @version 1.0.0
 */

// ============================================================
// CONFIGURATION
// ============================================================

export const SKIN_CONFIG = {
  // Challenge system (plagiarism)
  CHALLENGE_STAKE_PERCENT: 5,       // Challenger stakes 5% of contribution's rewards
  PLAGIARISM_SLASH_PERCENT: 100,    // Plagiarist loses 100% of rewards
  CHALLENGER_REWARD_PERCENT: 50,    // Challenger gets 50% of slashed amount
  CHALLENGE_PERIOD_DAYS: 14,        // 14 days to challenge after contribution

  // Activity consistency (sleeper detection)
  CONSISTENCY_WINDOW_DAYS: 90,      // Look at last 90 days
  CONSISTENCY_MIN_ACTIVE_WEEKS: 4,  // Must be active 4+ weeks in window
  ACTIVITY_ACTIONS: ['contribution', 'upvote', 'comment', 'vouch'],

  // Time-weighted reputation
  REPUTATION_HALF_LIFE_DAYS: 180,   // Old activity worth half after 6 months
}

// ============================================================
// 1. PLAGIARISM: Challenge-Based Detection
// ============================================================
//
// Game theory: We don't detect plagiarism - we make it unprofitable.
//
// Nash equilibrium analysis:
// - If no one checks: plagiarism is profitable
// - If checking is rewarded: people will check
// - If plagiarism is punished: plagiarism becomes unprofitable
// - Equilibrium: Don't plagiarize, because someone will check
//
// Schelling point: "Original source" is obvious and verifiable.
// Both parties naturally coordinate on what counts as plagiarism.

/**
 * Create a plagiarism challenge
 * Challenger stakes reputation. If right, gets bounty. If wrong, loses stake.
 */
export function createChallenge(contribution, challenger, originalSourceUrl) {
  return {
    id: `challenge-${Date.now()}`,
    contributionId: contribution.id,
    contributionAuthor: contribution.author,
    challenger,
    originalSourceUrl,
    createdAt: Date.now(),
    status: 'PENDING',  // PENDING -> VERIFIED/REJECTED
    // Challenger stakes 5% of contribution value
    challengerStake: Math.max(10, (contribution.rewardPoints || 0) * SKIN_CONFIG.CHALLENGE_STAKE_PERCENT / 100),
    potentialReward: (contribution.rewardPoints || 0) * SKIN_CONFIG.CHALLENGER_REWARD_PERCENT / 100,
  }
}

/**
 * Resolve a challenge (by governance vote or admin)
 * If plagiarism confirmed: author slashed, challenger rewarded
 * If challenge rejected: challenger loses stake
 */
export function resolveChallenge(challenge, isPlagiarism, resolvedBy) {
  if (isPlagiarism) {
    return {
      ...challenge,
      status: 'VERIFIED',
      resolvedAt: Date.now(),
      resolvedBy,
      outcome: {
        authorSlashed: true,
        authorPenalty: challenge.potentialReward * 2,  // Loses rewards + penalty
        challengerRewarded: true,
        challengerReward: challenge.potentialReward + challenge.challengerStake,
      }
    }
  } else {
    return {
      ...challenge,
      status: 'REJECTED',
      resolvedAt: Date.now(),
      resolvedBy,
      outcome: {
        authorSlashed: false,
        challengerRewarded: false,
        challengerPenalty: challenge.challengerStake,  // Loses stake for false accusation
      }
    }
  }
}

/**
 * Calculate plagiarism risk score based on challenge history
 * Users with past plagiarism get flagged on new contributions
 */
export function getPlagiarismRisk(username, challengeHistory) {
  const userChallenges = challengeHistory.filter(c => c.contributionAuthor === username)
  const verifiedPlagiarism = userChallenges.filter(c => c.status === 'VERIFIED').length
  const totalChallenges = userChallenges.length

  if (verifiedPlagiarism > 0) {
    return {
      risk: 'HIGH',
      score: Math.min(100, verifiedPlagiarism * 50),
      message: `${verifiedPlagiarism} verified plagiarism case(s)`,
      action: 'All new contributions require extended challenge period',
    }
  }
  if (totalChallenges > 2) {
    return {
      risk: 'MEDIUM',
      score: 30,
      message: `${totalChallenges} challenges filed (none verified)`,
      action: 'Monitor closely',
    }
  }
  return { risk: 'LOW', score: 0, message: 'Clean record' }
}

// ============================================================
// 2. SLEEPER ACCOUNTS: Activity Consistency Score
// ============================================================
//
// Problem: Attackers create accounts, let them age, activate later.
// Wallet age alone doesn't prove humanity.
//
// Solution: Measure CONSISTENCY of activity over time.
// Real humans have organic, sustained patterns.
// Sleepers have: nothing → nothing → sudden burst
//
// The math is simple: What % of weeks were you active?

/**
 * Calculate activity consistency score (0-100)
 * Higher = more consistent engagement over time
 */
export function calculateConsistencyScore(activityLog, windowDays = SKIN_CONFIG.CONSISTENCY_WINDOW_DAYS) {
  const now = Date.now()
  const windowStart = now - (windowDays * 24 * 60 * 60 * 1000)

  // Filter to window
  const recentActivity = activityLog.filter(a => a.timestamp >= windowStart)

  if (recentActivity.length === 0) {
    return { score: 0, activeWeeks: 0, totalWeeks: Math.ceil(windowDays / 7), pattern: 'DORMANT' }
  }

  // Count unique active weeks
  const activeWeeks = new Set()
  recentActivity.forEach(activity => {
    const weekNumber = Math.floor((activity.timestamp - windowStart) / (7 * 24 * 60 * 60 * 1000))
    activeWeeks.add(weekNumber)
  })

  const totalWeeks = Math.ceil(windowDays / 7)
  const consistencyScore = Math.round((activeWeeks.size / totalWeeks) * 100)

  // Detect patterns
  let pattern = 'CONSISTENT'
  if (activeWeeks.size < SKIN_CONFIG.CONSISTENCY_MIN_ACTIVE_WEEKS) {
    pattern = 'SPORADIC'
  }

  // Check for burst pattern (all activity in last week)
  const lastWeekActivity = recentActivity.filter(a =>
    a.timestamp >= now - (7 * 24 * 60 * 60 * 1000)
  )
  if (lastWeekActivity.length > recentActivity.length * 0.8 && recentActivity.length > 5) {
    pattern = 'BURST'  // Sleeper signature
  }

  return {
    score: consistencyScore,
    activeWeeks: activeWeeks.size,
    totalWeeks,
    pattern,
    isSuspicious: pattern === 'BURST' || pattern === 'DORMANT',
  }
}

/**
 * Get effective account age (activity-weighted)
 * A 1-year-old wallet with 1 month activity = 1 month effective age
 */
export function getEffectiveAge(createdAt, activityLog) {
  const now = Date.now()
  const totalAge = now - createdAt

  if (activityLog.length === 0) {
    return { effectiveAge: 0, totalAge, ratio: 0 }
  }

  // Find first and last activity
  const timestamps = activityLog.map(a => a.timestamp).sort((a, b) => a - b)
  const firstActivity = timestamps[0]
  const lastActivity = timestamps[timestamps.length - 1]

  // Effective age = time span of actual activity
  const activeSpan = lastActivity - firstActivity

  // Ratio shows how much of the account's life was active
  const ratio = totalAge > 0 ? activeSpan / totalAge : 0

  return {
    effectiveAge: activeSpan,
    effectiveAgeDays: Math.floor(activeSpan / (24 * 60 * 60 * 1000)),
    totalAge,
    totalAgeDays: Math.floor(totalAge / (24 * 60 * 60 * 1000)),
    ratio: Math.round(ratio * 100) / 100,
    isSleeper: ratio < 0.2 && totalAge > 30 * 24 * 60 * 60 * 1000,  // <20% active on 30+ day account
  }
}

// ============================================================
// 3. IDENTITY: Time-Weighted Reputation
// ============================================================
//
// Problem: How to verify identity without KYC or trusted third parties?
//
// Answer: Identity IS reputation accumulated over time.
// - You can't fake sustained positive contributions
// - You can't fake being vouched by real humans who know you
// - You can't fake time
//
// The trust chain already solves this. But we add one more layer:
// Recent activity matters more than old activity (half-life decay).
// This prevents "reputation farming then abandoning."

/**
 * Calculate time-weighted reputation score
 * Recent contributions worth more than old ones
 */
export function calculateTimeWeightedReputation(contributions, halfLifeDays = SKIN_CONFIG.REPUTATION_HALF_LIFE_DAYS) {
  const now = Date.now()
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000

  let weightedScore = 0
  let rawScore = 0

  contributions.forEach(contrib => {
    const age = now - contrib.timestamp
    const decayFactor = Math.pow(0.5, age / halfLifeMs)
    const points = contrib.rewardPoints || 0

    rawScore += points
    weightedScore += points * decayFactor
  })

  return {
    weightedScore: Math.round(weightedScore),
    rawScore,
    decayApplied: rawScore - weightedScore,
    message: weightedScore < rawScore * 0.5
      ? 'Most reputation is from old activity - contribute recently to maintain standing'
      : 'Reputation is current',
  }
}

// ============================================================
// UNIFIED SCORE: Skin in the Game Index
// ============================================================
//
// One number that captures: Are you a real, engaged community member?
// Combines: consistency + effective age + trust + clean record

/**
 * Calculate unified "Skin in the Game" index (0-100)
 * This is the master score for Sybil resistance
 */
export function calculateSkinInTheGameIndex(params) {
  const {
    activityLog = [],
    contributions = [],
    trustScore = 0,        // From trust chain (0-1)
    challengeHistory = [], // Plagiarism challenges
    createdAt = Date.now(),
  } = params

  // 1. Consistency (25%)
  const consistency = calculateConsistencyScore(activityLog)
  const consistencyComponent = consistency.score * 0.25

  // 2. Effective Age (25%)
  const age = getEffectiveAge(createdAt, activityLog)
  // Cap at 100 days = max score for age component
  const ageScore = Math.min(100, (age.effectiveAgeDays / 100) * 100)
  const ageComponent = ageScore * 0.25

  // 3. Trust Chain (30%)
  const trustComponent = (trustScore * 100) * 0.30

  // 4. Clean Record (20%)
  const plagiarismRisk = getPlagiarismRisk('', challengeHistory)
  const cleanRecordScore = 100 - plagiarismRisk.score
  const cleanRecordComponent = cleanRecordScore * 0.20

  const totalScore = Math.round(
    consistencyComponent + ageComponent + trustComponent + cleanRecordComponent
  )

  return {
    score: totalScore,
    tier: getTier(totalScore),
    breakdown: {
      consistency: { score: consistency.score, weight: 25, component: Math.round(consistencyComponent) },
      effectiveAge: { score: ageScore, weight: 25, component: Math.round(ageComponent) },
      trustChain: { score: Math.round(trustScore * 100), weight: 30, component: Math.round(trustComponent) },
      cleanRecord: { score: cleanRecordScore, weight: 20, component: Math.round(cleanRecordComponent) },
    },
    flags: {
      isSleeper: age.isSleeper,
      isBurstPattern: consistency.pattern === 'BURST',
      hasPlagiarismHistory: plagiarismRisk.risk !== 'LOW',
      isOutsideTrustNetwork: trustScore === 0,
    },
  }
}

function getTier(score) {
  if (score >= 80) return { name: 'Verified Member', color: 'green', votingMultiplier: 1.5 }
  if (score >= 60) return { name: 'Active Member', color: 'blue', votingMultiplier: 1.2 }
  if (score >= 40) return { name: 'New Member', color: 'yellow', votingMultiplier: 1.0 }
  if (score >= 20) return { name: 'Probationary', color: 'orange', votingMultiplier: 0.5 }
  return { name: 'Unverified', color: 'red', votingMultiplier: 0.25 }
}

// ============================================================
// EXPORT
// ============================================================

export default {
  SKIN_CONFIG,
  // Plagiarism
  createChallenge,
  resolveChallenge,
  getPlagiarismRisk,
  // Sleeper detection
  calculateConsistencyScore,
  getEffectiveAge,
  // Identity/Reputation
  calculateTimeWeightedReputation,
  // Unified score
  calculateSkinInTheGameIndex,
}

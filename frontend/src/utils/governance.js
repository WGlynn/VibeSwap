/**
 * Governance System for VibeSwap
 *
 * Implements security controls for contribution system:
 * 1. Wallet Age Gate - Minimum wallet age for governance participation
 * 2. Contribution Quality Scoring - Weighted voting power based on quality
 * 3. Supermajority Voting - 66% threshold for origin timestamp changes
 * 4. Challenge Period - 7-day window before finalization
 *
 * @version 1.0.0
 */

// ============================================================
// CONFIGURATION - Immutable once deployed
// ============================================================

export const GOVERNANCE_CONFIG = {
  // Wallet Age Requirements (in milliseconds)
  MIN_WALLET_AGE_MS: 30 * 24 * 60 * 60 * 1000,  // 30 days
  MIN_WALLET_TRANSACTIONS: 3,                     // 3+ on-chain transactions

  // Contribution Quality Weights
  QUALITY_WEIGHTS: {
    length: 0.15,           // Content length factor
    uniqueness: 0.25,       // How unique vs existing contributions
    references: 0.15,       // Has links/references
    engagement: 0.20,       // Upvotes and replies
    implementation: 0.25,   // Was it implemented?
  },

  // Voting Requirements
  SUPERMAJORITY_THRESHOLD: 0.66,    // 66% for origin timestamp approval
  CHALLENGE_PERIOD_MS: 7 * 24 * 60 * 60 * 1000,  // 7 days
  MIN_VOTERS_FOR_QUORUM: 5,         // Minimum 5 voters for valid vote

  // Voting Power Caps
  MAX_VOTING_POWER_PER_USER: 0.15,  // No single user can have >15% of vote
  QUALITY_SCORE_MULTIPLIER: 2.0,    // High quality = 2x voting power
}

// ============================================================
// WALLET ELIGIBILITY
// ============================================================

/**
 * Check if a wallet is eligible for governance participation
 * @param {Object} walletData - { address, createdAt, transactionCount }
 * @returns {Object} - { eligible, reasons, eligibleAt }
 */
export function checkWalletEligibility(walletData) {
  const { createdAt, transactionCount = 0 } = walletData
  const now = Date.now()
  const walletAge = now - createdAt

  const reasons = []
  let eligible = true
  let eligibleAt = now

  // Check wallet age
  if (walletAge < GOVERNANCE_CONFIG.MIN_WALLET_AGE_MS) {
    eligible = false
    const remainingTime = GOVERNANCE_CONFIG.MIN_WALLET_AGE_MS - walletAge
    eligibleAt = Math.max(eligibleAt, now + remainingTime)
    reasons.push({
      type: 'AGE',
      message: `Wallet must be at least 30 days old`,
      current: Math.floor(walletAge / (24 * 60 * 60 * 1000)),
      required: 30,
      unit: 'days',
    })
  }

  // Check transaction count
  if (transactionCount < GOVERNANCE_CONFIG.MIN_WALLET_TRANSACTIONS) {
    eligible = false
    reasons.push({
      type: 'TRANSACTIONS',
      message: `Wallet must have at least ${GOVERNANCE_CONFIG.MIN_WALLET_TRANSACTIONS} on-chain transactions`,
      current: transactionCount,
      required: GOVERNANCE_CONFIG.MIN_WALLET_TRANSACTIONS,
      unit: 'transactions',
    })
  }

  return {
    eligible,
    reasons,
    eligibleAt: eligible ? now : eligibleAt,
    walletAgeDays: Math.floor(walletAge / (24 * 60 * 60 * 1000)),
    transactionCount,
  }
}

// ============================================================
// CONTRIBUTION QUALITY SCORING
// ============================================================

/**
 * Calculate quality score for a contribution (0-100)
 * @param {Object} contribution - The contribution to score
 * @param {Array} allContributions - All contributions for uniqueness check
 * @returns {Object} - { score, breakdown }
 */
export function calculateQualityScore(contribution, allContributions = []) {
  const breakdown = {}

  // 1. Length Score (15%)
  const contentLength = (contribution.content || '').length
  const lengthScore = Math.min(100, (contentLength / 500) * 100)  // 500 chars = 100%
  breakdown.length = {
    score: lengthScore,
    weight: GOVERNANCE_CONFIG.QUALITY_WEIGHTS.length,
    weighted: lengthScore * GOVERNANCE_CONFIG.QUALITY_WEIGHTS.length,
    detail: `${contentLength} characters`,
  }

  // 2. Uniqueness Score (25%)
  const uniquenessScore = calculateUniqueness(contribution, allContributions)
  breakdown.uniqueness = {
    score: uniquenessScore,
    weight: GOVERNANCE_CONFIG.QUALITY_WEIGHTS.uniqueness,
    weighted: uniquenessScore * GOVERNANCE_CONFIG.QUALITY_WEIGHTS.uniqueness,
    detail: `${Math.round(uniquenessScore)}% unique`,
  }

  // 3. References Score (15%)
  const hasReferences = /https?:\/\/|github\.com|arxiv\.org|doi\.org/i.test(contribution.content || '')
  const hasCodeBlocks = /```[\s\S]*```/.test(contribution.content || '')
  const referencesScore = (hasReferences ? 50 : 0) + (hasCodeBlocks ? 50 : 0)
  breakdown.references = {
    score: referencesScore,
    weight: GOVERNANCE_CONFIG.QUALITY_WEIGHTS.references,
    weighted: referencesScore * GOVERNANCE_CONFIG.QUALITY_WEIGHTS.references,
    detail: hasReferences ? 'Has external references' : 'No references',
  }

  // 4. Engagement Score (20%)
  const upvotes = contribution.upvotes || 0
  const replies = contribution.replies || 0
  const engagementScore = Math.min(100, ((upvotes * 5) + (replies * 10)))
  breakdown.engagement = {
    score: engagementScore,
    weight: GOVERNANCE_CONFIG.QUALITY_WEIGHTS.engagement,
    weighted: engagementScore * GOVERNANCE_CONFIG.QUALITY_WEIGHTS.engagement,
    detail: `${upvotes} upvotes, ${replies} replies`,
  }

  // 5. Implementation Score (25%)
  const implementationScore = contribution.implemented ? 100 : 0
  breakdown.implementation = {
    score: implementationScore,
    weight: GOVERNANCE_CONFIG.QUALITY_WEIGHTS.implementation,
    weighted: implementationScore * GOVERNANCE_CONFIG.QUALITY_WEIGHTS.implementation,
    detail: contribution.implemented ? 'Implemented' : 'Not yet implemented',
  }

  // Calculate total
  const totalScore = Object.values(breakdown).reduce((sum, b) => sum + b.weighted, 0)

  return {
    score: Math.round(totalScore),
    breakdown,
    tier: getQualityTier(totalScore),
  }
}

/**
 * Calculate uniqueness score using Jaccard similarity
 */
function calculateUniqueness(contribution, allContributions) {
  if (allContributions.length === 0) return 100

  const getWords = (text) => {
    return new Set(
      (text || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)
    )
  }

  const words = getWords(contribution.content)
  if (words.size === 0) return 50

  let maxSimilarity = 0

  allContributions.forEach(other => {
    if (other.id === contribution.id) return
    const otherWords = getWords(other.content)
    if (otherWords.size === 0) return

    const intersection = new Set([...words].filter(x => otherWords.has(x)))
    const union = new Set([...words, ...otherWords])
    const similarity = intersection.size / union.size
    maxSimilarity = Math.max(maxSimilarity, similarity)
  })

  // Convert similarity to uniqueness (0 similarity = 100% unique)
  return Math.round((1 - maxSimilarity) * 100)
}

/**
 * Get quality tier from score
 */
function getQualityTier(score) {
  if (score >= 80) return { name: 'Exceptional', color: 'yellow', multiplier: 2.0 }
  if (score >= 60) return { name: 'High Quality', color: 'green', multiplier: 1.5 }
  if (score >= 40) return { name: 'Standard', color: 'blue', multiplier: 1.0 }
  if (score >= 20) return { name: 'Low Quality', color: 'gray', multiplier: 0.5 }
  return { name: 'Minimal', color: 'red', multiplier: 0.25 }
}

// ============================================================
// VOTING POWER CALCULATION
// ============================================================

/**
 * Calculate voting power for a user
 * @param {Object} userStats - { totalPoints, contributionCount, implementedCount }
 * @param {Array} userContributions - User's contributions for quality assessment
 * @param {Array} allContributions - All contributions for context
 * @returns {Object} - { votingPower, breakdown }
 */
export function calculateVotingPower(userStats, userContributions = [], allContributions = []) {
  // Base voting power from contribution points
  const basePoints = userStats.totalPoints || 0

  // Calculate average quality score of user's contributions
  let avgQuality = 50 // Default
  if (userContributions.length > 0) {
    const qualityScores = userContributions.map(c =>
      calculateQualityScore(c, allContributions).score
    )
    avgQuality = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
  }

  // Quality multiplier (0.5x to 2x)
  const qualityMultiplier = getQualityTier(avgQuality).multiplier

  // Calculate raw voting power
  const rawVotingPower = basePoints * qualityMultiplier

  return {
    votingPower: rawVotingPower,
    basePoints,
    qualityMultiplier,
    avgQualityScore: Math.round(avgQuality),
    breakdown: {
      base: basePoints,
      multiplier: qualityMultiplier,
      final: rawVotingPower,
    }
  }
}

// ============================================================
// ORIGIN TIMESTAMP VOTING SYSTEM
// ============================================================

/**
 * Create a new origin timestamp proposal
 * @param {string} contributionId - The contribution ID
 * @param {number} proposedTimestamp - The claimed origin timestamp
 * @param {string} proof - Evidence URL/reference
 * @param {string} proposer - Username of proposer
 * @returns {Object} - The proposal object
 */
export function createOriginTimestampProposal(contributionId, proposedTimestamp, proof, proposer) {
  const now = Date.now()

  return {
    id: `proposal-${now}-${contributionId}`,
    contributionId,
    proposedTimestamp,
    proof,
    proposer,
    createdAt: now,
    challengePeriodEnd: now + GOVERNANCE_CONFIG.CHALLENGE_PERIOD_MS,
    status: 'CHALLENGE_PERIOD',  // CHALLENGE_PERIOD -> VOTING -> APPROVED/REJECTED
    votes: {
      for: [],    // Array of { voter, power, timestamp }
      against: [],
    },
    totalVotingPower: 0,
    forPower: 0,
    againstPower: 0,
    result: null,
  }
}

/**
 * Cast a vote on an origin timestamp proposal
 * @param {Object} proposal - The proposal
 * @param {string} voter - Username
 * @param {boolean} inFavor - true = approve, false = reject
 * @param {number} votingPower - Voter's voting power
 * @param {Object} walletData - Voter's wallet data for eligibility check
 * @returns {Object} - { success, proposal, error }
 */
export function castVote(proposal, voter, inFavor, votingPower, walletData) {
  // Check wallet eligibility
  const eligibility = checkWalletEligibility(walletData)
  if (!eligibility.eligible) {
    return {
      success: false,
      error: `Wallet not eligible: ${eligibility.reasons.map(r => r.message).join(', ')}`,
      eligibility,
    }
  }

  // Check if already voted
  const existingVote = [...proposal.votes.for, ...proposal.votes.against]
    .find(v => v.voter === voter)
  if (existingVote) {
    return { success: false, error: 'Already voted on this proposal' }
  }

  // Check proposal status
  if (proposal.status !== 'CHALLENGE_PERIOD' && proposal.status !== 'VOTING') {
    return { success: false, error: `Proposal is ${proposal.status}, cannot vote` }
  }

  // Cap individual voting power
  const cappedPower = Math.min(
    votingPower,
    proposal.totalVotingPower * GOVERNANCE_CONFIG.MAX_VOTING_POWER_PER_USER || votingPower
  )

  // Record vote
  const voteRecord = {
    voter,
    power: cappedPower,
    timestamp: Date.now(),
  }

  const updatedProposal = { ...proposal }

  if (inFavor) {
    updatedProposal.votes.for = [...proposal.votes.for, voteRecord]
    updatedProposal.forPower = proposal.forPower + cappedPower
  } else {
    updatedProposal.votes.against = [...proposal.votes.against, voteRecord]
    updatedProposal.againstPower = proposal.againstPower + cappedPower
  }

  updatedProposal.totalVotingPower = updatedProposal.forPower + updatedProposal.againstPower

  // If challenge period ended, move to voting or finalize
  if (Date.now() > proposal.challengePeriodEnd) {
    updatedProposal.status = 'VOTING'
  }

  return { success: true, proposal: updatedProposal }
}

/**
 * Finalize a proposal after challenge period
 * @param {Object} proposal - The proposal to finalize
 * @returns {Object} - { success, result, proposal }
 */
export function finalizeProposal(proposal) {
  const now = Date.now()

  // Check if challenge period has ended
  if (now < proposal.challengePeriodEnd) {
    return {
      success: false,
      error: `Challenge period ends ${new Date(proposal.challengePeriodEnd).toLocaleString()}`,
      remainingMs: proposal.challengePeriodEnd - now,
    }
  }

  // Check quorum
  const totalVoters = proposal.votes.for.length + proposal.votes.against.length
  if (totalVoters < GOVERNANCE_CONFIG.MIN_VOTERS_FOR_QUORUM) {
    return {
      success: false,
      error: `Quorum not met: ${totalVoters}/${GOVERNANCE_CONFIG.MIN_VOTERS_FOR_QUORUM} voters`,
      proposal: { ...proposal, status: 'REJECTED', result: 'NO_QUORUM' },
    }
  }

  // Calculate result (needs 66% supermajority)
  const totalPower = proposal.forPower + proposal.againstPower
  const forPercentage = totalPower > 0 ? proposal.forPower / totalPower : 0

  const approved = forPercentage >= GOVERNANCE_CONFIG.SUPERMAJORITY_THRESHOLD

  return {
    success: true,
    result: approved ? 'APPROVED' : 'REJECTED',
    forPercentage: Math.round(forPercentage * 100),
    requiredPercentage: Math.round(GOVERNANCE_CONFIG.SUPERMAJORITY_THRESHOLD * 100),
    proposal: {
      ...proposal,
      status: approved ? 'APPROVED' : 'REJECTED',
      result: approved ? 'SUPERMAJORITY_APPROVED' : 'SUPERMAJORITY_NOT_MET',
      finalizedAt: now,
      finalForPercentage: forPercentage,
    },
  }
}

// ============================================================
// GOVERNANCE SUMMARY
// ============================================================

/**
 * Get governance status summary for a user
 */
export function getGovernanceSummary(walletData, userStats, userContributions, allContributions) {
  const eligibility = checkWalletEligibility(walletData)
  const votingPower = calculateVotingPower(userStats, userContributions, allContributions)

  return {
    eligible: eligibility.eligible,
    eligibilityReasons: eligibility.reasons,
    eligibleAt: eligibility.eligibleAt,
    votingPower: votingPower.votingPower,
    qualityScore: votingPower.avgQualityScore,
    qualityMultiplier: votingPower.qualityMultiplier,
    requirements: {
      walletAge: {
        required: 30,
        current: eligibility.walletAgeDays,
        met: eligibility.walletAgeDays >= 30,
        unit: 'days',
      },
      transactions: {
        required: GOVERNANCE_CONFIG.MIN_WALLET_TRANSACTIONS,
        current: eligibility.transactionCount,
        met: eligibility.transactionCount >= GOVERNANCE_CONFIG.MIN_WALLET_TRANSACTIONS,
        unit: 'transactions',
      },
    },
  }
}

// ============================================================
// EXPORT DEFAULT
// ============================================================

export default {
  GOVERNANCE_CONFIG,
  checkWalletEligibility,
  calculateQualityScore,
  calculateVotingPower,
  createOriginTimestampProposal,
  castVote,
  finalizeProposal,
  getGovernanceSummary,
}

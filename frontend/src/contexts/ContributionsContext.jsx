import { createContext, useContext, useState, useEffect } from 'react'
import {
  checkWalletEligibility,
  calculateQualityScore,
  calculateVotingPower,
  createOriginTimestampProposal,
  castVote,
  finalizeProposal,
  getGovernanceSummary,
  GOVERNANCE_CONFIG,
} from '../utils/governance'
import {
  createTrustGraph,
  addVouch,
  revokeVouch,
  getTrustScore,
  getVotingPowerWithTrust,
  getTrustNetworkStats,
  getPendingVouchRequests,
  checkSybilRisk,
  calculateReferralQuality,
  calculateDiversityScore,
  getAdjustedTrustScore,
  TRUST_CONFIG,
} from '../utils/trustChain'
import {
  calculateConsistencyScore,
  getEffectiveAge,
  calculateSkinInTheGameIndex,
  createChallenge,
  resolveChallenge,
  SKIN_CONFIG,
} from '../utils/skinInTheGame'
import {
  calculateShapleyDistribution,
  createRewardLedger,
  recordValueEvent,
  calculateGlobalMultiplier,
  createEpochTracker,
  advanceEpochIfNeeded,
  getRewardLeaderboard,
  getTopEnablers,
  SHAPLEY_CONFIG,
} from '../utils/shapleyTrust'
import {
  createCommitment,
  verifyCommitment,
  createExtractionTracker,
  attemptExtraction,
  createCheckpoint,
  createStateRoot,
  getSecuritySummary,
  FINALITY_CONFIG,
} from '../utils/finality'

const ContributionsContext = createContext()

// Reserved usernames - can only be claimed by signature from Faraday1
const RESERVED_USERNAMES = {
  'Matt': {
    reservedBy: 'Faraday1',
    signature: 'contrib-005',
    reason: 'Early tester feedback on simplicity and accessibility',
  },
  'Bill': {
    reservedBy: 'Faraday1',
    signature: 'contrib-015',
    reason: 'Father of Faraday1 - Inspired the Wallet Recovery System so nobody ever loses their crypto again',
    relationship: 'father',
  },
}

// Initial seed contributions
const SEED_CONTRIBUTIONS = [
  // Matt's original feedback (attributed)
  {
    id: 'contrib-003',
    author: 'Matt',
    type: 'feedback',
    title: 'Simplify Crypto Jargon for Newcomers',
    content: "Gave it a try, it's a fun way to understand the value of your exchange. My only point of feedback is that it assumes the user has at least intermediate proficiency in protocol. I would dial it down a bit for more casual/newer users. For example, I don't know what 'slippage' is, what 'MEV' is, etc.",
    tags: ['ux', 'accessibility', 'onboarding', 'simplicity'],
    timestamp: Date.now() - 86400000 * 2, // 2 days ago
    upvotes: 24,
    replies: 5,
    implemented: true,
    rewardPoints: 200,
  },
  {
    id: 'contrib-004',
    author: 'Matt',
    type: 'feedback',
    title: 'Avoid Buzzword Overload',
    content: "I don't know if you watched the Super Bowl but the ads were all AI and super buzz wordy. Might be overstated at the moment. Keep it simple and focused on real benefits.",
    tags: ['ux', 'messaging', 'simplicity'],
    timestamp: Date.now() - 86400000 * 2 + 3600000, // 2 days ago + 1hr
    upvotes: 18,
    replies: 3,
    implemented: true,
    rewardPoints: 150,
  },
  // Faraday1's signature reserving Matt username
  {
    id: 'contrib-005',
    author: 'Faraday1',
    type: 'context',
    title: 'Username Reservation: Matt',
    content: 'By this signature, I (Faraday1) hereby reserve the username "Matt" for the contributor who provided early tester feedback on simplifying crypto jargon and improving accessibility. This username is now reserved and can only be claimed by the rightful owner. Their contributions (contrib-003, contrib-004) are attributed to this account.',
    tags: ['governance', 'username', 'reservation'],
    timestamp: Date.now() - 86400000, // 1 day ago
    upvotes: 15,
    replies: 2,
    implemented: true,
    rewardPoints: 50,
    isSignature: true,
    reservedUsername: 'Matt',
  },
  {
    id: 'contrib-001',
    author: 'Faraday1',
    type: 'context',
    title: 'XP Multiplier Mechanism',
    content: 'Protocol alignment should act as an XP multiplier for all earnings, rewarding users who align with cooperative capitalism values.',
    tags: ['xp-system', 'alignment', 'rewards'],
    timestamp: Date.now() - 3600000,
    upvotes: 12,
    replies: 3,
    implemented: true,
    rewardPoints: 150,
  },
  {
    id: 'contrib-002',
    author: 'Faraday1',
    type: 'context',
    title: 'Knowledge Graph for Contributions',
    content: 'Track feedback and contributions from people in a knowledge graph. If the project is successful, contributors earn rewards. Build a forum like Reddit for socially building the app.',
    tags: ['forum', 'rewards', 'community'],
    timestamp: Date.now() - 1800000,
    upvotes: 8,
    replies: 0,
    implemented: true,
    rewardPoints: 100,
  },
  // ============================================
  // Faraday1 & Matt Conversation Thread
  // Topic: Democratized Finance & Target Audience
  // ============================================
  {
    id: 'contrib-007',
    author: 'Matt',
    type: 'feedback',
    title: 'Democratization Approach',
    content: "That's a good way to do it, democratize it.",
    tags: ['philosophy', 'democratization', 'conversation'],
    timestamp: Date.now() - 86400000 * 3, // 3 days ago
    upvotes: 8,
    replies: 1,
    implemented: false,
    rewardPoints: 0,
    threadId: 'thread-001',
    threadOrder: 1,
  },
  {
    id: 'contrib-008',
    author: 'Faraday1',
    type: 'context',
    title: 'Facebook of Money, But Decentralized',
    content: "Exactly. My design philosophy exists from the very top to bottom so it's not just democratized trading but democratized building. I want this to be the Facebook of money, but decentralized.",
    tags: ['philosophy', 'vision', 'democratization', 'conversation'],
    timestamp: Date.now() - 86400000 * 3 + 60000, // 3 days ago + 1 min
    upvotes: 22,
    replies: 1,
    implemented: false,
    rewardPoints: 0,
    threadId: 'thread-001',
    threadOrder: 2,
  },
  {
    id: 'contrib-009',
    author: 'Matt',
    type: 'context',
    title: 'Venmo/Cash App Market Analysis',
    content: "Well it's an interesting juxtaposition where you have Venmo, which marketed itself as peer to peer cash, going all in on banking. You can get a Venmo debit card now. In that sense, Venmo has really moved away from its roots. But Venmo, Cash App got their start with communities that for one reason or another didn't have access to traditional banking.",
    tags: ['market-analysis', 'venmo', 'cashapp', 'fintech', 'conversation'],
    timestamp: Date.now() - 86400000 * 3 + 120000, // 3 days ago + 2 min
    upvotes: 31,
    replies: 1,
    implemented: false,
    rewardPoints: 0,
    threadId: 'thread-001',
    threadOrder: 3,
  },
  {
    id: 'contrib-010',
    author: 'Matt',
    type: 'context',
    title: 'Target Audience: The Unbanked & Underserved',
    content: "So said another way, a potential target audience for you are those barred from traditional finance such as low income, immigrants, places with rampant inflation where money loses value quickly.",
    tags: ['target-audience', 'unbanked', 'inflation', 'immigrants', 'strategy', 'conversation'],
    timestamp: Date.now() - 86400000 * 3 + 180000, // 3 days ago + 3 min
    upvotes: 45,
    replies: 1,
    implemented: false,
    rewardPoints: 0,
    threadId: 'thread-001',
    threadOrder: 4,
    isKeyInsight: true,
  },
  {
    id: 'contrib-011',
    author: 'Faraday1',
    type: 'feedback',
    title: 'Cash App Adoption in Lower Income Communities',
    content: "Yeah most lower class people I know use Cash App.",
    tags: ['market-validation', 'cashapp', 'adoption', 'conversation'],
    timestamp: Date.now() - 86400000 * 3 + 240000, // 3 days ago + 4 min
    upvotes: 12,
    replies: 1,
    implemented: false,
    rewardPoints: 0,
    threadId: 'thread-001',
    threadOrder: 5,
  },
  {
    id: 'contrib-012',
    author: 'Matt',
    type: 'feedback',
    title: 'Validation of Target Market',
    content: "Good point.",
    tags: ['validation', 'conversation'],
    timestamp: Date.now() - 86400000 * 3 + 300000, // 3 days ago + 5 min
    upvotes: 5,
    replies: 1,
    implemented: false,
    rewardPoints: 0,
    threadId: 'thread-001',
    threadOrder: 6,
  },
  {
    id: 'contrib-013',
    author: 'Matt',
    type: 'context',
    title: 'Real-World Crypto Adoption: Where Banking Has Failed',
    content: "That was part of my point about simplifying it, the intellectual class will appreciate the technical aspects but may stay mostly theoretical. Your actual users, surprisingly, might be people that just need an alternative to banking and yours is the best fit for them. Consider that the only places in the world that have broader adoption of crypto, not as investment but actual day-to-day use, are regions of the world where traditional banking has failed.",
    tags: ['target-audience', 'adoption', 'unbanked', 'simplicity', 'global', 'strategy', 'conversation'],
    timestamp: Date.now() - 86400000 * 3 + 360000, // 3 days ago + 6 min
    upvotes: 52,
    replies: 1,
    implemented: true,
    rewardPoints: 250,
    threadId: 'thread-001',
    threadOrder: 7,
    isKeyInsight: true,
  },
  {
    id: 'contrib-014',
    author: 'Faraday1',
    type: 'context',
    title: 'Redesign Complete: Banking Alternative Messaging',
    content: `Implemented Matt's insight. The entire homepage messaging has been redesigned around the "banking alternative" thesis:

• "no bank required" - just a phone and internet
• "works everywhere" - Lagos to Lima
• "beat inflation" - convert to stable dollars
• "send money in seconds" - no wire fees, no delays

Target audience shift: from crypto traders → people who need an alternative to traditional banking.

Trust indicators added: "no account needed", "works worldwide", "you stay in control"

This reframes VibeSwap from a technical DeFi product to a practical financial tool for the underserved.`,
    tags: ['implementation', 'messaging', 'strategy', 'unbanked', 'design'],
    timestamp: Date.now(),
    upvotes: 18,
    replies: 0,
    implemented: true,
    rewardPoints: 100,
    threadId: 'thread-001',
    threadOrder: 8,
  },
  // ============================================
  // Bill's Contribution - Recovery System Inspiration
  // Reserved username for Faraday1's father
  // ============================================
  {
    id: 'contrib-015',
    author: 'Faraday1',
    type: 'context',
    title: 'Username Reservation: Bill',
    content: 'By this signature, I (Faraday1) hereby reserve the username "Bill" for my father, who inspired the Wallet Recovery System. His wisdom about the importance of never losing access to what matters most led directly to our 5-layer recovery architecture. This username is now reserved and can only be claimed by him. His contribution (contrib-016) is attributed to this account.',
    tags: ['governance', 'username', 'reservation', 'family', 'recovery'],
    timestamp: Date.now() - 86400000 * 0.5, // 12 hours ago
    upvotes: 42,
    replies: 8,
    implemented: true,
    rewardPoints: 100,
    isSignature: true,
    reservedUsername: 'Bill',
  },
  {
    id: 'contrib-016',
    author: 'Bill',
    type: 'context',
    title: 'Never Lose Your Crypto - The Recovery Philosophy',
    content: `The inspiration behind VibeSwap's Wallet Recovery System.

Too many people have lost everything because they forgot a password or lost a piece of paper. This doesn't have to happen.

The core insight: Recovery should work the way humans actually live. We trust our family and friends. We have time to notice when something's wrong. We plan for when we're gone.

From this came the 5-layer recovery system:
1. Guardian Recovery - Your trusted circle can help you recover
2. Timelock Recovery - Time is your ally against attackers
3. Dead Man's Switch - Your digital will for those you leave behind
4. Arbitration - A fair jury when all else fails
5. Quantum Backup - Future-proof protection

Plus 7 layers of AGI resistance to protect against sophisticated AI attacks.

The goal: A world where "not your keys, not your coins" doesn't mean "lose your keys, lose everything."

Your crypto. Your people. Your safety net.`,
    tags: ['recovery', 'philosophy', 'security', 'guardian', 'family', 'inheritance', 'agi-resistance'],
    timestamp: Date.now() - 86400000 * 1, // 1 day ago
    upvotes: 156,
    replies: 23,
    implemented: true,
    rewardPoints: 500,
    isKeyInsight: true,
    isFounding: true,
  },
  // ============================================
  // Bill & Faraday1 Collaboration
  // Topic: Mechanism Insulation (Fee/Governance Separation)
  // 50/50 Shapley credit - Bill requested, Faraday1 explained
  // ============================================
  {
    id: 'contrib-017',
    author: 'Bill',
    type: 'feedback',
    title: 'Why Not a Legal Pool from Exchange Fees?',
    content: `Asked an important question: why don't we add a pool to sustain lawyers from exchange fees?

This question forced the articulation of a critical design principle that wasn't explicitly documented.

The question itself revealed a gap in our documentation - we hadn't explained WHY fees and governance rewards must be separate. Sometimes the best contributions are the questions that force clarity.`,
    tags: ['mechanism-design', 'governance', 'fees', 'game-theory', 'question'],
    timestamp: Date.now() - 3600000 * 2, // 2 hours ago
    upvotes: 34,
    replies: 1,
    implemented: true,
    rewardPoints: 250, // 50% of 500 total
    isKeyInsight: true,
    threadId: 'thread-002',
    threadOrder: 1,
  },
  {
    id: 'contrib-018',
    author: 'Faraday1',
    type: 'context',
    title: 'Mechanism Insulation: Why Fees and Governance Must Be Separate',
    content: `Responding to Bill's question about a legal pool from fees, articulated a core design principle:

**The Insulation Principle:**
- Exchange fees → 100% to LPs (capital providers)
- Token rewards → Governance/Arbitration (protocol stewards)

**Why they must NOT mix:**

1. **Conflict of Interest** - If arbitrators are paid from fees, they're incentivized to favor high-volume traders

2. **Capture Attack** - Become LP + arbitrator = pay yourself with others' money

3. **Liquidity Death Spiral** - Legal costs spike → fees diverted → LP yields drop → LPs leave → less liquidity → death spiral

4. **Fee Manipulation** - Control fees = control governance via wash trading

**TL;DR:** Fees reward capital. Tokens reward stewards. Mixing creates circular incentives where dispute judges profit from disputes. That's regulatory capture, not decentralized justice.

Added to docs as "Mechanism Design" section with PDF/Word exports.`,
    tags: ['mechanism-design', 'governance', 'fees', 'game-theory', 'insulation', 'documentation'],
    timestamp: Date.now() - 3600000, // 1 hour ago
    upvotes: 47,
    replies: 3,
    implemented: true,
    rewardPoints: 250, // 50% of 500 total
    isKeyInsight: true,
    threadId: 'thread-002',
    threadOrder: 2,
  },
  {
    id: 'contrib-006',
    author: 'Faraday1',
    type: 'context',
    title: 'Shapley Counterfactuals for Extractive Behavior',
    content: `Add Shapley counterfactuals to the reward system so extractive behavior negatively impacts net rewards ON TOP of financial costs (slashing, failed tx fees).

The key insight: Shapley values measure marginal contribution - what value did you add that wouldn't exist without you?

For extractive actors:
- Counterfactual: "What if this actor wasn't here?"
- Answer: The pool would be BETTER off
- Therefore: Negative marginal contribution → Negative Shapley rewards

This creates a triple penalty for extraction attempts:
1. SLASHING: 50% collateral lost on invalid reveals
2. GAS COSTS: Failed extraction attempts still cost gas
3. SHAPLEY DEBT: Negative contribution score reduces future reward eligibility

The counterfactual calculation:
- Track each actor's impact on pool metrics (price stability, volume, IL)
- Compare realized metrics vs counterfactual "without this actor"
- If pool would be healthier without you → negative contribution score
- Negative scores create "Shapley debt" that must be repaid before earning

This makes extraction not just unprofitable but ANTI-profitable. You don't just fail to extract - you go into debt to the cooperative.`,
    tags: ['shapley', 'rewards', 'mev', 'game-theory', 'counterfactuals'],
    timestamp: Date.now(),
    upvotes: 31,
    replies: 7,
    implemented: false,
    rewardPoints: 0,
  },
]

export { RESERVED_USERNAMES }

// Contribution types
export const CONTRIBUTION_TYPES = {
  context: { label: 'Context', color: 'matrix', icon: '💡', points: 50 },
  feature: { label: 'Feature Request', color: 'cyan', icon: '✨', points: 30 },
  bug: { label: 'Bug Report', color: 'red', icon: '🐛', points: 40 },
  docs: { label: 'Documentation', color: 'blue', icon: '📚', points: 25 },
  feedback: { label: 'Feedback', color: 'purple', icon: '💬', points: 20 },
}

// ============================================================
// TIMESTAMP SYSTEM - Dual timestamps for value attribution
// ============================================================
//
// Every contribution has TWO timestamp fields:
//
// 1. `timestamp` (required, immutable)
//    - When the contribution was recorded in the system
//    - Set automatically to Date.now() on creation
//    - Cannot be changed after creation
//
// 2. `originTimestamp` (optional, governance-controlled)
//    - Claimed earlier timestamp for contributions that existed before system
//    - Example: Someone shared an idea via email 6 months ago, then added it here
//    - Can be retroactively added through governance vote or AI verification
//    - Requires proof (email, git commit, tweet, etc.)
//
// Why this matters:
// - Chronology determines value attribution (who had the idea first)
// - Some contributions predate the system (email threads, private chats, etc.)
// - Governance/AI can verify claims and backdate origin timestamps
// - The recorded `timestamp` always shows when it entered the system
// - The `originTimestamp` shows when the idea actually originated
//
// Fields:
// - originTimestamp: number | null - Unix timestamp of claimed origin
// - originProof: string | null - Link/reference to evidence (email, commit, etc.)
// - originVerified: boolean - Whether governance/AI has verified the claim
// - originVerifiedBy: string | null - Who/what verified it (e.g., "governance-vote-42", "ai-verification")
// - originVerifiedAt: number | null - When verification occurred
// ============================================================

export function ContributionsProvider({ children }) {
  const [contributions, setContributions] = useState(() => {
    const saved = localStorage.getItem('vibeswap_contributions')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return SEED_CONTRIBUTIONS
      }
    }
    return SEED_CONTRIBUTIONS
  })

  const [userStats, setUserStats] = useState(() => {
    const saved = localStorage.getItem('vibeswap_user_stats')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return {}
      }
    }
    return {}
  })

  // Governance proposals state
  const [proposals, setProposals] = useState(() => {
    const saved = localStorage.getItem('vibeswap_proposals')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return []
      }
    }
    return []
  })

  // Trust graph state (Web of Trust / Handshake Protocol)
  const [trustGraph, setTrustGraph] = useState(() => {
    const saved = localStorage.getItem('vibeswap_trust_graph')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return createTrustGraph()
      }
    }
    return createTrustGraph()
  })

  // Plagiarism challenges state
  const [challenges, setChallenges] = useState(() => {
    const saved = localStorage.getItem('vibeswap_challenges')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return []
      }
    }
    return []
  })

  // Activity log state (for consistency scoring)
  const [activityLog, setActivityLog] = useState(() => {
    const saved = localStorage.getItem('vibeswap_activity_log')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return []
      }
    }
    return []
  })

  // Shapley reward ledger (tracks all value distributions)
  const [rewardLedger, setRewardLedger] = useState(() => {
    const saved = localStorage.getItem('vibeswap_reward_ledger')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return createRewardLedger()
      }
    }
    return createRewardLedger()
  })

  // Epoch tracker (quality weights update in epochs)
  const [epochTracker, setEpochTracker] = useState(() => {
    const saved = localStorage.getItem('vibeswap_epoch_tracker')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return createEpochTracker()
      }
    }
    return createEpochTracker()
  })

  // Checkpoints for finality
  const [checkpoints, setCheckpoints] = useState(() => {
    const saved = localStorage.getItem('vibeswap_checkpoints')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return []
      }
    }
    return []
  })

  // Extraction tracker (caps damage per epoch)
  const [extractionTracker, setExtractionTracker] = useState(() => {
    const saved = localStorage.getItem('vibeswap_extraction')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return createExtractionTracker(0, 1000)  // Initial values
      }
    }
    return createExtractionTracker(0, 1000)
  })

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('vibeswap_contributions', JSON.stringify(contributions))
  }, [contributions])

  useEffect(() => {
    localStorage.setItem('vibeswap_user_stats', JSON.stringify(userStats))
  }, [userStats])

  useEffect(() => {
    localStorage.setItem('vibeswap_proposals', JSON.stringify(proposals))
  }, [proposals])

  useEffect(() => {
    localStorage.setItem('vibeswap_trust_graph', JSON.stringify(trustGraph))
  }, [trustGraph])

  useEffect(() => {
    localStorage.setItem('vibeswap_challenges', JSON.stringify(challenges))
  }, [challenges])

  useEffect(() => {
    localStorage.setItem('vibeswap_activity_log', JSON.stringify(activityLog))
  }, [activityLog])

  useEffect(() => {
    localStorage.setItem('vibeswap_reward_ledger', JSON.stringify(rewardLedger))
  }, [rewardLedger])

  useEffect(() => {
    localStorage.setItem('vibeswap_epoch_tracker', JSON.stringify(epochTracker))
  }, [epochTracker])

  useEffect(() => {
    localStorage.setItem('vibeswap_checkpoints', JSON.stringify(checkpoints))
  }, [checkpoints])

  useEffect(() => {
    localStorage.setItem('vibeswap_extraction', JSON.stringify(extractionTracker))
  }, [extractionTracker])

  // Calculate user stats from contributions
  const calculateUserStats = (username) => {
    const userContribs = contributions.filter(c => c.author === username)
    const totalPoints = userContribs.reduce((sum, c) => sum + (c.rewardPoints || 0), 0)
    const totalUpvotes = userContribs.reduce((sum, c) => sum + (c.upvotes || 0), 0)
    const implementedCount = userContribs.filter(c => c.implemented).length

    return {
      username,
      contributionCount: userContribs.length,
      totalPoints,
      totalUpvotes,
      implementedCount,
      rank: getRank(totalPoints),
    }
  }

  // Get rank based on points
  const getRank = (points) => {
    if (points >= 1000) return { title: 'Protocol Architect', color: 'text-yellow-400', tier: 5 }
    if (points >= 500) return { title: 'Core Contributor', color: 'text-purple-400', tier: 4 }
    if (points >= 200) return { title: 'Active Builder', color: 'text-matrix-500', tier: 3 }
    if (points >= 50) return { title: 'Contributor', color: 'text-cyan-400', tier: 2 }
    return { title: 'Newcomer', color: 'text-black-400', tier: 1 }
  }

  // Add a new contribution
  // See TIMESTAMP SYSTEM comment above for dual-timestamp explanation
  const addContribution = (contribution) => {
    const now = Date.now()
    const newContrib = {
      id: `contrib-${now}`,
      // Primary timestamp: when recorded in system (immutable)
      timestamp: now,
      // Origin timestamp: for retroactive attribution (governance-controlled)
      originTimestamp: null,      // Claimed earlier timestamp (null = same as timestamp)
      originProof: null,          // Evidence link (email, commit, tweet URL, etc.)
      originVerified: false,      // Has governance/AI verified the claim?
      originVerifiedBy: null,     // Verifier ID (e.g., "governance-vote-42", "ai-gpt4")
      originVerifiedAt: null,     // When verification occurred
      // Standard fields
      upvotes: 0,
      replies: 0,
      implemented: false,
      rewardPoints: 0,
      ...contribution,
    }
    setContributions(prev => [newContrib, ...prev])
    return newContrib
  }

  // Upvote a contribution
  const upvoteContribution = (id) => {
    setContributions(prev => prev.map(c =>
      c.id === id ? { ...c, upvotes: c.upvotes + 1 } : c
    ))
  }

  // Mark as implemented (awards points)
  const markImplemented = (id, points = 100) => {
    setContributions(prev => prev.map(c =>
      c.id === id ? { ...c, implemented: true, rewardPoints: points } : c
    ))
  }

  // ============================================================
  // ORIGIN TIMESTAMP FUNCTIONS
  // ============================================================

  // Claim an origin timestamp (user submits proof of earlier contribution)
  // This creates a pending claim that needs governance/AI verification
  const claimOriginTimestamp = (id, originTimestamp, originProof) => {
    setContributions(prev => prev.map(c =>
      c.id === id ? {
        ...c,
        originTimestamp,
        originProof,
        originVerified: false,  // Pending verification
        originVerifiedBy: null,
        originVerifiedAt: null,
      } : c
    ))
  }

  // Verify an origin timestamp claim (called by governance or AI system)
  // verifiedBy examples: "governance-vote-42", "ai-verification", "admin-faraday1"
  const verifyOriginTimestamp = (id, verifiedBy) => {
    setContributions(prev => prev.map(c =>
      c.id === id && c.originTimestamp ? {
        ...c,
        originVerified: true,
        originVerifiedBy: verifiedBy,
        originVerifiedAt: Date.now(),
      } : c
    ))
  }

  // Reject an origin timestamp claim (resets to null)
  const rejectOriginTimestamp = (id, rejectedBy) => {
    setContributions(prev => prev.map(c =>
      c.id === id ? {
        ...c,
        originTimestamp: null,
        originProof: null,
        originVerified: false,
        originVerifiedBy: `rejected-by-${rejectedBy}`,
        originVerifiedAt: Date.now(),
      } : c
    ))
  }

  // Get the effective timestamp for ordering (uses origin if verified, else recorded)
  const getEffectiveTimestamp = (contribution) => {
    if (contribution.originTimestamp && contribution.originVerified) {
      return contribution.originTimestamp
    }
    return contribution.timestamp
  }

  // Get contributions sorted by effective timestamp (for chronological value attribution)
  const getChronologicalContributions = () => {
    return [...contributions].sort((a, b) =>
      getEffectiveTimestamp(a) - getEffectiveTimestamp(b)
    )
  }

  // Get knowledge graph data (connections between contributions)
  const getKnowledgeGraph = () => {
    const nodes = []
    const edges = []

    // Create nodes for each contribution
    contributions.forEach(c => {
      nodes.push({
        id: c.id,
        label: c.title.slice(0, 20) + (c.title.length > 20 ? '...' : ''),
        author: c.author,
        type: c.type,
        size: 10 + (c.upvotes * 2) + (c.implemented ? 20 : 0),
        color: CONTRIBUTION_TYPES[c.type]?.color || 'matrix',
      })
    })

    // Create edges based on shared tags
    contributions.forEach((c1, i) => {
      contributions.slice(i + 1).forEach(c2 => {
        const sharedTags = c1.tags?.filter(t => c2.tags?.includes(t)) || []
        if (sharedTags.length > 0) {
          edges.push({
            source: c1.id,
            target: c2.id,
            weight: sharedTags.length,
            tags: sharedTags,
          })
        }
      })
    })

    return { nodes, edges }
  }

  // Get leaderboard
  const getLeaderboard = () => {
    const authors = [...new Set(contributions.map(c => c.author))]
    return authors
      .map(author => calculateUserStats(author))
      .sort((a, b) => b.totalPoints - a.totalPoints)
  }

  // Get all unique tags
  const getAllTags = () => {
    const tags = new Set()
    contributions.forEach(c => c.tags?.forEach(t => tags.add(t)))
    return [...tags]
  }

  // ============================================================
  // GOVERNANCE FUNCTIONS
  // ============================================================

  // Check if a wallet can participate in governance
  const checkGovernanceEligibility = (walletData) => {
    return checkWalletEligibility(walletData)
  }

  // Get quality score for a contribution
  const getContributionQuality = (contributionId) => {
    const contribution = contributions.find(c => c.id === contributionId)
    if (!contribution) return null
    return calculateQualityScore(contribution, contributions)
  }

  // Get voting power for a user
  const getUserVotingPower = (username, walletData) => {
    const userContribs = contributions.filter(c => c.author === username)
    const stats = calculateUserStats(username)
    return calculateVotingPower(stats, userContribs, contributions)
  }

  // Create a proposal for origin timestamp change
  const createTimestampProposal = (contributionId, proposedTimestamp, proof, proposer) => {
    const proposal = createOriginTimestampProposal(
      contributionId,
      proposedTimestamp,
      proof,
      proposer
    )
    setProposals(prev => [...prev, proposal])
    return proposal
  }

  // Vote on a proposal
  const voteOnProposal = (proposalId, voter, inFavor, walletData) => {
    const proposal = proposals.find(p => p.id === proposalId)
    if (!proposal) return { success: false, error: 'Proposal not found' }

    const votingPower = getUserVotingPower(voter, walletData)
    const result = castVote(proposal, voter, inFavor, votingPower.votingPower, walletData)

    if (result.success) {
      setProposals(prev => prev.map(p =>
        p.id === proposalId ? result.proposal : p
      ))
    }

    return result
  }

  // Finalize a proposal after challenge period
  const finalizeTimestampProposal = (proposalId) => {
    const proposal = proposals.find(p => p.id === proposalId)
    if (!proposal) return { success: false, error: 'Proposal not found' }

    const result = finalizeProposal(proposal)

    // Update proposal
    setProposals(prev => prev.map(p =>
      p.id === proposalId ? result.proposal : p
    ))

    // If approved, update the contribution's origin timestamp
    if (result.result === 'APPROVED') {
      verifyOriginTimestamp(
        proposal.contributionId,
        `governance-proposal-${proposalId}`
      )
    }

    return result
  }

  // Get all active proposals
  const getActiveProposals = () => {
    return proposals.filter(p =>
      p.status === 'CHALLENGE_PERIOD' || p.status === 'VOTING'
    )
  }

  // Get governance summary for a user
  const getGovernanceStatus = (username, walletData) => {
    const userContribs = contributions.filter(c => c.author === username)
    const stats = calculateUserStats(username)
    return getGovernanceSummary(walletData, stats, userContribs, contributions)
  }

  // ============================================================
  // TRUST CHAIN / HANDSHAKE PROTOCOL FUNCTIONS
  // ============================================================

  // Vouch for another user (handshake if reciprocated)
  const vouchForUser = (fromUsername, toUsername, message = '') => {
    const result = addVouch(trustGraph, fromUsername, toUsername, message)
    if (result.success) {
      setTrustGraph(result.graph)
    }
    return result
  }

  // Revoke a vouch
  const revokeUserVouch = (fromUsername, toUsername) => {
    const result = revokeVouch(trustGraph, fromUsername, toUsername)
    if (result.success) {
      setTrustGraph(result.graph)
    }
    return result
  }

  // Get trust score for a user (with referral quality & diversity adjustments)
  const getUserTrustScore = (username) => {
    return getAdjustedTrustScore(trustGraph, username)
  }

  // Get referral quality for a user
  const getUserReferralQuality = (username) => {
    return calculateReferralQuality(trustGraph, username)
  }

  // Get diversity score for a user
  const getUserDiversityScore = (username) => {
    return calculateDiversityScore(trustGraph, username)
  }

  // Get voting power including trust multiplier (uses adjusted trust score)
  const getFullVotingPower = (username, walletData) => {
    const basePower = getUserVotingPower(username, walletData)
    const adjustedTrust = getAdjustedTrustScore(trustGraph, username)

    // Use adjusted score instead of base score
    const adjustedPower = basePower.votingPower * (adjustedTrust.adjustedMultiplier || 1)

    return {
      basePower: basePower.votingPower,
      adjustedPower,
      trustScore: adjustedTrust.adjustedScore,
      trustMultiplier: adjustedTrust.adjustedMultiplier,
      modifiers: adjustedTrust.modifiers,
      breakdown: {
        base: basePower.votingPower,
        referralQuality: adjustedTrust.modifiers?.referralQuality || 1,
        diversity: adjustedTrust.modifiers?.diversityScore || 1,
        final: adjustedPower,
      },
    }
  }

  // Get pending vouch requests for a user
  const getUserPendingVouches = (username) => {
    return getPendingVouchRequests(trustGraph, username)
  }

  // Get trust network stats
  const getTrustStats = () => {
    return getTrustNetworkStats(trustGraph)
  }

  // Check Sybil risk for a user based on trust network
  const getUserSybilRisk = (username) => {
    return checkSybilRisk(trustGraph, username, contributions)
  }

  // ============================================================
  // SKIN IN THE GAME FUNCTIONS
  // ============================================================

  // Log an activity (for consistency scoring)
  const logActivity = (username, action) => {
    const entry = {
      username,
      action,
      timestamp: Date.now(),
    }
    setActivityLog(prev => [...prev, entry])
  }

  // Get user's activity consistency
  const getUserConsistency = (username) => {
    const userActivity = activityLog.filter(a => a.username === username)
    return calculateConsistencyScore(userActivity)
  }

  // Get user's effective account age
  const getUserEffectiveAge = (username, createdAt) => {
    const userActivity = activityLog.filter(a => a.username === username)
    return getEffectiveAge(createdAt, userActivity)
  }

  // Challenge a contribution as plagiarized
  const challengeContribution = (contributionId, challenger, sourceUrl) => {
    const contribution = contributions.find(c => c.id === contributionId)
    if (!contribution) return { success: false, error: 'Contribution not found' }

    const challenge = createChallenge(contribution, challenger, sourceUrl)
    setChallenges(prev => [...prev, challenge])
    return { success: true, challenge }
  }

  // Resolve a plagiarism challenge
  const resolvePlagiarismChallenge = (challengeId, isPlagiarism, resolvedBy) => {
    const challenge = challenges.find(c => c.id === challengeId)
    if (!challenge) return { success: false, error: 'Challenge not found' }

    const resolved = resolveChallenge(challenge, isPlagiarism, resolvedBy)
    setChallenges(prev => prev.map(c => c.id === challengeId ? resolved : c))

    // If plagiarism verified, mark contribution
    if (isPlagiarism) {
      setContributions(prev => prev.map(c =>
        c.id === challenge.contributionId
          ? { ...c, flaggedPlagiarism: true, rewardPoints: 0 }
          : c
      ))
    }

    return { success: true, resolved }
  }

  // Get unified "Skin in the Game" index for a user
  const getUserSkinIndex = (username, createdAt) => {
    const userActivity = activityLog.filter(a => a.username === username)
    const userContribs = contributions.filter(c => c.author === username)
    const userChallenges = challenges.filter(c => c.contributionAuthor === username)
    const trust = getTrustScore(trustGraph, username)

    return calculateSkinInTheGameIndex({
      activityLog: userActivity,
      contributions: userContribs,
      trustScore: trust.score,
      challengeHistory: userChallenges,
      createdAt,
    })
  }

  // ============================================================
  // SHAPLEY REWARD FUNCTIONS
  // ============================================================

  // Record a value-creating event and distribute rewards via Shapley
  const recordValue = (eventType, actor, value) => {
    const trust = getAdjustedTrustScore(trustGraph, actor)
    const trustChain = trust.trustChain || [actor]

    // Build quality weights from trust scores
    const qualityWeights = {}
    trustChain.forEach(user => {
      const userTrust = getAdjustedTrustScore(trustGraph, user)
      qualityWeights[user] = userTrust.adjustedScore || 0.5
    })

    // Calculate global multiplier from network health
    const networkStats = {
      userCount: Object.keys(trustGraph.trustScores || {}).length,
      activeUsers: [...new Set(activityLog.slice(-100).map(a => a.username))].length,
      avgTrustScore: Object.values(trustGraph.trustScores || {})
        .reduce((sum, t) => sum + (t.score || 0), 0) /
        Math.max(1, Object.keys(trustGraph.trustScores || {}).length),
    }
    const globalMultiplier = calculateGlobalMultiplier(networkStats)

    const event = {
      eventType,
      actor,
      value,
      trustChain,
      qualityWeights,
      globalMultiplier,
    }

    const newLedger = recordValueEvent(rewardLedger, event)
    setRewardLedger(newLedger)

    // Also log the activity
    logActivity(actor, eventType)

    return {
      distributed: newLedger.events[newLedger.events.length - 1],
      globalMultiplier,
    }
  }

  // Get user's Shapley rewards balance
  const getUserRewardBalance = (username) => {
    return rewardLedger.balances[username] || 0
  }

  // Get reward leaderboard
  const getShapleyLeaderboard = () => {
    return getRewardLeaderboard(rewardLedger)
  }

  // Get top enablers (people whose referrals create most value)
  const getTopValueEnablers = () => {
    return getTopEnablers(rewardLedger)
  }

  // Check and advance epoch if needed
  const checkEpoch = () => {
    const networkStats = {
      userCount: Object.keys(trustGraph.trustScores || {}).length,
    }
    const newTracker = advanceEpochIfNeeded(epochTracker, networkStats)
    if (newTracker.currentEpoch !== epochTracker.currentEpoch) {
      setEpochTracker(newTracker)
      return { advanced: true, newEpoch: newTracker.currentEpoch }
    }
    return { advanced: false, currentEpoch: epochTracker.currentEpoch }
  }

  // ============================================================
  // FINALITY & COMMITMENT FUNCTIONS
  // ============================================================

  // Create a commitment for an action (commit-reveal scheme)
  const commitAction = async (action) => {
    return await createCommitment(action)
  }

  // Verify a revealed commitment
  const verifyAction = async (commitment, reveal) => {
    return await verifyCommitment(commitment, reveal)
  }

  // Attempt extraction (bounded by cap)
  const tryExtraction = (address, amount) => {
    const result = attemptExtraction(extractionTracker, address, amount)
    if (result.success) {
      setExtractionTracker(result.tracker)
    }
    return result
  }

  // Create a checkpoint of current state
  const checkpoint = async () => {
    const state = {
      contributions: contributions.length,
      trustGraph: Object.keys(trustGraph.trustScores || {}).length,
      rewardLedger: rewardLedger.totalDistributed,
      epoch: epochTracker.currentEpoch,
    }
    const stateRoot = await createStateRoot(state)
    const previousCheckpoint = checkpoints[checkpoints.length - 1] || null
    const newCheckpoint = await createCheckpoint(stateRoot, previousCheckpoint)

    setCheckpoints(prev => [...prev, newCheckpoint])

    // Reset extraction tracker for new epoch
    const totalValue = rewardLedger.totalDistributed || 1000
    setExtractionTracker(createExtractionTracker(newCheckpoint.height, totalValue))

    return newCheckpoint
  }

  // Get security summary
  const getSecurityStatus = () => {
    return getSecuritySummary(checkpoints, extractionTracker)
  }

  return (
    <ContributionsContext.Provider value={{
      contributions,
      addContribution,
      upvoteContribution,
      markImplemented,
      // Origin timestamp functions (for retroactive attribution)
      claimOriginTimestamp,
      verifyOriginTimestamp,
      rejectOriginTimestamp,
      getEffectiveTimestamp,
      getChronologicalContributions,
      // Stats and graph functions
      calculateUserStats,
      getKnowledgeGraph,
      getLeaderboard,
      getAllTags,
      CONTRIBUTION_TYPES,
      // Governance functions
      proposals,
      checkGovernanceEligibility,
      getContributionQuality,
      getUserVotingPower,
      createTimestampProposal,
      voteOnProposal,
      finalizeTimestampProposal,
      getActiveProposals,
      getGovernanceStatus,
      GOVERNANCE_CONFIG,
      // Trust chain / Handshake Protocol functions
      trustGraph,
      vouchForUser,
      revokeUserVouch,
      getUserTrustScore,
      getUserReferralQuality,
      getUserDiversityScore,
      getFullVotingPower,
      getUserPendingVouches,
      getTrustStats,
      getUserSybilRisk,
      TRUST_CONFIG,
      // Skin in the Game functions
      challenges,
      activityLog,
      logActivity,
      getUserConsistency,
      getUserEffectiveAge,
      challengeContribution,
      resolvePlagiarismChallenge,
      getUserSkinIndex,
      SKIN_CONFIG,
      // Shapley reward functions
      rewardLedger,
      epochTracker,
      recordValue,
      getUserRewardBalance,
      getShapleyLeaderboard,
      getTopValueEnablers,
      checkEpoch,
      SHAPLEY_CONFIG,
      // Finality & commitment functions
      checkpoints,
      extractionTracker,
      commitAction,
      verifyAction,
      tryExtraction,
      checkpoint,
      getSecurityStatus,
      FINALITY_CONFIG,
    }}>
      {children}
    </ContributionsContext.Provider>
  )
}

export function useContributions() {
  const context = useContext(ContributionsContext)
  if (!context) {
    throw new Error('useContributions must be used within a ContributionsProvider')
  }
  return context
}

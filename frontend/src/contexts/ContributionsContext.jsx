import { createContext, useContext, useState, useEffect } from 'react'

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

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('vibeswap_contributions', JSON.stringify(contributions))
  }, [contributions])

  useEffect(() => {
    localStorage.setItem('vibeswap_user_stats', JSON.stringify(userStats))
  }, [userStats])

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

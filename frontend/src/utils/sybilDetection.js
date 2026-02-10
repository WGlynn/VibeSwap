/**
 * Sybil Attack Detection Heuristics
 *
 * Detects suspicious patterns that may indicate one person
 * controlling multiple fake identities to game the system.
 *
 * @version 1.0.0
 *
 * HEURISTICS OVERVIEW:
 * 1. Upvote Ring Detection - Accounts that only upvote each other
 * 2. Burst Creation Detection - Many accounts created in short window
 * 3. Identical Behavior Patterns - Same timing, same tags, same style
 * 4. New Account Spam - Fresh accounts submitting high-value content
 * 5. Wallet Clustering - Multiple wallets funded from same source
 * 6. Username Pattern Detection - Sequential/similar usernames (Bot1, Bot2...)
 * 7. Content Similarity - Duplicate or near-duplicate contributions
 * 8. Timing Correlation - Actions happening in suspicious synchrony
 */

// ============================================================
// CONFIGURATION - Tune these thresholds based on real data
// ============================================================

export const SYBIL_CONFIG = {
  // Upvote ring detection
  UPVOTE_RING_THRESHOLD: 0.8,        // 80%+ of upvotes from same group = suspicious
  MIN_UPVOTES_FOR_RING_CHECK: 5,     // Only check accounts with 5+ upvotes

  // Burst creation detection
  BURST_WINDOW_MS: 3600000,          // 1 hour window
  BURST_ACCOUNT_THRESHOLD: 5,        // 5+ accounts in window = suspicious

  // New account spam
  NEW_ACCOUNT_AGE_MS: 86400000 * 7,  // 7 days = "new"
  NEW_ACCOUNT_HIGH_VALUE_LIMIT: 3,   // Max 3 high-value contribs for new accounts

  // Content similarity
  SIMILARITY_THRESHOLD: 0.85,        // 85%+ similar = likely duplicate

  // Timing correlation
  TIMING_WINDOW_MS: 60000,           // Actions within 1 minute
  TIMING_CORRELATION_THRESHOLD: 5,   // 5+ correlated actions = suspicious

  // Username patterns
  SEQUENTIAL_USERNAME_REGEX: /^(.+?)(\d+)$/,  // Matches "User1", "Bot42", etc.
}

// ============================================================
// HEURISTIC 1: Upvote Ring Detection
// ============================================================
// Detects groups of accounts that primarily upvote each other
// and rarely interact with outsiders.

export function detectUpvoteRings(contributions, upvoteGraph) {
  /**
   * @param contributions - Array of all contributions
   * @param upvoteGraph - Map of { odId: [voterUsernames] }
   * @returns Array of { accounts: string[], ringScore: number, evidence: string }
   */

  const suspiciousRings = []
  const authorUpvotes = new Map() // author -> { receivedFrom: Set, gaveTo: Set }

  // Build upvote relationship graph
  contributions.forEach(contrib => {
    const author = contrib.author
    if (!authorUpvotes.has(author)) {
      authorUpvotes.set(author, { receivedFrom: new Set(), gaveTo: new Set() })
    }
  })

  // Populate from upvote graph
  if (upvoteGraph) {
    Object.entries(upvoteGraph).forEach(([contribId, voters]) => {
      const contrib = contributions.find(c => c.id === contribId)
      if (contrib) {
        voters.forEach(voter => {
          // contrib.author received upvote from voter
          if (authorUpvotes.has(contrib.author)) {
            authorUpvotes.get(contrib.author).receivedFrom.add(voter)
          }
          // voter gave upvote to contrib.author
          if (authorUpvotes.has(voter)) {
            authorUpvotes.get(voter).gaveTo.add(contrib.author)
          }
        })
      }
    })
  }

  // Detect mutual upvote clusters
  const authors = [...authorUpvotes.keys()]
  const checked = new Set()

  authors.forEach(author => {
    if (checked.has(author)) return

    const data = authorUpvotes.get(author)
    const mutualUpvoters = [...data.receivedFrom].filter(voter =>
      data.gaveTo.has(voter) // They upvoted each other
    )

    if (mutualUpvoters.length >= 2) {
      // Found potential ring - check if they ONLY upvote each other
      const ringMembers = [author, ...mutualUpvoters]
      let internalUpvotes = 0
      let externalUpvotes = 0

      ringMembers.forEach(member => {
        const memberData = authorUpvotes.get(member)
        if (memberData) {
          memberData.receivedFrom.forEach(voter => {
            if (ringMembers.includes(voter)) {
              internalUpvotes++
            } else {
              externalUpvotes++
            }
          })
        }
      })

      const totalUpvotes = internalUpvotes + externalUpvotes
      const ringScore = totalUpvotes > 0 ? internalUpvotes / totalUpvotes : 0

      if (ringScore >= SYBIL_CONFIG.UPVOTE_RING_THRESHOLD &&
          totalUpvotes >= SYBIL_CONFIG.MIN_UPVOTES_FOR_RING_CHECK) {
        suspiciousRings.push({
          accounts: ringMembers,
          ringScore: Math.round(ringScore * 100),
          evidence: `${internalUpvotes}/${totalUpvotes} upvotes are internal to this group`,
          severity: ringScore > 0.9 ? 'CRITICAL' : 'HIGH',
        })
        ringMembers.forEach(m => checked.add(m))
      }
    }
  })

  return suspiciousRings
}

// ============================================================
// HEURISTIC 2: Burst Account Creation Detection
// ============================================================
// Detects many accounts created within a short time window

export function detectBurstCreation(identities) {
  /**
   * @param identities - Array of { username, createdAt, address }
   * @returns Array of { accounts: string[], windowStart: Date, severity: string }
   */

  const suspiciousBursts = []

  // Sort by creation time
  const sorted = [...identities].sort((a, b) => a.createdAt - b.createdAt)

  for (let i = 0; i < sorted.length; i++) {
    const windowStart = sorted[i].createdAt
    const windowEnd = windowStart + SYBIL_CONFIG.BURST_WINDOW_MS

    // Find all accounts created in this window
    const windowAccounts = sorted.filter(identity =>
      identity.createdAt >= windowStart && identity.createdAt <= windowEnd
    )

    if (windowAccounts.length >= SYBIL_CONFIG.BURST_ACCOUNT_THRESHOLD) {
      // Check if we already reported this cluster
      const key = windowAccounts.map(a => a.username).sort().join(',')
      const alreadyReported = suspiciousBursts.some(burst =>
        burst.accounts.sort().join(',') === key
      )

      if (!alreadyReported) {
        suspiciousBursts.push({
          accounts: windowAccounts.map(a => a.username),
          addresses: windowAccounts.map(a => a.address),
          windowStart: new Date(windowStart),
          windowEnd: new Date(windowEnd),
          count: windowAccounts.length,
          severity: windowAccounts.length >= 10 ? 'CRITICAL' : 'HIGH',
          evidence: `${windowAccounts.length} accounts created within 1 hour`,
        })
      }
    }
  }

  return suspiciousBursts
}

// ============================================================
// HEURISTIC 3: New Account High-Value Spam Detection
// ============================================================
// New accounts submitting lots of high-value content = suspicious

export function detectNewAccountSpam(contributions, identities) {
  /**
   * @param contributions - Array of contributions
   * @param identities - Array of { username, createdAt }
   * @returns Array of { username, accountAge, highValueCount, severity }
   */

  const now = Date.now()
  const suspiciousAccounts = []

  // Build identity lookup
  const identityMap = new Map(identities.map(i => [i.username, i]))

  // Group contributions by author
  const authorContribs = new Map()
  contributions.forEach(contrib => {
    if (!authorContribs.has(contrib.author)) {
      authorContribs.set(contrib.author, [])
    }
    authorContribs.get(contrib.author).push(contrib)
  })

  // Check each author
  authorContribs.forEach((contribs, author) => {
    const identity = identityMap.get(author)
    if (!identity) return

    const accountAge = now - identity.createdAt
    const isNewAccount = accountAge < SYBIL_CONFIG.NEW_ACCOUNT_AGE_MS

    if (isNewAccount) {
      // Count high-value contributions (code, proposal, implemented)
      const highValueContribs = contribs.filter(c =>
        c.type === 'code' ||
        c.type === 'proposal' ||
        c.implemented ||
        c.rewardPoints > 50
      )

      if (highValueContribs.length > SYBIL_CONFIG.NEW_ACCOUNT_HIGH_VALUE_LIMIT) {
        suspiciousAccounts.push({
          username: author,
          accountAgeDays: Math.floor(accountAge / 86400000),
          highValueCount: highValueContribs.length,
          totalContributions: contribs.length,
          severity: highValueContribs.length > 10 ? 'CRITICAL' : 'MEDIUM',
          evidence: `Account is ${Math.floor(accountAge / 86400000)} days old with ${highValueContribs.length} high-value contributions`,
        })
      }
    }
  })

  return suspiciousAccounts
}

// ============================================================
// HEURISTIC 4: Username Pattern Detection
// ============================================================
// Detects sequential usernames like Bot1, Bot2, Bot3...

export function detectSequentialUsernames(identities) {
  /**
   * @param identities - Array of { username }
   * @returns Array of { pattern, accounts: string[], severity }
   */

  const patterns = new Map() // basePattern -> [{ username, number }]

  identities.forEach(identity => {
    const match = identity.username.match(SYBIL_CONFIG.SEQUENTIAL_USERNAME_REGEX)
    if (match) {
      const [, base, num] = match
      const key = base.toLowerCase()
      if (!patterns.has(key)) {
        patterns.set(key, [])
      }
      patterns.get(key).push({
        username: identity.username,
        number: parseInt(num, 10),
        address: identity.address,
      })
    }
  })

  const suspiciousPatterns = []

  patterns.forEach((accounts, base) => {
    if (accounts.length >= 3) {
      // Check if numbers are sequential or close
      const numbers = accounts.map(a => a.number).sort((a, b) => a - b)
      let sequentialCount = 1
      for (let i = 1; i < numbers.length; i++) {
        if (numbers[i] - numbers[i - 1] <= 2) {
          sequentialCount++
        }
      }

      if (sequentialCount >= 3) {
        suspiciousPatterns.push({
          pattern: `${base}[N]`,
          accounts: accounts.map(a => a.username),
          addresses: accounts.map(a => a.address),
          count: accounts.length,
          severity: accounts.length >= 10 ? 'CRITICAL' : 'HIGH',
          evidence: `${accounts.length} accounts matching pattern "${base}1", "${base}2", etc.`,
        })
      }
    }
  })

  return suspiciousPatterns
}

// ============================================================
// HEURISTIC 5: Content Similarity Detection
// ============================================================
// Detects duplicate or near-duplicate contributions

export function detectSimilarContent(contributions) {
  /**
   * @param contributions - Array of contributions with content
   * @returns Array of { contrib1, contrib2, similarity, severity }
   */

  const duplicates = []

  // Simple similarity check using Jaccard index on words
  const getWords = (text) => {
    return new Set(
      text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)
    )
  }

  const jaccardSimilarity = (set1, set2) => {
    const intersection = new Set([...set1].filter(x => set2.has(x)))
    const union = new Set([...set1, ...set2])
    return union.size > 0 ? intersection.size / union.size : 0
  }

  for (let i = 0; i < contributions.length; i++) {
    const words1 = getWords(contributions[i].content || '')
    if (words1.size < 5) continue // Skip very short content

    for (let j = i + 1; j < contributions.length; j++) {
      // Skip if same author (self-quoting is fine)
      if (contributions[i].author === contributions[j].author) continue

      const words2 = getWords(contributions[j].content || '')
      if (words2.size < 5) continue

      const similarity = jaccardSimilarity(words1, words2)

      if (similarity >= SYBIL_CONFIG.SIMILARITY_THRESHOLD) {
        duplicates.push({
          contrib1: { id: contributions[i].id, author: contributions[i].author, title: contributions[i].title },
          contrib2: { id: contributions[j].id, author: contributions[j].author, title: contributions[j].title },
          similarity: Math.round(similarity * 100),
          severity: similarity > 0.95 ? 'CRITICAL' : 'MEDIUM',
          evidence: `${Math.round(similarity * 100)}% content similarity between different authors`,
        })
      }
    }
  }

  return duplicates
}

// ============================================================
// HEURISTIC 6: Timing Correlation Detection
// ============================================================
// Detects accounts that act in suspicious synchrony

export function detectTimingCorrelation(contributions) {
  /**
   * @param contributions - Array with timestamps
   * @returns Array of { accounts, correlatedActions, severity }
   */

  const suspiciousCorrelations = []

  // Group contributions by time windows
  const timeWindows = new Map() // windowKey -> [contributions]

  contributions.forEach(contrib => {
    const windowKey = Math.floor(contrib.timestamp / SYBIL_CONFIG.TIMING_WINDOW_MS)
    if (!timeWindows.has(windowKey)) {
      timeWindows.set(windowKey, [])
    }
    timeWindows.get(windowKey).push(contrib)
  })

  // Find windows with multiple different authors acting together
  timeWindows.forEach((contribs, windowKey) => {
    const authors = [...new Set(contribs.map(c => c.author))]

    if (authors.length >= SYBIL_CONFIG.TIMING_CORRELATION_THRESHOLD) {
      // Check if this group acts together frequently
      let correlatedWindows = 0

      timeWindows.forEach((otherContribs, otherKey) => {
        if (otherKey === windowKey) return
        const otherAuthors = new Set(otherContribs.map(c => c.author))
        const overlap = authors.filter(a => otherAuthors.has(a))
        if (overlap.length >= authors.length * 0.8) {
          correlatedWindows++
        }
      })

      if (correlatedWindows >= 3) {
        suspiciousCorrelations.push({
          accounts: authors,
          correlatedWindows: correlatedWindows,
          windowTime: new Date(windowKey * SYBIL_CONFIG.TIMING_WINDOW_MS),
          severity: correlatedWindows >= 10 ? 'CRITICAL' : 'HIGH',
          evidence: `${authors.length} accounts acted together in ${correlatedWindows} different time windows`,
        })
      }
    }
  })

  return suspiciousCorrelations
}

// ============================================================
// HEURISTIC 7: Wallet Clustering Detection
// ============================================================
// Detects wallets funded from the same source (on-chain analysis)

export async function detectWalletClustering(identities, provider) {
  /**
   * @param identities - Array of { username, address }
   * @param provider - Ethers provider for on-chain queries
   * @returns Array of { cluster, fundingSource, accounts, severity }
   */

  if (!provider) {
    console.warn('No provider available for wallet clustering detection')
    return []
  }

  const suspiciousClusters = []
  const fundingSources = new Map() // fundingAddress -> [funded wallets]

  // Analyze first incoming transaction for each wallet
  // This reveals who funded each wallet initially
  for (const identity of identities) {
    try {
      const address = identity.address
      if (!address) continue

      // Get transaction history (first 10 incoming txs)
      // Note: This requires an archive node or indexer API like Etherscan
      const history = await getWalletFundingHistory(address, provider)

      if (history.length > 0) {
        // First funder is most significant
        const firstFunder = history[0].from

        if (!fundingSources.has(firstFunder)) {
          fundingSources.set(firstFunder, [])
        }
        fundingSources.get(firstFunder).push({
          username: identity.username,
          address: address,
          fundedAt: history[0].timestamp,
          amount: history[0].value,
        })
      }
    } catch (err) {
      // Skip wallets we can't analyze
      console.warn(`Could not analyze wallet ${identity.address}:`, err.message)
    }
  }

  // Find clusters (same funder → multiple wallets)
  fundingSources.forEach((fundedWallets, funderAddress) => {
    if (fundedWallets.length >= 3) {
      // Check if funding happened in a burst
      const timestamps = fundedWallets.map(w => w.fundedAt).sort()
      const timeSpan = timestamps[timestamps.length - 1] - timestamps[0]
      const isBurstFunding = timeSpan < 86400 // All funded within 24 hours

      suspiciousClusters.push({
        fundingSource: funderAddress,
        fundingSourceShort: `${funderAddress.slice(0, 6)}...${funderAddress.slice(-4)}`,
        accounts: fundedWallets.map(w => w.username),
        addresses: fundedWallets.map(w => w.address),
        count: fundedWallets.length,
        isBurstFunding,
        timeSpanHours: Math.round(timeSpan / 3600),
        totalFunded: fundedWallets.reduce((sum, w) => sum + parseFloat(w.amount || 0), 0),
        severity: fundedWallets.length >= 10 ? 'CRITICAL' : (fundedWallets.length >= 5 ? 'HIGH' : 'MEDIUM'),
        evidence: `${fundedWallets.length} wallets funded by same address${isBurstFunding ? ' within 24 hours' : ''}`,
      })
    }
  })

  return suspiciousClusters
}

// Helper: Get wallet funding history (requires indexer or archive node)
async function getWalletFundingHistory(address, provider) {
  /**
   * Returns array of { from, value, timestamp, txHash }
   *
   * In production, use:
   * - Etherscan API: api.etherscan.io/api?module=account&action=txlist
   * - Alchemy: alchemy.com/enhanced-apis
   * - The Graph: custom subgraph
   *
   * This is a placeholder that returns empty for now.
   * Real implementation would query transaction history.
   */

  // TODO: Implement with actual indexer API
  // Example with Etherscan:
  // const response = await fetch(
  //   `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${ETHERSCAN_API_KEY}`
  // )
  // const data = await response.json()
  // return data.result.filter(tx => tx.to.toLowerCase() === address.toLowerCase()).slice(0, 10)

  return []
}

// ============================================================
// HEURISTIC 8: Wallet Balance Pattern Detection
// ============================================================
// Detects wallets with identical or suspicious balance patterns

export async function detectBalancePatterns(identities, provider) {
  /**
   * @param identities - Array of { username, address }
   * @param provider - Ethers provider
   * @returns Array of suspicious patterns
   */

  if (!provider) return []

  const balances = []
  const suspiciousPatterns = []

  // Get balances for all wallets
  for (const identity of identities) {
    try {
      if (!identity.address) continue
      const balance = await provider.getBalance(identity.address)
      balances.push({
        username: identity.username,
        address: identity.address,
        balance: balance.toString(),
        balanceEth: parseFloat(balance.toString()) / 1e18,
      })
    } catch (err) {
      // Skip failed queries
    }
  }

  // Detect identical balances (suspicious)
  const balanceGroups = new Map()
  balances.forEach(b => {
    // Round to 6 decimals to catch near-identical
    const rounded = Math.round(b.balanceEth * 1000000) / 1000000
    const key = rounded.toString()
    if (!balanceGroups.has(key)) {
      balanceGroups.set(key, [])
    }
    balanceGroups.get(key).push(b)
  })

  balanceGroups.forEach((group, balanceKey) => {
    // Ignore zero balances (common) and very small groups
    if (parseFloat(balanceKey) === 0 || group.length < 3) return

    suspiciousPatterns.push({
      pattern: 'identical_balance',
      balance: parseFloat(balanceKey),
      accounts: group.map(g => g.username),
      addresses: group.map(g => g.address),
      count: group.length,
      severity: group.length >= 10 ? 'CRITICAL' : 'MEDIUM',
      evidence: `${group.length} wallets have identical balance of ${balanceKey} ETH`,
    })
  })

  // Detect "dust + small amount" pattern (common Sybil funding pattern)
  const dustPattern = balances.filter(b =>
    b.balanceEth > 0.001 && b.balanceEth < 0.01
  )
  if (dustPattern.length >= 5) {
    suspiciousPatterns.push({
      pattern: 'dust_funding',
      accounts: dustPattern.map(d => d.username),
      addresses: dustPattern.map(d => d.address),
      count: dustPattern.length,
      severity: 'MEDIUM',
      evidence: `${dustPattern.length} wallets have minimal "dust" funding (0.001-0.01 ETH)`,
    })
  }

  return suspiciousPatterns
}

// ============================================================
// HEURISTIC 9: Trust Chain Analysis
// ============================================================
// Uses the Web of Trust to identify users outside the trust network

export function detectTrustChainIssues(identities, trustGraph) {
  /**
   * @param identities - Array of { username }
   * @param trustGraph - Trust graph from trustChain.js
   * @returns Array of { username, issue, severity }
   */

  if (!trustGraph || !trustGraph.trustScores) {
    return []
  }

  const issues = []

  identities.forEach(identity => {
    const trustData = trustGraph.trustScores[identity.username]

    if (!trustData) {
      // Not in trust network at all
      issues.push({
        username: identity.username,
        issue: 'NO_TRUST_CHAIN',
        severity: 'MEDIUM',
        evidence: 'User has no connection to the trust network',
        trustScore: 0,
        recommendation: 'Request vouch from trusted community members',
      })
    } else if (trustData.score < 0.3 && !trustData.isFounder) {
      // Low trust score
      issues.push({
        username: identity.username,
        issue: 'LOW_TRUST_SCORE',
        severity: 'LOW',
        evidence: `Trust score ${Math.round(trustData.score * 100)}% - ${trustData.hopsFromFounder} hops from founder`,
        trustScore: trustData.score,
        trustChain: trustData.trustChain,
        recommendation: 'Build more trust relationships with established members',
      })
    }

    // Check for isolated trust clusters (potential Sybil rings)
    if (trustData && trustData.trustedBy.length >= 2) {
      const voucherScores = trustData.trustedBy.map(voucher => {
        const voucherData = trustGraph.trustScores[voucher]
        return voucherData?.score || 0
      })
      const avgVoucherScore = voucherScores.reduce((a, b) => a + b, 0) / voucherScores.length

      if (avgVoucherScore < 0.3 && trustData.score > 0) {
        issues.push({
          username: identity.username,
          issue: 'SYBIL_RING_SUSPECT',
          severity: 'HIGH',
          evidence: `Vouched by ${trustData.trustedBy.length} low-trust users (avg score: ${Math.round(avgVoucherScore * 100)}%)`,
          trustedBy: trustData.trustedBy,
          avgVoucherScore,
          recommendation: 'Investigate possible coordinated Sybil ring',
        })
      }
    }
  })

  return issues
}

// ============================================================
// MASTER DETECTION FUNCTION
// ============================================================
// Runs all heuristics and returns comprehensive report

export async function runSybilDetection(contributions, identities, upvoteGraph = null, provider = null, trustGraph = null) {
  /**
   * @param contributions - All contributions
   * @param identities - All identities
   * @param upvoteGraph - Optional upvote relationship data
   * @param provider - Optional ethers provider for on-chain analysis
   * @returns { summary, detections, riskScore }
   */

  // Run off-chain heuristics (instant)
  const detections = {
    upvoteRings: detectUpvoteRings(contributions, upvoteGraph),
    burstCreation: detectBurstCreation(identities),
    newAccountSpam: detectNewAccountSpam(contributions, identities),
    sequentialUsernames: detectSequentialUsernames(identities),
    similarContent: detectSimilarContent(contributions),
    timingCorrelation: detectTimingCorrelation(contributions),
    // Trust chain heuristics
    trustChainIssues: trustGraph ? detectTrustChainIssues(identities, trustGraph) : [],
    // On-chain heuristics (require provider)
    walletClustering: [],
    balancePatterns: [],
  }

  // Run on-chain heuristics if provider available
  if (provider) {
    try {
      detections.walletClustering = await detectWalletClustering(identities, provider)
      detections.balancePatterns = await detectBalancePatterns(identities, provider)
    } catch (err) {
      console.error('On-chain Sybil detection failed:', err)
    }
  }

  // Calculate overall risk score
  let criticalCount = 0
  let highCount = 0
  let mediumCount = 0

  Object.values(detections).forEach(results => {
    results.forEach(result => {
      if (result.severity === 'CRITICAL') criticalCount++
      if (result.severity === 'HIGH') highCount++
      if (result.severity === 'MEDIUM') mediumCount++
    })
  })

  const riskScore = Math.min(100, criticalCount * 30 + highCount * 15 + mediumCount * 5)

  let riskLevel = 'LOW'
  if (riskScore >= 70) riskLevel = 'CRITICAL'
  else if (riskScore >= 40) riskLevel = 'HIGH'
  else if (riskScore >= 20) riskLevel = 'MEDIUM'

  return {
    summary: {
      riskScore,
      riskLevel,
      criticalIssues: criticalCount,
      highIssues: highCount,
      mediumIssues: mediumCount,
      totalIssues: criticalCount + highCount + mediumCount,
    },
    detections,
    recommendations: generateRecommendations(detections),
  }
}

// ============================================================
// RECOMMENDATIONS GENERATOR
// ============================================================

function generateRecommendations(detections) {
  const recommendations = []

  if (detections.upvoteRings.length > 0) {
    recommendations.push({
      priority: 'CRITICAL',
      action: 'Investigate upvote rings',
      description: 'Accounts are upvoting each other in a closed loop. Consider penalizing ring participants or requiring diverse upvote sources.',
      affectedAccounts: detections.upvoteRings.flatMap(r => r.accounts),
    })
  }

  if (detections.burstCreation.length > 0) {
    recommendations.push({
      priority: 'HIGH',
      action: 'Add account creation rate limits',
      description: 'Many accounts created in short windows. Implement IP-based or device-based rate limiting.',
      affectedAccounts: detections.burstCreation.flatMap(r => r.accounts),
    })
  }

  if (detections.newAccountSpam.length > 0) {
    recommendations.push({
      priority: 'MEDIUM',
      action: 'Implement reputation aging',
      description: 'New accounts submitting high-value content. Require 7-30 day account age before earning full rewards.',
      affectedAccounts: detections.newAccountSpam.map(r => r.username),
    })
  }

  if (detections.sequentialUsernames.length > 0) {
    recommendations.push({
      priority: 'HIGH',
      action: 'Block sequential username patterns',
      description: 'Detected Bot1, Bot2, Bot3... patterns. Add username pattern detection during registration.',
      affectedAccounts: detections.sequentialUsernames.flatMap(r => r.accounts),
    })
  }

  if (detections.similarContent.length > 0) {
    recommendations.push({
      priority: 'MEDIUM',
      action: 'Add content deduplication',
      description: 'Near-duplicate content from different authors. Implement similarity check before accepting contributions.',
      affectedContributions: detections.similarContent.map(r => [r.contrib1.id, r.contrib2.id]).flat(),
    })
  }

  if (detections.timingCorrelation.length > 0) {
    recommendations.push({
      priority: 'HIGH',
      action: 'Investigate synchronized accounts',
      description: 'Multiple accounts acting in perfect synchrony. Likely controlled by same operator.',
      affectedAccounts: detections.timingCorrelation.flatMap(r => r.accounts),
    })
  }

  if (detections.walletClustering && detections.walletClustering.length > 0) {
    recommendations.push({
      priority: 'CRITICAL',
      action: 'Investigate wallet clusters',
      description: 'Multiple wallets funded from the same source address. Strong indicator of Sybil attack.',
      affectedAccounts: detections.walletClustering.flatMap(r => r.accounts),
      fundingSources: detections.walletClustering.map(r => r.fundingSource),
    })
  }

  if (detections.balancePatterns && detections.balancePatterns.length > 0) {
    recommendations.push({
      priority: 'MEDIUM',
      action: 'Review identical balance wallets',
      description: 'Multiple wallets with identical balances. May indicate automated funding.',
      affectedAccounts: detections.balancePatterns.flatMap(r => r.accounts),
    })
  }

  if (detections.trustChainIssues && detections.trustChainIssues.length > 0) {
    const sybilRingSuspects = detections.trustChainIssues.filter(i => i.issue === 'SYBIL_RING_SUSPECT')
    const noTrustChain = detections.trustChainIssues.filter(i => i.issue === 'NO_TRUST_CHAIN')

    if (sybilRingSuspects.length > 0) {
      recommendations.push({
        priority: 'CRITICAL',
        action: 'Investigate Sybil ring suspects',
        description: 'Users vouched only by low-trust accounts. Likely coordinated fake identities.',
        affectedAccounts: sybilRingSuspects.map(r => r.username),
      })
    }

    if (noTrustChain.length > 5) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Encourage trust network growth',
        description: `${noTrustChain.length} users outside trust network. Consider outreach or requiring vouches for governance.`,
        affectedAccounts: noTrustChain.map(r => r.username),
      })
    }
  }

  return recommendations
}

// ============================================================
// EXPORT FOR TESTING
// ============================================================

export default {
  SYBIL_CONFIG,
  detectUpvoteRings,
  detectBurstCreation,
  detectNewAccountSpam,
  detectSequentialUsernames,
  detectSimilarContent,
  detectTimingCorrelation,
  detectWalletClustering,
  detectBalancePatterns,
  detectTrustChainIssues,
  runSybilDetection,
}

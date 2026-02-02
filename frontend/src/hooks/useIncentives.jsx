import { useState, useEffect, createContext, useContext } from 'react'
import { useWallet } from './useWallet'

const IncentivesContext = createContext(null)

// Mock data for incentives - would come from contracts in production
export function IncentivesProvider({ children }) {
  const { isConnected, account } = useWallet()

  // LP Positions with rewards
  const [lpPositions, setLpPositions] = useState([])

  // IL Protection status
  const [ilProtection, setIlProtection] = useState({
    totalCoverage: 0,
    coveragePercent: 0,
    timeToFullCoverage: 0,
    claimableAmount: 0,
    positions: [],
  })

  // Loyalty rewards
  const [loyalty, setLoyalty] = useState({
    currentMultiplier: 1.0,
    maxMultiplier: 2.0,
    daysActive: 0,
    daysToNextTier: 0,
    nextTierMultiplier: 1.0,
    tier: 'Bronze',
  })

  // Shapley rewards breakdown
  const [shapleyRewards, setShapleyRewards] = useState({
    totalEarned: 0,
    pendingClaim: 0,
    breakdown: {
      direct: 0,      // Raw liquidity contribution
      enabling: 0,    // Time in pool
      scarcity: 0,    // Provided scarce side
      stability: 0,   // Stayed during volatility
    },
    recentBatches: [],
  })

  // Slippage guarantee
  const [slippageGuarantee, setSlippageGuarantee] = useState({
    availableProtection: 0,
    usedThisMonth: 0,
    maxMonthly: 0,
    recentClaims: [],
  })

  // Rewards history
  const [rewardsHistory, setRewardsHistory] = useState([])

  // Load mock data when connected
  useEffect(() => {
    if (!isConnected) {
      // Reset to empty state
      setLpPositions([])
      setIlProtection({ totalCoverage: 0, coveragePercent: 0, timeToFullCoverage: 0, claimableAmount: 0, positions: [] })
      setLoyalty({ currentMultiplier: 1.0, maxMultiplier: 2.0, daysActive: 0, daysToNextTier: 0, nextTierMultiplier: 1.0, tier: 'Bronze' })
      setShapleyRewards({ totalEarned: 0, pendingClaim: 0, breakdown: { direct: 0, enabling: 0, scarcity: 0, stability: 0 }, recentBatches: [] })
      setSlippageGuarantee({ availableProtection: 0, usedThisMonth: 0, maxMonthly: 0, recentClaims: [] })
      setRewardsHistory([])
      return
    }

    // Simulate loading user data
    const loadUserData = () => {
      // LP Positions
      setLpPositions([
        {
          id: '1',
          pool: 'ETH/USDC',
          token0: { symbol: 'ETH', logo: '⟠', amount: '2.5' },
          token1: { symbol: 'USDC', logo: '◉', amount: '5000' },
          value: 10000,
          share: 0.042,
          depositedAt: Date.now() - 45 * 24 * 60 * 60 * 1000, // 45 days ago
          earnedFees: 234.56,
          pendingRewards: 45.23,
          ilLoss: -120.50,
          ilCovered: 96.40, // 80% coverage after 45 days
        },
        {
          id: '2',
          pool: 'WBTC/ETH',
          token0: { symbol: 'WBTC', logo: '₿', amount: '0.1' },
          token1: { symbol: 'ETH', logo: '⟠', amount: '2.1' },
          value: 8400,
          share: 0.018,
          depositedAt: Date.now() - 12 * 24 * 60 * 60 * 1000, // 12 days ago
          earnedFees: 89.12,
          pendingRewards: 12.45,
          ilLoss: -45.20,
          ilCovered: 18.08, // 40% coverage after 12 days
        },
      ])

      // IL Protection
      setIlProtection({
        totalCoverage: 114.48,
        coveragePercent: 69, // weighted average
        timeToFullCoverage: 45, // days until oldest position hits 80%
        claimableAmount: 114.48,
        positions: [
          { pool: 'ETH/USDC', coverage: 80, ilLoss: 120.50, covered: 96.40, daysRemaining: 0 },
          { pool: 'WBTC/ETH', coverage: 40, ilLoss: 45.20, covered: 18.08, daysRemaining: 78 },
        ],
      })

      // Loyalty
      setLoyalty({
        currentMultiplier: 1.35,
        maxMultiplier: 2.0,
        daysActive: 45,
        daysToNextTier: 45, // days to next milestone
        nextTierMultiplier: 1.5,
        tier: 'Silver',
        tierProgress: 45, // percentage to next tier
      })

      // Shapley rewards
      setShapleyRewards({
        totalEarned: 567.89,
        pendingClaim: 57.68,
        breakdown: {
          direct: 22.74,      // 40% weight
          enabling: 17.06,    // 30% weight
          scarcity: 11.37,    // 20% weight
          stability: 6.51,    // 10% weight
        },
        recentBatches: [
          { batchId: 1250, earned: 2.34, yourShare: 0.8, totalFees: 292.50, timestamp: Date.now() - 30000 },
          { batchId: 1249, earned: 1.89, yourShare: 0.6, totalFees: 315.00, timestamp: Date.now() - 60000 },
          { batchId: 1248, earned: 3.12, yourShare: 1.1, totalFees: 283.64, timestamp: Date.now() - 90000 },
          { batchId: 1247, earned: 2.01, yourShare: 0.7, totalFees: 287.14, timestamp: Date.now() - 120000 },
          { batchId: 1246, earned: 2.78, yourShare: 0.9, totalFees: 308.89, timestamp: Date.now() - 150000 },
        ],
      })

      // Slippage guarantee
      setSlippageGuarantee({
        availableProtection: 450.00,
        usedThisMonth: 50.00,
        maxMonthly: 500.00,
        recentClaims: [
          { date: Date.now() - 5 * 24 * 60 * 60 * 1000, amount: 12.50, trade: '5 ETH → USDC' },
          { date: Date.now() - 12 * 24 * 60 * 60 * 1000, amount: 37.50, trade: '0.5 WBTC → ETH' },
        ],
      })

      // Rewards history
      setRewardsHistory([
        { type: 'fee', amount: 45.23, token: 'USDC', timestamp: Date.now() - 1000, pool: 'ETH/USDC' },
        { type: 'shapley', amount: 12.34, token: 'USDC', timestamp: Date.now() - 86400000, pool: 'ETH/USDC' },
        { type: 'il_claim', amount: 25.00, token: 'USDC', timestamp: Date.now() - 172800000, pool: 'WBTC/ETH' },
        { type: 'loyalty', amount: 8.50, token: 'VIBE', timestamp: Date.now() - 259200000, pool: null },
        { type: 'fee', amount: 12.45, token: 'ETH', timestamp: Date.now() - 345600000, pool: 'WBTC/ETH' },
      ])
    }

    loadUserData()

    // Simulate periodic updates
    const interval = setInterval(() => {
      setShapleyRewards(prev => ({
        ...prev,
        pendingClaim: prev.pendingClaim + (Math.random() * 0.5),
        breakdown: {
          direct: prev.breakdown.direct + (Math.random() * 0.2),
          enabling: prev.breakdown.enabling + (Math.random() * 0.15),
          scarcity: prev.breakdown.scarcity + (Math.random() * 0.1),
          stability: prev.breakdown.stability + (Math.random() * 0.05),
        },
      }))
    }, 10000)

    return () => clearInterval(interval)
  }, [isConnected, account])

  // Claim rewards action
  const claimRewards = async (type) => {
    // Simulate claiming
    await new Promise(resolve => setTimeout(resolve, 1500))

    if (type === 'shapley') {
      const claimed = shapleyRewards.pendingClaim
      setShapleyRewards(prev => ({
        ...prev,
        totalEarned: prev.totalEarned + prev.pendingClaim,
        pendingClaim: 0,
        breakdown: { direct: 0, enabling: 0, scarcity: 0, stability: 0 },
      }))
      return claimed
    }

    if (type === 'il') {
      const claimed = ilProtection.claimableAmount
      setIlProtection(prev => ({
        ...prev,
        claimableAmount: 0,
      }))
      return claimed
    }

    return 0
  }

  const value = {
    lpPositions,
    ilProtection,
    loyalty,
    shapleyRewards,
    slippageGuarantee,
    rewardsHistory,
    claimRewards,

    // Computed values
    totalValue: lpPositions.reduce((sum, p) => sum + p.value, 0),
    totalPendingRewards: shapleyRewards.pendingClaim + lpPositions.reduce((sum, p) => sum + p.pendingRewards, 0),
    totalEarnedAllTime: shapleyRewards.totalEarned + lpPositions.reduce((sum, p) => sum + p.earnedFees, 0),
  }

  return (
    <IncentivesContext.Provider value={value}>
      {children}
    </IncentivesContext.Provider>
  )
}

export function useIncentives() {
  const context = useContext(IncentivesContext)
  if (!context) {
    throw new Error('useIncentives must be used within an IncentivesProvider')
  }
  return context
}

export default useIncentives

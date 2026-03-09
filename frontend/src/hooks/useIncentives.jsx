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

    // TODO: Load real data from contracts when deployed
    // For now, show empty state — no fake data
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

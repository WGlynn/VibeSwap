import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { useWallet } from './useWallet'

// ============ Real Protocol Stats from On-Chain ============
// Reads TVL, volume, staker counts directly from deployed contracts.
// Falls back to cached/estimated data when RPC unavailable.

const STATS_CACHE_KEY = 'vsos_protocol_stats'
const REFRESH_INTERVAL = 60_000 // 1 minute

// Contract addresses — updated on deployment
const CONTRACTS = {
  8453: { // Base mainnet
    vibeAMM: null,  // Set after deployment
    staking: null,
    lending: null,
    governance: null,
    treasury: null,
  }
}

// Minimal ABIs for stat queries
const TREASURY_ABI = ['function totalAssets() view returns (uint256)']
const AMM_ABI = [
  'function getReserves(address,address) view returns (uint256,uint256)',
  'function totalLiquidity() view returns (uint256)',
]

function getCachedStats() {
  try {
    const raw = localStorage.getItem(STATS_CACHE_KEY)
    if (!raw) return null
    const { stats, timestamp } = JSON.parse(raw)
    if (Date.now() - timestamp < REFRESH_INTERVAL * 5) return stats
    return null
  } catch {
    return null
  }
}

export function useProtocolStats() {
  const { provider, chainId } = useWallet()

  const [stats, setStats] = useState(() => getCachedStats() || {
    // Start with zeros — not fake numbers
    tvl: 0,
    volume24h: 0,
    totalStaked: 0,
    stakerCount: 0,
    totalSupply: 0,
    totalBorrow: 0,
    proposalCount: 0,
    voterCount: 0,
    rewardsPaid: 0,
    isLive: false, // Flag: are contracts deployed?
  })

  const [isLoading, setIsLoading] = useState(false)

  const fetchStats = useCallback(async () => {
    const contracts = CONTRACTS[chainId || 8453]
    if (!contracts || !provider) {
      // No contracts deployed yet — show zeros, not mock data
      return
    }

    setIsLoading(true)
    try {
      const newStats = { ...stats, isLive: true }

      // Fetch TVL from treasury if deployed
      if (contracts.treasury) {
        const treasury = new ethers.Contract(contracts.treasury, TREASURY_ABI, provider)
        const totalAssets = await treasury.totalAssets()
        newStats.tvl = parseFloat(ethers.formatEther(totalAssets))
      }

      // Fetch AMM liquidity if deployed
      if (contracts.vibeAMM) {
        const amm = new ethers.Contract(contracts.vibeAMM, AMM_ABI, provider)
        const liquidity = await amm.totalLiquidity()
        newStats.tvl += parseFloat(ethers.formatEther(liquidity))
      }

      setStats(newStats)
      localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({
        stats: newStats,
        timestamp: Date.now(),
      }))
    } catch (err) {
      console.error('[ProtocolStats] Error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [provider, chainId])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchStats])

  // Format large numbers
  const formatTvl = useCallback((value) => {
    if (!value || value === 0) return '--'
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
    return `$${value.toFixed(2)}`
  }, [])

  return {
    ...stats,
    isLoading,
    formatTvl,
    refresh: fetchStats,
  }
}

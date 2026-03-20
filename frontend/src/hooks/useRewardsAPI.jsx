import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'

// ============ API Path ============
const isVercel = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')
const webPath = (endpoint) => isVercel ? `/jarvis-api/${endpoint}` : `https://jarvis-vibeswap.fly.dev/web/${endpoint}`

// ============ Contract Config ============
const SHAPLEY_ADDRESS = '0x290bC683F242761D513078451154F6BbE1EE18B1'
const VIBE_ADDRESS = '0x56C35BA2c026F7a4ADBe48d55b44652f959279ae'
const BASE_RPC = 'https://mainnet.base.org'

const SHAPLEY_ABI = ['function shapleyValues(bytes32,address) view returns (uint256)']
const VIBE_ABI = ['function balanceOf(address) view returns (uint256)']

/**
 * Hook for the RewardsPage — fetches contribution stats, leaderboard,
 * insights, and on-chain VIBE balance from both the Jarvis API and
 * Base mainnet contracts.
 */
export function useRewardsAPI(walletAddress) {
  const [userStats, setUserStats] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [insights, setInsights] = useState([])
  const [vibeBalance, setVibeBalance] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  // Fetch user stats from Jarvis bot API
  const fetchUserStats = useCallback(async () => {
    if (!walletAddress) return
    try {
      const res = await fetch(webPath(`rewards/stats?wallet=${walletAddress}`), {
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        setUserStats(data)
      }
    } catch {}
  }, [walletAddress])

  // Fetch leaderboard
  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(webPath('rewards/leaderboard'), {
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        setLeaderboard(data.leaderboard || [])
      }
    } catch {}
  }, [])

  // Fetch recent insights
  const fetchInsights = useCallback(async () => {
    try {
      const res = await fetch(webPath('rewards/insights'), {
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        setInsights(data.insights || [])
      }
    } catch {}
  }, [])

  // Fetch on-chain VIBE balance
  const fetchVibeBalance = useCallback(async () => {
    if (!walletAddress) return
    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPC)
      const vibe = new ethers.Contract(VIBE_ADDRESS, VIBE_ABI, provider)
      const balance = await vibe.balanceOf(walletAddress)
      setVibeBalance(ethers.formatEther(balance))
    } catch {
      setVibeBalance('0')
    }
  }, [walletAddress])

  // Fetch all on mount + periodic refresh
  useEffect(() => {
    const fetchAll = async () => {
      setIsLoading(true)
      await Promise.all([
        fetchUserStats(),
        fetchLeaderboard(),
        fetchInsights(),
        fetchVibeBalance(),
      ])
      setIsLoading(false)
    }

    fetchAll()
    const interval = setInterval(fetchAll, 60_000)
    return () => clearInterval(interval)
  }, [fetchUserStats, fetchLeaderboard, fetchInsights, fetchVibeBalance])

  return {
    userStats,
    leaderboard,
    insights,
    vibeBalance,
    isLoading,
    error,
    refresh: () => Promise.all([fetchUserStats(), fetchLeaderboard(), fetchInsights(), fetchVibeBalance()]),
  }
}

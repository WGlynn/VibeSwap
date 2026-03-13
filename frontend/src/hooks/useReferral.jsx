import { useState, useMemo, useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'

// ============================================================
// useReferral — Referral program state & tier logic
// Tier progression, earnings tracking, referral link generation
// ============================================================

const TIERS = [
  { name: 'Bronze', minRefs: 0, rebate: 10, color: '#cd7f32' },
  { name: 'Silver', minRefs: 5, rebate: 15, color: '#c0c0c0' },
  { name: 'Gold', minRefs: 20, rebate: 20, color: '#ffd700' },
  { name: 'Diamond', minRefs: 50, rebate: 30, color: '#b9f2ff' },
]

const MOCK_REFERRALS = [
  { address: '0xabcd...1234', joined: '2026-03-10', volume: 45200, earnings: 22.60 },
  { address: '0xef01...5678', joined: '2026-03-08', volume: 128000, earnings: 64.00 },
  { address: '0x9876...abcd', joined: '2026-03-05', volume: 8500, earnings: 4.25 },
  { address: '0xdead...beef', joined: '2026-02-28', volume: 250000, earnings: 125.00 },
  { address: '0xcafe...babe', joined: '2026-02-20', volume: 67000, earnings: 33.50 },
  { address: '0xf00d...1337', joined: '2026-02-15', volume: 192000, earnings: 96.00 },
]

export function useReferral(userAddress) {
  const [claimedAmount, setClaimedAmount] = useLocalStorage('vibeswap-referral-claimed', 0)

  const referralCode = useMemo(
    () => userAddress ? userAddress.slice(0, 8) : 'connect',
    [userAddress]
  )

  const referralLink = `vibeswap.io/ref/${referralCode}`

  const referrals = MOCK_REFERRALS

  const stats = useMemo(() => {
    const totalVolume = referrals.reduce((s, r) => s + r.volume, 0)
    const totalEarnings = referrals.reduce((s, r) => s + r.earnings, 0)
    const pending = totalEarnings - claimedAmount
    return {
      count: referrals.length,
      totalVolume,
      totalEarnings,
      pending: Math.max(0, pending),
    }
  }, [referrals, claimedAmount])

  const currentTier = useMemo(
    () => [...TIERS].reverse().find((t) => stats.count >= t.minRefs) || TIERS[0],
    [stats.count]
  )

  const nextTier = useMemo(
    () => TIERS.find((t) => t.minRefs > stats.count) || null,
    [stats.count]
  )

  const claim = useCallback(() => {
    setClaimedAmount(stats.totalEarnings)
  }, [stats.totalEarnings, setClaimedAmount])

  return {
    referralCode,
    referralLink,
    referrals,
    stats,
    currentTier,
    nextTier,
    tiers: TIERS,
    claim,
  }
}

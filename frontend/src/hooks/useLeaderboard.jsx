import { useState, useMemo, useCallback } from 'react'

// ============================================================
// useLeaderboard — Trading leaderboard data & ranking logic
// Period-based sorting, PnL calculation, reward tiers
// ============================================================

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

const ADDRESSES = [
  '0x1234...5678', '0xabcd...ef01', '0x9876...5432', '0xdead...beef',
  '0xcafe...babe', '0xf00d...0000', '0x4242...1337', '0xface...d00d',
  '0xbeef...cafe', '0x0000...ffff', '0x7777...8888', '0xaaaa...bbbb',
  '0xcccc...dddd', '0xeeee...1111', '0x2222...3333',
]

function generateTraders(period, seed) {
  const rng = seededRandom(seed)
  return ADDRESSES.map((addr, i) => {
    const volumeBase = period === '24h' ? 50000 : period === '7d' ? 250000 : period === '30d' ? 1000000 : 5000000
    const volume = volumeBase * (1 + rng() * 4) * (1 - i * 0.04)
    const pnl = volume * (rng() * 0.3 - 0.05)
    const trades = Math.floor((period === '24h' ? 5 : period === '7d' ? 30 : period === '30d' ? 100 : 500) * (1 + rng() * 3))
    const winRate = 45 + rng() * 30

    return {
      rank: i + 1,
      address: addr,
      volume,
      pnl,
      trades,
      winRate,
      rewardTier: i < 3 ? 'gold' : i < 10 ? 'silver' : 'bronze',
    }
  }).sort((a, b) => b.volume - a.volume).map((t, i) => ({ ...t, rank: i + 1 }))
}

const PERIODS = ['24h', '7d', '30d', 'all']

export function useLeaderboard() {
  const [period, setPeriod] = useState('7d')

  const traders = useMemo(() => {
    const seedMap = { '24h': 101, '7d': 202, '30d': 303, all: 404 }
    return generateTraders(period, seedMap[period] || 202)
  }, [period])

  const stats = useMemo(() => ({
    totalTraders: 2847 + Math.floor(period === '24h' ? 0 : period === '7d' ? 500 : 2000),
    totalVolume: traders.reduce((sum, t) => sum + t.volume, 0),
    avgPnl: traders.reduce((sum, t) => sum + t.pnl, 0) / traders.length,
    topPnl: Math.max(...traders.map((t) => t.pnl)),
  }), [traders, period])

  const getUserRank = useCallback((address) => {
    const trader = traders.find((t) => t.address === address)
    return trader || { rank: Math.floor(Math.random() * 500) + 50, volume: 12500, pnl: 850, trades: 24, winRate: 58 }
  }, [traders])

  return {
    traders,
    period,
    setPeriod,
    periods: PERIODS,
    stats,
    getUserRank,
  }
}

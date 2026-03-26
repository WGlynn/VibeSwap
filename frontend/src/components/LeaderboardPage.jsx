import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease } }),
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Mock Data ============

function generateAddress(rng) {
  const hex = '0123456789abcdef'
  let addr = '0x'
  for (let i = 0; i < 40; i++) addr += hex[Math.floor(rng() * 16)]
  return addr
}

function shortenAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function generateTraders(period) {
  const seedMap = { '24h': 1337, '7d': 2674, '30d': 5348, 'All': 10696 }
  const rng = seededRandom(seedMap[period] || 1337)
  const volScale = period === '24h' ? 1 : period === '7d' ? 5 : period === '30d' ? 18 : 60

  return Array.from({ length: 15 }, (_, i) => {
    const addr = generateAddress(rng)
    const volume = Math.round((800_000 - i * 42_000 + rng() * 120_000) * volScale)
    const pnl = Math.round((rng() - 0.25) * volume * 0.08)
    const winRate = Math.round(48 + rng() * 32)
    const trades = Math.round((120 - i * 6 + rng() * 40) * volScale * 0.15)
    return { rank: i + 1, address: addr, pnl, volume, winRate, trades }
  })
}

function generateLPs(period) {
  const seedMap = { '24h': 4242, '7d': 8484, '30d': 16968, 'All': 33936 }
  const rng = seededRandom(seedMap[period] || 4242)
  const scale = period === '24h' ? 1 : period === '7d' ? 3 : period === '30d' ? 8 : 24

  return Array.from({ length: 10 }, (_, i) => {
    const addr = generateAddress(rng)
    const tvl = Math.round((2_200_000 - i * 160_000 + rng() * 400_000) * (0.5 + scale * 0.05))
    const fees = Math.round(tvl * (0.002 + rng() * 0.006))
    const pools = Math.floor(2 + rng() * 6)
    const days = Math.floor(14 + rng() * 180)
    return { rank: i + 1, address: addr, tvl, fees, pools, days }
  })
}

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function fmtSigned(n) {
  const prefix = n >= 0 ? '+' : ''
  return prefix + fmt(n)
}

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

const RANK_COLORS = {
  1: { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.25)', text: '#eab308', label: 'gold' },
  2: { bg: 'rgba(156,163,175,0.12)', border: 'rgba(156,163,175,0.25)', text: '#9ca3af', label: 'silver' },
  3: { bg: 'rgba(180,83,9,0.12)', border: 'rgba(180,83,9,0.25)', text: '#b45309', label: 'bronze' },
}

function RankBadge({ rank }) {
  const medal = RANK_COLORS[rank]
  if (medal) {
    return (
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold"
        style={{ background: medal.bg, border: `1px solid ${medal.border}`, color: medal.text }}
      >
        {rank}
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono text-black-500" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {rank}
    </div>
  )
}

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

export default function LeaderboardPage() {
  const [period, setPeriod] = useState('7d')
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const traders = useMemo(() => generateTraders(period), [period])
  const lps = useMemo(() => generateLPs(period), [period])

  const totalTraders = useMemo(() => {
    const rng = seededRandom(7777)
    return Math.round(3_420 + rng() * 1_200)
  }, [])
  const totalVolume = useMemo(() => traders.reduce((s, t) => s + t.volume, 0), [traders])
  const avgPnl = useMemo(() => {
    const sum = traders.reduce((s, t) => s + t.pnl, 0)
    return Math.round(sum / traders.length)
  }, [traders])
  const topPnl = useMemo(() => Math.max(...traders.map((t) => t.pnl)), [traders])

  // Mock user ranking
  const userRank = 142
  const userVolume = 84_320
  const userPnl = 2_140

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title="Leaderboard"
        subtitle="Top traders and liquidity providers ranked by performance"
        category="trading"
        badge="Live"
        badgeColor={CYAN}
      >
        <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
          {['24h', '7d', '30d', 'All'].map((r) => (
            <button
              key={r}
              onClick={() => setPeriod(r)}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                period === r ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'
              }`}
            >
              {r === 'All' ? 'All Time' : r}
            </button>
          ))}
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4 space-y-6">

        {/* ============ Stats Row ============ */}
        <Section index={0} title="Overview" subtitle="Aggregate trading statistics for the current period">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total Traders', value: fmtNum(totalTraders), color: CYAN },
              { label: 'Total Volume', value: fmt(totalVolume), color: '#22c55e' },
              { label: 'Average PnL', value: fmtSigned(avgPnl), color: avgPnl >= 0 ? '#22c55e' : '#ef4444' },
              { label: 'Top PnL', value: fmtSigned(topPnl), color: '#eab308' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                custom={i}
                variants={cardV}
                initial="hidden"
                animate="visible"
                className="text-center rounded-xl p-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="text-[10px] font-mono text-black-500 mb-1 uppercase tracking-wider">{stat.label}</div>
                <div className="text-lg font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ============ Top Traders Table ============ */}
        <Section index={1} title="Top Traders" subtitle={`Ranked by PnL — ${period === 'All' ? 'All Time' : period}`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Rank', 'Address', 'PnL', 'Volume', 'Win Rate', 'Trades'].map((h) => (
                    <th
                      key={h}
                      className={`pb-3 text-[10px] font-mono text-black-500 uppercase tracking-wider font-medium ${
                        h === 'Rank' || h === 'Address' ? 'text-left' : 'text-right'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {traders.map((t, i) => {
                  const isTop3 = t.rank <= 3
                  const rankStyle = RANK_COLORS[t.rank]
                  return (
                    <motion.tr
                      key={t.address}
                      custom={i}
                      variants={cardV}
                      initial="hidden"
                      animate="visible"
                      className="group transition-colors"
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: isTop3 ? (rankStyle?.bg || 'transparent') : 'transparent',
                      }}
                    >
                      <td className="py-3 pr-3">
                        <RankBadge rank={t.rank} />
                      </td>
                      <td className="py-3 pr-3">
                        <span className="text-[11px] font-mono text-black-300 group-hover:text-white transition-colors">
                          {shortenAddr(t.address)}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className={`text-[11px] font-mono font-semibold ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {fmtSigned(t.pnl)}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className="text-[11px] font-mono text-black-300">{fmt(t.volume)}</span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className={`text-[11px] font-mono ${t.winRate >= 55 ? 'text-green-400' : t.winRate >= 45 ? 'text-black-300' : 'text-red-400'}`}>
                          {t.winRate}%
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-[11px] font-mono text-black-400">{fmtNum(t.trades)}</span>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ============ Top LPs Table ============ */}
        <Section index={2} title="Top Liquidity Providers" subtitle={`Ranked by TVL provided — ${period === 'All' ? 'All Time' : period}`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Rank', 'Address', 'TVL Provided', 'Fees Earned', 'Pools Active', 'Days in Pools'].map((h) => (
                    <th
                      key={h}
                      className={`pb-3 text-[10px] font-mono text-black-500 uppercase tracking-wider font-medium ${
                        h === 'Rank' || h === 'Address' ? 'text-left' : 'text-right'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lps.map((lp, i) => {
                  const isTop3 = lp.rank <= 3
                  const rankStyle = RANK_COLORS[lp.rank]
                  return (
                    <motion.tr
                      key={lp.address}
                      custom={i}
                      variants={cardV}
                      initial="hidden"
                      animate="visible"
                      className="group transition-colors"
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: isTop3 ? (rankStyle?.bg || 'transparent') : 'transparent',
                      }}
                    >
                      <td className="py-3 pr-3">
                        <RankBadge rank={lp.rank} />
                      </td>
                      <td className="py-3 pr-3">
                        <span className="text-[11px] font-mono text-black-300 group-hover:text-white transition-colors">
                          {shortenAddr(lp.address)}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className="text-[11px] font-mono text-white font-semibold">{fmt(lp.tvl)}</span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className="text-[11px] font-mono text-green-400">{fmt(lp.fees)}</span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className="text-[11px] font-mono text-black-300">{lp.pools}</span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-[11px] font-mono text-black-400">{lp.days}d</span>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ============ Your Ranking ============ */}
        <Section index={3} title="Your Ranking" subtitle="Personal performance in the current period">
          {isConnected ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <motion.div
                custom={0}
                variants={cardV}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-5 text-center"
                style={{ background: 'rgba(6,182,212,0.06)', border: `1px solid rgba(6,182,212,0.15)` }}
              >
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Your Rank</div>
                <div className="text-3xl font-bold font-mono" style={{ color: CYAN }}>#{userRank}</div>
                <div className="text-[10px] font-mono text-black-500 mt-1">of {fmtNum(totalTraders)} traders</div>
              </motion.div>
              <motion.div
                custom={1}
                variants={cardV}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-5 text-center"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Your Volume</div>
                <div className="text-2xl font-bold font-mono text-white">{fmt(userVolume)}</div>
                <div className="text-[10px] font-mono text-black-500 mt-1">lifetime traded</div>
              </motion.div>
              <motion.div
                custom={2}
                variants={cardV}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-5 text-center"
                style={{ background: userPnl >= 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${userPnl >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}` }}
              >
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Your PnL</div>
                <div className={`text-2xl font-bold font-mono ${userPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmtSigned(userPnl)}
                </div>
                <div className="text-[10px] font-mono text-black-500 mt-1">realized profit</div>
              </motion.div>
            </div>
          ) : (
            <motion.div
              custom={0}
              variants={cardV}
              initial="hidden"
              animate="visible"
              className="rounded-xl p-8 text-center"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="text-[11px] font-mono text-black-500 mb-2">
                Sign in to see your ranking
              </div>
              <div className="text-[10px] font-mono text-black-600">
                Track your PnL, volume, and position on the leaderboard
              </div>
            </motion.div>
          )}
        </Section>

        {/* ============ Rewards Info ============ */}
        <Section index={4} title="Epoch Rewards" subtitle="Incentives for top performers each trading epoch">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <motion.div
              custom={0}
              variants={cardV}
              initial="hidden"
              animate="visible"
              className="rounded-xl p-5"
              style={{ background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.12)' }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-mono font-bold shrink-0"
                  style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308' }}
                >
                  T
                </div>
                <div>
                  <div className="text-[11px] font-mono font-semibold text-white mb-1">Trader Rewards</div>
                  <div className="text-[10px] font-mono text-black-400 leading-relaxed">
                    Top 10 traders each epoch earn bonus VIBE rewards proportional to their volume and PnL.
                    Rewards are distributed via Shapley attribution to ensure fair allocation based on marginal contribution.
                  </div>
                  <div className="mt-3 flex gap-4">
                    <div>
                      <div className="text-[10px] font-mono text-black-500">Pool Size</div>
                      <div className="text-[11px] font-mono font-bold text-yellow-400">50,000 VIBE</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-black-500">Epoch Length</div>
                      <div className="text-[11px] font-mono font-bold text-yellow-400">7 days</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-black-500">Next Epoch</div>
                      <div className="text-[11px] font-mono font-bold text-yellow-400">3d 14h</div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              custom={1}
              variants={cardV}
              initial="hidden"
              animate="visible"
              className="rounded-xl p-5"
              style={{ background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.12)' }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-mono font-bold shrink-0"
                  style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}
                >
                  L
                </div>
                <div>
                  <div className="text-[11px] font-mono font-semibold text-white mb-1">LP Rewards</div>
                  <div className="text-[10px] font-mono text-black-400 leading-relaxed">
                    Top 10 liquidity providers earn bonus VIBE for sustained TVL and pool diversity.
                    Longer time in pools earns a loyalty multiplier up to 2x on base rewards.
                  </div>
                  <div className="mt-3 flex gap-4">
                    <div>
                      <div className="text-[10px] font-mono text-black-500">Pool Size</div>
                      <div className="text-[11px] font-mono font-bold text-purple-400">75,000 VIBE</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-black-500">Loyalty Max</div>
                      <div className="text-[11px] font-mono font-bold text-purple-400">2.0x</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-black-500">Min TVL</div>
                      <div className="text-[11px] font-mono font-bold text-purple-400">$1,000</div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Reward tiers breakdown */}
          <div className="mt-5">
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-3">Reward Distribution by Rank</div>
            <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
              {[
                { rank: 1, pct: 25, color: '#eab308' },
                { rank: 2, pct: 18, color: '#9ca3af' },
                { rank: 3, pct: 14, color: '#b45309' },
                { rank: 4, pct: 10, color: CYAN },
                { rank: 5, pct: 8, color: CYAN },
                { rank: 6, pct: 7, color: CYAN },
                { rank: 7, pct: 6, color: CYAN },
                { rank: 8, pct: 5, color: CYAN },
                { rank: 9, pct: 4, color: CYAN },
                { rank: 10, pct: 3, color: CYAN },
              ].map((tier) => (
                <motion.div
                  key={tier.rank}
                  custom={tier.rank}
                  variants={cardV}
                  initial="hidden"
                  animate="visible"
                  className="rounded-lg p-2 text-center"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="text-[10px] font-mono font-bold" style={{ color: tier.color }}>#{tier.rank}</div>
                  <div className="text-[10px] font-mono text-black-400 mt-0.5">{tier.pct}%</div>
                </motion.div>
              ))}
            </div>
          </div>
        </Section>

        {/* ============ How Ranking Works ============ */}
        <Section index={5} title="How Rankings Work" subtitle="Transparent, on-chain, verifiable ranking methodology">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: 'PnL Weighted',
                desc: 'Trader rankings weight realized PnL at 50%, volume at 30%, and win rate at 20%. Only closed positions count.',
                metric: '50/30/20',
                metricLabel: 'Weight Split',
              },
              {
                title: 'TVL + Duration',
                desc: 'LP rankings use time-weighted TVL. Providing $100K for 30 days ranks higher than $300K for 1 day. Consistency matters.',
                metric: 'TWA',
                metricLabel: 'Time-Weighted Average',
              },
              {
                title: 'Anti-Gaming',
                desc: 'Wash trading detection via commit-reveal batching. Self-trades in the same batch are identified and excluded from rankings.',
                metric: '0%',
                metricLabel: 'Wash Trade Credit',
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                custom={i}
                variants={cardV}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="text-[11px] font-mono font-semibold text-white mb-2">{item.title}</div>
                <div className="text-[10px] font-mono text-black-400 leading-relaxed mb-3">{item.desc}</div>
                <div className="pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="text-[10px] font-mono text-black-500">{item.metricLabel}</div>
                  <div className="text-sm font-bold font-mono" style={{ color: CYAN }}>{item.metric}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>

      </div>
    </div>
  )
}

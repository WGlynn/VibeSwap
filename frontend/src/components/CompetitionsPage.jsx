import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
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

// ============ Helpers ============

function generateAddress(rng) {
  const hex = '0123456789abcdef'
  let addr = '0x'
  for (let i = 0; i < 40; i++) addr += hex[Math.floor(rng() * 16)]
  return addr
}

function shortenAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function fmtJul(n) {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K JUL`
  return `${n.toLocaleString()} JUL`
}

function rankMedal(rank) {
  if (rank === 1) return { symbol: '\u{1F947}', color: '#fbbf24' }
  if (rank === 2) return { symbol: '\u{1F948}', color: '#94a3b8' }
  if (rank === 3) return { symbol: '\u{1F949}', color: '#d97706' }
  return null
}

// ============ Mock Data ============

const ACTIVE_COMPETITION = {
  name: 'March Madness', description: 'Highest PnL% over 2 weeks wins the grand prize. All pairs eligible.',
  prizePool: 250_000, startDate: '2026-03-01', endDate: '2026-03-15',
  participants: 1847, maxParticipants: 5000, entryFee: 0,
}

// ============ Mock Data: Leaderboard ============

function generateLeaderboard() {
  const rng = seededRandom(3141)
  return Array.from({ length: 15 }, (_, i) => {
    const addr = generateAddress(rng)
    const pnlPct = Math.round((45 - i * 2.8 + (rng() - 0.3) * 12) * 100) / 100
    const volume = Math.round(420_000 - i * 22_000 + rng() * 80_000)
    const trades = Math.round(180 - i * 8 + rng() * 50)
    const prizeAlloc = i === 0 ? 75_000 : i === 1 ? 45_000 : i === 2 ? 25_000
      : i < 10 ? Math.round(15_000 / 7 * (1 - (i - 3) * 0.08)) : 0
    return { rank: i + 1, address: addr, pnlPct, volume, trades, prizeAlloc }
  })
}

const LEADERBOARD = generateLeaderboard()

// ============ Mock Data: Prize Structure ============

const PRIZE_TIERS = [
  { place: '1st Place', jul: 75_000, pct: 30, badge: 'Champion', badgeColor: '#fbbf24' },
  { place: '2nd Place', jul: 45_000, pct: 18, badge: 'Runner-Up', badgeColor: '#94a3b8' },
  { place: '3rd Place', jul: 25_000, pct: 10, badge: 'Podium', badgeColor: '#d97706' },
  { place: '4th - 10th', jul: 15_000, pct: 6, badge: 'Top 10', badgeColor: '#8b5cf6', note: 'Split among 7 traders' },
]

// ============ Mock Data: Past Competitions ============

const PAST_COMPETITIONS = [
  {
    name: 'New Year Sprint',
    winner: '0x7a3b...f291',
    winnerPnl: '+62.4%',
    dates: 'Jan 1 - Jan 14, 2026',
    totalVolume: 18_400_000,
    participants: 2103,
    prizePool: 200_000,
  },
  {
    name: 'Valentine Volatility',
    winner: '0x9c1d...a847',
    winnerPnl: '+48.7%',
    dates: 'Feb 7 - Feb 21, 2026',
    totalVolume: 14_700_000,
    participants: 1654,
    prizePool: 180_000,
  },
  {
    name: 'DeFi Decathlon',
    winner: '0x2e8f...c503',
    winnerPnl: '+55.1%',
    dates: 'Dec 1 - Dec 15, 2025',
    totalVolume: 22_100_000,
    participants: 2891,
    prizePool: 300_000,
  },
]

// ============ Mock Data: Upcoming Competitions ============

const UPCOMING_COMPETITIONS = [
  {
    name: 'Spring Surge',
    description: 'Cross-chain volume competition across all LayerZero-connected chains. Highest cumulative volume wins.',
    registrationOpens: 'Mar 20, 2026',
    startDate: 'Apr 1, 2026',
    endDate: 'Apr 14, 2026',
    prizePool: 300_000,
    maxParticipants: 5000,
    scoring: 'Total cross-chain volume',
    rules: ['Minimum 10 trades across 2+ chains', 'All VibeSwap pairs eligible', 'No wash trading'],
  },
  {
    name: 'Arbitrage Arena',
    description: 'Profit from price discrepancies across chains. Best risk-adjusted return (Sharpe ratio) wins.',
    registrationOpens: 'Apr 20, 2026',
    startDate: 'May 1, 2026',
    endDate: 'May 14, 2026',
    prizePool: 350_000,
    maxParticipants: 3000,
    scoring: 'Risk-adjusted PnL (Sharpe ratio)',
    rules: ['Minimum $1,000 starting capital', 'Cross-chain trades only', 'Automated strategies permitted'],
  },
]

// ============ Mock Data: Rules ============

const RULES = {
  entry: [
    'Must hold a connected wallet with at least $100 in assets on any supported chain',
    'No entry fee for standard competitions (premium tiers may require JUL staking)',
    'Maximum one account per competition — sybil detection is active',
    'Registration must be completed before the competition start time',
  ],
  scoring: [
    'Default scoring: PnL% calculated from start-of-competition portfolio snapshot',
    'Only trades executed on VibeSwap count toward competition metrics',
    'Unrealized gains/losses at competition end are included in final PnL',
    'Ties are broken by total volume traded, then by number of trades',
  ],
  prohibited: [
    'Wash trading — trades between your own wallets are detected and disqualified',
    'Front-running other competitors via off-platform MEV',
    'Colluding with other participants to manipulate rankings',
    'Using flash loans to inflate volume or PnL artificially',
    'Exploiting smart contract bugs — responsible disclosure earns bonus JUL instead',
  ],
}

// ============ Time Remaining Helper ============

function getTimeRemaining() {
  // Mock: always show some time remaining for the active competition
  return { days: 3, hours: 14, minutes: 27, seconds: 52 }
}

// ============ Component ============

export default function CompetitionsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeTab, setActiveTab] = useState('leaderboard')
  const timeRemaining = useMemo(() => getTimeRemaining(), [])

  // Mock user performance
  const userPerformance = useMemo(() => {
    if (!isConnected) return null
    const rng = seededRandom(9999)
    return {
      rank: 42,
      totalParticipants: ACTIVE_COMPETITION.participants,
      pnlPct: 8.34,
      volume: 34_200,
      trades: 47,
      projectedPrize: 0,
      percentile: Math.round((1 - 42 / ACTIVE_COMPETITION.participants) * 100),
    }
  }, [isConnected])

  return (
    <div className="min-h-screen pb-24">
      <PageHero
        title="Competitions"
        subtitle="Compete in trading tournaments — top performers win JUL rewards and soulbound trophies"
        category="community"
        badge="Live"
        badgeColor="#22c55e"
      />

      <div className="max-w-7xl mx-auto px-4 space-y-8">

        {/* ============ Active Competition Banner ============ */}
        <motion.div variants={sectionV} initial="hidden" animate="visible" custom={0}>
          <GlassCard className="p-0 overflow-hidden" glowColor="terminal">
            <div className="relative">
              {/* Gradient accent bar */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-cyan-500 to-green-500" />

              <div className="p-6 sm:p-8">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                  {/* Left: Competition info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-mono uppercase tracking-wider text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">
                        Active Now
                      </span>
                      <span className="text-xs text-black-500">
                        {ACTIVE_COMPETITION.startDate} - {ACTIVE_COMPETITION.endDate}
                      </span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold mb-2">{ACTIVE_COMPETITION.name}</h2>
                    <p className="text-sm text-black-400 max-w-xl">{ACTIVE_COMPETITION.description}</p>
                  </div>

                  {/* Right: Stats + Join */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 lg:gap-6">
                    {/* Time remaining */}
                    <div className="flex gap-2">
                      {['days', 'hours', 'minutes', 'seconds'].map((unit) => (
                        <div key={unit} className="text-center">
                          <div className="text-xl sm:text-2xl font-bold font-mono" style={{ color: CYAN }}>
                            {String(timeRemaining[unit]).padStart(2, '0')}
                          </div>
                          <div className="text-[10px] text-black-500 uppercase">{unit.slice(0, 3)}</div>
                        </div>
                      ))}
                    </div>

                    {/* Divider */}
                    <div className="hidden sm:block w-px h-12 bg-black-700" />

                    {/* Prize & Participants */}
                    <div className="text-sm space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-black-500">Prize Pool:</span>
                        <span className="font-bold text-green-400">{fmtJul(ACTIVE_COMPETITION.prizePool)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-black-500">Participants:</span>
                        <span className="font-mono">{ACTIVE_COMPETITION.participants.toLocaleString()} / {ACTIVE_COMPETITION.maxParticipants.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-black-500">Entry:</span>
                        <span className="text-green-400">Free</span>
                      </div>
                    </div>

                    {/* Join button */}
                    <motion.button
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.97 }}
                      className="px-6 py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 transition-all shadow-lg shadow-purple-500/20"
                    >
                      {isConnected ? 'Join Competition' : 'Connect to Join'}
                    </motion.button>
                  </div>
                </div>

                {/* Progress bar: time elapsed */}
                <div className="mt-6">
                  <div className="flex justify-between text-[10px] text-black-500 mb-1">
                    <span>Started Mar 1</span>
                    <span>78% elapsed</span>
                    <span>Ends Mar 15</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-black-800 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-500"
                      initial={{ width: 0 }}
                      animate={{ width: '78%' }}
                      transition={{ duration: 1.2, ease }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Your Performance (if connected) ============ */}
        {isConnected && userPerformance && (
          <motion.div variants={sectionV} initial="hidden" animate="visible" custom={1}>
            <GlassCard className="p-6" glowColor="matrix">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                Your Performance
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {[
                  { label: 'Rank', value: `#${userPerformance.rank}`, sub: `of ${userPerformance.totalParticipants.toLocaleString()}` },
                  { label: 'PnL', value: `+${userPerformance.pnlPct}%`, sub: 'since start', color: '#22c55e' },
                  { label: 'Volume', value: fmt(userPerformance.volume), sub: 'total traded' },
                  { label: 'Trades', value: userPerformance.trades.toString(), sub: 'executed' },
                  { label: 'Percentile', value: `Top ${100 - userPerformance.percentile}%`, sub: `${userPerformance.percentile}th pctl` },
                  { label: 'Est. Prize', value: userPerformance.projectedPrize > 0 ? fmtJul(userPerformance.projectedPrize) : 'None', sub: 'top 10 wins', color: userPerformance.projectedPrize > 0 ? '#22c55e' : '#ef4444' },
                ].map((stat, i) => (
                  <motion.div key={stat.label} variants={cardV} initial="hidden" animate="visible" custom={i} className="text-center">
                    <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">{stat.label}</div>
                    <div className="text-lg font-bold font-mono" style={stat.color ? { color: stat.color } : {}}>{stat.value}</div>
                    <div className="text-[10px] text-black-600">{stat.sub}</div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Tab Navigation ============ */}
        <motion.div variants={sectionV} initial="hidden" animate="visible" custom={2}>
          <div className="flex gap-1 bg-black-900/50 rounded-xl p-1 w-fit">
            {['leaderboard', 'prizes', 'past', 'upcoming', 'rules'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                  activeTab === tab
                    ? 'bg-black-700 text-white shadow-sm'
                    : 'text-black-400 hover:text-white hover:bg-black-800/50'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </motion.div>

        {/* ============ Leaderboard Tab ============ */}
        {activeTab === 'leaderboard' && (
          <motion.div variants={sectionV} initial="hidden" animate="visible" custom={3}>
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 border-b border-black-800 flex items-center justify-between">
                <h3 className="text-lg font-bold">March Madness Leaderboard</h3>
                <span className="text-xs text-black-500 font-mono">Updated every batch cycle</span>
              </div>

              {/* Table header */}
              <div className="grid grid-cols-12 gap-2 px-4 py-3 text-[10px] text-black-500 uppercase tracking-wider border-b border-black-800/50">
                <div className="col-span-1">Rank</div>
                <div className="col-span-3">Trader</div>
                <div className="col-span-2 text-right">PnL %</div>
                <div className="col-span-2 text-right">Volume</div>
                <div className="col-span-2 text-right">Trades</div>
                <div className="col-span-2 text-right">Prize</div>
              </div>

              {/* Table rows */}
              {LEADERBOARD.map((trader, i) => {
                const medal = rankMedal(trader.rank)
                const isUser = isConnected && trader.rank === 42
                return (
                  <motion.div
                    key={trader.address}
                    variants={cardV}
                    initial="hidden"
                    animate="visible"
                    custom={i}
                    className={`grid grid-cols-12 gap-2 px-4 py-3 items-center border-b border-black-800/30 transition-colors hover:bg-black-800/30 ${
                      trader.rank <= 3 ? 'bg-black-800/20' : ''
                    }`}
                  >
                    {/* Rank */}
                    <div className="col-span-1">
                      {medal ? (
                        <span className="text-lg">{medal.symbol}</span>
                      ) : (
                        <span className="text-sm font-mono text-black-400">{trader.rank}</span>
                      )}
                    </div>

                    {/* Address */}
                    <div className="col-span-3">
                      <span className="font-mono text-sm">{shortenAddr(trader.address)}</span>
                    </div>

                    {/* PnL % */}
                    <div className="col-span-2 text-right">
                      <span className={`font-mono text-sm font-semibold ${
                        trader.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {trader.pnlPct >= 0 ? '+' : ''}{trader.pnlPct.toFixed(2)}%
                      </span>
                    </div>

                    {/* Volume */}
                    <div className="col-span-2 text-right">
                      <span className="font-mono text-sm text-black-300">{fmt(trader.volume)}</span>
                    </div>

                    {/* Trades */}
                    <div className="col-span-2 text-right">
                      <span className="font-mono text-sm text-black-400">{trader.trades}</span>
                    </div>

                    {/* Prize */}
                    <div className="col-span-2 text-right">
                      {trader.prizeAlloc > 0 ? (
                        <span className="font-mono text-sm text-green-400">{fmtJul(trader.prizeAlloc)}</span>
                      ) : (
                        <span className="text-xs text-black-600">--</span>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Prizes Tab ============ */}
        {activeTab === 'prizes' && (
          <motion.div variants={sectionV} initial="hidden" animate="visible" custom={3} className="space-y-6">
            <GlassCard className="p-6">
              <h3 className="text-lg font-bold mb-2">Prize Structure</h3>
              <p className="text-sm text-black-400 mb-6">
                Total prize pool: <span className="text-green-400 font-bold">{fmtJul(ACTIVE_COMPETITION.prizePool)}</span>
                {' '} distributed to top 10 finishers plus soulbound NFT trophies.
              </p>

              <div className="space-y-4">
                {PRIZE_TIERS.map((tier, i) => (
                  <motion.div key={tier.place} variants={cardV} initial="hidden" animate="visible" custom={i}>
                    <div className={`flex items-center justify-between p-4 rounded-xl border ${
                      i === 0 ? 'border-yellow-500/30 bg-yellow-500/5' :
                      i === 1 ? 'border-gray-400/20 bg-gray-400/5' :
                      i === 2 ? 'border-orange-500/20 bg-orange-500/5' :
                      'border-black-700/50 bg-black-800/30'
                    }`}>
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
                          style={{ backgroundColor: `${tier.badgeColor}20`, color: tier.badgeColor }}>
                          {i < 3 ? ['1', '2', '3'][i] : '~'}
                        </div>
                        <div>
                          <div className="font-semibold text-sm">{tier.place}</div>
                          {tier.note && <div className="text-[10px] text-black-500">{tier.note}</div>}
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="font-bold font-mono text-green-400">{fmtJul(tier.jul)}</div>
                          <div className="text-[10px] text-black-500">{tier.pct}% of pool</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-medium px-2 py-1 rounded-full"
                            style={{ backgroundColor: `${tier.badgeColor}20`, color: tier.badgeColor }}>
                            {tier.badge} NFT
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Additional prize info */}
              <div className="mt-6 p-4 rounded-xl bg-black-800/40 border border-black-700/40">
                <h4 className="text-sm font-semibold mb-2 text-purple-400">Soulbound Trophies</h4>
                <p className="text-xs text-black-400 leading-relaxed">
                  All top 10 finishers receive non-transferable soulbound NFTs that permanently display on their
                  VibeSwap profile. These trophies unlock exclusive UI themes, priority access to future competitions,
                  and a 10% fee discount for the following season. Champion badges stack across competitions.
                </p>
              </div>
            </GlassCard>

            {/* Remaining pool allocation */}
            <GlassCard className="p-6">
              <h4 className="text-sm font-bold mb-3">Full Pool Allocation</h4>
              <div className="space-y-2">
                {[
                  { label: '1st Place', pct: 30, color: '#fbbf24' },
                  { label: '2nd Place', pct: 18, color: '#94a3b8' },
                  { label: '3rd Place', pct: 10, color: '#d97706' },
                  { label: '4th - 10th Place', pct: 6, color: '#8b5cf6' },
                  { label: 'DAO Treasury', pct: 20, color: '#06b6d4' },
                  { label: 'Next Competition Seed', pct: 16, color: '#22c55e' },
                ].map((alloc, i) => (
                  <div key={alloc.label} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-black-400">{alloc.label}</div>
                    <div className="flex-1 h-2 rounded-full bg-black-800 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: alloc.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${alloc.pct}%` }}
                        transition={{ duration: 0.8, delay: 0.1 * i, ease }}
                      />
                    </div>
                    <div className="w-10 text-xs text-right font-mono text-black-400">{alloc.pct}%</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Past Competitions Tab ============ */}
        {activeTab === 'past' && (
          <motion.div variants={sectionV} initial="hidden" animate="visible" custom={3} className="space-y-4">
            <h3 className="text-lg font-bold">Past Competitions</h3>
            {PAST_COMPETITIONS.map((comp, i) => (
              <motion.div key={comp.name} variants={cardV} initial="hidden" animate="visible" custom={i}>
                <GlassCard className="p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <h4 className="text-base font-bold mb-1">{comp.name}</h4>
                      <div className="text-xs text-black-500">{comp.dates}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-black-800 text-black-400">Completed</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-4 pt-4 border-t border-black-800/50">
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">Winner</div>
                      <div className="font-mono text-sm">{comp.winner}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">Winning PnL</div>
                      <div className="font-mono text-sm text-green-400">{comp.winnerPnl}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">Total Volume</div>
                      <div className="font-mono text-sm">{fmt(comp.totalVolume)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">Participants</div>
                      <div className="font-mono text-sm">{comp.participants.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">Prize Pool</div>
                      <div className="font-mono text-sm text-green-400">{fmtJul(comp.prizePool)}</div>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* ============ Upcoming Competitions Tab ============ */}
        {activeTab === 'upcoming' && (
          <motion.div variants={sectionV} initial="hidden" animate="visible" custom={3} className="space-y-4">
            <h3 className="text-lg font-bold">Upcoming Competitions</h3>
            {UPCOMING_COMPETITIONS.map((comp, i) => (
              <motion.div key={comp.name} variants={cardV} initial="hidden" animate="visible" custom={i}>
                <GlassCard className="p-6" glowColor="terminal">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-base font-bold">{comp.name}</h4>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-mono">
                          Upcoming
                        </span>
                      </div>
                      <p className="text-sm text-black-400 max-w-lg">{comp.description}</p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-black-800 border border-black-700 hover:border-cyan-500/40 transition-colors whitespace-nowrap"
                    >
                      Set Reminder
                    </motion.button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-black-800/50">
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">Registration Opens</div>
                      <div className="text-sm font-medium">{comp.registrationOpens}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">Duration</div>
                      <div className="text-sm font-medium">{comp.startDate} - {comp.endDate}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">Prize Pool</div>
                      <div className="text-sm font-bold text-green-400">{fmtJul(comp.prizePool)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-1">Scoring</div>
                      <div className="text-sm font-medium">{comp.scoring}</div>
                    </div>
                  </div>

                  {/* Rules preview */}
                  <div className="mt-4 pt-4 border-t border-black-800/30">
                    <div className="text-[10px] text-black-500 uppercase tracking-wider mb-2">Key Rules</div>
                    <div className="flex flex-wrap gap-2">
                      {comp.rules.map((rule) => (
                        <span key={rule} className="text-xs px-2 py-1 rounded-md bg-black-800/60 text-black-400">
                          {rule}
                        </span>
                      ))}
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* ============ Rules Tab ============ */}
        {activeTab === 'rules' && (
          <motion.div variants={sectionV} initial="hidden" animate="visible" custom={3} className="space-y-6">
            {/* Entry Requirements */}
            <GlassCard className="p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs font-bold">E</span>
                Entry Requirements
              </h3>
              <ul className="space-y-3">
                {RULES.entry.map((rule, i) => (
                  <motion.li key={i} variants={cardV} initial="hidden" animate="visible" custom={i}
                    className="flex items-start gap-3 text-sm text-black-300">
                    <span className="w-5 h-5 rounded-full bg-black-800 text-black-500 flex items-center justify-center text-[10px] font-mono flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    {rule}
                  </motion.li>
                ))}
              </ul>
            </GlassCard>

            {/* Scoring Methodology */}
            <GlassCard className="p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-green-500/20 text-green-400 flex items-center justify-center text-xs font-bold">S</span>
                Scoring Methodology
              </h3>
              <ul className="space-y-3">
                {RULES.scoring.map((rule, i) => (
                  <motion.li key={i} variants={cardV} initial="hidden" animate="visible" custom={i}
                    className="flex items-start gap-3 text-sm text-black-300">
                    <span className="w-5 h-5 rounded-full bg-black-800 text-black-500 flex items-center justify-center text-[10px] font-mono flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    {rule}
                  </motion.li>
                ))}
              </ul>
            </GlassCard>

            {/* Prohibited Strategies */}
            <GlassCard className="p-6" glowColor="warning">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-red-500/20 text-red-400 flex items-center justify-center text-xs font-bold">!</span>
                Prohibited Strategies
              </h3>
              <ul className="space-y-3">
                {RULES.prohibited.map((rule, i) => (
                  <motion.li key={i} variants={cardV} initial="hidden" animate="visible" custom={i}
                    className="flex items-start gap-3 text-sm text-black-300">
                    <span className="w-5 h-5 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">
                      x
                    </span>
                    {rule}
                  </motion.li>
                ))}
              </ul>
              <div className="mt-4 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400/80">
                  Violations result in immediate disqualification, forfeiture of any accrued prizes, and a 90-day
                  competition ban. Repeat offenders face permanent exclusion from all VibeSwap competitive events.
                </p>
              </div>
            </GlassCard>

            {/* Fair Play Commitment */}
            <GlassCard className="p-6">
              <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold">F</span>
                Fair Play Commitment
              </h3>
              <p className="text-sm text-black-400 leading-relaxed mb-4">
                VibeSwap competitions are built on the same commit-reveal batch auction mechanism that powers the core DEX.
                This means MEV extraction is structurally impossible during competition trades — every participant gets the same
                uniform clearing price within each batch. Combined with on-chain sybil detection and Shapley-based reward
                distribution, competitions are designed to reward genuine trading skill, not infrastructure advantages.
              </p>
              <div className="flex flex-wrap gap-2">
                {['Zero MEV', 'Batch Auctions', 'Sybil Detection', 'On-Chain Verification', 'Shapley Fairness'].map((tag) => (
                  <span key={tag} className="text-xs px-2 py-1 rounded-md bg-purple-500/10 text-purple-400 font-mono">
                    {tag}
                  </span>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Not Connected CTA ============ */}
        {!isConnected && (
          <motion.div variants={sectionV} initial="hidden" animate="visible" custom={5}>
            <GlassCard className="p-8 text-center">
              <h3 className="text-xl font-bold mb-2">Ready to Compete?</h3>
              <p className="text-sm text-black-400 mb-6 max-w-md mx-auto">
                Connect your wallet to track your performance, view personalized stats,
                and join active competitions.
              </p>
              <Link
                to="/wallet"
                className="inline-block px-6 py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 transition-all shadow-lg shadow-purple-500/20"
              >
                Connect Wallet
              </Link>
            </GlassCard>
          </motion.div>
        )}

      </div>
    </div>
  )
}

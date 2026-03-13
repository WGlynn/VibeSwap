import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Pool Data ============
const POOL_PAIRS = [
  { id: 1, tokenA: 'ETH', tokenB: 'USDC', logoA: '\u27E0', logoB: '$', category: 'major' },
  { id: 2, tokenA: 'ETH', tokenB: 'WBTC', logoA: '\u27E0', logoB: '\u20BF', category: 'major' },
  { id: 3, tokenA: 'USDC', tokenB: 'USDT', logoA: '$', logoB: '$', category: 'stable' },
  { id: 4, tokenA: 'ETH', tokenB: 'DAI', logoA: '\u27E0', logoB: '\u25C7', category: 'major' },
  { id: 5, tokenA: 'WBTC', tokenB: 'USDC', logoA: '\u20BF', logoB: '$', category: 'major' },
  { id: 6, tokenA: 'ARB', tokenB: 'ETH', logoA: '\u25C8', logoB: '\u27E0', category: 'alt' },
  { id: 7, tokenA: 'OP', tokenB: 'ETH', logoA: '\u2295', logoB: '\u27E0', category: 'alt' },
  { id: 8, tokenA: 'DAI', tokenB: 'USDC', logoA: '\u25C7', logoB: '$', category: 'stable' },
]

function generatePoolData(pools) {
  const rng = seededRandom(42)
  return pools.map(pool => {
    const isStable = pool.category === 'stable'
    const baseAPY = isStable ? 2 + rng() * 6 : 5 + rng() * 25
    const rewardAPY = rng() * 12
    const tvl = isStable ? 5_000_000 + rng() * 45_000_000 : 1_000_000 + rng() * 30_000_000
    const volume24h = tvl * (0.02 + rng() * 0.15)
    const ilRisk = isStable ? rng() * 0.5 : 1 + rng() * 9
    return {
      ...pool,
      baseAPY: parseFloat(baseAPY.toFixed(2)),
      rewardAPY: parseFloat(rewardAPY.toFixed(2)),
      totalAPY: parseFloat((baseAPY + rewardAPY).toFixed(2)),
      tvl,
      volume24h,
      volumeTvlRatio: parseFloat((volume24h / tvl).toFixed(4)),
      ilRisk: parseFloat(ilRisk.toFixed(1)),
    }
  })
}

const POOL_DATA = generatePoolData(POOL_PAIRS)

// ============ Mock User Positions ============
const MOCK_POSITIONS = [
  {
    id: 1, pair: 'ETH / USDC', entryValue: 10000, currentValue: 10342,
    feesEarned: 287.50, ilImpact: -45.20, daysActive: 34, netAPY: 18.4,
  },
  {
    id: 2, pair: 'USDC / USDT', entryValue: 25000, currentValue: 25088,
    feesEarned: 112.30, ilImpact: -0.80, daysActive: 62, netAPY: 4.2,
  },
  {
    id: 3, pair: 'ETH / WBTC', entryValue: 5000, currentValue: 4812,
    feesEarned: 198.40, ilImpact: -386.10, daysActive: 21, netAPY: -12.8,
  },
]

// ============ Helpers ============
function fmtUSD(n) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}

function fmtPct(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

function ilPercent(priceRatio) {
  // IL formula: IL = 2 * sqrt(r) / (1 + r) - 1
  const r = priceRatio
  const sqrtR = Math.sqrt(r)
  return (2 * sqrtR / (1 + r) - 1) * 100
}

function RiskBadge({ score }) {
  let color, label
  if (score <= 2) { color = 'bg-green-500/15 text-green-400 border-green-500/25'; label = 'Low' }
  else if (score <= 5) { color = 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25'; label = 'Med' }
  else { color = 'bg-red-500/15 text-red-400 border-red-500/25'; label = 'High' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border ${color}`}>
      {score.toFixed(1)} {label}
    </span>
  )
}

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold font-mono text-white tracking-tight">{title}</h2>
      {subtitle && <p className="text-xs font-mono text-black-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}

// ============ Section: Top Opportunities ============
function TopOpportunities({ pools, onCompare, compareIds }) {
  const [sortBy, setSortBy] = useState('totalAPY')
  const [filter, setFilter] = useState('all')

  const filtered = useMemo(() => {
    let list = [...pools]
    if (filter !== 'all') list = list.filter(p => p.category === filter)
    list.sort((a, b) => b[sortBy] - a[sortBy])
    return list
  }, [pools, sortBy, filter])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / PHI, delay: 0.1 }}
    >
      <SectionHeader title="Top Opportunities" subtitle="Ranked by risk-adjusted returns" />
      <GlassCard glowColor="terminal" className="p-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {['all', 'major', 'stable', 'alt'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
                filter === f
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                  : 'bg-black-800/50 text-black-400 border border-black-700/50 hover:text-black-200'
              }`}
            >
              {f === 'all' ? 'All Pools' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <div className="flex-1" />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="px-3 py-1 rounded-lg text-xs font-mono bg-black-800/50 text-black-300 border border-black-700/50 outline-none"
          >
            <option value="totalAPY">Sort: APY</option>
            <option value="tvl">Sort: TVL</option>
            <option value="volumeTvlRatio">Sort: Vol/TVL</option>
            <option value="ilRisk">Sort: IL Risk</option>
          </select>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-mono text-black-500 uppercase tracking-wider border-b border-black-700/50">
          <div className="col-span-3">Pair</div>
          <div className="col-span-2 text-right">APY</div>
          <div className="col-span-2 text-right">TVL</div>
          <div className="col-span-2 text-right">Vol/TVL</div>
          <div className="col-span-2 text-center">IL Risk</div>
          <div className="col-span-1 text-center">+</div>
        </div>

        {/* Rows */}
        {filtered.map((pool, i) => (
          <motion.div
            key={pool.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="grid grid-cols-12 gap-2 px-3 py-3 items-center border-b border-black-800/50 hover:bg-black-800/30 transition-colors"
          >
            <div className="col-span-3 flex items-center gap-2">
              <div className="flex -space-x-1">
                <span className="w-6 h-6 rounded-full bg-black-700 flex items-center justify-center text-[10px]">{pool.logoA}</span>
                <span className="w-6 h-6 rounded-full bg-black-700 flex items-center justify-center text-[10px]">{pool.logoB}</span>
              </div>
              <span className="text-sm font-mono font-medium text-white">{pool.tokenA}/{pool.tokenB}</span>
            </div>
            <div className="col-span-2 text-right">
              <div className="text-sm font-mono font-medium text-green-400">{pool.totalAPY}%</div>
              <div className="text-[10px] font-mono text-black-500">{pool.baseAPY}% + {pool.rewardAPY}%</div>
            </div>
            <div className="col-span-2 text-right text-sm font-mono text-black-300">{fmtUSD(pool.tvl)}</div>
            <div className="col-span-2 text-right text-sm font-mono" style={{ color: CYAN }}>{pool.volumeTvlRatio.toFixed(2)}</div>
            <div className="col-span-2 text-center"><RiskBadge score={pool.ilRisk} /></div>
            <div className="col-span-1 text-center">
              <button
                onClick={() => onCompare(pool.id)}
                className={`w-6 h-6 rounded-md flex items-center justify-center text-xs transition-all ${
                  compareIds.includes(pool.id)
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'bg-black-700/50 text-black-500 border border-black-700/50 hover:text-black-300'
                }`}
              >
                {compareIds.includes(pool.id) ? '\u2713' : '+'}
              </button>
            </div>
          </motion.div>
        ))}
      </GlassCard>
    </motion.div>
  )
}

// ============ Section: IL Calculator ============
function ILCalculator() {
  const [selectedPair, setSelectedPair] = useState('ETH / USDC')
  const [entryPrice, setEntryPrice] = useState('2000')

  const scenarios = useMemo(() => {
    const entry = parseFloat(entryPrice) || 1
    const multipliers = [0.25, 0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0, 3.0, 5.0]
    return multipliers.map(m => ({
      multiplier: m,
      newPrice: entry * m,
      il: ilPercent(m),
      label: m === 1 ? 'Entry' : m < 1 ? `${((1 - m) * 100).toFixed(0)}% drop` : `${((m - 1) * 100).toFixed(0)}% rise`,
    }))
  }, [entryPrice])

  const worstIL = Math.min(...scenarios.map(s => s.il))

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / PHI, delay: 0.2 }}
    >
      <SectionHeader title="IL Calculator" subtitle="Impermanent loss at various price scenarios" />
      <GlassCard glowColor="warning" className="p-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1 block">Pair</label>
            <select
              value={selectedPair}
              onChange={e => setSelectedPair(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-black-800/50 text-black-200 border border-black-700/50 outline-none"
            >
              {POOL_PAIRS.filter(p => p.category !== 'stable').map(p => (
                <option key={p.id} value={`${p.tokenA} / ${p.tokenB}`}>{p.tokenA} / {p.tokenB}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1 block">Entry Price ($)</label>
            <input
              type="number"
              value={entryPrice}
              onChange={e => setEntryPrice(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-black-800/50 text-black-200 border border-black-700/50 outline-none"
              placeholder="2000"
            />
          </div>
        </div>

        {/* IL Chart (text-based bar visualization) */}
        <div className="space-y-1.5">
          {scenarios.map((s, i) => {
            const barWidth = Math.min(Math.abs(s.il) / Math.abs(worstIL) * 100, 100)
            const isEntry = s.multiplier === 1
            return (
              <motion.div
                key={s.multiplier}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                  isEntry ? 'bg-cyan-500/10 border border-cyan-500/20' : 'hover:bg-black-800/30'
                } transition-colors`}
              >
                <div className="w-20 text-right text-xs font-mono text-black-400">
                  ${s.newPrice.toFixed(0)}
                </div>
                <div className="flex-1 relative h-4">
                  {!isEntry && (
                    <div
                      className="absolute left-0 top-0 h-full rounded-sm"
                      style={{
                        width: `${barWidth}%`,
                        backgroundColor: s.il < -5 ? '#ef4444' + '40' : s.il < -1 ? '#f59e0b' + '40' : '#22c55e' + '30',
                      }}
                    />
                  )}
                  {isEntry && (
                    <div className="absolute left-0 top-0 h-full w-full rounded-sm" style={{ backgroundColor: CYAN + '20' }}>
                      <div className="flex items-center justify-center h-full text-[10px] font-mono" style={{ color: CYAN }}>
                        No IL at entry
                      </div>
                    </div>
                  )}
                </div>
                <div className={`w-16 text-right text-xs font-mono font-medium ${
                  isEntry ? 'text-cyan-400' : s.il < -5 ? 'text-red-400' : s.il < -1 ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {isEntry ? '0.00%' : s.il.toFixed(2) + '%'}
                </div>
                <div className="w-20 text-[10px] font-mono text-black-500 hidden sm:block">
                  {s.label}
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Key Insight */}
        <div className="mt-4 p-3 rounded-xl bg-red-500/5 border border-red-500/15">
          <div className="flex items-start gap-2">
            <span className="text-red-400 text-sm mt-0.5">!</span>
            <div>
              <p className="text-xs font-mono text-red-400 font-medium">Max IL in range: {worstIL.toFixed(2)}%</p>
              <p className="text-[10px] font-mono text-black-500 mt-0.5">
                IL occurs when the price ratio of pooled assets changes. The more it deviates, the greater the loss vs. simply holding.
              </p>
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Section: Position Simulator ============
function PositionSimulator() {
  const [simAmount, setSimAmount] = useState('10000')
  const [simPair, setSimPair] = useState(0)

  const pool = POOL_DATA[simPair]
  const amount = parseFloat(simAmount) || 0

  const projections = useMemo(() => {
    if (!pool || amount <= 0) return null
    const dailyRate = pool.totalAPY / 365 / 100
    const dailyFeeRate = pool.baseAPY / 365 / 100
    const dailyRewardRate = pool.rewardAPY / 365 / 100

    return {
      daily: {
        total: amount * dailyRate,
        fees: amount * dailyFeeRate,
        rewards: amount * dailyRewardRate,
      },
      weekly: {
        total: amount * dailyRate * 7,
        fees: amount * dailyFeeRate * 7,
        rewards: amount * dailyRewardRate * 7,
      },
      monthly: {
        total: amount * dailyRate * 30,
        fees: amount * dailyFeeRate * 30,
        rewards: amount * dailyRewardRate * 30,
      },
      yearly: {
        total: amount * pool.totalAPY / 100,
        fees: amount * pool.baseAPY / 100,
        rewards: amount * pool.rewardAPY / 100,
      },
    }
  }, [pool, amount])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / PHI, delay: 0.3 }}
    >
      <SectionHeader title="Position Simulator" subtitle="Project your earnings before committing" />
      <GlassCard glowColor="matrix" className="p-4">
        {/* Inputs */}
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1 block">Amount ($)</label>
            <input
              type="number"
              value={simAmount}
              onChange={e => setSimAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-black-800/50 text-black-200 border border-black-700/50 outline-none"
              placeholder="10000"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1 block">Pool</label>
            <select
              value={simPair}
              onChange={e => setSimPair(parseInt(e.target.value))}
              className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-black-800/50 text-black-200 border border-black-700/50 outline-none"
            >
              {POOL_DATA.map((p, i) => (
                <option key={p.id} value={i}>{p.tokenA}/{p.tokenB} ({p.totalAPY}% APY)</option>
              ))}
            </select>
          </div>
        </div>

        {/* Projection Cards */}
        {projections && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Daily', data: projections.daily },
              { label: 'Weekly', data: projections.weekly },
              { label: 'Monthly', data: projections.monthly },
              { label: 'Yearly', data: projections.yearly },
            ].map((period, i) => (
              <motion.div
                key={period.label}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * (1 / (PHI * 10)) }}
                className="p-3 rounded-xl bg-black-800/50 border border-black-700/50"
              >
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">{period.label}</div>
                <div className="text-lg font-mono font-bold text-green-400">{fmtUSD(period.data.total)}</div>
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-black-500">Fees</span>
                    <span className="text-black-300">{fmtUSD(period.data.fees)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-black-500">Rewards</span>
                    <span style={{ color: CYAN }}>{fmtUSD(period.data.rewards)}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Pool Info Bar */}
        {pool && (
          <div className="mt-4 flex flex-wrap gap-4 px-3 py-2 rounded-lg bg-black-900/50 text-[10px] font-mono text-black-400">
            <span>TVL: <span className="text-black-300">{fmtUSD(pool.tvl)}</span></span>
            <span>Vol/TVL: <span style={{ color: CYAN }}>{pool.volumeTvlRatio.toFixed(2)}</span></span>
            <span>IL Risk: <span className={pool.ilRisk > 5 ? 'text-red-400' : pool.ilRisk > 2 ? 'text-yellow-400' : 'text-green-400'}>{pool.ilRisk.toFixed(1)}</span></span>
            <span>Base APY: <span className="text-green-400">{pool.baseAPY}%</span></span>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Section: My Positions ============
function MyPositions({ isConnected }) {
  if (!isConnected) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / PHI, delay: 0.4 }}
      >
        <SectionHeader title="My Positions" subtitle="Track your active LP performance" />
        <GlassCard className="p-8">
          <div className="text-center">
            <div className="text-3xl mb-3 opacity-40">{'\u26A1'}</div>
            <p className="text-sm font-mono text-black-400">Connect your wallet to view positions</p>
            <p className="text-xs font-mono text-black-500 mt-1">Your LP performance data will appear here</p>
          </div>
        </GlassCard>
      </motion.div>
    )
  }

  const totalValue = MOCK_POSITIONS.reduce((s, p) => s + p.currentValue, 0)
  const totalFees = MOCK_POSITIONS.reduce((s, p) => s + p.feesEarned, 0)
  const totalIL = MOCK_POSITIONS.reduce((s, p) => s + p.ilImpact, 0)
  const netPnL = MOCK_POSITIONS.reduce((s, p) => s + (p.currentValue - p.entryValue) + p.feesEarned, 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / PHI, delay: 0.4 }}
    >
      <SectionHeader title="My Positions" subtitle="Track your active LP performance" />

      {/* Portfolio Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total Value', value: fmtUSD(totalValue), color: 'text-white' },
          { label: 'Fees Earned', value: fmtUSD(totalFees), color: 'text-green-400' },
          { label: 'IL Impact', value: fmtUSD(Math.abs(totalIL)), color: 'text-red-400', prefix: '-' },
          { label: 'Net P&L', value: fmtUSD(Math.abs(netPnL)), color: netPnL >= 0 ? 'text-green-400' : 'text-red-400', prefix: netPnL >= 0 ? '+' : '-' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.05 }}
          >
            <GlassCard className="p-3">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">{stat.label}</div>
              <div className={`text-lg font-mono font-bold mt-1 ${stat.color}`}>
                {stat.prefix || ''}{stat.value}
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Position Cards */}
      <div className="space-y-3">
        {MOCK_POSITIONS.map((pos, i) => {
          const pnl = (pos.currentValue - pos.entryValue) + pos.feesEarned
          const pnlPct = (pnl / pos.entryValue) * 100
          return (
            <motion.div
              key={pos.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45 + i * 0.06 }}
            >
              <GlassCard glowColor={pos.netAPY > 0 ? 'matrix' : 'warning'} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-mono font-bold text-white">{pos.pair}</span>
                    <span className="text-[10px] font-mono text-black-500">{pos.daysActive}d active</span>
                  </div>
                  <span className={`text-sm font-mono font-bold ${pos.netAPY >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {fmtPct(pos.netAPY)} APY
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <div className="text-[10px] font-mono text-black-500 mb-0.5">Position Value</div>
                    <div className="text-sm font-mono text-white">{fmtUSD(pos.currentValue)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-black-500 mb-0.5">Fees Earned</div>
                    <div className="text-sm font-mono text-green-400">+{fmtUSD(pos.feesEarned)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-black-500 mb-0.5">IL Impact</div>
                    <div className="text-sm font-mono text-red-400">{fmtUSD(pos.ilImpact)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-black-500 mb-0.5">Net P&L</div>
                    <div className={`text-sm font-mono font-medium ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pnl >= 0 ? '+' : ''}{fmtUSD(Math.abs(pnl))} ({fmtPct(pnlPct)})
                    </div>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

// ============ Section: Range Optimization ============
function RangeOptimization() {
  const [rangePair, setRangePair] = useState(0)
  const [riskLevel, setRiskLevel] = useState('balanced')

  const pool = POOL_DATA[rangePair]

  const rangeData = useMemo(() => {
    if (!pool) return null
    const rng = seededRandom(pool.id * 137 + (riskLevel === 'conservative' ? 1 : riskLevel === 'aggressive' ? 3 : 2))
    const basePrice = pool.tokenA === 'ETH' ? 2000 + rng() * 500 : pool.tokenA === 'WBTC' ? 50000 + rng() * 10000 : 1
    const isStable = pool.category === 'stable'

    let rangeWidth
    if (riskLevel === 'conservative') rangeWidth = isStable ? 0.002 : 0.15
    else if (riskLevel === 'aggressive') rangeWidth = isStable ? 0.0005 : 0.04
    else rangeWidth = isStable ? 0.001 : 0.08

    const lowerBound = basePrice * (1 - rangeWidth)
    const upperBound = basePrice * (1 + rangeWidth)
    const concentration = 1 / (2 * rangeWidth)
    const apyMultiplier = Math.min(concentration, 50)
    const effectiveAPY = pool.baseAPY * apyMultiplier
    const inRangePct = riskLevel === 'conservative' ? 92 + rng() * 6 : riskLevel === 'aggressive' ? 55 + rng() * 20 : 75 + rng() * 15
    const volatility = isStable ? 0.1 + rng() * 0.3 : 5 + rng() * 25

    return {
      basePrice,
      lowerBound,
      upperBound,
      rangeWidth: rangeWidth * 100,
      concentration: concentration.toFixed(1),
      effectiveAPY: Math.min(effectiveAPY, 999).toFixed(1),
      inRangePct: inRangePct.toFixed(1),
      volatility: volatility.toFixed(1),
      rebalanceFreq: riskLevel === 'conservative' ? 'Weekly' : riskLevel === 'aggressive' ? 'Hourly' : 'Daily',
    }
  }, [pool, riskLevel])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / PHI, delay: 0.5 }}
    >
      <SectionHeader title="Range Optimization" subtitle="Concentrated liquidity range suggestions" />
      <GlassCard glowColor="terminal" className="p-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1 block">Pool</label>
            <select
              value={rangePair}
              onChange={e => setRangePair(parseInt(e.target.value))}
              className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-black-800/50 text-black-200 border border-black-700/50 outline-none"
            >
              {POOL_DATA.map((p, i) => (
                <option key={p.id} value={i}>{p.tokenA}/{p.tokenB}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1 block">Strategy</label>
            <div className="flex gap-2">
              {['conservative', 'balanced', 'aggressive'].map(level => (
                <button
                  key={level}
                  onClick={() => setRiskLevel(level)}
                  className={`flex-1 px-2 py-2 rounded-lg text-xs font-mono font-medium transition-all ${
                    riskLevel === level
                      ? level === 'conservative' ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                        : level === 'aggressive' ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                        : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                      : 'bg-black-800/50 text-black-400 border border-black-700/50 hover:text-black-200'
                  }`}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Range Visualization */}
        {rangeData && (
          <>
            <div className="p-4 rounded-xl bg-black-900/50 mb-4">
              {/* Price range bar */}
              <div className="flex items-center justify-between text-[10px] font-mono text-black-500 mb-2">
                <span>Lower: ${rangeData.lowerBound.toFixed(2)}</span>
                <span className="text-white">Current: ${rangeData.basePrice.toFixed(2)}</span>
                <span>Upper: ${rangeData.upperBound.toFixed(2)}</span>
              </div>
              <div className="relative h-8 rounded-lg bg-black-800 overflow-hidden">
                {/* Full range background */}
                <div className="absolute inset-0 bg-black-800" />
                {/* Active range */}
                <div
                  className="absolute top-0 h-full rounded-lg"
                  style={{
                    left: '10%',
                    right: '10%',
                    background: `linear-gradient(90deg, ${CYAN}00, ${CYAN}30, ${CYAN}00)`,
                    borderLeft: `2px solid ${CYAN}60`,
                    borderRight: `2px solid ${CYAN}60`,
                  }}
                />
                {/* Current price indicator */}
                <div className="absolute top-0 h-full w-0.5 bg-white left-1/2 -translate-x-1/2" />
                <div className="absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white" />
              </div>
              <div className="text-center text-[10px] font-mono mt-2" style={{ color: CYAN }}>
                Range width: {'\u00B1'}{rangeData.rangeWidth.toFixed(2)}% | {rangeData.concentration}x concentrated
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Effective APY', value: `${rangeData.effectiveAPY}%`, color: 'text-green-400' },
                { label: 'In Range', value: `${rangeData.inRangePct}%`, color: parseFloat(rangeData.inRangePct) > 80 ? 'text-green-400' : 'text-yellow-400' },
                { label: '24h Volatility', value: `${rangeData.volatility}%`, color: parseFloat(rangeData.volatility) > 10 ? 'text-red-400' : 'text-black-300' },
                { label: 'Rebalance', value: rangeData.rebalanceFreq, color: 'text-black-300' },
              ].map(metric => (
                <div key={metric.label} className="p-2 rounded-lg bg-black-800/50 border border-black-700/30">
                  <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">{metric.label}</div>
                  <div className={`text-sm font-mono font-bold mt-1 ${metric.color}`}>{metric.value}</div>
                </div>
              ))}
            </div>

            {/* Strategy Note */}
            <div className="mt-4 p-3 rounded-xl bg-black-800/30 border border-black-700/30">
              <p className="text-[11px] font-mono text-black-400 leading-relaxed">
                {riskLevel === 'conservative' && 'Wide range for maximum time in range. Lower capital efficiency but minimal rebalancing needed. Best for passive LPs.'}
                {riskLevel === 'balanced' && 'Moderate range balancing capital efficiency with time in range. Requires daily monitoring. Recommended for most users.'}
                {riskLevel === 'aggressive' && 'Tight range for maximum capital efficiency. High APY but requires frequent rebalancing. Significant out-of-range risk.'}
              </p>
            </div>
          </>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Section: Pool Comparison ============
function PoolComparison({ compareIds, pools, onRemove }) {
  const selected = pools.filter(p => compareIds.includes(p.id))

  if (selected.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / PHI, delay: 0.6 }}
      >
        <SectionHeader title="Pool Comparison" subtitle="Select up to 3 pools from the table above" />
        <GlassCard className="p-8">
          <div className="text-center">
            <div className="text-3xl mb-3 opacity-40">{'\u2696'}</div>
            <p className="text-sm font-mono text-black-400">No pools selected for comparison</p>
            <p className="text-xs font-mono text-black-500 mt-1">Click the + button on any pool above to add it here</p>
          </div>
        </GlassCard>
      </motion.div>
    )
  }

  const metrics = [
    { key: 'totalAPY', label: 'Total APY', fmt: v => v + '%', best: 'max' },
    { key: 'baseAPY', label: 'Base APY', fmt: v => v + '%', best: 'max' },
    { key: 'rewardAPY', label: 'Reward APY', fmt: v => v + '%', best: 'max' },
    { key: 'tvl', label: 'TVL', fmt: v => fmtUSD(v), best: 'max' },
    { key: 'volume24h', label: '24h Volume', fmt: v => fmtUSD(v), best: 'max' },
    { key: 'volumeTvlRatio', label: 'Vol/TVL', fmt: v => v.toFixed(4), best: 'max' },
    { key: 'ilRisk', label: 'IL Risk', fmt: v => v.toFixed(1), best: 'min' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / PHI, delay: 0.6 }}
    >
      <SectionHeader title="Pool Comparison" subtitle="Side-by-side analysis of selected pools" />
      <GlassCard glowColor="terminal" className="p-4 overflow-x-auto">
        <table className="w-full min-w-[400px]">
          <thead>
            <tr className="border-b border-black-700/50">
              <th className="text-left py-3 px-2 text-[10px] font-mono text-black-500 uppercase tracking-wider w-28">Metric</th>
              {selected.map(pool => (
                <th key={pool.id} className="text-center py-3 px-2">
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-sm font-mono font-bold text-white">{pool.tokenA}/{pool.tokenB}</span>
                    <button
                      onClick={() => onRemove(pool.id)}
                      className="w-4 h-4 rounded-full bg-black-700 text-black-400 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center text-[10px] transition-colors"
                    >
                      {'\u00D7'}
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(metric => {
              const values = selected.map(p => p[metric.key])
              const bestVal = metric.best === 'max' ? Math.max(...values) : Math.min(...values)
              return (
                <tr key={metric.key} className="border-b border-black-800/50">
                  <td className="py-2.5 px-2 text-xs font-mono text-black-400">{metric.label}</td>
                  {selected.map(pool => {
                    const val = pool[metric.key]
                    const isBest = val === bestVal && selected.length > 1
                    return (
                      <td key={pool.id} className="text-center py-2.5 px-2">
                        <span className={`text-sm font-mono font-medium ${
                          isBest ? (metric.key === 'ilRisk' ? 'text-green-400' : 'text-cyan-400') : 'text-black-300'
                        }`}>
                          {metric.fmt(val)}
                          {isBest && <span className="ml-1 text-[9px]">{'\u2605'}</span>}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>

        {selected.length < 3 && (
          <p className="text-[10px] font-mono text-black-500 mt-3 text-center">
            {3 - selected.length} more slot{selected.length < 2 ? 's' : ''} available for comparison
          </p>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============
export default function LPOptimizerPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [compareIds, setCompareIds] = useState([])

  const handleCompare = (poolId) => {
    setCompareIds(prev => {
      if (prev.includes(poolId)) return prev.filter(id => id !== poolId)
      if (prev.length >= 3) return prev
      return [...prev, poolId]
    })
  }

  const handleRemoveCompare = (poolId) => {
    setCompareIds(prev => prev.filter(id => id !== poolId))
  }

  return (
    <div className="max-w-6xl mx-auto px-4 pb-16 font-mono">
      <PageHero
        title="LP Optimizer"
        subtitle="Maximize your liquidity provision returns"
        category="defi"
        badge="Beta"
        badgeColor={CYAN}
      />

      {/* Quick Stats Bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / (PHI * PHI), delay: 0.05 }}
        className="mb-8"
      >
        <div className="flex flex-wrap gap-3 justify-center">
          {[
            { label: 'Active Pools', value: POOL_DATA.length.toString(), accent: false },
            { label: 'Highest APY', value: Math.max(...POOL_DATA.map(p => p.totalAPY)).toFixed(1) + '%', accent: true },
            { label: 'Total TVL', value: fmtUSD(POOL_DATA.reduce((s, p) => s + p.tvl, 0)), accent: false },
            { label: 'Avg IL Risk', value: (POOL_DATA.reduce((s, p) => s + p.ilRisk, 0) / POOL_DATA.length).toFixed(1), accent: false },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 + i * (1 / (PHI * 20)) }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-black-800/40 border border-black-700/40"
            >
              <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">{stat.label}</span>
              <span className={`text-sm font-mono font-bold ${stat.accent ? 'text-green-400' : 'text-white'}`}>{stat.value}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Sections */}
      <div className="space-y-8">
        <TopOpportunities pools={POOL_DATA} onCompare={handleCompare} compareIds={compareIds} />
        <ILCalculator />
        <PositionSimulator />
        <MyPositions isConnected={isConnected} />
        <RangeOptimization />
        <PoolComparison compareIds={compareIds} pools={POOL_DATA} onRemove={handleRemoveCompare} />
      </div>

      {/* Footer CTA */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 / PHI }}
        className="mt-12 text-center"
      >
        <GlassCard className="p-6 inline-block">
          <p className="text-sm font-mono text-black-400 mb-3">
            Ready to provide liquidity?
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/pool"
              className="px-5 py-2.5 rounded-xl text-sm font-mono font-medium transition-all"
              style={{ backgroundColor: CYAN + '20', color: CYAN, border: `1px solid ${CYAN}40` }}
            >
              Add Liquidity
            </Link>
            <Link
              to="/swap"
              className="px-5 py-2.5 rounded-xl bg-black-800 text-black-300 text-sm font-mono font-medium border border-black-700/50 hover:text-white transition-all"
            >
              Swap Tokens
            </Link>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  )
}

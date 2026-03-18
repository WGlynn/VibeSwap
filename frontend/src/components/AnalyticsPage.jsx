import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import Sparkline, { generateSparklineData } from './ui/Sparkline'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded Data Generators ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

function generateTVLData(days = 30) {
  const rng = seededRandom(42); let tvl = 12_400_000
  return Array.from({ length: days }, (_, i) => {
    tvl += (rng() - 0.42) * 600_000; tvl = Math.max(tvl, 8_000_000)
    return { day: i + 1, value: Math.round(tvl) }
  })
}

function generateVolumeData(days = 30) {
  const rng = seededRandom(137)
  return Array.from({ length: days }, (_, i) => {
    const base = 800_000 + rng() * 2_200_000
    return { day: i + 1, value: Math.round(base * ((i % 7 > 4) ? 0.65 : 1)) }
  })
}

function generateUserGrowthData(days = 30) {
  const rng = seededRandom(256); let users = 1_240
  return Array.from({ length: days }, (_, i) => {
    users += Math.round(20 + rng() * 80); return { day: i + 1, value: users }
  })
}

function generateMEVSavingsData(days = 30) {
  const rng = seededRandom(512); let cum = 0
  return Array.from({ length: days }, (_, i) => {
    cum += Math.round(4_000 + rng() * 18_000); return { day: i + 1, value: cum }
  })
}

// ============ Static Seed Data ============

const tvlData = generateTVLData()
const volumeData = generateVolumeData()
const userGrowthData = generateUserGrowthData()
const mevSavingsData = generateMEVSavingsData()

const TOP_PAIRS = [
  { pair: 'ETH / USDC', volume: 4_820_000, tvl: 6_340_000, feeRevenue: 14_460, change: 12.4 },
  { pair: 'WBTC / ETH', volume: 2_150_000, tvl: 3_890_000, feeRevenue: 6_450, change: -3.2 },
  { pair: 'ARB / ETH', volume: 1_740_000, tvl: 1_250_000, feeRevenue: 5_220, change: 28.7 },
  { pair: 'USDC / USDT', volume: 980_000, tvl: 2_100_000, feeRevenue: 980, change: 1.1 },
  { pair: 'OP / ETH', volume: 620_000, tvl: 890_000, feeRevenue: 1_860, change: -7.5 },
]

const FEE_BY_POOL = [
  { name: 'ETH/USDC', value: 14_460, pct: 50.2 }, { name: 'WBTC/ETH', value: 6_450, pct: 22.4 },
  { name: 'ARB/ETH', value: 5_220, pct: 18.1 }, { name: 'USDC/USDT', value: 980, pct: 3.4 },
  { name: 'Other', value: 1_690, pct: 5.9 },
]
const FEE_BY_CHAIN = [
  { name: 'Base', value: 15_200, pct: 52.8 }, { name: 'Ethereum', value: 8_400, pct: 29.2 },
  { name: 'Arbitrum', value: 5_200, pct: 18.0 },
]
const FEE_BY_TYPE = [
  { name: 'Swap Fees', value: 20_100, pct: 69.8 }, { name: 'Priority Bids', value: 6_200, pct: 21.5 },
  { name: 'Cross-chain', value: 2_500, pct: 8.7 },
]

const CHAIN_METRICS = [
  { chain: 'Base', tvl: 6_800_000, volume: 4_200_000, users: 1_840, batches: 12_400, color: '#3b82f6' },
  { chain: 'Ethereum', tvl: 5_100_000, volume: 3_100_000, users: 1_220, batches: 8_900, color: '#8b5cf6' },
  { chain: 'Arbitrum', tvl: 2_900_000, volume: 1_800_000, users: 780, batches: 6_200, color: '#f97316' },
]

const BATCH_STATS = {
  avgBatchSize: 18.4, revealRate: 96.2, settlementSuccess: 99.7,
  avgSettleTime: 2.1, totalBatches: 27_500, avgMEVPerBatch: 12.8,
}

const TOKEN_DISTRIBUTION = [
  { holder: 'Community Treasury', pct: 35, tokens: 7_350_000, color: CYAN },
  { holder: 'LP Incentives', pct: 25, tokens: 5_250_000, color: '#8b5cf6' },
  { holder: 'Team (4yr vest)', pct: 15, tokens: 3_150_000, color: '#f97316' },
  { holder: 'Insurance Pool', pct: 10, tokens: 2_100_000, color: '#22c55e' },
  { holder: 'Early Contributors', pct: 8, tokens: 1_680_000, color: '#eab308' },
  { holder: 'Circulating', pct: 7, tokens: 1_470_000, color: '#ec4899' },
]

const WATERFALL_STEPS = [
  { label: 'Gross Fees', value: 28_800, cumulative: 28_800, type: 'total' },
  { label: 'Treasury', value: -8_640, cumulative: 20_160, type: 'outflow' },
  { label: 'Stakers', value: -11_520, cumulative: 8_640, type: 'outflow' },
  { label: 'Insurance', value: -5_760, cumulative: 2_880, type: 'outflow' },
  { label: 'Retained', value: 2_880, cumulative: 2_880, type: 'retained' },
]

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

// ============ Reusable Area Line Chart ============

function AreaLineChart({ data, color, gradientId, height = 180 }) {
  const W = 720, H = height
  const PAD = { top: 16, right: 16, bottom: 28, left: 56 }
  const iW = W - PAD.left - PAD.right, iH = H - PAD.top - PAD.bottom
  const values = data.map((d) => d.value)
  const min = Math.min(...values) * 0.95, max = Math.max(...values) * 1.05
  const range = max - min || 1

  const pts = data.map((d, i) => ({
    x: PAD.left + (i / (data.length - 1)) * iW,
    y: PAD.top + iH - ((d.value - min) / range) * iH,
  }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${PAD.top + iH} L${pts[0].x},${PAD.top + iH} Z`
  const yTicks = Array.from({ length: 5 }, (_, i) => min + (range / 4) * i)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((t, i) => {
        const y = PAD.top + iH - ((t - min) / range) * iH
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="monospace">
              {values[0] > 10_000 ? fmt(Math.round(t)) : fmtNum(Math.round(t))}
            </text>
          </g>
        )
      })}
      {data.filter((_, i) => i % 5 === 0).map((d) => {
        const i = data.indexOf(d)
        return (
          <text key={i} x={PAD.left + (i / (data.length - 1)) * iW} y={H - 6}
            textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="monospace">
            D{d.day}
          </text>
        )
      })}
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4" fill={color} />
    </svg>
  )
}

// ============ Volume Bar Chart ============

function VolumeChart({ data }) {
  const W = 720, H = 180
  const PAD = { top: 12, right: 16, bottom: 28, left: 56 }
  const iW = W - PAD.left - PAD.right, iH = H - PAD.top - PAD.bottom
  const max = Math.max(...data.map((d) => d.value)) * 1.1
  const barW = (iW / data.length) * 0.7, gap = (iW / data.length) * 0.3

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {data.map((d, i) => {
        const barH = (d.value / max) * iH, x = PAD.left + i * (barW + gap) + gap / 2
        return (
          <g key={i}>
            <rect x={x} y={PAD.top + iH - barH} width={barW} height={barH} rx="2" fill={CYAN} opacity="0.7" />
            {i % 5 === 0 && (
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="monospace">
                D{d.day}
              </text>
            )}
          </g>
        )
      })}
      {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
        const y = PAD.top + iH - pct * iH
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.04)" />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="monospace">
              {fmt(Math.round(max * pct))}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ============ Waterfall Chart ============

function WaterfallChart({ steps }) {
  const maxVal = Math.max(...steps.map((s) => s.cumulative), steps[0].value)
  const W = 520, H = 160, barW = 64, gap = 24, PAD = { top: 20, bottom: 24, left: 8 }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {steps.map((step, i) => {
        const x = PAD.left + i * (barW + gap), fullH = H - PAD.top - PAD.bottom
        const barH = (Math.abs(step.value) / maxVal) * fullH
        const y = (step.type === 'total' || step.type === 'retained')
          ? PAD.top + fullH - (step.value / maxVal) * fullH
          : PAD.top + fullH - (step.cumulative / maxVal) * fullH - (Math.abs(step.value) / maxVal) * fullH
        const color = step.type === 'total' ? CYAN : step.type === 'retained' ? '#22c55e' : '#ef4444'
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx="3" fill={color} opacity="0.8" />
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="10" fontFamily="monospace">
              {fmt(step.value)}
            </text>
            <text x={x + barW / 2} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="monospace">
              {step.label}
            </text>
            {i < steps.length - 1 && step.type !== 'total' && (
              <line x1={x + barW} y1={PAD.top + fullH - (step.cumulative / maxVal) * fullH}
                x2={x + barW + gap} y2={PAD.top + fullH - (step.cumulative / maxVal) * fullH}
                stroke="rgba(255,255,255,0.1)" strokeDasharray="3,3" />
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ============ Small Section Helpers ============

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-black-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function FeeBreakdownBar({ items, label }) {
  const colors = ['#06b6d4', '#8b5cf6', '#f97316', '#22c55e', '#eab308']
  return (
    <div className="mb-5">
      <div className="text-xs text-black-500 font-mono mb-2">{label}</div>
      <div className="flex rounded-full overflow-hidden h-3 mb-2">
        {items.map((item, i) => (
          <div key={item.name} style={{ width: `${item.pct}%`, backgroundColor: colors[i % colors.length] }}
            className="transition-all" title={`${item.name}: ${item.pct}%`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item, i) => (
          <div key={item.name} className="flex items-center gap-1.5 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
            <span className="text-black-400">{item.name}</span>
            <span className="font-mono text-black-300">{fmt(item.value)}</span>
            <span className="text-black-600">({item.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState('30d')

  const latestTVL = tvlData[tvlData.length - 1].value
  const totalVolume24h = volumeData[volumeData.length - 1].value
  const totalUsers = userGrowthData[userGrowthData.length - 1].value
  const totalMEVSaved = mevSavingsData[mevSavingsData.length - 1].value

  const sparkTVL = useMemo(() => generateSparklineData(42, 20, 0.02), [])
  const sparkVol = useMemo(() => generateSparklineData(137, 20, 0.05), [])
  const sparkUsers = useMemo(() => generateSparklineData(256, 20, 0.01), [])
  const sparkMEV = useMemo(() => generateSparklineData(512, 20, 0.02), [])

  const totalChainTVL = CHAIN_METRICS.reduce((s, c) => s + c.tvl, 0)

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero title="Analytics" subtitle="Protocol performance, MEV savings, and on-chain metrics"
        category="system" badge="Live" badgeColor={CYAN}>
        <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
          {['24h', '7d', '30d', 'All'].map((r) => (
            <button key={r} onClick={() => setTimeRange(r)}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                timeRange === r ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'
              }`}>{r}</button>
          ))}
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4">
        <motion.div variants={stagger} initial="hidden" animate="show">
          {/* ============ Stat Cards Row ============ */}
          <motion.div variants={fadeUp} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Value Locked" value={latestTVL} prefix="$" decimals={0} change={8.42} sparkData={sparkTVL} />
            <StatCard label="24h Volume" value={totalVolume24h} prefix="$" decimals={0} change={14.7} sparkData={sparkVol} />
            <StatCard label="Total Users" value={totalUsers} prefix="" decimals={0} change={6.3} sparkData={sparkUsers} />
            <StatCard label="MEV Saved" value={totalMEVSaved} prefix="$" decimals={0} change={22.1} sparkData={sparkMEV} />
          </motion.div>

          {/* ============ TVL Chart ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Total Value Locked" subtitle="30-day TVL across all pools and chains" />
              <AreaLineChart data={tvlData} color={CYAN} gradientId="tvl-fill" height={220} />
            </GlassCard>
          </motion.div>

          {/* ============ Volume Chart ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Daily Swap Volume" subtitle="Aggregate volume across all trading pairs" />
              <VolumeChart data={volumeData} />
            </GlassCard>
          </motion.div>

          {/* ============ Top Pairs Table ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Top Trading Pairs" subtitle="Ranked by 24h volume" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-black-500 border-b border-black-800">
                      <th className="pb-3 font-medium">Pair</th>
                      <th className="pb-3 font-medium text-right">24h Volume</th>
                      <th className="pb-3 font-medium text-right">TVL</th>
                      <th className="pb-3 font-medium text-right">LP Fee Volume</th>
                      <th className="pb-3 font-medium text-right">24h Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TOP_PAIRS.map((p) => (
                      <tr key={p.pair} className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors">
                        <td className="py-3 font-mono font-medium">{p.pair}</td>
                        <td className="py-3 text-right font-mono">{fmt(p.volume)}</td>
                        <td className="py-3 text-right font-mono">{fmt(p.tvl)}</td>
                        <td className="py-3 text-right font-mono text-green-400">{fmt(p.feeRevenue)}</td>
                        <td className={`py-3 text-right font-mono ${p.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {p.change >= 0 ? '+' : ''}{p.change}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ User Growth ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="User Growth" subtitle="Cumulative unique addresses over time" />
              <AreaLineChart data={userGrowthData} color="#a855f7" gradientId="users-fill" height={160} />
            </GlassCard>
          </motion.div>

          {/* ============ Fee Revenue Breakdown ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="LP Fee Volume Breakdown" subtitle="LP fee distribution by pool, chain, and type" />
              <FeeBreakdownBar items={FEE_BY_POOL} label="By Pool" />
              <FeeBreakdownBar items={FEE_BY_CHAIN} label="By Chain" />
              <FeeBreakdownBar items={FEE_BY_TYPE} label="By Type" />
            </GlassCard>
          </motion.div>

          {/* ============ MEV Savings Tracker ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="MEV Savings Tracker" subtitle="Cumulative savings from commit-reveal batch auctions vs. traditional DEX" />
              <AreaLineChart data={mevSavingsData} color="#22c55e" gradientId="mev-fill" height={160} />
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-xs text-black-500 font-mono mb-1">Total Saved</div>
                  <div className="text-lg font-bold font-mono text-green-400">{fmt(totalMEVSaved)}</div>
                </div>
                <div>
                  <div className="text-xs text-black-500 font-mono mb-1">Avg Per Batch</div>
                  <div className="text-lg font-bold font-mono text-green-400">${BATCH_STATS.avgMEVPerBatch}</div>
                </div>
                <div>
                  <div className="text-xs text-black-500 font-mono mb-1">vs. Uniswap Est.</div>
                  <div className="text-lg font-bold font-mono text-green-400">-94.2%</div>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Chain Comparison ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Chain Comparison" subtitle="Protocol metrics across supported networks" />
              <div className="grid md:grid-cols-3 gap-4">
                {CHAIN_METRICS.map((c) => (
                  <div key={c.chain} className="bg-black-800/40 rounded-xl p-4 border border-black-800">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="font-semibold text-sm">{c.chain}</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      {[['TVL', fmt(c.tvl)], ['24h Volume', fmt(c.volume)], ['Users', fmtNum(c.users)], ['Batches', fmtNum(c.batches)]].map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-black-500">{k}</span><span className="font-mono">{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 h-1.5 rounded-full bg-black-700 overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${(c.tvl / totalChainTVL) * 100}%`, backgroundColor: c.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Batch Auction Stats ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Batch Auction Performance" subtitle="Commit-reveal mechanism health metrics" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {[
                  { label: 'Avg Batch Size', value: `${BATCH_STATS.avgBatchSize} orders` },
                  { label: 'Reveal Rate', value: `${BATCH_STATS.revealRate}%` },
                  { label: 'Settlement Success', value: `${BATCH_STATS.settlementSuccess}%` },
                  { label: 'Avg Settle Time', value: `${BATCH_STATS.avgSettleTime}s` },
                  { label: 'Total Batches', value: fmtNum(BATCH_STATS.totalBatches) },
                  { label: 'MEV/Batch', value: `$${BATCH_STATS.avgMEVPerBatch}` },
                ].map((stat) => (
                  <div key={stat.label} className="text-center bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                    <div className="text-[10px] text-black-500 font-mono mb-1">{stat.label}</div>
                    <div className="text-base font-bold font-mono" style={{ color: CYAN }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Token Distribution ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Token Distribution" subtitle="VIBE token allocation and circulation" />
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  {TOKEN_DISTRIBUTION.map((d) => (
                    <div key={d.holder}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-black-400">{d.holder}</span>
                        <span className="font-mono">{d.pct}% &middot; {fmtNum(d.tokens)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-black-800 overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${d.pct}%`, backgroundColor: d.color }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  {[
                    { label: 'Total Supply', value: '21,000,000 VIBE' },
                    { label: 'Circulating Supply', value: '1,470,000 VIBE', sub: '7.0% of total supply' },
                    { label: 'Treasury Holdings', value: '7,350,000 VIBE', sub: 'Governed by DAO vote' },
                  ].map((item) => (
                    <div key={item.label} className="bg-black-800/40 rounded-xl p-4 border border-black-800">
                      <div className="text-xs text-black-500 font-mono mb-1">{item.label}</div>
                      <div className="text-xl font-bold font-mono">{item.value}</div>
                      {item.sub && <div className="text-xs text-black-500 mt-1">{item.sub}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Protocol Revenue Waterfall ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Protocol Revenue Waterfall" subtitle="Fee flow: Gross Fees -> Treasury -> Stakers -> Insurance -> Retained" />
              <WaterfallChart steps={WATERFALL_STEPS} />
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                {[
                  { label: 'Treasury (30%)', value: 8_640, color: CYAN },
                  { label: 'Stakers (40%)', value: 11_520, color: '#8b5cf6' },
                  { label: 'Insurance (20%)', value: 5_760, color: '#f97316' },
                  { label: 'Retained (10%)', value: 2_880, color: '#22c55e' },
                ].map((item) => (
                  <div key={item.label} className="bg-black-800/30 rounded-lg p-3">
                    <div className="text-[10px] text-black-500 font-mono">{item.label}</div>
                    <div className="font-bold font-mono" style={{ color: item.color }}>{fmt(item.value)}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

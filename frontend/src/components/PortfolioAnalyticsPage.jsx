import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Animation Variants ============

const stagger = { hidden: {}, show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtPct(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

// ============ Data Generation ============

function generatePortfolioHistory(seed, days, startValue) {
  const rng = seededRandom(seed)
  let value = startValue
  const data = []
  for (let i = 0; i < days; i++) {
    const drift = (rng() - 0.47) * startValue * 0.018
    value = Math.max(value * 0.85, value + drift)
    data.push({ day: i, value: Math.round(value * 100) / 100 })
  }
  return data
}

function generateAssetAllocation(seed) {
  const rng = seededRandom(seed)
  const raw = [
    { name: 'ETH', color: '#627eea', base: 38 },
    { name: 'USDC', color: '#2775ca', base: 22 },
    { name: 'WBTC', color: '#f7931a', base: 16 },
    { name: 'ARB', color: '#28a0f0', base: 9 },
    { name: 'OP', color: '#ff0420', base: 7 },
    { name: 'VIBE', color: CYAN, base: 5 },
    { name: 'Other', color: '#8b5cf6', base: 3 },
  ]
  let total = 0
  const adjusted = raw.map(a => {
    const val = a.base + (rng() - 0.5) * 4
    total += val
    return { ...a, value: val }
  })
  return adjusted.map(a => ({ ...a, pct: (a.value / total) * 100 }))
}

function generatePerformers(seed) {
  const rng = seededRandom(seed)
  const tokens = [['VIBE', 'Ethereum'], ['ARB', 'Arbitrum'], ['OP', 'Optimism'], ['ETH', 'Ethereum'],
    ['WBTC', 'Bitcoin'], ['USDC', 'Ethereum'], ['LINK', 'Ethereum'], ['UNI', 'Ethereum']]
  return tokens.map(([name, chain]) => ({
    name, chain, pnl: (rng() - 0.35) * 4800, pctChange: (rng() - 0.35) * 62, value: 1000 + rng() * 18000,
  })).sort((a, b) => b.pnl - a.pnl)
}

function generateChainDistribution(seed) {
  const rng = seededRandom(seed)
  const chains = [['Ethereum', 28400, 5000, '#627eea'], ['Arbitrum', 12800, 3000, '#28a0f0'],
    ['Optimism', 7200, 2000, '#ff0420'], ['Base', 5600, 1500, '#0052ff'], ['Polygon', 2100, 800, '#8247e5']]
  return chains.map(([chain, base, spread, color]) => ({ chain, value: base + rng() * spread, color }))
}

function generateDefiPositions(seed) {
  const rng = seededRandom(seed)
  const raw = [['VibeSwap Staking', 'Staked', 'VIBE', 4200, 1200, 18.4, 6, CYAN], ['VibeSwap LP', 'Farming', 'ETH/USDC', 8600, 2000, 12.1, 4, '#22c55e'],
    ['Aave V3', 'Lending', 'USDC', 6400, 1800, 4.2, 2, '#b6509e'], ['VibeSwap Vault', 'Staked', 'ETH', 12200, 3000, 5.8, 2, '#627eea'],
    ['Compound', 'Lending', 'WBTC', 3100, 900, 1.8, 1.5, '#00d395'], ['VibeSwap Farm', 'Farming', 'VIBE/ETH', 2800, 700, 42.5, 15, '#f97316']]
  return raw.map(([protocol, type, token, vBase, vSpread, aBase, aSpread, color]) => (
    { protocol, type, token, value: vBase + rng() * vSpread, apy: aBase + rng() * aSpread, color }
  ))
}

function generateBenchmarkData(seed, days) {
  const rng = seededRandom(seed)
  let portfolio = 100, eth = 100, btc = 100
  const data = []
  for (let i = 0; i < days; i++) {
    portfolio += (rng() - 0.46) * 2.8
    eth += (rng() - 0.48) * 3.5
    btc += (rng() - 0.47) * 3.2
    data.push({
      day: i,
      portfolio: Math.max(70, portfolio),
      eth: Math.max(65, eth),
      btc: Math.max(60, btc),
    })
  }
  return data
}

// ============ Static Seed Data (seed 1212) ============

const PERIODS = ['1D', '7D', '1M', '3M', '1Y', 'All']
const PERIOD_DAYS = { '1D': 24, '7D': 7, '1M': 30, '3M': 90, '1Y': 365, 'All': 730 }

const PORTFOLIO_HISTORIES = Object.fromEntries(
  PERIODS.map((p, i) => [p, generatePortfolioHistory(1212 + i * 7, PERIOD_DAYS[p], 58420)])
)

const ASSET_ALLOCATION = generateAssetAllocation(1212)
const PERFORMERS = generatePerformers(1212)
const CHAIN_DISTRIBUTION = generateChainDistribution(1212)
const DEFI_POSITIONS = generateDefiPositions(1212)
const BENCHMARK_DATA = generateBenchmarkData(1212, 90)

const rngRisk = seededRandom(1212)
const RISK_METRICS = {
  sharpeRatio: 1.42 + rngRisk() * 0.6,
  maxDrawdown: -(8.4 + rngRisk() * 7.2),
  volatility: 14.2 + rngRisk() * 8.1,
  sortino: 1.84 + rngRisk() * 0.5,
  beta: 0.82 + rngRisk() * 0.3,
  alpha: 2.1 + rngRisk() * 3.8,
}

const rngPnl = seededRandom(1212)
const PNL_DATA = {
  realizedPnl: 3240 + rngPnl() * 2800,
  unrealizedPnl: 5180 + rngPnl() * 4200,
  totalFeesPaid: 142 + rngPnl() * 210,
  totalMevSaved: 380 + rngPnl() * 300,
  impermanentLoss: -(120 + rngPnl() * 180),
  yieldEarned: 2840 + rngPnl() * 1600,
}

const rngTax = seededRandom(1212)
const TAX_DATA = {
  shortTermGains: 1820 + rngTax() * 1400,
  longTermGains: 3100 + rngTax() * 2200,
  totalLosses: -(640 + rngTax() * 500),
  netTaxable: 0,
  estimatedTax: 0,
  harvestable: -(280 + rngTax() * 400),
}
TAX_DATA.netTaxable = TAX_DATA.shortTermGains + TAX_DATA.longTermGains + TAX_DATA.totalLosses
TAX_DATA.estimatedTax = Math.max(0, TAX_DATA.shortTermGains * 0.37 + TAX_DATA.longTermGains * 0.20 + TAX_DATA.totalLosses * 0.20)

// ============ Section Header ============

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm md:text-base font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
      {subtitle && <p className="text-xs font-mono text-black-400 mt-1 italic">{subtitle}</p>}
      <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
    </div>
  )
}

// ============ Portfolio Value Chart ============

function PortfolioChart({ data, color }) {
  const W = 720, H = 220
  const PAD = { top: 16, right: 16, bottom: 28, left: 60 }
  const iW = W - PAD.left - PAD.right, iH = H - PAD.top - PAD.bottom
  const values = data.map(d => d.value)
  const min = Math.min(...values) * 0.995, max = Math.max(...values) * 1.005
  const range = max - min || 1

  const pts = data.map((d, i) => ({
    x: PAD.left + (i / (data.length - 1)) * iW,
    y: PAD.top + iH - ((d.value - min) / range) * iH,
  }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${PAD.top + iH} L${pts[0].x},${PAD.top + iH} Z`
  const yTicks = Array.from({ length: 5 }, (_, i) => min + (range / 4) * i)

  const startVal = data[0].value, endVal = data[data.length - 1].value
  const change = ((endVal - startVal) / startVal) * 100
  const lineColor = change >= 0 ? color : '#ef4444'

  return (
    <div>
      <div className="flex items-baseline gap-4 mb-3">
        <span className="text-2xl font-bold font-mono">{fmt(endVal)}</span>
        <span className={`text-sm font-mono ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {fmtPct(change)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <defs>
          <linearGradient id="portfolio-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => {
          const y = PAD.top + iH - ((t - min) / range) * iH
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="monospace">
                {fmt(Math.round(t))}
              </text>
            </g>
          )
        })}
        <path d={areaPath} fill="url(#portfolio-fill)" />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4" fill={lineColor} />
      </svg>
    </div>
  )
}

// ============ Donut Chart ============

function DonutChart({ items, size = 180 }) {
  const cx = size / 2, cy = size / 2, outerR = size / 2 - 4, innerR = outerR * 0.62
  let cumAngle = -90

  const arcs = items.map(item => {
    const startAngle = cumAngle
    const sweep = (item.pct / 100) * 360
    cumAngle += sweep
    const endAngle = startAngle + sweep

    const startRad = (startAngle * Math.PI) / 180
    const endRad = (endAngle * Math.PI) / 180

    const x1 = cx + outerR * Math.cos(startRad)
    const y1 = cy + outerR * Math.sin(startRad)
    const x2 = cx + outerR * Math.cos(endRad)
    const y2 = cy + outerR * Math.sin(endRad)
    const ix1 = cx + innerR * Math.cos(endRad)
    const iy1 = cy + innerR * Math.sin(endRad)
    const ix2 = cx + innerR * Math.cos(startRad)
    const iy2 = cy + innerR * Math.sin(startRad)

    const largeArc = sweep > 180 ? 1 : 0
    const d = [
      `M${x1},${y1}`,
      `A${outerR},${outerR} 0 ${largeArc},1 ${x2},${y2}`,
      `L${ix1},${iy1}`,
      `A${innerR},${innerR} 0 ${largeArc},0 ${ix2},${iy2}`,
      'Z',
    ].join(' ')

    return { ...item, d }
  })

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto" style={{ maxWidth: size }}>
      {arcs.map((arc, i) => (
        <path key={i} d={arc.d} fill={arc.color} opacity="0.85" stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="10" fontFamily="monospace">
        Portfolio
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="white" fontSize="13" fontFamily="monospace" fontWeight="bold">
        {fmt(58420)}
      </text>
    </svg>
  )
}

// ============ Benchmark Chart ============

function BenchmarkChart({ data }) {
  const W = 720, H = 200
  const PAD = { top: 16, right: 80, bottom: 28, left: 48 }
  const iW = W - PAD.left - PAD.right, iH = H - PAD.top - PAD.bottom

  const allVals = data.flatMap(d => [d.portfolio, d.eth, d.btc])
  const min = Math.min(...allVals) * 0.98, max = Math.max(...allVals) * 1.02
  const range = max - min || 1

  const makeLine = (key) => data.map((d, i) => {
    const x = PAD.left + (i / (data.length - 1)) * iW
    const y = PAD.top + iH - ((d[key] - min) / range) * iH
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')

  const lines = [
    { key: 'portfolio', color: CYAN, label: 'Portfolio' },
    { key: 'eth', color: '#627eea', label: 'ETH' },
    { key: 'btc', color: '#f7931a', label: 'BTC' },
  ]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
        const y = PAD.top + iH - pct * iH
        const val = min + pct * range
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="monospace">
              {val.toFixed(0)}
            </text>
          </g>
        )
      })}
      {lines.map(l => (
        <g key={l.key}>
          <path d={makeLine(l.key)} fill="none" stroke={l.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
          <text
            x={PAD.left + iW + 8}
            y={PAD.top + iH - ((data[data.length - 1][l.key] - min) / range) * iH + 4}
            fill={l.color} fontSize="10" fontFamily="monospace"
          >
            {l.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ============ Main Component ============

export default function PortfolioAnalyticsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [period, setPeriod] = useState('1M')

  const portfolioData = useMemo(() => PORTFOLIO_HISTORIES[period] || PORTFOLIO_HISTORIES['1M'], [period])

  const performers = useMemo(() => PERFORMERS, [])
  const bestPerformers = performers.slice(0, 3)
  const worstPerformers = performers.slice(-3).reverse()

  const chainTotal = useMemo(() => CHAIN_DISTRIBUTION.reduce((s, c) => s + c.value, 0), [])
  const defiTotal = useMemo(() => DEFI_POSITIONS.reduce((s, p) => s + p.value, 0), [])

  const defiByType = useMemo(() => {
    const groups = {}
    DEFI_POSITIONS.forEach(p => {
      if (!groups[p.type]) groups[p.type] = 0
      groups[p.type] += p.value
    })
    return Object.entries(groups).map(([type, value]) => ({ type, value }))
  }, [])

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title="Portfolio Analytics"
        subtitle="Track performance, risk, and allocation across all chains"
        category="account"
        badge="Live"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4">
        <motion.div variants={stagger} initial="hidden" animate="show">

          {/* ============ 1. Portfolio Value Chart ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" spotlight className="p-6">
              <div className="flex items-center justify-between mb-4">
                <SectionHeader title="Portfolio Value" subtitle="Total portfolio value over time" />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
                  {PERIODS.map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                        period === p ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              {isConnected ? (
                <PortfolioChart data={portfolioData} color={CYAN} />
              ) : (
                <div className="text-center py-16 text-black-500 text-sm">
                  Sign in to view portfolio history
                </div>
              )}
            </GlassCard>
          </motion.div>

          {/* ============ 2. Asset Allocation Donut ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Asset Allocation" subtitle="Portfolio composition by token" />
              <div className="grid md:grid-cols-2 gap-6 items-center">
                <div className="flex justify-center">
                  <DonutChart items={ASSET_ALLOCATION} size={200} />
                </div>
                <div className="space-y-2">
                  {ASSET_ALLOCATION.map(a => (
                    <div key={a.name} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                      <span className="text-sm text-black-300 flex-1">{a.name}</span>
                      <span className="text-sm font-mono text-black-400">{a.pct.toFixed(1)}%</span>
                      <div className="w-24 h-1.5 rounded-full bg-black-800 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${a.pct}%`, backgroundColor: a.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ 3. PnL Breakdown ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="PnL Breakdown" subtitle="Realized vs unrealized profit and loss" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Realized PnL', value: PNL_DATA.realizedPnl, color: '#22c55e' },
                  { label: 'Unrealized PnL', value: PNL_DATA.unrealizedPnl, color: CYAN },
                  { label: 'Yield Earned', value: PNL_DATA.yieldEarned, color: '#a855f7' },
                  { label: 'Fees Paid', value: -PNL_DATA.totalFeesPaid, color: '#ef4444' },
                  { label: 'MEV Saved', value: PNL_DATA.totalMevSaved, color: '#22c55e' },
                  { label: 'IL Exposure', value: PNL_DATA.impermanentLoss, color: '#f97316' },
                ].map(item => (
                  <div key={item.label} className="text-center bg-black-800/30 rounded-xl p-4 border border-black-800/50">
                    <div className="text-[10px] text-black-500 font-mono mb-2 uppercase tracking-wider">{item.label}</div>
                    <div className="text-base font-bold font-mono" style={{ color: item.color }}>
                      {item.value >= 0 ? '+' : ''}{fmt(item.value)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-4 rounded-xl bg-black-900/50 flex items-center justify-between">
                <span className="text-sm text-black-400 font-mono">Total PnL</span>
                <span className="text-xl font-bold font-mono" style={{ color: CYAN }}>
                  +{fmt(PNL_DATA.realizedPnl + PNL_DATA.unrealizedPnl + PNL_DATA.yieldEarned + PNL_DATA.impermanentLoss - PNL_DATA.totalFeesPaid)}
                </span>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ 4. Best & Worst Performers ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <div className="grid md:grid-cols-2 gap-4">
              <GlassCard glowColor="terminal" className="p-6">
                <SectionHeader title="Best Performers" subtitle="Top gainers by absolute PnL" />
                <div className="space-y-3">
                  {bestPerformers.map((t, i) => (
                    <div key={t.name} className="flex items-center justify-between p-3 rounded-xl bg-black-800/30 border border-black-800/50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-green-500/10 text-green-400">
                          #{i + 1}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{t.name}</div>
                          <div className="text-xs text-black-500">{t.chain}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono text-green-400">+{fmt(Math.abs(t.pnl))}</div>
                        <div className="text-xs font-mono text-green-400/70">{fmtPct(Math.abs(t.pctChange))}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
              <GlassCard glowColor="terminal" className="p-6">
                <SectionHeader title="Worst Performers" subtitle="Largest drawdowns by absolute PnL" />
                <div className="space-y-3">
                  {worstPerformers.map((t, i) => (
                    <div key={t.name} className="flex items-center justify-between p-3 rounded-xl bg-black-800/30 border border-black-800/50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-red-500/10 text-red-400">
                          #{performers.length - i}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{t.name}</div>
                          <div className="text-xs text-black-500">{t.chain}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono text-red-400">{fmt(t.pnl)}</div>
                        <div className="text-xs font-mono text-red-400/70">{fmtPct(t.pctChange)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>
          </motion.div>

          {/* ============ 5. Risk Metrics ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Risk Metrics" subtitle="Sharpe ratio, drawdown, volatility, and more" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Sharpe Ratio', value: RISK_METRICS.sharpeRatio.toFixed(2), good: RISK_METRICS.sharpeRatio > 1 },
                  { label: 'Max Drawdown', value: `${RISK_METRICS.maxDrawdown.toFixed(1)}%`, good: RISK_METRICS.maxDrawdown > -15 },
                  { label: 'Volatility', value: `${RISK_METRICS.volatility.toFixed(1)}%`, good: RISK_METRICS.volatility < 25 },
                  { label: 'Sortino Ratio', value: RISK_METRICS.sortino.toFixed(2), good: RISK_METRICS.sortino > 1.5 },
                  { label: 'Beta', value: RISK_METRICS.beta.toFixed(2), good: true },
                  { label: 'Alpha', value: `${RISK_METRICS.alpha >= 0 ? '+' : ''}${RISK_METRICS.alpha.toFixed(2)}%`, good: RISK_METRICS.alpha > 0 },
                ].map(m => (
                  <div key={m.label} className="text-center bg-black-800/30 rounded-xl p-4 border border-black-800/50">
                    <div className="text-[10px] text-black-500 font-mono mb-2 uppercase tracking-wider">{m.label}</div>
                    <div className="text-lg font-bold font-mono" style={{ color: m.good ? '#22c55e' : '#f97316' }}>
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid md:grid-cols-3 gap-3">
                {[
                  { label: 'Risk Assessment', value: RISK_METRICS.sharpeRatio > 1.5 ? 'Well-balanced' : RISK_METRICS.sharpeRatio > 1 ? 'Moderate' : 'Needs rebalancing',
                    color: RISK_METRICS.sharpeRatio > 1.5 ? '#22c55e' : RISK_METRICS.sharpeRatio > 1 ? '#eab308' : '#ef4444' },
                  { label: 'Drawdown Recovery', value: `~${Math.ceil(Math.abs(RISK_METRICS.maxDrawdown) / (RISK_METRICS.alpha > 0 ? RISK_METRICS.alpha : 1) * 30)} days est.`, color: null },
                  { label: 'Risk-adj Return', value: `${(RISK_METRICS.sharpeRatio * RISK_METRICS.volatility).toFixed(1)}% ann.`, color: CYAN },
                ].map(r => (
                  <div key={r.label} className="p-3 rounded-xl bg-black-900/50">
                    <div className="text-xs text-black-500 mb-1">{r.label}</div>
                    <div className="text-sm font-mono" style={r.color ? { color: r.color } : undefined}>{r.value}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ 6. Chain Distribution ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Chain Distribution" subtitle="Portfolio allocation across networks" />
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  {CHAIN_DISTRIBUTION.map(c => (
                    <div key={c.chain}>
                      <div className="flex justify-between text-sm mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                          <span className="text-black-300">{c.chain}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-black-400">{((c.value / chainTotal) * 100).toFixed(1)}%</span>
                          <span className="font-mono text-sm">{fmt(c.value)}</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-black-800 overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: c.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${(c.value / chainTotal) * 100}%` }}
                          transition={{ duration: 1 / PHI, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[['Total Value', fmt(chainTotal)], ['Chains Active', String(CHAIN_DISTRIBUTION.length)],
                    ['Primary Chain', CHAIN_DISTRIBUTION[0].chain], ['Diversification', CHAIN_DISTRIBUTION.length >= 4 ? 'Good' : 'Low'],
                  ].map(([label, value]) => (
                    <div key={label} className="p-3 rounded-xl bg-black-800/30 text-center border border-black-800/50">
                      <div className="text-[10px] text-black-500 font-mono mb-1 uppercase">{label}</div>
                      <div className="text-sm font-bold font-mono" style={{ color: CYAN }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ 7. DeFi Position Summary ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="DeFi Positions" subtitle="Active positions across staking, farming, and lending" />
              <div className="grid grid-cols-3 gap-3 mb-5">
                {defiByType.map(g => (
                  <div key={g.type} className="text-center p-3 rounded-xl bg-black-800/30 border border-black-800/50">
                    <div className="text-[10px] text-black-500 font-mono mb-1 uppercase">{g.type}</div>
                    <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>{fmt(g.value)}</div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-black-500 border-b border-black-800 text-xs uppercase tracking-wider">
                      <th className="pb-3 font-medium">Protocol</th>
                      <th className="pb-3 font-medium">Type</th>
                      <th className="pb-3 font-medium">Token</th>
                      <th className="pb-3 font-medium text-right">Value</th>
                      <th className="pb-3 font-medium text-right">30d Fees</th>
                      <th className="pb-3 font-medium text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DEFI_POSITIONS.map(p => (
                      <tr key={p.protocol} className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                            <span className="font-medium">{p.protocol}</span>
                          </div>
                        </td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-black-700/50 text-black-400">
                            {p.type}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-black-300">{p.token}</td>
                        <td className="py-3 text-right font-mono">{fmt(p.value)}</td>
                        <td className="py-3 text-right font-mono" style={{ color: CYAN }}>{p.apy.toFixed(1)}%</td>
                        <td className="py-3 text-right font-mono text-black-400">{((p.value / defiTotal) * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between p-3 rounded-xl bg-black-900/50">
                <span className="text-sm text-black-400 font-mono">Total DeFi Positions</span>
                <span className="text-lg font-bold font-mono" style={{ color: CYAN }}>{fmt(defiTotal)}</span>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ 8. Performance vs Benchmarks ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Performance vs Benchmarks" subtitle="Portfolio returns compared to ETH and BTC (90-day, rebased to 100)" />
              <BenchmarkChart data={BENCHMARK_DATA} />
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[['Portfolio', BENCHMARK_DATA[BENCHMARK_DATA.length - 1].portfolio, CYAN],
                  ['ETH', BENCHMARK_DATA[BENCHMARK_DATA.length - 1].eth, '#627eea'],
                  ['BTC', BENCHMARK_DATA[BENCHMARK_DATA.length - 1].btc, '#f7931a'],
                ].map(([label, val, color]) => (
                  <div key={label} className="p-3 rounded-xl bg-black-800/30 border border-black-800/50">
                    <div className="text-xs text-black-500 font-mono mb-1">{label}</div>
                    <div className="text-lg font-bold font-mono" style={{ color }}>
                      {val - 100 >= 0 ? '+' : ''}{(val - 100).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ 9. Tax Implications Estimate ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Tax Implications" subtitle="Estimated tax obligations (not financial advice)" />
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  {[
                    { label: 'Short-term Gains', value: TAX_DATA.shortTermGains, sub: 'Held < 1 year (ordinary rate)', color: '#f97316' },
                    { label: 'Long-term Gains', value: TAX_DATA.longTermGains, sub: 'Held > 1 year (capital gains rate)', color: '#22c55e' },
                    { label: 'Realized Losses', value: TAX_DATA.totalLosses, sub: 'Offsets gains dollar-for-dollar', color: '#ef4444' },
                    { label: 'Harvestable Losses', value: TAX_DATA.harvestable, sub: 'Unrealized losses you could realize', color: '#eab308' },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between p-3 rounded-xl bg-black-800/30 border border-black-800/50">
                      <div>
                        <div className="text-sm font-medium">{item.label}</div>
                        <div className="text-xs text-black-500">{item.sub}</div>
                      </div>
                      <div className="text-right font-mono font-bold" style={{ color: item.color }}>
                        {item.value >= 0 ? '+' : ''}{fmt(item.value)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  <div className="p-5 rounded-xl bg-black-900/60 border border-black-800">
                    <div className="text-xs text-black-500 font-mono mb-2 uppercase tracking-wider">Net Taxable Amount</div>
                    <div className="text-2xl font-bold font-mono" style={{ color: TAX_DATA.netTaxable >= 0 ? '#f97316' : '#22c55e' }}>
                      {fmt(TAX_DATA.netTaxable)}
                    </div>
                  </div>
                  <div className="p-5 rounded-xl bg-black-900/60 border border-red-500/10">
                    <div className="text-xs text-black-500 font-mono mb-2 uppercase tracking-wider">Estimated Tax Owed</div>
                    <div className="text-2xl font-bold font-mono text-red-400">
                      {fmt(TAX_DATA.estimatedTax)}
                    </div>
                    <div className="text-xs text-black-500 mt-2">
                      Based on 37% short-term / 20% long-term rates
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/10">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <p className="text-xs text-black-400 leading-relaxed">
                        This is an estimate only. Consult a tax professional for accurate calculations.
                        Tax laws vary by jurisdiction. VibeSwap does not provide tax advice.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Footer ============ */}
          <motion.div variants={fadeUp} className="text-center pb-8">
            <p className="text-xs text-black-500">
              Portfolio analytics are for informational purposes only. Past performance does not guarantee future results.
            </p>
            <div className="flex items-center justify-center space-x-2 mt-2 text-xs text-black-600">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Data secured by VibeSwap commit-reveal architecture</span>
            </div>
          </motion.div>

        </motion.div>
      </div>
    </div>
  )
}

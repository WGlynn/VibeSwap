import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Data Generation (seed 2626) ============

const rng = seededRandom(2626)

function pick(arr) { return arr[Math.floor(rng() * arr.length)] }
function range(n, fn) { return Array.from({ length: n }, (_, i) => fn(i)) }
function pctChange() { return (rng() - 0.42) * 30 }
function price(base, variance) { return +(base + (rng() - 0.5) * variance).toFixed(2) }

const TOKEN_NAMES = [
  'ETH', 'BTC', 'SOL', 'ARB', 'OP', 'AVAX', 'MATIC', 'LINK',
  'UNI', 'AAVE', 'MKR', 'SNX', 'CRV', 'LDO', 'RPL', 'GMX',
  'DYDX', 'PENDLE', 'ENA', 'EIGEN', 'TAO', 'RENDER', 'FET',
  'ONDO', 'MANTLE', 'SEI', 'TIA', 'INJ', 'SUI', 'APT',
  'PEPE', 'BONK', 'WIF', 'FLOKI', 'MEME', 'DOGE', 'SHIB',
  'IMX', 'GALA', 'AXS', 'SAND', 'MANA', 'ILV', 'PRIME',
  'SUPER', 'BEAM', 'PIXEL', 'PORTAL', 'XAI', 'MYRIA',
]

const TOKEN_CATEGORIES = {
  ETH: 'L1', BTC: 'L1', SOL: 'L1', AVAX: 'L1', SUI: 'L1', APT: 'L1', SEI: 'L1', INJ: 'L1',
  ARB: 'L2', OP: 'L2', MATIC: 'L2', MANTLE: 'L2', TIA: 'L2',
  LINK: 'DeFi', UNI: 'DeFi', AAVE: 'DeFi', MKR: 'DeFi', SNX: 'DeFi', CRV: 'DeFi',
  LDO: 'DeFi', RPL: 'DeFi', GMX: 'DeFi', DYDX: 'DeFi', PENDLE: 'DeFi', ENA: 'DeFi',
  TAO: 'AI', RENDER: 'AI', FET: 'AI', EIGEN: 'AI',
  ONDO: 'RWA',
  PEPE: 'Memes', BONK: 'Memes', WIF: 'Memes', FLOKI: 'Memes', MEME: 'Memes', DOGE: 'Memes', SHIB: 'Memes',
  IMX: 'Gaming', GALA: 'Gaming', AXS: 'Gaming', SAND: 'Gaming', MANA: 'Gaming', ILV: 'Gaming',
  PRIME: 'Gaming', SUPER: 'Gaming', BEAM: 'Gaming', PIXEL: 'Gaming', PORTAL: 'Gaming', XAI: 'Gaming', MYRIA: 'Gaming',
}

const BASE_PRICES = {
  BTC: 67420, ETH: 3840, SOL: 178, ARB: 1.82, OP: 3.45, AVAX: 42.6, MATIC: 0.92,
  LINK: 18.4, UNI: 12.3, AAVE: 142, MKR: 2840, SNX: 4.2, CRV: 0.68, LDO: 2.9,
  RPL: 28.4, GMX: 48.2, DYDX: 3.4, PENDLE: 6.8, ENA: 1.24, EIGEN: 4.6, TAO: 580,
  RENDER: 11.2, FET: 2.8, ONDO: 1.42, MANTLE: 0.78, SEI: 0.82, TIA: 14.6, INJ: 34.2,
  SUI: 1.84, APT: 12.4, PEPE: 0.0000124, BONK: 0.0000268, WIF: 2.84, FLOKI: 0.000182,
  MEME: 0.032, DOGE: 0.168, SHIB: 0.0000284, IMX: 2.4, GALA: 0.048, AXS: 9.8,
  SAND: 0.62, MANA: 0.58, ILV: 112, PRIME: 18.4, SUPER: 1.24, BEAM: 0.032,
  PIXEL: 0.42, PORTAL: 0.88, XAI: 0.94, MYRIA: 0.012,
}

// Generate token market data
const ALL_TOKENS = TOKEN_NAMES.map((name) => {
  const basePrice = BASE_PRICES[name] || 1
  const change24h = pctChange()
  const change7d = pctChange() * 1.8
  const vol24h = Math.round((rng() * 800 + 20) * 1_000_000)
  const mcap = Math.round((rng() * 40 + 0.5) * 1_000_000_000)
  return {
    name,
    category: TOKEN_CATEGORIES[name] || 'Other',
    price: price(basePrice, basePrice * 0.05),
    change24h: +change24h.toFixed(2),
    change7d: +change7d.toFixed(2),
    volume24h: vol24h,
    marketCap: mcap,
    sparkline: range(24, () => +(50 + rng() * 50).toFixed(1)),
  }
})

// Sort by market cap descending for volume leaders
const VOLUME_LEADERS = [...ALL_TOKENS].sort((a, b) => b.volume24h - a.volume24h).slice(0, 8)

// Top gainers and losers
const SORTED_BY_CHANGE = [...ALL_TOKENS].sort((a, b) => b.change24h - a.change24h)
const TOP_GAINERS = SORTED_BY_CHANGE.slice(0, 6)
const TOP_LOSERS = SORTED_BY_CHANGE.slice(-6).reverse()

// Trending tokens (high volume + positive change)
const TRENDING = [...ALL_TOKENS]
  .sort((a, b) => (b.volume24h * Math.max(b.change24h, 0.1)) - (a.volume24h * Math.max(a.change24h, 0.1)))
  .slice(0, 8)

// New listings
const rng2 = seededRandom(2627)
const NEW_LISTINGS = [
  { name: 'VIBE', price: 0.42, change24h: 184.2, listed: '2h ago', category: 'DeFi' },
  { name: 'ZKEVM', price: 1.84, change24h: 42.8, listed: '6h ago', category: 'L2' },
  { name: 'NEURAL', price: 0.68, change24h: -12.4, listed: '14h ago', category: 'AI' },
  { name: 'RWAX', price: 3.24, change24h: 28.6, listed: '1d ago', category: 'RWA' },
  { name: 'PIXL', price: 0.094, change24h: 68.4, listed: '1d ago', category: 'Gaming' },
  { name: 'OMNI', price: 22.40, change24h: -4.2, listed: '2d ago', category: 'L2' },
]

// Category performance
const CATEGORIES = [
  { name: 'DeFi', change: +((rng2() - 0.35) * 12).toFixed(1), tvl: '$48.2B', icon: '\u2696', color: '#22c55e' },
  { name: 'L2s', change: +((rng2() - 0.35) * 12).toFixed(1), tvl: '$18.6B', icon: '\u26A1', color: '#3b82f6' },
  { name: 'AI', change: +((rng2() - 0.35) * 14).toFixed(1), tvl: '$6.4B', icon: '\u2699', color: '#a855f7' },
  { name: 'Memes', change: +((rng2() - 0.35) * 20).toFixed(1), tvl: '$22.1B', icon: '\u2728', color: '#eab308' },
  { name: 'RWA', change: +((rng2() - 0.35) * 8).toFixed(1), tvl: '$8.8B', icon: '\u2302', color: '#f97316' },
  { name: 'Gaming', change: +((rng2() - 0.35) * 16).toFixed(1), tvl: '$4.2B', icon: '\u265E', color: '#ec4899' },
]

// Global stats
const GLOBAL_STATS = {
  totalMarketCap: '$2.68T',
  marketCapChange: +1.42,
  volume24h: '$148.2B',
  volumeChange: +8.6,
  defiTVL: '$108.4B',
  tvlChange: +2.1,
  gasAverage: '12 gwei',
  gasChange: -18.4,
}

// Fear & Greed
const rng3 = seededRandom(2628)
const FEAR_GREED_VALUE = Math.round(40 + rng3() * 45) // 40-85 range
const FEAR_GREED_LABEL = FEAR_GREED_VALUE >= 75 ? 'Extreme Greed'
  : FEAR_GREED_VALUE >= 55 ? 'Greed'
  : FEAR_GREED_VALUE >= 45 ? 'Neutral'
  : FEAR_GREED_VALUE >= 25 ? 'Fear'
  : 'Extreme Fear'
const FEAR_GREED_COLOR = FEAR_GREED_VALUE >= 75 ? '#22c55e'
  : FEAR_GREED_VALUE >= 55 ? '#84cc16'
  : FEAR_GREED_VALUE >= 45 ? '#eab308'
  : FEAR_GREED_VALUE >= 25 ? '#f97316'
  : '#ef4444'
const FEAR_GREED_HISTORY = range(30, (i) => ({
  day: i + 1,
  value: Math.round(30 + rng3() * 55),
}))

// BTC dominance data
const rng4 = seededRandom(2629)
const BTC_DOMINANCE = 54.2 + (rng4() - 0.5) * 4
const BTC_DOMINANCE_HISTORY = range(30, (i) => {
  const base = 52 + (i / 30) * 3
  return { day: i + 1, value: +(base + (rng4() - 0.5) * 2).toFixed(1) }
})

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function fmtPrice(p) {
  if (p >= 1000) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (p >= 1) return `$${p.toFixed(2)}`
  if (p >= 0.001) return `$${p.toFixed(4)}`
  return `$${p.toFixed(8)}`
}

function ChangeText({ value, className = '' }) {
  const isPos = value >= 0
  return (
    <span className={`font-mono ${isPos ? 'text-green-400' : 'text-red-400'} ${className}`}>
      {isPos ? '+' : ''}{value}%
    </span>
  )
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

// ============ Mini Sparkline ============

function MiniSparkline({ data, color = CYAN, width = 80, height = 28 }) {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ============ Area Line Chart ============

function AreaLineChart({ data, color, gradientId, height = 140 }) {
  const W = 600, H = height
  const PAD = { top: 12, right: 12, bottom: 24, left: 44 }
  const iW = W - PAD.left - PAD.right, iH = H - PAD.top - PAD.bottom
  const values = data.map((d) => d.value)
  const min = Math.min(...values) * 0.95, max = Math.max(...values) * 1.05
  const rng = max - min || 1

  const pts = data.map((d, i) => ({
    x: PAD.left + (i / (data.length - 1)) * iW,
    y: PAD.top + iH - ((d.value - min) / rng) * iH,
  }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${PAD.top + iH} L${pts[0].x},${PAD.top + iH} Z`
  const yTicks = Array.from({ length: 4 }, (_, i) => min + (rng / 3) * i)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((t, i) => {
        const y = PAD.top + iH - ((t - min) / rng) * iH
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.05)" />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">
              {t.toFixed(1)}
            </text>
          </g>
        )
      })}
      {data.filter((_, i) => i % 7 === 0).map((d) => {
        const idx = data.indexOf(d)
        return (
          <text key={idx} x={PAD.left + (idx / (data.length - 1)) * iW} y={H - 4}
            textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">
            D{d.day}
          </text>
        )
      })}
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3" fill={color} />
    </svg>
  )
}

// ============ Fear & Greed Gauge ============

function FearGreedGauge({ value, label, color }) {
  const angle = -90 + (value / 100) * 180
  const R = 70, cx = 90, cy = 85
  return (
    <svg viewBox="0 0 180 110" className="w-full max-w-[240px] mx-auto">
      {/* Background arc */}
      <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" strokeLinecap="round" />
      {/* Gradient arc segments */}
      {[
        { start: -180, end: -144, color: '#ef4444' },
        { start: -144, end: -108, color: '#f97316' },
        { start: -108, end: -72, color: '#eab308' },
        { start: -72, end: -36, color: '#84cc16' },
        { start: -36, end: 0, color: '#22c55e' },
      ].map(({ start, end, color: c }, i) => {
        const startRad = (start * Math.PI) / 180
        const endRad = (end * Math.PI) / 180
        const x1 = cx + R * Math.cos(startRad)
        const y1 = cy + R * Math.sin(startRad)
        const x2 = cx + R * Math.cos(endRad)
        const y2 = cy + R * Math.sin(endRad)
        return (
          <path key={i}
            d={`M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`}
            fill="none" stroke={c} strokeWidth="10" strokeLinecap="round" opacity="0.3" />
        )
      })}
      {/* Needle */}
      <line
        x1={cx} y1={cy}
        x2={cx + 55 * Math.cos((angle * Math.PI) / 180)}
        y2={cy + 55 * Math.sin((angle * Math.PI) / 180)}
        stroke={color} strokeWidth="2.5" strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="4" fill={color} />
      {/* Value */}
      <text x={cx} y={cy - 16} textAnchor="middle" fill="white" fontSize="22" fontWeight="bold" fontFamily="monospace">
        {value}
      </text>
      <text x={cx} y={cy + 2} textAnchor="middle" fill={color} fontSize="10" fontFamily="monospace">
        {label}
      </text>
    </svg>
  )
}

// ============ Section Header ============

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-black-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}

// ============ Heatmap Cell ============

function HeatmapCell({ token }) {
  const intensity = Math.min(Math.abs(token.change24h) / 15, 1)
  const isPos = token.change24h >= 0
  const bg = isPos
    ? `rgba(34, 197, 94, ${0.1 + intensity * 0.5})`
    : `rgba(239, 68, 68, ${0.1 + intensity * 0.5})`
  const border = isPos
    ? `rgba(34, 197, 94, ${0.15 + intensity * 0.3})`
    : `rgba(239, 68, 68, ${0.15 + intensity * 0.3})`
  const sizeClass = token.marketCap > 20_000_000_000
    ? 'col-span-2 row-span-2'
    : token.marketCap > 5_000_000_000
    ? 'col-span-2'
    : ''

  return (
    <motion.div
      whileHover={{ scale: 1.05, zIndex: 10 }}
      className={`rounded-lg p-2 flex flex-col items-center justify-center cursor-pointer transition-colors ${sizeClass}`}
      style={{ backgroundColor: bg, border: `1px solid ${border}` }}
    >
      <span className="text-xs font-mono font-bold">{token.name}</span>
      <span className={`text-[10px] font-mono ${isPos ? 'text-green-300' : 'text-red-300'}`}>
        {isPos ? '+' : ''}{token.change24h}%
      </span>
    </motion.div>
  )
}

// ============ Main Component ============

export default function MarketOverviewPage() {
  const [activeTab, setActiveTab] = useState('gainers')
  const [heatmapCategory, setHeatmapCategory] = useState('All')

  // Dual wallet detection
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // Filter heatmap tokens
  const heatmapTokens = useMemo(() => {
    if (heatmapCategory === 'All') return ALL_TOKENS.slice(0, 30)
    return ALL_TOKENS.filter((t) => t.category === heatmapCategory).slice(0, 20)
  }, [heatmapCategory])

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title="Market Overview"
        subtitle="Real-time crypto market data, trends, and sentiment analysis"
        category="defi"
        badge="Live"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4">
        <motion.div variants={stagger} initial="hidden" animate="show">

          {/* ============ Global Stats ============ */}
          <motion.div variants={fadeUp} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Market Cap', value: GLOBAL_STATS.totalMarketCap, change: GLOBAL_STATS.marketCapChange },
              { label: '24h Volume', value: GLOBAL_STATS.volume24h, change: GLOBAL_STATS.volumeChange },
              { label: 'DeFi TVL', value: GLOBAL_STATS.defiTVL, change: GLOBAL_STATS.tvlChange },
              { label: 'Gas Average', value: GLOBAL_STATS.gasAverage, change: GLOBAL_STATS.gasChange },
            ].map((stat) => (
              <GlassCard key={stat.label} glowColor="terminal" className="p-4">
                <div className="text-[10px] text-black-500 font-mono uppercase tracking-wider mb-1">{stat.label}</div>
                <div className="text-xl font-bold font-mono" style={{ color: CYAN }}>{stat.value}</div>
                <ChangeText value={stat.change} className="text-xs" />
              </GlassCard>
            ))}
          </motion.div>

          {/* ============ Top Gainers / Losers ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <SectionHeader title="Top Movers" subtitle="24h price performance" />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
                  {['gainers', 'losers'].map((tab) => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono capitalize transition-colors ${
                        activeTab === tab ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'
                      }`}>{tab}</button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-black-500 border-b border-black-800">
                      <th className="pb-3 font-medium">#</th>
                      <th className="pb-3 font-medium">Token</th>
                      <th className="pb-3 font-medium text-right">Price</th>
                      <th className="pb-3 font-medium text-right">24h</th>
                      <th className="pb-3 font-medium text-right">7d</th>
                      <th className="pb-3 font-medium text-right">Volume</th>
                      <th className="pb-3 font-medium text-right">Chart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeTab === 'gainers' ? TOP_GAINERS : TOP_LOSERS).map((token, i) => (
                      <tr key={token.name} className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors">
                        <td className="py-3 text-black-500 font-mono text-xs">{i + 1}</td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                              style={{ backgroundColor: `${CYAN}20`, color: CYAN }}>
                              {token.name.slice(0, 2)}
                            </div>
                            <div>
                              <span className="font-mono font-medium">{token.name}</span>
                              <span className="text-black-500 text-xs ml-2">{token.category}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-right font-mono">{fmtPrice(token.price)}</td>
                        <td className="py-3 text-right"><ChangeText value={token.change24h} /></td>
                        <td className="py-3 text-right"><ChangeText value={token.change7d} /></td>
                        <td className="py-3 text-right font-mono text-black-400">{fmt(token.volume24h)}</td>
                        <td className="py-3 text-right">
                          <MiniSparkline data={token.sparkline} color={token.change24h >= 0 ? '#22c55e' : '#ef4444'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Trending Tokens ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Trending Tokens" subtitle="Most active by volume-weighted momentum" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {TRENDING.map((token, i) => (
                  <motion.div key={token.name}
                    whileHover={{ y: -2, transition: { duration: 1 / (PHI * PHI * PHI) } }}
                    className="bg-black-800/40 rounded-xl p-3 border border-black-800/50 cursor-pointer hover:border-black-700 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
                          style={{ backgroundColor: `${CYAN}20`, color: CYAN }}>
                          {token.name.slice(0, 2)}
                        </div>
                        <span className="font-mono text-sm font-medium">{token.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-black-500">#{i + 1}</span>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="font-mono text-sm">{fmtPrice(token.price)}</div>
                        <ChangeText value={token.change24h} className="text-xs" />
                      </div>
                      <MiniSparkline data={token.sparkline} color={token.change24h >= 0 ? '#22c55e' : '#ef4444'} width={56} height={22} />
                    </div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Market Heatmap ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <SectionHeader title="Market Heatmap" subtitle="Token performance by 24h price change" />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50 flex-wrap">
                  {['All', 'DeFi', 'L2', 'AI', 'Memes', 'Gaming'].map((cat) => (
                    <button key={cat} onClick={() => setHeatmapCategory(cat === 'L2' ? 'L2' : cat)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors ${
                        heatmapCategory === cat ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'
                      }`}>{cat}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1.5 auto-rows-[48px]">
                {heatmapTokens.map((token) => (
                  <HeatmapCell key={token.name} token={token} />
                ))}
              </div>
              <div className="flex items-center justify-center gap-4 mt-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.6)' }} />
                  <span className="text-[10px] text-black-500 font-mono">Bearish</span>
                </div>
                <div className="w-24 h-2 rounded-full" style={{
                  background: 'linear-gradient(to right, rgba(239,68,68,0.5), rgba(255,255,255,0.08), rgba(34,197,94,0.5))'
                }} />
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 197, 94, 0.6)' }} />
                  <span className="text-[10px] text-black-500 font-mono">Bullish</span>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Category Performance ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Category Performance" subtitle="Sector-level 24h performance and TVL" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {CATEGORIES.map((cat) => {
                  const isPos = cat.change >= 0
                  return (
                    <motion.div key={cat.name}
                      whileHover={{ y: -3, transition: { duration: 1 / (PHI * PHI * PHI) } }}
                      className="bg-black-800/40 rounded-xl p-4 border border-black-800/50 text-center cursor-pointer hover:border-black-700 transition-colors"
                    >
                      <div className="text-2xl mb-2">{cat.icon}</div>
                      <div className="font-semibold text-sm mb-1">{cat.name}</div>
                      <div className={`font-mono text-lg font-bold ${isPos ? 'text-green-400' : 'text-red-400'}`}>
                        {isPos ? '+' : ''}{cat.change}%
                      </div>
                      <div className="text-[10px] text-black-500 font-mono mt-1">TVL {cat.tvl}</div>
                      <div className="mt-2 h-1 rounded-full overflow-hidden bg-black-700">
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(Math.abs(cat.change) * 5 + 20, 100)}%`,
                          backgroundColor: cat.color,
                          opacity: 0.7,
                        }} />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Fear & Greed + BTC Dominance Row ============ */}
          <motion.div variants={fadeUp} className="grid md:grid-cols-2 gap-4 mb-8">
            {/* Fear & Greed Index */}
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Fear & Greed Index" subtitle="Composite market sentiment indicator" />
              <FearGreedGauge value={FEAR_GREED_VALUE} label={FEAR_GREED_LABEL} color={FEAR_GREED_COLOR} />
              <div className="mt-4">
                <div className="text-xs text-black-500 font-mono mb-2">30-Day History</div>
                <div className="flex items-end gap-[2px] h-12">
                  {FEAR_GREED_HISTORY.map((d, i) => {
                    const h = (d.value / 100) * 100
                    const c = d.value >= 55 ? '#22c55e' : d.value >= 45 ? '#eab308' : '#ef4444'
                    return (
                      <div key={i} className="flex-1 rounded-t-sm transition-all"
                        style={{ height: `${h}%`, backgroundColor: c, opacity: 0.5 }}
                        title={`Day ${d.day}: ${d.value}`}
                      />
                    )
                  })}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-black-600 font-mono">30d ago</span>
                  <span className="text-[9px] text-black-600 font-mono">Today</span>
                </div>
              </div>
            </GlassCard>

            {/* BTC Dominance */}
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="BTC Dominance" subtitle="Bitcoin's share of total crypto market cap" />
              <div className="flex items-center gap-4 mb-4">
                <div className="text-3xl font-bold font-mono" style={{ color: '#f97316' }}>
                  {BTC_DOMINANCE.toFixed(1)}%
                </div>
                <div className="text-xs text-black-500">
                  <div>ETH: {(100 - BTC_DOMINANCE - 28.4).toFixed(1)}%</div>
                  <div>Alts: 28.4%</div>
                </div>
              </div>
              <AreaLineChart data={BTC_DOMINANCE_HISTORY} color="#f97316" gradientId="btc-dom-fill" height={130} />
              {/* Dominance bar */}
              <div className="mt-4 flex rounded-full overflow-hidden h-3">
                <div style={{ width: `${BTC_DOMINANCE}%`, backgroundColor: '#f97316' }} className="transition-all" />
                <div style={{ width: `${100 - BTC_DOMINANCE - 28.4}%`, backgroundColor: '#8b5cf6' }} className="transition-all" />
                <div style={{ width: '28.4%', backgroundColor: CYAN }} className="transition-all" />
              </div>
              <div className="flex gap-4 mt-2">
                {[
                  { label: 'BTC', color: '#f97316' },
                  { label: 'ETH', color: '#8b5cf6' },
                  { label: 'Alts', color: CYAN },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-black-400 font-mono">{item.label}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ New Listings ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="New Listings" subtitle="Recently added tokens on VibeSwap" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {NEW_LISTINGS.map((token) => {
                  const isPos = token.change24h >= 0
                  return (
                    <motion.div key={token.name}
                      whileHover={{ y: -2, transition: { duration: 1 / (PHI * PHI * PHI) } }}
                      className="bg-black-800/40 rounded-xl p-3 border border-black-800/50 cursor-pointer hover:border-black-700 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
                            style={{ backgroundColor: isPos ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                              color: isPos ? '#22c55e' : '#ef4444' }}>
                            {token.name.slice(0, 2)}
                          </div>
                          <span className="font-mono text-sm font-medium">{token.name}</span>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-black-700/60 text-black-400 font-mono">{token.category}</span>
                      </div>
                      <div className="font-mono text-sm mb-0.5">{fmtPrice(token.price)}</div>
                      <div className="flex items-center justify-between">
                        <ChangeText value={token.change24h} className="text-xs" />
                        <span className="text-[9px] text-black-600 font-mono">{token.listed}</span>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Volume Leaders ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Volume Leaders" subtitle="Highest 24h trading volume across all pairs" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-black-500 border-b border-black-800">
                      <th className="pb-3 font-medium">#</th>
                      <th className="pb-3 font-medium">Token</th>
                      <th className="pb-3 font-medium text-right">Price</th>
                      <th className="pb-3 font-medium text-right">24h Volume</th>
                      <th className="pb-3 font-medium text-right">Market Cap</th>
                      <th className="pb-3 font-medium text-right">24h Change</th>
                      <th className="pb-3 font-medium text-right">Vol/MCap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {VOLUME_LEADERS.map((token, i) => {
                      const volMcap = ((token.volume24h / token.marketCap) * 100).toFixed(2)
                      return (
                        <tr key={token.name} className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors">
                          <td className="py-3 text-black-500 font-mono text-xs">{i + 1}</td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                                style={{ backgroundColor: `${CYAN}20`, color: CYAN }}>
                                {token.name.slice(0, 2)}
                              </div>
                              <div>
                                <span className="font-mono font-medium">{token.name}</span>
                                <span className="text-black-500 text-xs ml-2">{token.category}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-right font-mono">{fmtPrice(token.price)}</td>
                          <td className="py-3 text-right font-mono" style={{ color: CYAN }}>{fmt(token.volume24h)}</td>
                          <td className="py-3 text-right font-mono text-black-400">{fmt(token.marketCap)}</td>
                          <td className="py-3 text-right"><ChangeText value={token.change24h} /></td>
                          <td className="py-3 text-right">
                            <span className="font-mono text-xs text-black-400">{volMcap}%</span>
                            <div className="mt-1 h-1 rounded-full bg-black-800 overflow-hidden w-16 ml-auto">
                              <div className="h-full rounded-full" style={{
                                width: `${Math.min(parseFloat(volMcap) * 2, 100)}%`,
                                backgroundColor: CYAN,
                                opacity: 0.7,
                              }} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Wallet CTA ============ */}
          {!isConnected && (
            <motion.div variants={fadeUp} className="mb-8">
              <GlassCard glowColor="matrix" className="p-6 text-center">
                <div className="text-lg font-semibold mb-2">Connect Your Wallet</div>
                <p className="text-sm text-black-400 mb-4 max-w-md mx-auto">
                  Sign in to access personalized watchlists, price alerts, and portfolio tracking
                  powered by VibeSwap's MEV-protected infrastructure.
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-mono"
                  style={{ backgroundColor: `${CYAN}15`, border: `1px solid ${CYAN}30`, color: CYAN }}>
                  Sign In to unlock full features
                </div>
              </GlassCard>
            </motion.div>
          )}

        </motion.div>
      </div>
    </div>
  )
}

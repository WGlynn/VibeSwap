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
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Animation Constants ============

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } },
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

const fadeIn = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 1 / PHI, ease: 'easeOut' } },
}

// ============ Sentiment Helpers ============

function getSentimentLabel(value) {
  if (value <= 20) return 'Extreme Fear'
  if (value <= 40) return 'Fear'
  if (value <= 60) return 'Neutral'
  if (value <= 80) return 'Greed'
  return 'Extreme Greed'
}

function getSentimentColor(value) {
  if (value <= 20) return '#ef4444'
  if (value <= 40) return '#f97316'
  if (value <= 60) return '#eab308'
  if (value <= 80) return '#22c55e'
  return '#10b981'
}

function getGaugeGradientColor(pct) {
  if (pct < 0.25) return '#ef4444'
  if (pct < 0.5) return '#f97316'
  if (pct < 0.75) return '#eab308'
  return '#22c55e'
}

// ============ Format Helpers ============

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtPct(n) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

// ============ Data Generation ============

function generateSocialBuzz(rng) {
  const tokens = [
    { symbol: 'ETH', name: 'Ethereum' },
    { symbol: 'BTC', name: 'Bitcoin' },
    { symbol: 'SOL', name: 'Solana' },
    { symbol: 'ARB', name: 'Arbitrum' },
    { symbol: 'OP', name: 'Optimism' },
    { symbol: 'PEPE', name: 'Pepe' },
    { symbol: 'LINK', name: 'Chainlink' },
    { symbol: 'AAVE', name: 'Aave' },
    { symbol: 'EIGEN', name: 'EigenLayer' },
    { symbol: 'TAO', name: 'Bittensor' },
  ]
  return tokens.map((t) => ({
    ...t,
    mentions: Math.round(1200 + rng() * 48000),
    sentiment: +(0.15 + rng() * 0.75).toFixed(2),
    volumeCorrelation: +(-0.3 + rng() * 1.1).toFixed(2),
    change24h: +(-25 + rng() * 80).toFixed(1),
  })).sort((a, b) => b.mentions - a.mentions)
}

function generateFundingRates(rng) {
  const pairs = [
    'ETH-PERP', 'BTC-PERP', 'SOL-PERP', 'ARB-PERP', 'OP-PERP',
    'AVAX-PERP', 'LINK-PERP', 'DOGE-PERP', 'PEPE-PERP', 'WIF-PERP',
  ]
  return pairs.map((pair) => ({
    pair,
    rate: +(-0.04 + rng() * 0.08).toFixed(4),
    rate8h: +(-0.12 + rng() * 0.24).toFixed(4),
    annualized: +(-14 + rng() * 28).toFixed(2),
    openInterest: Math.round(2_000_000 + rng() * 48_000_000),
  }))
}

function generateLongShortRatio(rng) {
  const tokens = ['ETH', 'BTC', 'SOL', 'ARB', 'OP', 'AVAX', 'LINK', 'DOGE']
  return tokens.map((token) => {
    const longPct = +(35 + rng() * 30).toFixed(1)
    return {
      token,
      longPct,
      shortPct: +(100 - longPct).toFixed(1),
      longVolume: Math.round(5_000_000 + rng() * 45_000_000),
      shortVolume: Math.round(3_000_000 + rng() * 35_000_000),
      change1h: +(-5 + rng() * 10).toFixed(1),
    }
  })
}

function generateOnChainSignals(rng) {
  return {
    whaleAccumulation: {
      label: 'Whale Accumulation',
      description: 'Net flow to wallets >1000 ETH in 24h',
      value: Math.round(-12000 + rng() * 35000),
      unit: 'ETH',
      trend: rng() > 0.4 ? 'bullish' : 'bearish',
      confidence: +(0.55 + rng() * 0.4).toFixed(2),
    },
    exchangeInflow: {
      label: 'Exchange Inflows',
      description: 'Tokens moving to exchanges (sell pressure)',
      value: Math.round(8000 + rng() * 22000),
      unit: 'ETH',
      trend: rng() > 0.55 ? 'bearish' : 'neutral',
      confidence: +(0.45 + rng() * 0.45).toFixed(2),
    },
    exchangeOutflow: {
      label: 'Exchange Outflows',
      description: 'Tokens leaving exchanges (accumulation)',
      value: Math.round(10000 + rng() * 28000),
      unit: 'ETH',
      trend: rng() > 0.45 ? 'bullish' : 'neutral',
      confidence: +(0.5 + rng() * 0.4).toFixed(2),
    },
    activeAddresses: {
      label: 'Active Addresses',
      description: '24h unique active addresses on Ethereum',
      value: Math.round(380000 + rng() * 220000),
      unit: '',
      trend: rng() > 0.5 ? 'bullish' : 'neutral',
      confidence: +(0.6 + rng() * 0.3).toFixed(2),
    },
    nvtRatio: {
      label: 'NVT Ratio',
      description: 'Network Value to Transactions — higher = overvalued',
      value: +(35 + rng() * 90).toFixed(1),
      unit: '',
      trend: rng() > 0.5 ? 'bearish' : 'neutral',
      confidence: +(0.4 + rng() * 0.4).toFixed(2),
    },
    gasUsage: {
      label: 'Avg Gas Usage',
      description: 'Network activity proxy (higher = more demand)',
      value: Math.round(15 + rng() * 85),
      unit: 'Gwei',
      trend: rng() > 0.5 ? 'bullish' : 'neutral',
      confidence: +(0.5 + rng() * 0.35).toFixed(2),
    },
  }
}

function generateHistoricalSentiment(rng) {
  let value = 45
  return Array.from({ length: 30 }, (_, i) => {
    value += (rng() - 0.48) * 12
    value = Math.max(5, Math.min(95, value))
    return { day: i + 1, value: Math.round(value) }
  })
}

// ============ Static Seeded Data ============

const mainRng = seededRandom(7777)
const FEAR_GREED_INDEX = Math.round(25 + mainRng() * 55)
const SOCIAL_BUZZ = generateSocialBuzz(seededRandom(3141))
const FUNDING_RATES = generateFundingRates(seededRandom(2718))
const LONG_SHORT = generateLongShortRatio(seededRandom(1414))
const ON_CHAIN = generateOnChainSignals(seededRandom(1618))
const HISTORICAL_SENTIMENT = generateHistoricalSentiment(seededRandom(4242))

// ============ Circular Gauge Component ============

function FearGreedGauge({ value }) {
  const radius = 100
  const strokeWidth = 14
  const center = 130
  const circumference = Math.PI * radius
  const startAngle = Math.PI
  const sweepAngle = Math.PI

  const ticks = 50
  const tickSegments = Array.from({ length: ticks }, (_, i) => {
    const pct = i / ticks
    const angle = startAngle + pct * sweepAngle
    const x = center + radius * Math.cos(angle)
    const y = center + radius * Math.sin(angle)
    return { x, y, pct, color: getGaugeGradientColor(pct) }
  })

  const valuePct = value / 100
  const needleAngle = startAngle + valuePct * sweepAngle
  const needleLength = radius - 20
  const needleX = center + needleLength * Math.cos(needleAngle)
  const needleY = center + needleLength * Math.sin(needleAngle)

  const sentimentLabel = getSentimentLabel(value)
  const sentimentColor = getSentimentColor(value)

  const arcPath = (r, startA, endA) => {
    const x1 = center + r * Math.cos(startA)
    const y1 = center + r * Math.sin(startA)
    const x2 = center + r * Math.cos(endA)
    const y2 = center + r * Math.sin(endA)
    const largeArc = endA - startA > Math.PI ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
  }

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 260 160" className="w-full max-w-xs">
        <defs>
          <linearGradient id="gauge-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="25%" stopColor="#f97316" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="75%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>

        {/* Background arc */}
        <path
          d={arcPath(radius, startAngle, startAngle + sweepAngle)}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Colored arc segments */}
        {tickSegments.map((seg, i) => {
          if (i === ticks - 1) return null
          const a1 = startAngle + (i / ticks) * sweepAngle
          const a2 = startAngle + ((i + 1) / ticks) * sweepAngle
          return (
            <path
              key={i}
              d={arcPath(radius, a1, a2)}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              opacity={i / ticks <= valuePct ? 0.8 : 0.12}
              strokeLinecap="butt"
            />
          )
        })}

        {/* Scale labels */}
        <text x="20" y="148" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="monospace">0</text>
        <text x="60" y="55" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">25</text>
        <text x="125" y="22" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace" textAnchor="middle">50</text>
        <text x="192" y="55" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">75</text>
        <text x="232" y="148" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="monospace">100</text>

        {/* Needle */}
        <line
          x1={center}
          y1={center}
          x2={needleX}
          y2={needleY}
          stroke={sentimentColor}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx={center} cy={center} r="5" fill={sentimentColor} />
        <circle cx={center} cy={center} r="2.5" fill="#0a0a0a" />

        {/* Value */}
        <text
          x={center}
          y={center + 30}
          textAnchor="middle"
          fill="white"
          fontSize="28"
          fontFamily="monospace"
          fontWeight="bold"
        >
          {value}
        </text>
      </svg>

      <div className="text-center -mt-2">
        <div
          className="text-lg font-bold font-mono tracking-wide"
          style={{ color: sentimentColor }}
        >
          {sentimentLabel}
        </div>
        <div className="text-xs text-black-500 font-mono mt-1">
          Updated every 10 seconds
        </div>
      </div>
    </div>
  )
}

// ============ Section Header ============

function SectionHeader({ title, subtitle, icon }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        {icon && <span className="text-lg">{icon}</span>}
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      {subtitle && <p className="text-sm text-black-500 mt-0.5 font-mono">{subtitle}</p>}
    </div>
  )
}

// ============ Sentiment Indicator Dot ============

function TrendDot({ trend }) {
  const colorMap = {
    bullish: '#22c55e',
    bearish: '#ef4444',
    neutral: '#eab308',
  }
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: colorMap[trend] || colorMap.neutral }}
      />
      <span
        className="text-xs font-mono capitalize"
        style={{ color: colorMap[trend] || colorMap.neutral }}
      >
        {trend}
      </span>
    </div>
  )
}

// ============ Confidence Bar ============

function ConfidenceBar({ confidence }) {
  const pct = Math.round(confidence * 100)
  const color = confidence > 0.7 ? '#22c55e' : confidence > 0.5 ? '#eab308' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-black-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono text-black-400 w-10 text-right">{pct}%</span>
    </div>
  )
}

// ============ Historical Sentiment SVG Chart ============

function SentimentLineChart({ data }) {
  const W = 720
  const H = 220
  const PAD = { top: 20, right: 20, bottom: 32, left: 48 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top - PAD.bottom

  const min = 0
  const max = 100
  const range = max - min

  const pts = data.map((d, i) => ({
    x: PAD.left + (i / (data.length - 1)) * iW,
    y: PAD.top + iH - ((d.value - min) / range) * iH,
    value: d.value,
  }))

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${PAD.top + iH} L${pts[0].x},${PAD.top + iH} Z`

  // Zone backgrounds
  const zones = [
    { y1: 0, y2: 20, color: 'rgba(239,68,68,0.05)', label: 'Extreme Fear' },
    { y1: 20, y2: 40, color: 'rgba(249,115,22,0.04)', label: 'Fear' },
    { y1: 40, y2: 60, color: 'rgba(234,179,8,0.03)', label: 'Neutral' },
    { y1: 60, y2: 80, color: 'rgba(34,197,94,0.04)', label: 'Greed' },
    { y1: 80, y2: 100, color: 'rgba(16,185,129,0.05)', label: 'Extreme Greed' },
  ]

  const yTicks = [0, 20, 40, 60, 80, 100]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <defs>
        <linearGradient id="sentiment-area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.2" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Zone backgrounds */}
      {zones.map((zone, i) => {
        const zy1 = PAD.top + iH - ((zone.y2 - min) / range) * iH
        const zy2 = PAD.top + iH - ((zone.y1 - min) / range) * iH
        return (
          <rect
            key={i}
            x={PAD.left}
            y={zy1}
            width={iW}
            height={zy2 - zy1}
            fill={zone.color}
          />
        )
      })}

      {/* Grid lines + y-axis labels */}
      {yTicks.map((t) => {
        const y = PAD.top + iH - ((t - min) / range) * iH
        return (
          <g key={t}>
            <line
              x1={PAD.left}
              y1={y}
              x2={W - PAD.right}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
            />
            <text
              x={PAD.left - 8}
              y={y + 4}
              textAnchor="end"
              fill="rgba(255,255,255,0.35)"
              fontSize="10"
              fontFamily="monospace"
            >
              {t}
            </text>
          </g>
        )
      })}

      {/* Zone labels on the right */}
      {zones.map((zone, i) => {
        const midY = PAD.top + iH - (((zone.y1 + zone.y2) / 2 - min) / range) * iH
        return (
          <text
            key={i}
            x={W - PAD.right + 4}
            y={midY + 3}
            fill="rgba(255,255,255,0.15)"
            fontSize="7"
            fontFamily="monospace"
          >
            {zone.label}
          </text>
        )
      })}

      {/* X-axis labels */}
      {data.filter((_, i) => i % 5 === 0).map((d, idx) => {
        const i = data.indexOf(d)
        return (
          <text
            key={idx}
            x={PAD.left + (i / (data.length - 1)) * iW}
            y={H - 8}
            textAnchor="middle"
            fill="rgba(255,255,255,0.35)"
            fontSize="10"
            fontFamily="monospace"
          >
            D{d.day}
          </text>
        )
      })}

      {/* Area fill */}
      <path d={areaPath} fill="url(#sentiment-area-fill)" />

      {/* Line — color segments based on value */}
      {pts.map((p, i) => {
        if (i === 0) return null
        const prev = pts[i - 1]
        const avgVal = (prev.value + p.value) / 2
        const color = getSentimentColor(avgVal)
        return (
          <line
            key={i}
            x1={prev.x}
            y1={prev.y}
            x2={p.x}
            y2={p.y}
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        )
      })}

      {/* End point */}
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r="4"
        fill={getSentimentColor(pts[pts.length - 1].value)}
      />
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r="7"
        fill="none"
        stroke={getSentimentColor(pts[pts.length - 1].value)}
        strokeWidth="1"
        opacity="0.4"
      />
    </svg>
  )
}

// ============ Long/Short Bar ============

function LongShortBar({ longPct, shortPct }) {
  return (
    <div className="flex rounded-full overflow-hidden h-3">
      <div
        className="transition-all"
        style={{ width: `${longPct}%`, backgroundColor: '#22c55e' }}
        title={`Long: ${longPct}%`}
      />
      <div
        className="transition-all"
        style={{ width: `${shortPct}%`, backgroundColor: '#ef4444' }}
        title={`Short: ${shortPct}%`}
      />
    </div>
  )
}

// ============ Main Component ============

export default function SentimentPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedTab, setSelectedTab] = useState('overview')
  const [sortBy, setSortBy] = useState('mentions')

  // ============ Derived Data ============

  const sortedBuzz = useMemo(() => {
    const data = [...SOCIAL_BUZZ]
    if (sortBy === 'mentions') data.sort((a, b) => b.mentions - a.mentions)
    else if (sortBy === 'sentiment') data.sort((a, b) => b.sentiment - a.sentiment)
    else if (sortBy === 'correlation') data.sort((a, b) => Math.abs(b.volumeCorrelation) - Math.abs(a.volumeCorrelation))
    return data
  }, [sortBy])

  const overallSentiment = useMemo(() => {
    const avg = SOCIAL_BUZZ.reduce((s, t) => s + t.sentiment, 0) / SOCIAL_BUZZ.length
    return Math.round(avg * 100)
  }, [])

  const netExchangeFlow = useMemo(() => {
    return ON_CHAIN.exchangeInflow.value - ON_CHAIN.exchangeOutflow.value
  }, [])

  const latestSentiment = HISTORICAL_SENTIMENT[HISTORICAL_SENTIMENT.length - 1].value
  const sentimentTrend = latestSentiment - HISTORICAL_SENTIMENT[HISTORICAL_SENTIMENT.length - 8].value

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title="Market Sentiment"
        subtitle="Real-time crowd sentiment and social signals"
        category="intelligence"
        badge="Live"
        badgeColor={CYAN}
      >
        <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
          {['overview', 'social', 'on-chain'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`px-3 py-1 rounded-lg text-xs font-mono capitalize transition-colors ${
                selectedTab === tab
                  ? 'bg-black-700 text-white'
                  : 'text-black-500 hover:text-black-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4">
        <motion.div variants={stagger} initial="hidden" animate="show">

          {/* ============ Fear & Greed Index ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <div className="grid md:grid-cols-3 gap-6">
              {/* Gauge */}
              <GlassCard glowColor="warning" className="p-6 md:col-span-1">
                <SectionHeader
                  title="Fear & Greed Index"
                  subtitle="Composite market emotion gauge"
                />
                <FearGreedGauge value={FEAR_GREED_INDEX} />
              </GlassCard>

              {/* Index Breakdown */}
              <GlassCard glowColor="terminal" className="p-6 md:col-span-2">
                <SectionHeader
                  title="Index Components"
                  subtitle="Weighted factors contributing to the sentiment score"
                />
                <div className="space-y-4">
                  {[
                    { name: 'Volatility', weight: '25%', score: Math.round(20 + mainRng() * 60), desc: 'Current vs. 30-day average volatility' },
                    { name: 'Market Momentum', weight: '25%', score: Math.round(25 + mainRng() * 55), desc: 'Volume-weighted price momentum' },
                    { name: 'Social Media', weight: '15%', score: overallSentiment, desc: 'Aggregate social sentiment across platforms' },
                    { name: 'Dominance', weight: '10%', score: Math.round(30 + mainRng() * 50), desc: 'BTC dominance vs. historical average' },
                    { name: 'Funding Rates', weight: '15%', score: Math.round(35 + mainRng() * 40), desc: 'Perpetual funding rate bias' },
                    { name: 'On-Chain Activity', weight: '10%', score: Math.round(40 + mainRng() * 35), desc: 'Active addresses and transaction volume' },
                  ].map((factor) => (
                    <div key={factor.name}>
                      <div className="flex justify-between items-baseline mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium">{factor.name}</span>
                          <span className="text-[10px] text-black-600 font-mono">({factor.weight})</span>
                        </div>
                        <span
                          className="text-sm font-bold font-mono"
                          style={{ color: getSentimentColor(factor.score) }}
                        >
                          {factor.score}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-black-800 overflow-hidden mb-1">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: getSentimentColor(factor.score) }}
                          initial={{ width: 0 }}
                          animate={{ width: `${factor.score}%` }}
                          transition={{ duration: 1 / PHI, ease: 'easeOut', delay: 0.1 }}
                        />
                      </div>
                      <p className="text-[10px] text-black-600 font-mono">{factor.desc}</p>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>
          </motion.div>

          {/* ============ Social Buzz ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
                <SectionHeader
                  title="Social Buzz"
                  subtitle="Trending tokens across social platforms"
                />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-lg border border-black-800/50">
                  {[
                    { key: 'mentions', label: 'Mentions' },
                    { key: 'sentiment', label: 'Sentiment' },
                    { key: 'correlation', label: 'Correlation' },
                  ].map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setSortBy(s.key)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${
                        sortBy === s.key
                          ? 'bg-black-700 text-white'
                          : 'text-black-500 hover:text-black-300'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-black-500 border-b border-black-800">
                      <th className="pb-3 font-medium font-mono text-xs">#</th>
                      <th className="pb-3 font-medium font-mono text-xs">Token</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Mentions (24h)</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Sentiment</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Vol. Correlation</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">24h Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBuzz.map((token, idx) => {
                      const sentColor = token.sentiment > 0.6
                        ? '#22c55e'
                        : token.sentiment > 0.4
                          ? '#eab308'
                          : '#ef4444'
                      const corrColor = token.volumeCorrelation > 0.3
                        ? '#22c55e'
                        : token.volumeCorrelation > -0.1
                          ? '#eab308'
                          : '#ef4444'
                      return (
                        <tr
                          key={token.symbol}
                          className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors"
                        >
                          <td className="py-3 font-mono text-black-600 text-xs">{idx + 1}</td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-sm">{token.symbol}</span>
                              <span className="text-xs text-black-500">{token.name}</span>
                            </div>
                          </td>
                          <td className="py-3 text-right font-mono">{fmtNum(token.mentions)}</td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-12 h-1.5 rounded-full bg-black-800 overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${token.sentiment * 100}%`,
                                    backgroundColor: sentColor,
                                  }}
                                />
                              </div>
                              <span className="font-mono text-xs" style={{ color: sentColor }}>
                                {(token.sentiment * 100).toFixed(0)}%
                              </span>
                            </div>
                          </td>
                          <td className="py-3 text-right">
                            <span className="font-mono text-xs" style={{ color: corrColor }}>
                              {token.volumeCorrelation > 0 ? '+' : ''}{token.volumeCorrelation.toFixed(2)}
                            </span>
                          </td>
                          <td className={`py-3 text-right font-mono text-xs ${
                            parseFloat(token.change24h) >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {parseFloat(token.change24h) >= 0 ? '+' : ''}{token.change24h}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 text-[10px] text-black-600 font-mono">
                Data aggregated from Twitter/X, Reddit, Telegram, and Discord. Updated every 60 seconds.
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Funding Rates ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader
                title="Funding Rates"
                subtitle="Perpetual swap funding rates across major pairs"
              />

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-black-500 border-b border-black-800">
                      <th className="pb-3 font-medium font-mono text-xs">Pair</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Current Rate</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">8h Rate</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Annualized</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Open Interest</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FUNDING_RATES.map((fr) => {
                      const rateColor = fr.rate >= 0 ? '#22c55e' : '#ef4444'
                      const rate8hColor = fr.rate8h >= 0 ? '#22c55e' : '#ef4444'
                      const annColor = fr.annualized >= 0 ? '#22c55e' : '#ef4444'
                      const signal = Math.abs(fr.annualized) > 15
                        ? (fr.annualized > 0 ? 'Overleveraged Long' : 'Overleveraged Short')
                        : 'Normal'
                      const signalColor = signal === 'Normal'
                        ? 'text-black-500'
                        : fr.annualized > 0
                          ? 'text-red-400'
                          : 'text-green-400'
                      return (
                        <tr
                          key={fr.pair}
                          className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors"
                        >
                          <td className="py-3 font-mono font-medium text-sm">{fr.pair}</td>
                          <td className="py-3 text-right font-mono text-xs" style={{ color: rateColor }}>
                            {fr.rate >= 0 ? '+' : ''}{(fr.rate * 100).toFixed(4)}%
                          </td>
                          <td className="py-3 text-right font-mono text-xs" style={{ color: rate8hColor }}>
                            {fr.rate8h >= 0 ? '+' : ''}{(fr.rate8h * 100).toFixed(4)}%
                          </td>
                          <td className="py-3 text-right font-mono text-xs" style={{ color: annColor }}>
                            {fmtPct(fr.annualized)}
                          </td>
                          <td className="py-3 text-right font-mono text-xs text-black-300">
                            ${fmtNum(fr.openInterest)}
                          </td>
                          <td className={`py-3 text-right font-mono text-[10px] ${signalColor}`}>
                            {signal}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  {
                    label: 'Avg Funding',
                    value: fmtPct(FUNDING_RATES.reduce((s, f) => s + f.annualized, 0) / FUNDING_RATES.length),
                    color: CYAN,
                  },
                  {
                    label: 'Most Positive',
                    value: FUNDING_RATES.reduce((max, f) => f.annualized > max.annualized ? f : max, FUNDING_RATES[0]).pair,
                    color: '#22c55e',
                  },
                  {
                    label: 'Most Negative',
                    value: FUNDING_RATES.reduce((min, f) => f.annualized < min.annualized ? f : min, FUNDING_RATES[0]).pair,
                    color: '#ef4444',
                  },
                  {
                    label: 'Total OI',
                    value: '$' + fmtNum(FUNDING_RATES.reduce((s, f) => s + f.openInterest, 0)),
                    color: CYAN,
                  },
                ].map((stat) => (
                  <div key={stat.label} className="text-center bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                    <div className="text-[10px] text-black-500 font-mono mb-1">{stat.label}</div>
                    <div className="text-sm font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Long/Short Ratio ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader
                title="Long/Short Ratio"
                subtitle="Position distribution across top tokens"
              />

              <div className="space-y-4">
                {/* Legend */}
                <div className="flex items-center gap-4 text-xs font-mono">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#22c55e' }} />
                    <span className="text-black-400">Long</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#ef4444' }} />
                    <span className="text-black-400">Short</span>
                  </div>
                </div>

                {/* Bars */}
                {LONG_SHORT.map((ls) => (
                  <div key={ls.token}>
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-sm w-12">{ls.token}</span>
                        <span className={`text-[10px] font-mono ${
                          parseFloat(ls.change1h) >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {parseFloat(ls.change1h) >= 0 ? '+' : ''}{ls.change1h}% 1h
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-mono">
                        <span className="text-green-400">{ls.longPct}%</span>
                        <span className="text-black-600">/</span>
                        <span className="text-red-400">{ls.shortPct}%</span>
                      </div>
                    </div>
                    <LongShortBar longPct={ls.longPct} shortPct={ls.shortPct} />
                    <div className="flex justify-between text-[10px] text-black-600 font-mono mt-1">
                      <span>Vol: ${fmtNum(ls.longVolume)}</span>
                      <span>Vol: ${fmtNum(ls.shortVolume)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Aggregate stats */}
              <div className="mt-6 pt-4 border-t border-black-800">
                <div className="grid grid-cols-3 gap-4 text-center">
                  {(() => {
                    const avgLong = LONG_SHORT.reduce((s, l) => s + l.longPct, 0) / LONG_SHORT.length
                    const totalLongVol = LONG_SHORT.reduce((s, l) => s + l.longVolume, 0)
                    const totalShortVol = LONG_SHORT.reduce((s, l) => s + l.shortVolume, 0)
                    return [
                      { label: 'Avg Long %', value: `${avgLong.toFixed(1)}%`, color: '#22c55e' },
                      { label: 'Total Long Vol', value: `$${fmtNum(totalLongVol)}`, color: '#22c55e' },
                      { label: 'Total Short Vol', value: `$${fmtNum(totalShortVol)}`, color: '#ef4444' },
                    ]
                  })().map((stat) => (
                    <div key={stat.label} className="bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                      <div className="text-[10px] text-black-500 font-mono mb-1">{stat.label}</div>
                      <div className="text-sm font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ On-Chain Signals ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader
                title="On-Chain Signals"
                subtitle="Blockchain-native indicators for smart money tracking"
              />

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.values(ON_CHAIN).map((signal) => (
                  <motion.div
                    key={signal.label}
                    variants={fadeIn}
                    className="bg-black-800/40 rounded-xl p-4 border border-black-800 hover:border-black-700 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-sm font-semibold font-mono">{signal.label}</h3>
                      <TrendDot trend={signal.trend} />
                    </div>
                    <div className="text-2xl font-bold font-mono mb-1" style={{ color: CYAN }}>
                      {typeof signal.value === 'number' && signal.value > 10000
                        ? fmtNum(signal.value)
                        : signal.value.toLocaleString()}
                      {signal.unit && (
                        <span className="text-sm text-black-500 ml-1">{signal.unit}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-black-600 font-mono mb-3">
                      {signal.description}
                    </p>
                    <div>
                      <div className="text-[10px] text-black-500 font-mono mb-1">Confidence</div>
                      <ConfidenceBar confidence={signal.confidence} />
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Net exchange flow summary */}
              <div className="mt-6 pt-4 border-t border-black-800">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {
                      label: 'Net Exchange Flow',
                      value: `${netExchangeFlow > 0 ? '+' : ''}${fmtNum(netExchangeFlow)} ETH`,
                      color: netExchangeFlow > 0 ? '#ef4444' : '#22c55e',
                      desc: netExchangeFlow > 0 ? 'Net inflow (sell pressure)' : 'Net outflow (accumulation)',
                    },
                    {
                      label: 'Whale Activity',
                      value: ON_CHAIN.whaleAccumulation.trend === 'bullish' ? 'Accumulating' : 'Distributing',
                      color: ON_CHAIN.whaleAccumulation.trend === 'bullish' ? '#22c55e' : '#ef4444',
                      desc: `${fmtNum(Math.abs(ON_CHAIN.whaleAccumulation.value))} ETH net`,
                    },
                    {
                      label: 'Network Activity',
                      value: fmtNum(ON_CHAIN.activeAddresses.value),
                      color: CYAN,
                      desc: 'Active addresses 24h',
                    },
                    {
                      label: 'NVT Signal',
                      value: ON_CHAIN.nvtRatio.value > 80 ? 'Overvalued' : ON_CHAIN.nvtRatio.value > 50 ? 'Fair' : 'Undervalued',
                      color: ON_CHAIN.nvtRatio.value > 80 ? '#ef4444' : ON_CHAIN.nvtRatio.value > 50 ? '#eab308' : '#22c55e',
                      desc: `NVT: ${ON_CHAIN.nvtRatio.value}`,
                    },
                  ].map((item) => (
                    <div key={item.label} className="bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                      <div className="text-[10px] text-black-500 font-mono mb-1">{item.label}</div>
                      <div className="text-sm font-bold font-mono" style={{ color: item.color }}>{item.value}</div>
                      <div className="text-[10px] text-black-600 font-mono mt-0.5">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Historical Sentiment ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="warning" className="p-6">
              <SectionHeader
                title="Historical Sentiment"
                subtitle="30-day sentiment index trend with zone classification"
              />
              <SentimentLineChart data={HISTORICAL_SENTIMENT} />

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  {
                    label: 'Current',
                    value: latestSentiment,
                    color: getSentimentColor(latestSentiment),
                    sub: getSentimentLabel(latestSentiment),
                  },
                  {
                    label: '7d Trend',
                    value: `${sentimentTrend >= 0 ? '+' : ''}${sentimentTrend}`,
                    color: sentimentTrend >= 0 ? '#22c55e' : '#ef4444',
                    sub: sentimentTrend >= 0 ? 'Improving' : 'Declining',
                  },
                  {
                    label: '30d High',
                    value: Math.max(...HISTORICAL_SENTIMENT.map((d) => d.value)),
                    color: '#22c55e',
                    sub: getSentimentLabel(Math.max(...HISTORICAL_SENTIMENT.map((d) => d.value))),
                  },
                  {
                    label: '30d Low',
                    value: Math.min(...HISTORICAL_SENTIMENT.map((d) => d.value)),
                    color: '#ef4444',
                    sub: getSentimentLabel(Math.min(...HISTORICAL_SENTIMENT.map((d) => d.value))),
                  },
                ].map((stat) => (
                  <div key={stat.label} className="text-center bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                    <div className="text-[10px] text-black-500 font-mono mb-1">{stat.label}</div>
                    <div className="text-lg font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
                    <div className="text-[10px] text-black-600 font-mono mt-0.5">{stat.sub}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Sentiment Signals Summary ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader
                title="Aggregate Signals"
                subtitle="Combined view of all sentiment indicators"
              />

              <div className="grid md:grid-cols-2 gap-6">
                {/* Bullish signals */}
                <div>
                  <div className="text-xs font-mono text-green-400 mb-3 uppercase tracking-wider">Bullish Signals</div>
                  <div className="space-y-2">
                    {[
                      ON_CHAIN.whaleAccumulation.trend === 'bullish' && 'Whale addresses are accumulating',
                      ON_CHAIN.exchangeOutflow.value > ON_CHAIN.exchangeInflow.value && 'Net outflow from exchanges',
                      FEAR_GREED_INDEX < 30 && 'Extreme fear often precedes reversals',
                      LONG_SHORT.some((l) => l.longPct < 40) && 'Low long positions suggest room for upside',
                      FUNDING_RATES.some((f) => f.annualized < -10) && 'Negative funding rates — shorts paying longs',
                      ON_CHAIN.activeAddresses.trend === 'bullish' && 'Rising active addresses',
                    ].filter(Boolean).map((signal, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs font-mono">
                        <span className="text-green-400 mt-0.5">+</span>
                        <span className="text-black-300">{signal}</span>
                      </div>
                    ))}
                    {[
                      ON_CHAIN.whaleAccumulation.trend === 'bullish' && 'Whale addresses are accumulating',
                      ON_CHAIN.exchangeOutflow.value > ON_CHAIN.exchangeInflow.value && 'Net outflow from exchanges',
                      FEAR_GREED_INDEX < 30 && 'Extreme fear often precedes reversals',
                    ].filter(Boolean).length === 0 && (
                      <div className="text-xs font-mono text-black-600">No strong bullish signals detected</div>
                    )}
                  </div>
                </div>

                {/* Bearish signals */}
                <div>
                  <div className="text-xs font-mono text-red-400 mb-3 uppercase tracking-wider">Bearish Signals</div>
                  <div className="space-y-2">
                    {[
                      ON_CHAIN.whaleAccumulation.trend === 'bearish' && 'Whale addresses are distributing',
                      ON_CHAIN.exchangeInflow.value > ON_CHAIN.exchangeOutflow.value && 'Net inflow to exchanges (sell pressure)',
                      FEAR_GREED_INDEX > 80 && 'Extreme greed often precedes corrections',
                      LONG_SHORT.some((l) => l.longPct > 65) && 'High long positions — potential for liquidation cascade',
                      FUNDING_RATES.some((f) => f.annualized > 15) && 'High positive funding — overleveraged longs',
                      ON_CHAIN.nvtRatio.value > 80 && 'High NVT ratio suggests overvaluation',
                    ].filter(Boolean).map((signal, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs font-mono">
                        <span className="text-red-400 mt-0.5">-</span>
                        <span className="text-black-300">{signal}</span>
                      </div>
                    ))}
                    {[
                      ON_CHAIN.whaleAccumulation.trend === 'bearish' && 'Whale addresses are distributing',
                      ON_CHAIN.exchangeInflow.value > ON_CHAIN.exchangeOutflow.value && 'Net inflow to exchanges',
                      FEAR_GREED_INDEX > 80 && 'Extreme greed often precedes corrections',
                    ].filter(Boolean).length === 0 && (
                      <div className="text-xs font-mono text-black-600">No strong bearish signals detected</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="mt-6 pt-4 border-t border-black-800">
                <p className="text-[10px] text-black-600 font-mono leading-relaxed">
                  Sentiment data is aggregated from multiple on-chain and off-chain sources including social media
                  platforms, funding rates, exchange flows, and network activity metrics. This information is provided
                  for educational purposes only and should not be considered financial advice. All signals are
                  probabilistic and past patterns do not guarantee future outcomes.
                </p>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Navigation Links ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Analytics', path: '/analytics', desc: 'Protocol metrics' },
                { label: 'Market Overview', path: '/market', desc: 'Token prices' },
                { label: 'Trading', path: '/trading', desc: 'Trade now' },
                { label: 'Oracle', path: '/oracle', desc: 'Price feeds' },
              ].map((link) => (
                <Link key={link.path} to={link.path}>
                  <GlassCard glowColor="terminal" className="p-4 cursor-pointer">
                    <div className="text-sm font-semibold font-mono" style={{ color: CYAN }}>
                      {link.label}
                    </div>
                    <div className="text-[10px] text-black-500 font-mono mt-1">{link.desc}</div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          </motion.div>

        </motion.div>
      </div>
    </div>
  )
}

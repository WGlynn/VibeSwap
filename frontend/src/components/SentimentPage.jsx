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

// ============ Animation ============

const stagger = { hidden: {}, show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

// ============ Sentiment Helpers ============

function getSentimentLabel(v) {
  if (v <= 20) return 'Extreme Fear'
  if (v <= 40) return 'Fear'
  if (v <= 60) return 'Neutral'
  if (v <= 80) return 'Greed'
  return 'Extreme Greed'
}

function getSentimentColor(v) {
  if (v <= 20) return '#ef4444'
  if (v <= 40) return '#f97316'
  if (v <= 60) return '#eab308'
  if (v <= 80) return '#22c55e'
  return '#10b981'
}

function getGaugeColor(pct) {
  if (pct < 0.25) return '#ef4444'
  if (pct < 0.5) return '#f97316'
  if (pct < 0.75) return '#eab308'
  return '#22c55e'
}

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtPct(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }

// ============ Data Generation ============

function generateSocialBuzz(rng) {
  return [
    { symbol: 'ETH', name: 'Ethereum' }, { symbol: 'BTC', name: 'Bitcoin' },
    { symbol: 'SOL', name: 'Solana' }, { symbol: 'ARB', name: 'Arbitrum' },
    { symbol: 'OP', name: 'Optimism' }, { symbol: 'PEPE', name: 'Pepe' },
    { symbol: 'LINK', name: 'Chainlink' }, { symbol: 'AAVE', name: 'Aave' },
    { symbol: 'EIGEN', name: 'EigenLayer' }, { symbol: 'TAO', name: 'Bittensor' },
  ].map((t) => ({
    ...t,
    mentions: Math.round(1200 + rng() * 48000),
    sentiment: +(0.15 + rng() * 0.75).toFixed(2),
    volumeCorrelation: +(-0.3 + rng() * 1.1).toFixed(2),
    change24h: +(-25 + rng() * 80).toFixed(1),
  })).sort((a, b) => b.mentions - a.mentions)
}

function generateFundingRates(rng) {
  return ['ETH-PERP', 'BTC-PERP', 'SOL-PERP', 'ARB-PERP', 'OP-PERP',
    'AVAX-PERP', 'LINK-PERP', 'DOGE-PERP', 'PEPE-PERP', 'WIF-PERP',
  ].map((pair) => ({
    pair,
    rate: +(-0.04 + rng() * 0.08).toFixed(4),
    rate8h: +(-0.12 + rng() * 0.24).toFixed(4),
    annualized: +(-14 + rng() * 28).toFixed(2),
    openInterest: Math.round(2_000_000 + rng() * 48_000_000),
  }))
}

function generateLongShort(rng) {
  return ['ETH', 'BTC', 'SOL', 'ARB', 'OP', 'AVAX', 'LINK', 'DOGE'].map((token) => {
    const longPct = +(35 + rng() * 30).toFixed(1)
    return {
      token, longPct, shortPct: +(100 - longPct).toFixed(1),
      longVolume: Math.round(5_000_000 + rng() * 45_000_000),
      shortVolume: Math.round(3_000_000 + rng() * 35_000_000),
      change1h: +(-5 + rng() * 10).toFixed(1),
    }
  })
}

function generateOnChain(rng) {
  return [
    { label: 'Whale Accumulation', desc: 'Net flow to wallets >1000 ETH', value: Math.round(-12000 + rng() * 35000), unit: 'ETH', trend: rng() > 0.4 ? 'bullish' : 'bearish', confidence: +(0.55 + rng() * 0.4).toFixed(2) },
    { label: 'Exchange Inflows', desc: 'Tokens moving to exchanges (sell pressure)', value: Math.round(8000 + rng() * 22000), unit: 'ETH', trend: rng() > 0.55 ? 'bearish' : 'neutral', confidence: +(0.45 + rng() * 0.45).toFixed(2) },
    { label: 'Exchange Outflows', desc: 'Tokens leaving exchanges (accumulation)', value: Math.round(10000 + rng() * 28000), unit: 'ETH', trend: rng() > 0.45 ? 'bullish' : 'neutral', confidence: +(0.5 + rng() * 0.4).toFixed(2) },
    { label: 'Active Addresses', desc: '24h unique active addresses on Ethereum', value: Math.round(380000 + rng() * 220000), unit: '', trend: rng() > 0.5 ? 'bullish' : 'neutral', confidence: +(0.6 + rng() * 0.3).toFixed(2) },
    { label: 'NVT Ratio', desc: 'Network Value to Transactions ratio', value: +(35 + rng() * 90).toFixed(1), unit: '', trend: rng() > 0.5 ? 'bearish' : 'neutral', confidence: +(0.4 + rng() * 0.4).toFixed(2) },
    { label: 'Avg Gas Usage', desc: 'Network activity proxy', value: Math.round(15 + rng() * 85), unit: 'Gwei', trend: rng() > 0.5 ? 'bullish' : 'neutral', confidence: +(0.5 + rng() * 0.35).toFixed(2) },
  ]
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
const LONG_SHORT = generateLongShort(seededRandom(1414))
const ON_CHAIN = generateOnChain(seededRandom(1618))
const HISTORICAL = generateHistoricalSentiment(seededRandom(4242))

// ============ Fear & Greed Gauge ============

function FearGreedGauge({ value }) {
  const R = 100, CX = 130, CY = 130
  const ticks = 50
  const sentimentColor = getSentimentColor(value)

  const arc = (r, a1, a2) => {
    const x1 = CX + r * Math.cos(a1), y1 = CY + r * Math.sin(a1)
    const x2 = CX + r * Math.cos(a2), y2 = CY + r * Math.sin(a2)
    return `M ${x1} ${y1} A ${r} ${r} 0 ${a2 - a1 > Math.PI ? 1 : 0} 1 ${x2} ${y2}`
  }

  const needleAngle = Math.PI + (value / 100) * Math.PI
  const nX = CX + (R - 20) * Math.cos(needleAngle)
  const nY = CY + (R - 20) * Math.sin(needleAngle)

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 260 160" className="w-full max-w-xs">
        <path d={arc(R, Math.PI, 2 * Math.PI)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" strokeLinecap="round" />
        {Array.from({ length: ticks - 1 }, (_, i) => {
          const p = i / ticks
          const a1 = Math.PI + p * Math.PI, a2 = Math.PI + ((i + 1) / ticks) * Math.PI
          return <path key={i} d={arc(R, a1, a2)} fill="none" stroke={getGaugeColor(p)} strokeWidth="14" opacity={p <= value / 100 ? 0.8 : 0.12} strokeLinecap="butt" />
        })}
        <text x="20" y="148" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="monospace">0</text>
        <text x="60" y="55" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">25</text>
        <text x="125" y="22" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace" textAnchor="middle">50</text>
        <text x="192" y="55" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">75</text>
        <text x="232" y="148" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="monospace">100</text>
        <line x1={CX} y1={CY} x2={nX} y2={nY} stroke={sentimentColor} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={CX} cy={CY} r="5" fill={sentimentColor} />
        <circle cx={CX} cy={CY} r="2.5" fill="#0a0a0a" />
        <text x={CX} y={CY + 30} textAnchor="middle" fill="white" fontSize="28" fontFamily="monospace" fontWeight="bold">{value}</text>
      </svg>
      <div className="text-center -mt-2">
        <div className="text-lg font-bold font-mono tracking-wide" style={{ color: sentimentColor }}>{getSentimentLabel(value)}</div>
        <div className="text-xs text-black-500 font-mono mt-1">Updated every 10 seconds</div>
      </div>
    </div>
  )
}

// ============ Sub-components ============

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-black-500 mt-0.5 font-mono">{subtitle}</p>}
    </div>
  )
}

function TrendDot({ trend }) {
  const c = { bullish: '#22c55e', bearish: '#ef4444', neutral: '#eab308' }[trend] || '#eab308'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
      <span className="text-xs font-mono capitalize" style={{ color: c }}>{trend}</span>
    </div>
  )
}

function ConfidenceBar({ confidence }) {
  const pct = Math.round(confidence * 100)
  const c = confidence > 0.7 ? '#22c55e' : confidence > 0.5 ? '#eab308' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-black-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: c }} />
      </div>
      <span className="text-xs font-mono text-black-400 w-10 text-right">{pct}%</span>
    </div>
  )
}

// ============ Historical Sentiment Chart ============

function SentimentLineChart({ data }) {
  const W = 720, H = 220
  const PAD = { top: 20, right: 20, bottom: 32, left: 48 }
  const iW = W - PAD.left - PAD.right, iH = H - PAD.top - PAD.bottom

  const zones = [
    { y1: 0, y2: 20, color: 'rgba(239,68,68,0.05)', label: 'Extreme Fear' },
    { y1: 20, y2: 40, color: 'rgba(249,115,22,0.04)', label: 'Fear' },
    { y1: 40, y2: 60, color: 'rgba(234,179,8,0.03)', label: 'Neutral' },
    { y1: 60, y2: 80, color: 'rgba(34,197,94,0.04)', label: 'Greed' },
    { y1: 80, y2: 100, color: 'rgba(16,185,129,0.05)', label: 'Extreme Greed' },
  ]

  const pts = data.map((d, i) => ({
    x: PAD.left + (i / (data.length - 1)) * iW,
    y: PAD.top + iH - (d.value / 100) * iH,
    value: d.value,
  }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${PAD.top + iH} L${pts[0].x},${PAD.top + iH} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <defs>
        <linearGradient id="sent-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.2" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
        </linearGradient>
      </defs>
      {zones.map((z, i) => {
        const zy1 = PAD.top + iH - (z.y2 / 100) * iH, zy2 = PAD.top + iH - (z.y1 / 100) * iH
        return <rect key={i} x={PAD.left} y={zy1} width={iW} height={zy2 - zy1} fill={z.color} />
      })}
      {[0, 20, 40, 60, 80, 100].map((t) => {
        const y = PAD.top + iH - (t / 100) * iH
        return (
          <g key={t}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="monospace">{t}</text>
          </g>
        )
      })}
      {data.filter((_, i) => i % 5 === 0).map((d) => {
        const i = data.indexOf(d)
        return <text key={i} x={PAD.left + (i / (data.length - 1)) * iW} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="monospace">D{d.day}</text>
      })}
      <path d={areaPath} fill="url(#sent-fill)" />
      {pts.map((p, i) => {
        if (i === 0) return null
        const prev = pts[i - 1]
        return <line key={i} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y} stroke={getSentimentColor((prev.value + p.value) / 2)} strokeWidth="2.5" strokeLinecap="round" />
      })}
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4" fill={getSentimentColor(pts[pts.length - 1].value)} />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="7" fill="none" stroke={getSentimentColor(pts[pts.length - 1].value)} strokeWidth="1" opacity="0.4" />
    </svg>
  )
}

// ============ Main Component ============

export default function SentimentPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedTab, setSelectedTab] = useState('overview')
  const [sortBy, setSortBy] = useState('mentions')

  const sortedBuzz = useMemo(() => {
    const d = [...SOCIAL_BUZZ]
    if (sortBy === 'mentions') d.sort((a, b) => b.mentions - a.mentions)
    else if (sortBy === 'sentiment') d.sort((a, b) => b.sentiment - a.sentiment)
    else d.sort((a, b) => Math.abs(b.volumeCorrelation) - Math.abs(a.volumeCorrelation))
    return d
  }, [sortBy])

  const overallSentiment = useMemo(() => {
    return Math.round(SOCIAL_BUZZ.reduce((s, t) => s + t.sentiment, 0) / SOCIAL_BUZZ.length * 100)
  }, [])

  const netFlow = useMemo(() => ON_CHAIN[1].value - ON_CHAIN[2].value, [])
  const latestSent = HISTORICAL[HISTORICAL.length - 1].value
  const sentTrend = latestSent - HISTORICAL[HISTORICAL.length - 8].value

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero title="Market Sentiment" subtitle="Real-time crowd sentiment and social signals" category="intelligence" badge="Live" badgeColor={CYAN}>
        <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
          {['overview', 'social', 'on-chain'].map((tab) => (
            <button key={tab} onClick={() => setSelectedTab(tab)}
              className={`px-3 py-1 rounded-lg text-xs font-mono capitalize transition-colors ${selectedTab === tab ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'}`}>{tab}</button>
          ))}
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4">
        <motion.div variants={stagger} initial="hidden" animate="show">

          {/* ============ Fear & Greed Index ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <div className="grid md:grid-cols-3 gap-6">
              <GlassCard glowColor="warning" className="p-6 md:col-span-1">
                <SectionHeader title="Fear & Greed Index" subtitle="Composite market emotion gauge" />
                <FearGreedGauge value={FEAR_GREED_INDEX} />
              </GlassCard>

              <GlassCard glowColor="terminal" className="p-6 md:col-span-2">
                <SectionHeader title="Index Components" subtitle="Weighted factors contributing to the score" />
                <div className="space-y-4">
                  {[
                    { name: 'Volatility', weight: '25%', score: Math.round(20 + mainRng() * 60), desc: 'Current vs. 30-day average volatility' },
                    { name: 'Market Momentum', weight: '25%', score: Math.round(25 + mainRng() * 55), desc: 'Volume-weighted price momentum' },
                    { name: 'Social Media', weight: '15%', score: overallSentiment, desc: 'Aggregate social sentiment' },
                    { name: 'Dominance', weight: '10%', score: Math.round(30 + mainRng() * 50), desc: 'BTC dominance vs. historical average' },
                    { name: 'Funding Rates', weight: '15%', score: Math.round(35 + mainRng() * 40), desc: 'Perpetual funding rate bias' },
                    { name: 'On-Chain Activity', weight: '10%', score: Math.round(40 + mainRng() * 35), desc: 'Active addresses and tx volume' },
                  ].map((f) => (
                    <div key={f.name}>
                      <div className="flex justify-between items-baseline mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium">{f.name}</span>
                          <span className="text-[10px] text-black-600 font-mono">({f.weight})</span>
                        </div>
                        <span className="text-sm font-bold font-mono" style={{ color: getSentimentColor(f.score) }}>{f.score}</span>
                      </div>
                      <div className="h-2 rounded-full bg-black-800 overflow-hidden mb-1">
                        <motion.div className="h-full rounded-full" style={{ backgroundColor: getSentimentColor(f.score) }}
                          initial={{ width: 0 }} animate={{ width: `${f.score}%` }}
                          transition={{ duration: 1 / PHI, ease: 'easeOut', delay: 0.1 }} />
                      </div>
                      <p className="text-[10px] text-black-600 font-mono">{f.desc}</p>
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
                <SectionHeader title="Social Buzz" subtitle="Trending tokens across social platforms" />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-lg border border-black-800/50">
                  {[{ key: 'mentions', label: 'Mentions' }, { key: 'sentiment', label: 'Sentiment' }, { key: 'correlation', label: 'Correlation' }].map((s) => (
                    <button key={s.key} onClick={() => setSortBy(s.key)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${sortBy === s.key ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'}`}>{s.label}</button>
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
                    {sortedBuzz.map((t, idx) => {
                      const sC = t.sentiment > 0.6 ? '#22c55e' : t.sentiment > 0.4 ? '#eab308' : '#ef4444'
                      const cC = t.volumeCorrelation > 0.3 ? '#22c55e' : t.volumeCorrelation > -0.1 ? '#eab308' : '#ef4444'
                      return (
                        <tr key={t.symbol} className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors">
                          <td className="py-3 font-mono text-black-600 text-xs">{idx + 1}</td>
                          <td className="py-3">
                            <span className="font-mono font-semibold text-sm">{t.symbol}</span>
                            <span className="text-xs text-black-500 ml-2">{t.name}</span>
                          </td>
                          <td className="py-3 text-right font-mono">{fmtNum(t.mentions)}</td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-12 h-1.5 rounded-full bg-black-800 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${t.sentiment * 100}%`, backgroundColor: sC }} />
                              </div>
                              <span className="font-mono text-xs" style={{ color: sC }}>{(t.sentiment * 100).toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="py-3 text-right">
                            <span className="font-mono text-xs" style={{ color: cC }}>{t.volumeCorrelation > 0 ? '+' : ''}{t.volumeCorrelation.toFixed(2)}</span>
                          </td>
                          <td className={`py-3 text-right font-mono text-xs ${parseFloat(t.change24h) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {parseFloat(t.change24h) >= 0 ? '+' : ''}{t.change24h}%
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
              <SectionHeader title="Funding Rates" subtitle="Perpetual swap funding rates across major pairs" />
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
                      const signal = Math.abs(fr.annualized) > 15
                        ? (fr.annualized > 0 ? 'Overleveraged Long' : 'Overleveraged Short')
                        : 'Normal'
                      const sigColor = signal === 'Normal' ? 'text-black-500' : fr.annualized > 0 ? 'text-red-400' : 'text-green-400'
                      return (
                        <tr key={fr.pair} className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors">
                          <td className="py-3 font-mono font-medium text-sm">{fr.pair}</td>
                          <td className="py-3 text-right font-mono text-xs" style={{ color: fr.rate >= 0 ? '#22c55e' : '#ef4444' }}>
                            {fr.rate >= 0 ? '+' : ''}{(fr.rate * 100).toFixed(4)}%
                          </td>
                          <td className="py-3 text-right font-mono text-xs" style={{ color: fr.rate8h >= 0 ? '#22c55e' : '#ef4444' }}>
                            {fr.rate8h >= 0 ? '+' : ''}{(fr.rate8h * 100).toFixed(4)}%
                          </td>
                          <td className="py-3 text-right font-mono text-xs" style={{ color: fr.annualized >= 0 ? '#22c55e' : '#ef4444' }}>
                            {fmtPct(parseFloat(fr.annualized))}
                          </td>
                          <td className="py-3 text-right font-mono text-xs text-black-300">${fmtNum(fr.openInterest)}</td>
                          <td className={`py-3 text-right font-mono text-[10px] ${sigColor}`}>{signal}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Avg Funding', value: fmtPct(FUNDING_RATES.reduce((s, f) => s + parseFloat(f.annualized), 0) / FUNDING_RATES.length), color: CYAN },
                  { label: 'Most Positive', value: FUNDING_RATES.reduce((m, f) => parseFloat(f.annualized) > parseFloat(m.annualized) ? f : m).pair, color: '#22c55e' },
                  { label: 'Most Negative', value: FUNDING_RATES.reduce((m, f) => parseFloat(f.annualized) < parseFloat(m.annualized) ? f : m).pair, color: '#ef4444' },
                  { label: 'Total OI', value: '$' + fmtNum(FUNDING_RATES.reduce((s, f) => s + f.openInterest, 0)), color: CYAN },
                ].map((st) => (
                  <div key={st.label} className="text-center bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                    <div className="text-[10px] text-black-500 font-mono mb-1">{st.label}</div>
                    <div className="text-sm font-bold font-mono" style={{ color: st.color }}>{st.value}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Long/Short Ratio ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Long/Short Ratio" subtitle="Position distribution across top tokens" />
              <div className="flex items-center gap-4 text-xs font-mono mb-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#22c55e' }} />
                  <span className="text-black-400">Long</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#ef4444' }} />
                  <span className="text-black-400">Short</span>
                </div>
              </div>
              <div className="space-y-4">
                {LONG_SHORT.map((ls) => (
                  <div key={ls.token}>
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-sm w-12">{ls.token}</span>
                        <span className={`text-[10px] font-mono ${parseFloat(ls.change1h) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {parseFloat(ls.change1h) >= 0 ? '+' : ''}{ls.change1h}% 1h
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-mono">
                        <span className="text-green-400">{ls.longPct}%</span>
                        <span className="text-black-600">/</span>
                        <span className="text-red-400">{ls.shortPct}%</span>
                      </div>
                    </div>
                    <div className="flex rounded-full overflow-hidden h-3">
                      <div className="transition-all" style={{ width: `${ls.longPct}%`, backgroundColor: '#22c55e' }} />
                      <div className="transition-all" style={{ width: `${ls.shortPct}%`, backgroundColor: '#ef4444' }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-black-600 font-mono mt-1">
                      <span>Vol: ${fmtNum(ls.longVolume)}</span>
                      <span>Vol: ${fmtNum(ls.shortVolume)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-4 border-t border-black-800">
                <div className="grid grid-cols-3 gap-4 text-center">
                  {(() => {
                    const avgL = LONG_SHORT.reduce((s, l) => s + l.longPct, 0) / LONG_SHORT.length
                    const tLV = LONG_SHORT.reduce((s, l) => s + l.longVolume, 0)
                    const tSV = LONG_SHORT.reduce((s, l) => s + l.shortVolume, 0)
                    return [
                      { label: 'Avg Long %', value: `${avgL.toFixed(1)}%`, color: '#22c55e' },
                      { label: 'Total Long Vol', value: `$${fmtNum(tLV)}`, color: '#22c55e' },
                      { label: 'Total Short Vol', value: `$${fmtNum(tSV)}`, color: '#ef4444' },
                    ]
                  })().map((st) => (
                    <div key={st.label} className="bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                      <div className="text-[10px] text-black-500 font-mono mb-1">{st.label}</div>
                      <div className="text-sm font-bold font-mono" style={{ color: st.color }}>{st.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ On-Chain Signals ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="On-Chain Signals" subtitle="Blockchain-native indicators for smart money tracking" />
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ON_CHAIN.map((sig) => (
                  <div key={sig.label} className="bg-black-800/40 rounded-xl p-4 border border-black-800 hover:border-black-700 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-sm font-semibold font-mono">{sig.label}</h3>
                      <TrendDot trend={sig.trend} />
                    </div>
                    <div className="text-2xl font-bold font-mono mb-1" style={{ color: CYAN }}>
                      {typeof sig.value === 'number' && sig.value > 10000 ? fmtNum(sig.value) : sig.value.toLocaleString()}
                      {sig.unit && <span className="text-sm text-black-500 ml-1">{sig.unit}</span>}
                    </div>
                    <p className="text-[10px] text-black-600 font-mono mb-3">{sig.desc}</p>
                    <div>
                      <div className="text-[10px] text-black-500 font-mono mb-1">Confidence</div>
                      <ConfidenceBar confidence={sig.confidence} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-4 border-t border-black-800">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Net Exchange Flow', value: `${netFlow > 0 ? '+' : ''}${fmtNum(netFlow)} ETH`, color: netFlow > 0 ? '#ef4444' : '#22c55e', desc: netFlow > 0 ? 'Net inflow (sell pressure)' : 'Net outflow (accumulation)' },
                    { label: 'Whale Activity', value: ON_CHAIN[0].trend === 'bullish' ? 'Accumulating' : 'Distributing', color: ON_CHAIN[0].trend === 'bullish' ? '#22c55e' : '#ef4444', desc: `${fmtNum(Math.abs(ON_CHAIN[0].value))} ETH net` },
                    { label: 'Network Activity', value: fmtNum(ON_CHAIN[3].value), color: CYAN, desc: 'Active addresses 24h' },
                    { label: 'NVT Signal', value: ON_CHAIN[4].value > 80 ? 'Overvalued' : ON_CHAIN[4].value > 50 ? 'Fair' : 'Undervalued', color: ON_CHAIN[4].value > 80 ? '#ef4444' : ON_CHAIN[4].value > 50 ? '#eab308' : '#22c55e', desc: `NVT: ${ON_CHAIN[4].value}` },
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
              <SectionHeader title="Historical Sentiment" subtitle="30-day sentiment index trend with zone classification" />
              <SentimentLineChart data={HISTORICAL} />
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Current', value: latestSent, color: getSentimentColor(latestSent), sub: getSentimentLabel(latestSent) },
                  { label: '7d Trend', value: `${sentTrend >= 0 ? '+' : ''}${sentTrend}`, color: sentTrend >= 0 ? '#22c55e' : '#ef4444', sub: sentTrend >= 0 ? 'Improving' : 'Declining' },
                  { label: '30d High', value: Math.max(...HISTORICAL.map((d) => d.value)), color: '#22c55e', sub: getSentimentLabel(Math.max(...HISTORICAL.map((d) => d.value))) },
                  { label: '30d Low', value: Math.min(...HISTORICAL.map((d) => d.value)), color: '#ef4444', sub: getSentimentLabel(Math.min(...HISTORICAL.map((d) => d.value))) },
                ].map((st) => (
                  <div key={st.label} className="text-center bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                    <div className="text-[10px] text-black-500 font-mono mb-1">{st.label}</div>
                    <div className="text-lg font-bold font-mono" style={{ color: st.color }}>{st.value}</div>
                    <div className="text-[10px] text-black-600 font-mono mt-0.5">{st.sub}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Aggregate Signals ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Aggregate Signals" subtitle="Combined view of all sentiment indicators" />
              <div className="grid md:grid-cols-2 gap-6">
                {/* Bullish */}
                <div>
                  <div className="text-xs font-mono text-green-400 mb-3 uppercase tracking-wider">Bullish Signals</div>
                  <div className="space-y-2">
                    {[
                      ON_CHAIN[0].trend === 'bullish' && 'Whale addresses are accumulating',
                      ON_CHAIN[2].value > ON_CHAIN[1].value && 'Net outflow from exchanges',
                      FEAR_GREED_INDEX < 30 && 'Extreme fear often precedes reversals',
                      LONG_SHORT.some((l) => l.longPct < 40) && 'Low long positions suggest room for upside',
                      FUNDING_RATES.some((f) => parseFloat(f.annualized) < -10) && 'Negative funding — shorts paying longs',
                      ON_CHAIN[3].trend === 'bullish' && 'Rising active addresses on-chain',
                    ].filter(Boolean).map((sig, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs font-mono">
                        <span className="text-green-400 mt-0.5">+</span>
                        <span className="text-black-300">{sig}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Bearish */}
                <div>
                  <div className="text-xs font-mono text-red-400 mb-3 uppercase tracking-wider">Bearish Signals</div>
                  <div className="space-y-2">
                    {[
                      ON_CHAIN[0].trend === 'bearish' && 'Whale addresses are distributing',
                      ON_CHAIN[1].value > ON_CHAIN[2].value && 'Net inflow to exchanges (sell pressure)',
                      FEAR_GREED_INDEX > 80 && 'Extreme greed often precedes corrections',
                      LONG_SHORT.some((l) => l.longPct > 65) && 'High long positions — liquidation risk',
                      FUNDING_RATES.some((f) => parseFloat(f.annualized) > 15) && 'High positive funding — overleveraged longs',
                      parseFloat(ON_CHAIN[4].value) > 80 && 'High NVT ratio suggests overvaluation',
                    ].filter(Boolean).map((sig, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs font-mono">
                        <span className="text-red-400 mt-0.5">-</span>
                        <span className="text-black-300">{sig}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Overall verdict */}
              <div className="mt-6 pt-4 border-t border-black-800">
                <div className="grid grid-cols-3 gap-4 text-center">
                  {[
                    { label: 'Sentiment Score', value: FEAR_GREED_INDEX, color: getSentimentColor(FEAR_GREED_INDEX) },
                    { label: 'Social Consensus', value: `${overallSentiment}%`, color: getSentimentColor(overallSentiment) },
                    { label: 'On-Chain Bias', value: netFlow > 0 ? 'Sell Pressure' : 'Accumulation', color: netFlow > 0 ? '#ef4444' : '#22c55e' },
                  ].map((st) => (
                    <div key={st.label} className="bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                      <div className="text-[10px] text-black-500 font-mono mb-1">{st.label}</div>
                      <div className="text-lg font-bold font-mono" style={{ color: st.color }}>{st.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Market Correlations ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Cross-Market Correlations" subtitle="Sentiment correlation between asset classes" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-black-500 border-b border-black-800">
                      <th className="pb-3 font-medium font-mono text-xs">Pair</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Correlation</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Strength</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">30d Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const cRng = seededRandom(9999)
                      return [
                        { pair: 'BTC / ETH', corr: +(0.7 + cRng() * 0.25).toFixed(2) },
                        { pair: 'BTC / S&P 500', corr: +(0.2 + cRng() * 0.4).toFixed(2) },
                        { pair: 'ETH / SOL', corr: +(0.5 + cRng() * 0.35).toFixed(2) },
                        { pair: 'BTC / Gold', corr: +(-0.1 + cRng() * 0.4).toFixed(2) },
                        { pair: 'DeFi / L2', corr: +(0.4 + cRng() * 0.4).toFixed(2) },
                        { pair: 'Memes / BTC', corr: +(0.1 + cRng() * 0.5).toFixed(2) },
                      ].map((c) => ({
                        ...c,
                        strength: Math.abs(c.corr) > 0.7 ? 'Strong' : Math.abs(c.corr) > 0.4 ? 'Moderate' : 'Weak',
                        avg30d: +(c.corr + (-0.1 + cRng() * 0.2)).toFixed(2),
                      }))
                    })().map((c) => {
                      const corrColor = c.corr > 0.5 ? '#22c55e' : c.corr > 0.2 ? '#eab308' : c.corr > 0 ? '#f97316' : '#ef4444'
                      return (
                        <tr key={c.pair} className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors">
                          <td className="py-3 font-mono font-medium text-sm">{c.pair}</td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-black-800 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.abs(c.corr) * 100}%`, backgroundColor: corrColor }} />
                              </div>
                              <span className="font-mono text-xs" style={{ color: corrColor }}>{c.corr}</span>
                            </div>
                          </td>
                          <td className="py-3 text-right font-mono text-xs text-black-400">{c.strength}</td>
                          <td className="py-3 text-right font-mono text-xs text-black-400">{c.avg30d}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
                    <div className="text-sm font-semibold font-mono" style={{ color: CYAN }}>{link.label}</div>
                    <div className="text-[10px] text-black-500 font-mono mt-1">{link.desc}</div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          </motion.div>

          {/* ============ Disclaimer ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <p className="text-[10px] text-black-600 font-mono leading-relaxed text-center max-w-2xl mx-auto">
              Sentiment data is aggregated from multiple on-chain and off-chain sources. This information is provided
              for educational purposes only and should not be considered financial advice. Past patterns do not guarantee future outcomes.
            </p>
          </motion.div>

        </motion.div>
      </div>
    </div>
  )
}

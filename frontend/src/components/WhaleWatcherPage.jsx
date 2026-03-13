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

const STAGGER_STEP = 1 / (PHI * PHI * PHI * PHI)
const FADE_DURATION = 1 / (PHI * PHI)

const stagger = { hidden: {}, show: { transition: { staggerChildren: STAGGER_STEP } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: FADE_DURATION, ease: 'easeOut' } },
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function truncAddr(addr) {
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

function timeAgo(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function generateAddress(rng) {
  const hex = '0123456789abcdef'
  return '0x' + Array.from({ length: 40 }, () => hex[Math.floor(rng() * 16)]).join('')
}

// ============ Section Tag ============

function SectionTag({ children }) {
  return (
    <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">
      {children}
    </span>
  )
}

function SectionHeader({ tag, title, subtitle }) {
  return (
    <div className="mb-4">
      {tag && <SectionTag>{tag}</SectionTag>}
      <h2 className="text-lg font-semibold tracking-tight font-mono">{title}</h2>
      {subtitle && <p className="text-sm text-black-500 mt-0.5 font-mono">{subtitle}</p>}
    </div>
  )
}

// ============ Mock Data Generators ============

const TOKENS = ['ETH', 'WBTC', 'USDC', 'ARB', 'OP', 'LINK', 'UNI', 'AAVE', 'VIBE', 'MATIC']
const DEXES = ['VibeSwap', 'Uniswap', 'SushiSwap', 'Curve', '1inch', 'Balancer']
const CHAINS = ['Ethereum', 'Arbitrum', 'Base', 'Optimism']

const CLASSIFICATIONS = ['accumulating', 'distributing', 'holding']
const CLASS_COLORS = {
  accumulating: 'text-green-400',
  distributing: 'text-red-400',
  holding: 'text-yellow-400',
}
const CLASS_BG = {
  accumulating: 'bg-green-400/10 border-green-400/20',
  distributing: 'bg-red-400/10 border-red-400/20',
  holding: 'bg-yellow-400/10 border-yellow-400/20',
}

function generateLiveFeed() {
  const rng = seededRandom(271828)
  const now = Date.now()
  return Array.from({ length: 25 }, (_, i) => {
    const token = TOKENS[Math.floor(rng() * TOKENS.length)]
    const direction = rng() > 0.5 ? 'in' : 'out'
    const amount = Math.round((50_000 + rng() * 4_950_000) * 100) / 100
    const dex = DEXES[Math.floor(rng() * DEXES.length)]
    const chain = CHAINS[Math.floor(rng() * CHAINS.length)]
    return {
      id: `feed-${i}`,
      address: generateAddress(rng),
      amount,
      token,
      direction,
      timestamp: now - Math.floor(rng() * 3600000),
      dex,
      chain,
    }
  }).sort((a, b) => b.timestamp - a.timestamp)
}

function generateTopWhales() {
  const rng = seededRandom(141421)
  return Array.from({ length: 15 }, (_, i) => {
    const totalHoldings = Math.round(1_000_000 + rng() * 499_000_000)
    const tokenCount = Math.floor(3 + rng() * 18)
    const lastActive = Math.floor(rng() * 72)
    const classification = CLASSIFICATIONS[Math.floor(rng() * CLASSIFICATIONS.length)]
    const pnl = (rng() - 0.3) * 200
    const txCount30d = Math.floor(5 + rng() * 200)
    return {
      rank: i + 1,
      address: generateAddress(rng),
      totalHoldings,
      tokenCount,
      lastActive,
      classification,
      pnl,
      txCount30d,
      chain: CHAINS[Math.floor(rng() * CHAINS.length)],
    }
  }).sort((a, b) => b.totalHoldings - a.totalHoldings)
}

function generateFlowData(periods) {
  const rng = seededRandom(173205)
  return Array.from({ length: periods }, (_, i) => {
    const buys = Math.round(500_000 + rng() * 4_500_000)
    const sells = Math.round(400_000 + rng() * 4_000_000)
    return { period: i + 1, buys, sells, net: buys - sells }
  })
}

function generateTokenConcentration() {
  const rng = seededRandom(223606)
  const tokens = ['ETH', 'WBTC', 'ARB', 'OP', 'LINK', 'VIBE']
  return tokens.map((token) => {
    const holders = Array.from({ length: 10 }, (_, i) => {
      const base = (10 - i) * (2 + rng() * 3)
      return {
        rank: i + 1,
        address: generateAddress(rng),
        pct: Math.round(base * 100) / 100,
      }
    })
    const totalTop10 = holders.reduce((s, h) => s + h.pct, 0)
    return { token, holders, totalTop10: Math.round(totalTop10 * 100) / 100 }
  })
}

function generateSmartMoney() {
  const rng = seededRandom(316227)
  return Array.from({ length: 10 }, (_, i) => {
    const winRate = Math.round((55 + rng() * 40) * 10) / 10
    const avgReturn = Math.round((5 + rng() * 45) * 10) / 10
    const followedCount = Math.floor(50 + rng() * 5000)
    const totalTrades = Math.floor(20 + rng() * 500)
    const totalPnl = Math.round((rng() * 2_000_000 + 100_000) * 100) / 100
    return {
      rank: i + 1,
      address: generateAddress(rng),
      winRate,
      avgReturn,
      followedCount,
      totalTrades,
      totalPnl,
      topToken: TOKENS[Math.floor(rng() * TOKENS.length)],
      chain: CHAINS[Math.floor(rng() * CHAINS.length)],
    }
  }).sort((a, b) => b.totalPnl - a.totalPnl)
}

// ============ Static Data ============

const LIVE_FEED = generateLiveFeed()
const TOP_WHALES = generateTopWhales()
const TOKEN_CONCENTRATION = generateTokenConcentration()
const SMART_MONEY = generateSmartMoney()

// ============ Flow Chart SVG ============

function FlowChart({ data, label }) {
  const W = 720, H = 180, PAD = { top: 16, right: 16, bottom: 28, left: 56 }
  const iW = W - PAD.left - PAD.right, iH = H - PAD.top - PAD.bottom
  const maxVal = Math.max(...data.map((d) => Math.max(d.buys, d.sells))) * 1.15
  const gW = iW / data.length, bW = gW * 0.35

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto font-mono">
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
        const y = PAD.top + iH - p * iH
        return (<g key={i}><line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
          <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="9" fontFamily="monospace">{fmt(Math.round(maxVal * p))}</text></g>)
      })}
      {data.map((d, i) => {
        const x = PAD.left + i * gW + gW * 0.1, buyH = (d.buys / maxVal) * iH, sellH = (d.sells / maxVal) * iH
        return (<g key={i}>
          <rect x={x} y={PAD.top + iH - buyH} width={bW} height={buyH} rx="2" fill="#22c55e" opacity="0.75" />
          <rect x={x + bW + 2} y={PAD.top + iH - sellH} width={bW} height={sellH} rx="2" fill="#ef4444" opacity="0.75" />
          {i % Math.ceil(data.length / 8) === 0 && (<text x={x + bW} y={H - 6} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="9" fontFamily="monospace">
            {label === '24h' ? `${d.period}h` : `D${d.period}`}</text>)}
        </g>)
      })}
      {(() => {
        const netMax = Math.max(...data.map((d) => Math.abs(d.net))), midY = PAD.top + iH / 2
        const pts = data.map((d, i) => ({ x: PAD.left + i * gW + gW / 2, y: midY - (d.net / (netMax * 2)) * iH * 0.4 }))
        const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
        return (<><line x1={PAD.left} y1={midY} x2={W - PAD.right} y2={midY} stroke="rgba(255,255,255,0.08)" strokeDasharray="4,4" />
          <path d={path} fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" /></>)
      })()}
    </svg>
  )
}

// ============ Concentration Bar ============

function ConcentrationBar({ holders, totalTop10 }) {
  const colors = ['#06b6d4', '#3b82f6', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6']
  return (
    <div>
      <div className="flex rounded-full overflow-hidden h-3 mb-2">
        {holders.map((h, i) => (
          <div
            key={i}
            style={{ width: `${(h.pct / totalTop10) * 100}%`, backgroundColor: colors[i] }}
            className="transition-all"
            title={`#${h.rank}: ${h.pct}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {holders.slice(0, 5).map((h, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px] font-mono">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors[i] }} />
            <span className="text-black-500">#{h.rank}</span>
            <span className="text-black-400">{truncAddr(h.address)}</span>
            <span className="text-black-300">{h.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function WhaleWatcherPage() {
  // Dual wallet detection
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // State
  const [feedFilter, setFeedFilter] = useState('all')
  const [flowTimeRange, setFlowTimeRange] = useState('24h')
  const [selectedConcentrationToken, setSelectedConcentrationToken] = useState('ETH')
  const [alertThreshold, setAlertThreshold] = useState(100000)
  const [alertTokens, setAlertTokens] = useState(['ETH', 'WBTC'])
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  const [whaleSort, setWhaleSort] = useState('holdings')

  // Filtered live feed
  const filteredFeed = useMemo(() => {
    if (feedFilter === 'all') return LIVE_FEED
    return LIVE_FEED.filter((tx) => tx.direction === feedFilter)
  }, [feedFilter])

  // Flow data based on time range
  const flowData = useMemo(() => {
    const periods = flowTimeRange === '24h' ? 24 : flowTimeRange === '7d' ? 7 : 30
    return generateFlowData(periods)
  }, [flowTimeRange])

  // Sorted whales
  const sortedWhales = useMemo(() => {
    const sorted = [...TOP_WHALES]
    if (whaleSort === 'holdings') sorted.sort((a, b) => b.totalHoldings - a.totalHoldings)
    else if (whaleSort === 'activity') sorted.sort((a, b) => a.lastActive - b.lastActive)
    else if (whaleSort === 'tokens') sorted.sort((a, b) => b.tokenCount - a.tokenCount)
    else if (whaleSort === 'pnl') sorted.sort((a, b) => b.pnl - a.pnl)
    return sorted
  }, [whaleSort])

  // Selected token concentration
  const selectedConcentration = useMemo(() => {
    return TOKEN_CONCENTRATION.find((t) => t.token === selectedConcentrationToken) || TOKEN_CONCENTRATION[0]
  }, [selectedConcentrationToken])

  // Flow summary stats
  const flowSummary = useMemo(() => {
    const totalBuys = flowData.reduce((s, d) => s + d.buys, 0)
    const totalSells = flowData.reduce((s, d) => s + d.sells, 0)
    const netFlow = totalBuys - totalSells
    const buyPressure = Math.round((totalBuys / (totalBuys + totalSells)) * 100)
    return { totalBuys, totalSells, netFlow, buyPressure }
  }, [flowData])

  // Alert token toggle
  const toggleAlertToken = (token) => {
    setAlertTokens((prev) =>
      prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token]
    )
  }

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title="Whale Watcher"
        subtitle="Track large wallet movements in real-time"
        category="intelligence"
        badge="Live"
        badgeColor={CYAN}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-black-800/60 border border-black-700/50">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {isConnected ? 'Tracking' : 'Demo Mode'}
          </div>
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4">
        <motion.div variants={stagger} initial="hidden" animate="show">

          {/* ============ Overview Stats ============ */}
          <motion.div variants={fadeUp} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Whales Tracked', value: '2,847', change: '+12.4%', positive: true },
              { label: '24h Whale Volume', value: '$847.2M', change: '+28.7%', positive: true },
              { label: 'Net Flow (24h)', value: flowSummary.netFlow >= 0 ? `+${fmt(flowSummary.netFlow)}` : fmt(flowSummary.netFlow), change: `${flowSummary.buyPressure}% buy`, positive: flowSummary.netFlow >= 0 },
              { label: 'Active Alerts', value: alertsEnabled ? alertTokens.length.toString() : '0', change: alertsEnabled ? 'Enabled' : 'Disabled', positive: alertsEnabled },
            ].map((stat) => (
              <GlassCard key={stat.label} glowColor="terminal" className="p-4">
                <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider mb-1">{stat.label}</div>
                <div className="text-xl font-bold font-mono" style={{ color: CYAN }}>{stat.value}</div>
                <div className={`text-xs font-mono mt-1 ${stat.positive ? 'text-green-400' : 'text-red-400'}`}>
                  {stat.change}
                </div>
              </GlassCard>
            ))}
          </motion.div>

          {/* ============ Live Feed ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <SectionHeader tag="real-time" title="Live Whale Feed" subtitle="Transactions above $50K" />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'in', label: 'Buys' },
                    { id: 'out', label: 'Sells' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setFeedFilter(tab.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                        feedFilter === tab.id
                          ? 'bg-black-700 text-white'
                          : 'text-black-500 hover:text-black-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto max-h-[400px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-sm font-mono">
                  <thead className="sticky top-0 bg-black-900/90 backdrop-blur-sm z-10">
                    <tr className="text-left text-black-500 border-b border-black-800">
                      <th className="pb-3 font-medium">Address</th>
                      <th className="pb-3 font-medium">Direction</th>
                      <th className="pb-3 font-medium text-right">Amount</th>
                      <th className="pb-3 font-medium">Token</th>
                      <th className="pb-3 font-medium">DEX</th>
                      <th className="pb-3 font-medium">Chain</th>
                      <th className="pb-3 font-medium text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFeed.map((tx) => (
                      <motion.tr
                        key={tx.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: FADE_DURATION * 0.5 }}
                        className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors"
                      >
                        <td className="py-2.5 text-cyan-400">{truncAddr(tx.address)}</td>
                        <td className="py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                            tx.direction === 'in'
                              ? 'bg-green-400/10 text-green-400 border border-green-400/20'
                              : 'bg-red-400/10 text-red-400 border border-red-400/20'
                          }`}>
                            {tx.direction === 'in' ? '\u2191 Buy' : '\u2193 Sell'}
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-medium">{fmt(tx.amount)}</td>
                        <td className="py-2.5">
                          <span className="text-black-300">{tx.token}</span>
                        </td>
                        <td className="py-2.5 text-black-500 text-xs">{tx.dex}</td>
                        <td className="py-2.5 text-black-500 text-xs">{tx.chain}</td>
                        <td className="py-2.5 text-right text-black-500 text-xs">
                          {timeAgo(Date.now() - tx.timestamp)}
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs font-mono text-black-500">
                <span>{filteredFeed.length} transactions</span>
                <span className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Auto-refreshing
                </span>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Top Whales ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <SectionHeader tag="leaderboard" title="Top Whales" subtitle="Largest wallets by total holdings" />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
                  {[
                    { id: 'holdings', label: 'Holdings' },
                    { id: 'activity', label: 'Activity' },
                    { id: 'tokens', label: 'Tokens' },
                    { id: 'pnl', label: 'P&L' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setWhaleSort(tab.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                        whaleSort === tab.id
                          ? 'bg-black-700 text-white'
                          : 'text-black-500 hover:text-black-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="text-left text-black-500 border-b border-black-800">
                      <th className="pb-3 font-medium w-12">#</th>
                      <th className="pb-3 font-medium">Address</th>
                      <th className="pb-3 font-medium text-right">Holdings (USD)</th>
                      <th className="pb-3 font-medium text-right">Tokens</th>
                      <th className="pb-3 font-medium text-right">30d Txns</th>
                      <th className="pb-3 font-medium text-right">P&L</th>
                      <th className="pb-3 font-medium text-right">Last Active</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedWhales.map((whale, idx) => (
                      <motion.tr
                        key={whale.address}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * STAGGER_STEP * 0.3, duration: FADE_DURATION }}
                        className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors"
                      >
                        <td className="py-3 text-black-500">
                          {idx + 1 <= 3 ? (
                            <span className="text-yellow-400 font-bold">{idx + 1}</span>
                          ) : (
                            idx + 1
                          )}
                        </td>
                        <td className="py-3 text-cyan-400">{truncAddr(whale.address)}</td>
                        <td className="py-3 text-right font-medium">{fmt(whale.totalHoldings)}</td>
                        <td className="py-3 text-right text-black-300">{whale.tokenCount}</td>
                        <td className="py-3 text-right text-black-400">{whale.txCount30d}</td>
                        <td className={`py-3 text-right ${whale.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {whale.pnl >= 0 ? '+' : ''}{whale.pnl.toFixed(1)}%
                        </td>
                        <td className="py-3 text-right text-black-500 text-xs">
                          {whale.lastActive === 0 ? 'Just now' : `${whale.lastActive}h ago`}
                        </td>
                        <td className="py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border ${CLASS_BG[whale.classification]} ${CLASS_COLORS[whale.classification]}`}>
                            {whale.classification}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Whale Alerts ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="warning" className="p-6">
              <SectionHeader tag="alerts" title="Whale Alerts" subtitle="Configure notifications for large wallet movements" />

              <div className="grid md:grid-cols-3 gap-6">
                {/* Threshold */}
                <div className="bg-black-800/40 rounded-xl p-4 border border-black-800">
                  <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider mb-3">
                    Alert Threshold
                  </div>
                  <div className="space-y-3">
                    {[50_000, 100_000, 250_000, 500_000, 1_000_000].map((val) => (
                      <button
                        key={val}
                        onClick={() => setAlertThreshold(val)}
                        className={`w-full px-3 py-2 rounded-lg text-xs font-mono text-left transition-colors border ${
                          alertThreshold === val
                            ? 'bg-cyan-400/10 border-cyan-400/30 text-cyan-400'
                            : 'bg-black-800/30 border-black-700/50 text-black-400 hover:text-black-300 hover:border-black-600'
                        }`}
                      >
                        {'>'} {fmt(val)} moves
                      </button>
                    ))}
                  </div>
                </div>

                {/* Token Selection */}
                <div className="bg-black-800/40 rounded-xl p-4 border border-black-800">
                  <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider mb-3">
                    Tracked Tokens
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {TOKENS.map((token) => (
                      <button
                        key={token}
                        onClick={() => toggleAlertToken(token)}
                        className={`px-3 py-2 rounded-lg text-xs font-mono transition-colors border ${
                          alertTokens.includes(token)
                            ? 'bg-cyan-400/10 border-cyan-400/30 text-cyan-400'
                            : 'bg-black-800/30 border-black-700/50 text-black-500 hover:text-black-300'
                        }`}
                      >
                        {token}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notification Toggle + Summary */}
                <div className="bg-black-800/40 rounded-xl p-4 border border-black-800">
                  <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider mb-3">
                    Notification Status
                  </div>
                  <div className="space-y-4">
                    <button
                      onClick={() => setAlertsEnabled(!alertsEnabled)}
                      className={`w-full px-4 py-3 rounded-xl text-sm font-mono font-medium transition-all border ${
                        alertsEnabled
                          ? 'bg-green-400/10 border-green-400/30 text-green-400'
                          : 'bg-black-800/30 border-black-700/50 text-black-500'
                      }`}
                    >
                      {alertsEnabled ? 'Alerts Enabled' : 'Alerts Disabled'}
                    </button>

                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between text-black-400">
                        <span>Threshold</span>
                        <span className="text-black-300">{fmt(alertThreshold)}</span>
                      </div>
                      <div className="flex justify-between text-black-400">
                        <span>Tokens</span>
                        <span className="text-black-300">{alertTokens.length} selected</span>
                      </div>
                      <div className="flex justify-between text-black-400">
                        <span>Status</span>
                        <span className={alertsEnabled ? 'text-green-400' : 'text-red-400'}>
                          {alertsEnabled ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>

                    {/* Recent Alert History */}
                    <div className="border-t border-black-700/50 pt-3">
                      <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Recent Alerts</div>
                      {[
                        { token: 'ETH', amount: 2_340_000, dir: 'in', time: '12m' },
                        { token: 'WBTC', amount: 890_000, dir: 'out', time: '47m' },
                        { token: 'ETH', amount: 1_120_000, dir: 'in', time: '2h' },
                      ].map((alert, i) => (
                        <div key={i} className="flex items-center justify-between py-1 text-[11px] font-mono">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1 h-1 rounded-full ${alert.dir === 'in' ? 'bg-green-400' : 'bg-red-400'}`} />
                            <span className="text-black-400">{alert.token}</span>
                          </div>
                          <span className="text-black-300">{fmt(alert.amount)}</span>
                          <span className="text-black-500">{alert.time} ago</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {!isConnected && (
                <div className="mt-4 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 text-xs font-mono text-blue-400/80">
                  Connect wallet to enable push notifications for whale alerts
                </div>
              )}
            </GlassCard>
          </motion.div>

          {/* ============ Flow Analysis ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <SectionHeader tag="flow analysis" title="Whale Flow Analysis" subtitle="Net buying vs selling pressure from whale wallets" />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
                  {['24h', '7d', '30d'].map((r) => (
                    <button
                      key={r}
                      onClick={() => setFlowTimeRange(r)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                        flowTimeRange === r
                          ? 'bg-black-700 text-white'
                          : 'text-black-500 hover:text-black-300'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <FlowChart data={flowData} label={flowTimeRange} />

              {/* Legend */}
              <div className="flex items-center justify-center gap-6 mt-3 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-2 rounded-sm bg-green-500 opacity-75" />
                  <span className="text-black-400">Buy Volume</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-2 rounded-sm bg-red-500 opacity-75" />
                  <span className="text-black-400">Sell Volume</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-0.5 rounded-sm" style={{ backgroundColor: CYAN }} />
                  <span className="text-black-400">Net Flow</span>
                </div>
              </div>

              {/* Summary Stats */}
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Buys', value: fmt(flowSummary.totalBuys), color: 'text-green-400' },
                  { label: 'Total Sells', value: fmt(flowSummary.totalSells), color: 'text-red-400' },
                  { label: 'Net Flow', value: flowSummary.netFlow >= 0 ? `+${fmt(flowSummary.netFlow)}` : fmt(flowSummary.netFlow), color: flowSummary.netFlow >= 0 ? 'text-green-400' : 'text-red-400' },
                  { label: 'Buy Pressure', value: `${flowSummary.buyPressure}%`, color: flowSummary.buyPressure > 50 ? 'text-green-400' : 'text-red-400' },
                ].map((stat) => (
                  <div key={stat.label} className="text-center bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                    <div className="text-[10px] text-black-500 font-mono mb-1">{stat.label}</div>
                    <div className={`text-base font-bold font-mono ${stat.color}`}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Token Concentration ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <SectionHeader tag="concentration" title="Token Concentration" subtitle="Top 10 holders as percentage of total supply" />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
                  {TOKEN_CONCENTRATION.map((t) => (
                    <button
                      key={t.token}
                      onClick={() => setSelectedConcentrationToken(t.token)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                        selectedConcentrationToken === t.token
                          ? 'bg-black-700 text-white'
                          : 'text-black-500 hover:text-black-300'
                      }`}
                    >
                      {t.token}
                    </button>
                  ))}
                </div>
              </div>

              {/* Concentration Summary */}
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                <div className="bg-black-800/40 rounded-xl p-4 border border-black-800">
                  <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider mb-1">Top 10 Control</div>
                  <div className="text-2xl font-bold font-mono" style={{ color: CYAN }}>
                    {selectedConcentration.totalTop10.toFixed(1)}%
                  </div>
                  <div className="text-xs font-mono text-black-500 mt-1">of total supply</div>
                </div>
                <div className="bg-black-800/40 rounded-xl p-4 border border-black-800">
                  <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider mb-1">Concentration Level</div>
                  <div className={`text-2xl font-bold font-mono ${
                    selectedConcentration.totalTop10 > 60 ? 'text-red-400' :
                    selectedConcentration.totalTop10 > 40 ? 'text-yellow-400' : 'text-green-400'
                  }`}>
                    {selectedConcentration.totalTop10 > 60 ? 'High' :
                     selectedConcentration.totalTop10 > 40 ? 'Medium' : 'Low'}
                  </div>
                  <div className="text-xs font-mono text-black-500 mt-1">risk assessment</div>
                </div>
                <div className="bg-black-800/40 rounded-xl p-4 border border-black-800">
                  <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider mb-1">Remaining Supply</div>
                  <div className="text-2xl font-bold font-mono text-blue-400">
                    {(100 - selectedConcentration.totalTop10).toFixed(1)}%
                  </div>
                  <div className="text-xs font-mono text-black-500 mt-1">distributed among others</div>
                </div>
              </div>

              {/* Concentration Bar */}
              <ConcentrationBar holders={selectedConcentration.holders} totalTop10={selectedConcentration.totalTop10} />

              {/* Holder Breakdown */}
              <div className="mt-4 space-y-1.5">
                {selectedConcentration.holders.map((h, idx) => {
                  const cumulative = selectedConcentration.holders.slice(0, idx + 1).reduce((s, x) => s + x.pct, 0)
                  return (
                    <div key={idx} className="flex items-center gap-3 text-xs font-mono py-1 hover:bg-black-800/20 rounded px-2 transition-colors">
                      <span className="text-black-500 w-6">#{h.rank}</span>
                      <span className="text-cyan-400 w-28">{truncAddr(h.address)}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-black-800 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(h.pct / selectedConcentration.holders[0].pct) * 100}%`, backgroundColor: CYAN }} />
                      </div>
                      <span className="text-black-300 w-14 text-right">{h.pct}%</span>
                      <span className="text-black-500 w-16 text-right">{cumulative.toFixed(1)}%</span>
                    </div>
                  )
                })}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Smart Money ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="matrix" className="p-6">
              <SectionHeader tag="smart money" title="Smart Money Wallets" subtitle="Wallets with consistently profitable trades" />

              <div className="overflow-x-auto">
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="text-left text-black-500 border-b border-black-800">
                      <th className="pb-3 font-medium w-12">#</th>
                      <th className="pb-3 font-medium">Address</th>
                      <th className="pb-3 font-medium text-right">Win Rate</th>
                      <th className="pb-3 font-medium text-right">Avg Return</th>
                      <th className="pb-3 font-medium text-right">Total P&L</th>
                      <th className="pb-3 font-medium text-right">Trades</th>
                      <th className="pb-3 font-medium">Top Token</th>
                      <th className="pb-3 font-medium text-right">Followers</th>
                      <th className="pb-3 font-medium">Chain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SMART_MONEY.map((wallet, idx) => (
                      <motion.tr
                        key={wallet.address}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * STAGGER_STEP * 0.4, duration: FADE_DURATION }}
                        className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors"
                      >
                        <td className="py-3">
                          {idx + 1 <= 3 ? (
                            <span className="text-green-400 font-bold">{idx + 1}</span>
                          ) : (
                            <span className="text-black-500">{idx + 1}</span>
                          )}
                        </td>
                        <td className="py-3 text-cyan-400">{truncAddr(wallet.address)}</td>
                        <td className="py-3 text-right">
                          <span className={wallet.winRate >= 70 ? 'text-green-400' : wallet.winRate >= 55 ? 'text-yellow-400' : 'text-black-300'}>
                            {wallet.winRate}%
                          </span>
                        </td>
                        <td className="py-3 text-right text-green-400">+{wallet.avgReturn}%</td>
                        <td className="py-3 text-right font-medium text-green-400">{fmt(wallet.totalPnl)}</td>
                        <td className="py-3 text-right text-black-400">{wallet.totalTrades}</td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] bg-black-800/60 border border-black-700/50 text-black-300">
                            {wallet.topToken}
                          </span>
                        </td>
                        <td className="py-3 text-right text-black-400">{fmtNum(wallet.followedCount)}</td>
                        <td className="py-3 text-black-500 text-xs">{wallet.chain}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Smart Money Insights */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="text-center bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                  <div className="text-[10px] text-black-500 font-mono mb-1">Avg Win Rate</div>
                  <div className="text-base font-bold font-mono text-green-400">
                    {(SMART_MONEY.reduce((s, w) => s + w.winRate, 0) / SMART_MONEY.length).toFixed(1)}%
                  </div>
                </div>
                <div className="text-center bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                  <div className="text-[10px] text-black-500 font-mono mb-1">Total Followers</div>
                  <div className="text-base font-bold font-mono text-blue-400">
                    {fmtNum(SMART_MONEY.reduce((s, w) => s + w.followedCount, 0))}
                  </div>
                </div>
                <div className="text-center bg-black-800/30 rounded-xl p-3 border border-black-800/50">
                  <div className="text-[10px] text-black-500 font-mono mb-1">Total P&L</div>
                  <div className="text-base font-bold font-mono text-green-400">
                    {fmt(SMART_MONEY.reduce((s, w) => s + w.totalPnl, 0))}
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Whale Behavioral Patterns ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader tag="behavioral patterns" title="Whale Behavior Summary" subtitle="Aggregated accumulation and distribution signals" />
              <div className="grid md:grid-cols-3 gap-4">
                {[
                  { label: 'Accumulating', cls: 'accumulating', color: 'green', bg: 'bg-green-400/5 border-green-400/10', desc: 'wallets actively buying' },
                  { label: 'Distributing', cls: 'distributing', color: 'red', bg: 'bg-red-400/5 border-red-400/10', desc: 'wallets actively selling' },
                  { label: 'Holding', cls: 'holding', color: 'yellow', bg: 'bg-yellow-400/5 border-yellow-400/10', desc: 'wallets dormant / holding' },
                ].map((cat) => {
                  const whales = TOP_WHALES.filter((w) => w.classification === cat.cls)
                  return (
                    <div key={cat.cls} className={`rounded-xl p-4 border ${cat.bg}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-2.5 h-2.5 rounded-full bg-${cat.color}-400`} />
                        <span className={`text-sm font-mono font-medium text-${cat.color}-400`}>{cat.label}</span>
                      </div>
                      <div className={`text-2xl font-bold font-mono text-${cat.color}-400 mb-1`}>{whales.length}</div>
                      <div className="text-[10px] font-mono text-black-500 mb-2">{cat.desc}</div>
                      {whales.slice(0, 2).map((w, i) => (
                        <div key={i} className="flex justify-between text-[11px] font-mono py-0.5">
                          <span className="text-cyan-400">{truncAddr(w.address)}</span>
                          <span className={`text-${cat.color}-400`}>{w.pnl >= 0 ? '+' : ''}{w.pnl.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
              {/* Overall Sentiment Bar */}
              {(() => {
                const acc = TOP_WHALES.filter((w) => w.classification === 'accumulating').length
                const dist = TOP_WHALES.filter((w) => w.classification === 'distributing').length
                const hold = TOP_WHALES.filter((w) => w.classification === 'holding').length
                const total = acc + dist + hold
                return (
                  <div className="mt-5">
                    <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Overall Whale Sentiment</div>
                    <div className="flex rounded-full overflow-hidden h-3 mb-2">
                      <div style={{ width: `${(acc / total) * 100}%` }} className="bg-green-400 transition-all" />
                      <div style={{ width: `${(hold / total) * 100}%` }} className="bg-yellow-400 transition-all" />
                      <div style={{ width: `${(dist / total) * 100}%` }} className="bg-red-400 transition-all" />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-black-500">
                      <span>Accumulating {Math.round((acc / total) * 100)}%</span>
                      <span>Holding {Math.round((hold / total) * 100)}%</span>
                      <span>Distributing {Math.round((dist / total) * 100)}%</span>
                    </div>
                  </div>
                )
              })()}
            </GlassCard>
          </motion.div>

          {/* ============ Footer CTA ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6 text-center">
              <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider mb-2">
                VibeSwap Intelligence
              </div>
              <h3 className="text-lg font-bold font-mono mb-2">
                MEV-free trading means whales play fair
              </h3>
              <p className="text-sm font-mono text-black-500 max-w-xl mx-auto mb-4">
                VibeSwap's commit-reveal batch auctions eliminate front-running and sandwich attacks.
                Whale movements are transparent, not exploitative.
              </p>
              <div className="flex items-center justify-center gap-3">
                <Link
                  to="/swap"
                  className="px-4 py-2 rounded-xl text-sm font-mono font-medium transition-colors border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10"
                >
                  Start Trading
                </Link>
                <Link
                  to="/commit-reveal"
                  className="px-4 py-2 rounded-xl text-sm font-mono font-medium transition-colors border border-black-700/50 text-black-400 hover:text-black-300 hover:border-black-600"
                >
                  Learn About Commit-Reveal
                </Link>
              </div>
            </GlassCard>
          </motion.div>

        </motion.div>
      </div>
    </div>
  )
}

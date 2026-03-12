import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============================================================
// InfoFi Page — Real Information Finance
// Knowledge primitives as economic assets with Shapley attribution
// Data Marketplace + InfoFi Score + Signal Dashboard + Revenue + Leaderboard
// ============================================================

const API_BASE = import.meta.env.VITE_API_URL || ''
const TYPES = ['All', 'Insight', 'Discovery', 'Synthesis', 'Proof', 'Data', 'Model', 'Framework']
const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'most_cited', label: 'Most Cited' },
  { value: 'highest_price', label: 'Highest Price' },
  { value: 'most_viewed', label: 'Most Viewed' },
]
const PAGE_SIZE = 20
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

const TABS = ['Primitives', 'Marketplace', 'Signals', 'Leaderboard']

// ============ Mock Data for New Sections ============

const MOCK_DATA_FEEDS = [
  { id: 'df-1', name: 'BTC/USD Price History', provider: 'oracle.vibe', category: 'Price', price: '12 JUL', subscribers: 1284, accuracy: 98.7 },
  { id: 'df-2', name: 'Whale Alert Stream', provider: 'deepwatch.eth', category: 'On-Chain', price: '8 JUL', subscribers: 943, accuracy: 96.2 },
  { id: 'df-3', name: 'DeFi Sentiment Index', provider: 'sentiment.lab', category: 'Sentiment', price: '15 JUL', subscribers: 2107, accuracy: 91.4 },
  { id: 'df-4', name: 'Gas Price Predictor', provider: 'gasbot.xyz', category: 'Analytics', price: '5 JUL', subscribers: 3821, accuracy: 94.1 },
  { id: 'df-5', name: 'MEV Detection Feed', provider: 'flashguard.io', category: 'On-Chain', price: '20 JUL', subscribers: 712, accuracy: 97.8 },
  { id: 'df-6', name: 'Cross-Chain Flow Map', provider: 'bridge.eye', category: 'Analytics', price: '18 JUL', subscribers: 561, accuracy: 93.5 },
]
const MOCK_SIGNALS = [
  { id: 's-1', title: 'ETH breakout above $4200 resistance', type: 'Buy', asset: 'ETH', confidence: 87, accuracy: 92, author: 'oracle.vibe', ts: '2m ago' },
  { id: 's-2', title: 'MATIC double top — reversal likely', type: 'Sell', asset: 'MATIC', confidence: 74, accuracy: 81, author: 'ta.wizard', ts: '8m ago' },
  { id: 's-3', title: 'Unusual whale accumulation on ARB', type: 'Buy', asset: 'ARB', confidence: 91, accuracy: 96, author: 'deepwatch.eth', ts: '15m ago' },
  { id: 's-4', title: 'SOL TVL decline — risk off signal', type: 'Sell', asset: 'SOL', confidence: 68, accuracy: 77, author: 'defi.scout', ts: '22m ago' },
  { id: 's-5', title: 'BTC hash rate ATH — bullish divergence', type: 'Buy', asset: 'BTC', confidence: 83, accuracy: 89, author: 'onchain.guru', ts: '31m ago' },
]
const MOCK_LEADERBOARD = [
  { rank: 1, author: 'oracle.vibe', score: 97.3, signals: 482, earnings: '14,280 JUL', streak: 23 },
  { rank: 2, author: 'deepwatch.eth', score: 96.1, signals: 367, earnings: '11,940 JUL', streak: 18 },
  { rank: 3, author: 'onchain.guru', score: 94.8, signals: 291, earnings: '9,720 JUL', streak: 15 },
  { rank: 4, author: 'ta.wizard', score: 93.2, signals: 534, earnings: '8,430 JUL', streak: 11 },
  { rank: 5, author: 'sentiment.lab', score: 92.7, signals: 219, earnings: '7,890 JUL', streak: 9 },
  { rank: 6, author: 'defi.scout', score: 91.4, signals: 188, earnings: '6,210 JUL', streak: 7 },
]

const FEED_CATEGORIES = ['All', 'Price', 'Sentiment', 'On-Chain', 'Analytics']

// ============ API Helpers ============

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts,
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

function useDebounce(val, ms) {
  const [d, setD] = useState(val)
  useEffect(() => { const t = setTimeout(() => setD(val), ms); return () => clearTimeout(t) }, [val, ms])
  return d
}

// ============ Shared Modal Wrapper ============

function Modal({ onClose, children, maxW = 'max-w-lg' }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={`bg-black-900 border border-black-700 rounded-2xl p-6 ${maxW} w-full max-h-[85vh] overflow-y-auto`}
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        transition={{ duration: PHI * 0.25 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

function ModalHeader({ title, onClose }) {
  return (
    <div className="flex items-center justify-between mb-4">
      {typeof title === 'string' ? <h2 className="text-white font-bold text-lg">{title}</h2> : title}
      <button onClick={onClose} className="text-black-500 hover:text-white text-lg">&times;</button>
    </div>
  )
}

// ============ Small Components ============

function TypeBadge({ type }) {
  const c = {
    Insight: 'text-cyan-400 bg-cyan-900/30 border-cyan-800/40',
    Discovery: 'text-amber-400 bg-amber-900/30 border-amber-800/40',
    Synthesis: 'text-purple-400 bg-purple-900/30 border-purple-800/40',
    Proof: 'text-matrix-400 bg-matrix-900/30 border-matrix-800/40',
    Data: 'text-blue-400 bg-blue-900/30 border-blue-800/40',
    Model: 'text-pink-400 bg-pink-900/30 border-pink-800/40',
    Framework: 'text-orange-400 bg-orange-900/30 border-orange-800/40',
  }[type] || 'text-black-400 bg-black-900/60 border-black-700'
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${c}`}>{type}</span>
}

function StatBox({ label, value, loading, accent = false }) {
  return (
    <div className="text-center p-2 bg-black-800/40 border border-black-700/50 rounded-lg">
      <div className={`font-mono font-bold text-sm ${accent ? 'text-cyan-400' : 'text-white'}`}>
        {loading ? <span className="animate-pulse text-black-500">--</span> : value}
      </div>
      <div className="text-black-500 text-[10px] font-mono">{label}</div>
    </div>
  )
}

function CurveBar({ citations, max }) {
  const pct = max > 0 ? Math.min((citations / max) * 100, 100) : 0
  return (
    <div className="w-full h-1.5 bg-black-800 rounded-full overflow-hidden">
      <motion.div className="h-full bg-gradient-to-r from-matrix-700 to-matrix-400 rounded-full"
        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
        transition={{ duration: PHI * 0.6, ease: 'easeOut' }} />
    </div>
  )
}

function AccuracyBar({ value }) {
  const color = value >= 90 ? 'from-emerald-600 to-emerald-400'
    : value >= 80 ? 'from-cyan-600 to-cyan-400'
    : value >= 70 ? 'from-amber-600 to-amber-400'
    : 'from-red-600 to-red-400'
  return (
    <div className="w-full h-1 bg-black-800 rounded-full overflow-hidden">
      <motion.div className={`h-full bg-gradient-to-r ${color} rounded-full`}
        initial={{ width: 0 }} animate={{ width: `${value}%` }}
        transition={{ duration: PHI * 0.6, ease: 'easeOut' }} />
    </div>
  )
}

const inputCls = 'w-full bg-black-800 border border-black-700 rounded-lg px-3 py-2 text-sm text-white placeholder-black-600 focus:border-matrix-600 focus:outline-none transition-colors'

// ============ InfoFi Score Card ============

function InfoFiScoreCard({ connected }) {
  const score = 73.4
  const tier = 'Silver'
  const circumference = 2 * Math.PI * 36
  const filled = circumference * (score / 100)

  return (
    <GlassCard glowColor="terminal" className="p-4 mb-6">
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <svg width="88" height="88" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="36" fill="none" stroke="rgba(37,37,37,1)" strokeWidth="4" />
            <motion.circle cx="44" cy="44" r="36" fill="none" stroke={CYAN} strokeWidth="4"
              strokeLinecap="round" strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: circumference - filled }}
              transition={{ duration: PHI, ease: 'easeOut' }}
              transform="rotate(-90 44 44)" />
            <text x="44" y="40" textAnchor="middle" className="fill-white text-sm font-bold font-mono">{connected ? score : '--'}</text>
            <text x="44" y="54" textAnchor="middle" className="fill-black-500 text-[8px] font-mono">{connected ? tier : 'N/A'}</text>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-bold text-sm mb-1">InfoFi Score</h3>
          <p className="text-black-400 text-[11px] font-mono mb-3 leading-relaxed">
            Your information value based on signal quality, prediction accuracy, and citation impact.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Signal Quality', connected ? '82%' : '--'],
              ['Prediction Acc', connected ? '76%' : '--'],
              ['Citation Impact', connected ? '68%' : '--'],
            ].map(([label, val]) => (
              <div key={label} className="text-center">
                <div className="text-[11px] font-mono font-bold" style={{ color: CYAN }}>{val}</div>
                <div className="text-[8px] font-mono text-black-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

// ============ Revenue Stream Card ============

function RevenueStreamCard({ connected }) {
  const streams = [
    { label: 'Citation Royalties', amount: '142.8 JUL', pct: 45 },
    { label: 'Signal Subscriptions', amount: '89.2 JUL', pct: 28 },
    { label: 'Data Feed Sales', amount: '54.6 JUL', pct: 17 },
    { label: 'Shapley Rewards', amount: '31.4 JUL', pct: 10 },
  ]

  return (
    <GlassCard glowColor="matrix" className="p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-bold text-sm">Revenue Streams</h3>
        <div className="text-right">
          <span className="text-matrix-400 font-mono font-bold text-sm">{connected ? '318.0 JUL' : '--'}</span>
          <span className="text-black-500 text-[10px] font-mono block">30d earnings</span>
        </div>
      </div>
      <div className="space-y-2.5">
        {streams.map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-mono text-black-400">{s.label}</span>
              <span className="text-[10px] font-mono text-white">{connected ? s.amount : '--'}</span>
            </div>
            <div className="w-full h-1 bg-black-800 rounded-full overflow-hidden">
              <motion.div className="h-full bg-gradient-to-r from-matrix-700 to-matrix-400 rounded-full"
                initial={{ width: 0 }} animate={{ width: connected ? `${s.pct}%` : '0%' }}
                transition={{ duration: PHI * 0.6, delay: 0.1, ease: 'easeOut' }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-black-500 text-[9px] font-mono mt-3 leading-relaxed">
        Contribute quality data and signals to earn JUL tokens via Shapley attribution.
      </p>
    </GlassCard>
  )
}

// ============ Data Marketplace Tab ============

function DataMarketplace({ connected }) {
  const [feedFilter, setFeedFilter] = useState('All')
  const filtered = feedFilter === 'All' ? MOCK_DATA_FEEDS : MOCK_DATA_FEEDS.filter((f) => f.category === feedFilter)

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-4">
        {FEED_CATEGORIES.map((cat) => (
          <button key={cat} onClick={() => setFeedFilter(cat)}
            className={`text-[10px] font-mono px-3 py-1 rounded-full transition-colors ${
              feedFilter === cat ? 'text-black-900 font-bold' : 'bg-black-800/60 text-black-400 border border-black-700 hover:border-black-600'
            }`}
            style={feedFilter === cat ? { backgroundColor: CYAN } : undefined}>
            {cat}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <AnimatePresence mode="popLayout">
          {filtered.map((feed, i) => (
            <motion.div key={feed.id}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: PHI * 0.3, delay: i * 0.04 }}>
              <GlassCard glowColor="none" className="p-3.5">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white text-xs font-medium truncate">{feed.name}</h4>
                    <span className="text-[10px] font-mono text-black-500">{feed.provider}</span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono font-bold text-xs" style={{ color: CYAN }}>{feed.price}</div>
                    <div className="text-[9px] font-mono text-black-500">/mo</div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-black-800">
                  <div className="flex items-center gap-3">
                    <span className="text-[9px] font-mono text-black-500">{feed.subscribers.toLocaleString()} subs</span>
                    <span className="text-[9px] font-mono text-matrix-500">{feed.accuracy}% acc</span>
                  </div>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                    { Price: 'text-cyan-400 bg-cyan-900/30 border-cyan-800/40',
                      Sentiment: 'text-purple-400 bg-purple-900/30 border-purple-800/40',
                      'On-Chain': 'text-amber-400 bg-amber-900/30 border-amber-800/40',
                      Analytics: 'text-blue-400 bg-blue-900/30 border-blue-800/40',
                    }[feed.category]
                  }`}>{feed.category}</span>
                </div>
                {connected && (
                  <button className="w-full mt-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-colors border border-black-700 hover:border-cyan-700 text-black-400 hover:text-cyan-400">
                    Subscribe
                  </button>
                )}
              </GlassCard>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ============ Signal Dashboard Tab ============

function SignalDashboard({ connected }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatBox label="Active Signals" value="24" accent />
        <StatBox label="Avg Accuracy" value="88.3%" />
        <StatBox label="Signals Today" value="6" />
      </div>
      <AnimatePresence mode="popLayout">
        {MOCK_SIGNALS.map((sig, i) => (
          <motion.div key={sig.id}
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
            transition={{ duration: PHI * 0.3, delay: i * 0.05 }}>
            <GlassCard glowColor="none" className="p-3.5">
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-xs ${
                  sig.type === 'Buy'
                    ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/40'
                    : 'bg-red-900/30 text-red-400 border border-red-800/40'
                }`}>
                  {sig.type}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-white text-xs font-medium leading-snug">{sig.title}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-black-500">{sig.author}</span>
                    <span className="text-[9px] font-mono text-black-600">{sig.ts}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black-800 border border-black-700 text-white">{sig.asset}</span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-black-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-mono text-black-500">Confidence: {sig.confidence}%</span>
                  <span className="text-[9px] font-mono text-matrix-500">Historical: {sig.accuracy}%</span>
                </div>
                <AccuracyBar value={sig.accuracy} />
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </AnimatePresence>
      {!connected && (
        <div className="text-center py-4 text-black-500 text-[10px] font-mono">
          Connect wallet to subscribe to signals and receive real-time alerts
        </div>
      )}
    </div>
  )
}

// ============ Leaderboard Tab ============

function LeaderboardTab() {
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatBox label="Total Providers" value="1,247" accent />
        <StatBox label="Signals / Day" value="892" />
        <StatBox label="Rewards Pool" value="50K JUL" />
      </div>
      <div className="overflow-hidden rounded-xl border border-black-700/50">
        {/* Header row */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-black-800/60 border-b border-black-700/50">
          <span className="col-span-1 text-[9px] font-mono text-black-500">#</span>
          <span className="col-span-3 text-[9px] font-mono text-black-500">Provider</span>
          <span className="col-span-2 text-[9px] font-mono text-black-500 text-right">Score</span>
          <span className="col-span-2 text-[9px] font-mono text-black-500 text-right">Signals</span>
          <span className="col-span-2 text-[9px] font-mono text-black-500 text-right">Earnings</span>
          <span className="col-span-2 text-[9px] font-mono text-black-500 text-right">Streak</span>
        </div>
        {/* Rows */}
        <AnimatePresence>
          {MOCK_LEADERBOARD.map((entry, i) => (
            <motion.div key={entry.author}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: PHI * 0.25, delay: i * 0.04 }}
              className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center transition-colors hover:bg-black-800/40 ${
                i < MOCK_LEADERBOARD.length - 1 ? 'border-b border-black-800/50' : ''
              }`}>
              <span className={`col-span-1 font-mono font-bold text-xs ${
                entry.rank === 1 ? 'text-amber-400' : entry.rank === 2 ? 'text-black-300' : entry.rank === 3 ? 'text-orange-400' : 'text-black-500'
              }`}>{entry.rank}</span>
              <span className="col-span-3 text-[11px] font-mono text-white truncate">{entry.author}</span>
              <span className="col-span-2 text-[11px] font-mono font-bold text-right" style={{ color: CYAN }}>{entry.score}%</span>
              <span className="col-span-2 text-[11px] font-mono text-black-400 text-right">{entry.signals}</span>
              <span className="col-span-2 text-[11px] font-mono text-matrix-400 text-right">{entry.earnings}</span>
              <div className="col-span-2 flex items-center justify-end gap-1">
                <span className="text-[11px] font-mono text-black-400">{entry.streak}d</span>
                <span className="text-[9px] text-amber-500">&#9650;</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ============ Primitive Card ============

function PrimitiveCard({ p, onSelect, onCite, onAuthor, max, connected }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: PHI * 0.3 }}>
      <GlassCard glowColor="none" className="p-4 cursor-pointer" onClick={() => onSelect(p)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-white text-sm font-medium leading-snug truncate">{p.title}</h3>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <button className="text-[10px] font-mono text-matrix-500 hover:text-matrix-400 transition-colors"
                onClick={(e) => { e.stopPropagation(); onAuthor(p.author) }}>{p.author}</button>
              <TypeBadge type={p.type} />
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-matrix-400 font-mono font-bold text-sm">{p.price || '--'}</div>
            <div className="text-[10px] font-mono text-black-500">Price</div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-black-800">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-black-500">{p.citations ?? 0} citations</span>
            {p.citations > 10 && (
              <span className="text-[9px] font-mono text-matrix-500 bg-matrix-900/20 px-1 rounded">trending</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-matrix-500">Shapley: {p.shapleyEarnings || p.shapley || '--'}</span>
            {connected && (
              <button onClick={(e) => { e.stopPropagation(); onCite(p.id) }}
                className="text-[10px] font-mono px-2 py-0.5 rounded bg-matrix-900/30 text-matrix-400 border border-matrix-800/40 hover:bg-matrix-800/40 transition-colors">
                Cite</button>
            )}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Detail Modal ============

function DetailModal({ p, onClose, onCite, onAuthor, max, connected }) {
  if (!p) return null
  return (
    <Modal onClose={onClose}>
      <ModalHeader title={<TypeBadge type={p.type} />} onClose={onClose} />
      <h2 className="text-white text-lg font-bold mb-2">{p.title}</h2>
      <button className="text-xs font-mono text-matrix-500 hover:text-matrix-400 mb-3 block"
        onClick={() => { onClose(); onAuthor(p.author) }}>by {p.author}</button>
      <p className="text-black-400 text-sm mb-4 leading-relaxed">{p.description || 'No description available.'}</p>
      <div className="mb-4 p-3 bg-black-800/40 rounded-lg border border-black-700/50">
        <div className="flex justify-between text-[10px] font-mono text-black-500 mb-1.5">
          <span>Bonding Curve</span><span>{p.price || '--'}</span>
        </div>
        <CurveBar citations={p.citations ?? 0} max={max} />
        <div className="flex justify-between mt-2 text-[10px] font-mono">
          <span className="text-black-500">{p.citations ?? 0} citations</span>
          <span className="text-matrix-500">Shapley: {p.shapleyEarnings || p.shapley || '--'}</span>
        </div>
      </div>
      {p.citedPrimitives?.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-mono text-black-400 mb-2">Cites</h4>
          <div className="space-y-1">
            {p.citedPrimitives.map((cp, i) => (
              <div key={i} className="text-[11px] font-mono text-black-500 bg-black-800/30 rounded px-2 py-1 border border-black-800">
                {typeof cp === 'string' ? cp : cp.title || `Primitive #${cp.id || i}`}
              </div>
            ))}
          </div>
        </div>
      )}
      {connected && (
        <button onClick={() => onCite(p.id)}
          className="w-full mt-2 py-2 rounded-lg bg-matrix-600 text-black-900 font-mono font-bold text-sm hover:bg-matrix-500 transition-colors">
          Cite This Primitive</button>
      )}
    </Modal>
  )
}

// ============ Create Modal ============

function CreateModal({ onClose, onCreated, existing }) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [type, setType] = useState('Insight')
  const [author, setAuthor] = useState('')
  const [cited, setCited] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const toggle = (id) => setCited((p) => p.includes(id) ? p.filter((c) => c !== id) : [...p, id])

  const submit = async () => {
    if (!title.trim() || !author.trim()) { setErr('Title and author are required'); return }
    setBusy(true); setErr(null)
    try {
      const result = await api('/web/infofi/primitives', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), description: desc.trim(), type, author: author.trim(), citedPrimitives: cited }),
      })
      onCreated(result); onClose()
    } catch (e) { setErr(e.message || 'Failed to create primitive') }
    finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Register Primitive" onClose={onClose} />
      {err && <div className="mb-3 p-2 rounded bg-red-900/30 border border-red-800/40 text-red-400 text-xs font-mono">{err}</div>}
      <label className="block mb-3">
        <span className="text-black-400 text-xs font-mono block mb-1">Title *</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What did you discover?" className={inputCls} />
      </label>
      <label className="block mb-3">
        <span className="text-black-400 text-xs font-mono block mb-1">Description</span>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Explain the knowledge primitive..."
          rows={3} className={`${inputCls} resize-none`} />
      </label>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="text-black-400 text-xs font-mono block mb-1">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            {TYPES.filter((t) => t !== 'All').map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-black-400 text-xs font-mono block mb-1">Author *</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="your.name" className={inputCls} />
        </label>
      </div>
      {existing.length > 0 && (
        <div className="mb-4">
          <span className="text-black-400 text-xs font-mono block mb-1">Cite Existing Primitives</span>
          <div className="max-h-32 overflow-y-auto space-y-1 border border-black-700 rounded-lg p-2 bg-black-800/40">
            {existing.map((p) => (
              <label key={p.id} className="flex items-center gap-2 cursor-pointer hover:bg-black-800 rounded px-1 py-0.5 transition-colors">
                <input type="checkbox" checked={cited.includes(p.id)} onChange={() => toggle(p.id)} className="accent-matrix-500" />
                <span className="text-[11px] font-mono text-black-400 truncate">{p.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <button onClick={submit} disabled={busy || !title.trim() || !author.trim()}
        className="w-full py-2.5 rounded-lg bg-matrix-600 text-black-900 font-mono font-bold text-sm hover:bg-matrix-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        {busy ? 'Registering...' : 'Register Primitive'}</button>
    </Modal>
  )
}

// ============ Author Profile Modal ============

function AuthorModal({ author, onClose }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let dead = false
    setLoading(true); setErr(null)
    api(`/web/infofi/author/${encodeURIComponent(author)}`)
      .then((d) => { if (!dead) setStats(d) })
      .catch((e) => { if (!dead) setErr(e.message) })
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [author])

  const s = (k1, k2) => stats?.[k1] ?? stats?.[k2] ?? '--'
  return (
    <Modal onClose={onClose} maxW="max-w-sm">
      <ModalHeader title={<span className="font-mono">{author}</span>} onClose={onClose} />
      {loading && <p className="text-black-500 text-xs font-mono animate-pulse">Loading author stats...</p>}
      {err && <p className="text-black-500 text-xs font-mono">Backend offline — connect to see live data</p>}
      {stats && (
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Primitives', s('primitivesCount', 'primitives'), 'text-white'],
            ['Citations', s('totalCitations', 'citations'), 'text-white'],
            ['Earnings', s('totalEarnings', 'earnings'), 'text-matrix-400'],
            ['Reputation', s('reputation', 'rank'), 'text-white'],
          ].map(([label, val, color]) => (
            <div key={label} className="text-center p-3 bg-black-800/40 border border-black-700/50 rounded-lg">
              <div className={`${color} font-mono font-bold`}>{val}</div>
              <div className="text-black-500 text-[10px] font-mono">{label}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ============================================================
// Main Page
// ============================================================

export default function InfoFiPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeTab, setActiveTab] = useState('Primitives')
  const [primitives, setPrimitives] = useState([])
  const [stats, setStats] = useState(null)
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState('newest')
  const [searchInput, setSearchInput] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offline, setOffline] = useState(false)
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [authorView, setAuthorView] = useState(null)

  const query = useDebounce(searchInput, 300)
  const sentinelRef = useRef(null)
  const maxCit = useMemo(() => Math.max(1, ...primitives.map((p) => p.citations ?? 0)), [primitives])

  // ============ Fetch Stats ============
  useEffect(() => {
    api('/web/infofi/stats').then(setStats).catch(() => setOffline(true))
  }, [])

  // ============ Fetch Primitives ============
  const fetchPrimitives = useCallback(async (reset = false) => {
    const off = reset ? 0 : offset
    reset ? setLoading(true) : setLoadingMore(true)
    try {
      const data = query.trim()
        ? await api(`/web/infofi/search?q=${encodeURIComponent(query.trim())}&limit=${PAGE_SIZE}&offset=${off}`)
        : await api(`/web/infofi/primitives?sort=${sort}&limit=${PAGE_SIZE}&offset=${off}${filter !== 'All' ? `&type=${filter}` : ''}`)
      const items = Array.isArray(data) ? data : data.primitives || data.results || []
      if (reset) { setPrimitives(items); setOffset(items.length) }
      else { setPrimitives((prev) => [...prev, ...items]); setOffset(off + items.length) }
      setHasMore(items.length >= PAGE_SIZE)
      setOffline(false)
    } catch {
      setOffline(true)
      if (reset) setPrimitives([])
      setHasMore(false)
    } finally { setLoading(false); setLoadingMore(false) }
  }, [offset, query, filter, sort])

  useEffect(() => { setOffset(0); fetchPrimitives(true) }, [filter, sort, query]) // eslint-disable-line

  // ============ Infinite Scroll ============
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting && hasMore && !loadingMore) fetchPrimitives(false) },
      { rootMargin: '200px' }
    )
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [hasMore, loadingMore, fetchPrimitives])

  // ============ Actions ============
  const handleCite = useCallback(async (id) => {
    try {
      await api('/web/infofi/cite', { method: 'POST', body: JSON.stringify({ primitiveId: id, citingAuthor: 'anonymous' }) })
      setPrimitives((prev) => prev.map((p) => p.id === id ? { ...p, citations: (p.citations ?? 0) + 1 } : p))
      if (selected?.id === id) setSelected((prev) => ({ ...prev, citations: (prev.citations ?? 0) + 1 }))
    } catch { /* optimistic update skipped */ }
  }, [selected])

  const handleCreated = useCallback((np) => {
    if (np && typeof np === 'object') setPrimitives((prev) => [np, ...prev])
  }, [])

  // ============ Render ============
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
            Info<span style={{ color: CYAN }}>Fi</span>
          </h1>
          <p className="text-black-400 text-sm mt-1 max-w-md">Knowledge primitives as economic assets</p>
        </div>
        {isConnected && (
          <button onClick={() => setShowCreate(true)}
            className="flex-shrink-0 px-4 py-2 rounded-lg bg-matrix-600 text-black-900 font-mono font-bold text-xs hover:bg-matrix-500 transition-colors">
            + Create</button>
        )}
      </div>

      {/* InfoFi Score + Revenue */}
      <InfoFiScoreCard connected={isConnected} />
      <RevenueStreamCard connected={isConnected} />

      {/* Offline banner */}
      {offline && (
        <div className="mb-4 p-2.5 rounded-lg bg-black-800/60 border border-black-700/50 text-center">
          <span className="text-black-400 text-xs font-mono">Backend offline — connect to see live data</span>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 mb-5 border-b border-black-800 pb-px">
        {TABS.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`text-xs font-mono px-4 py-2 rounded-t-lg transition-colors relative ${
              activeTab === tab
                ? 'text-white font-bold'
                : 'text-black-500 hover:text-black-300'
            }`}>
            {tab}
            {activeTab === tab && (
              <motion.div layoutId="infofi-tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                style={{ backgroundColor: CYAN }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
            )}
          </button>
        ))}
      </div>

      {/* Stats bar — always visible */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatBox label="Primitives" value={stats?.totalPrimitives ?? stats?.primitives ?? '--'} loading={!stats && !offline} />
        <StatBox label="Citations" value={stats?.totalCitations ?? stats?.citations ?? '--'} loading={!stats && !offline} />
        <StatBox label="Total Value" value={stats?.totalValue ?? stats?.value ?? '--'} loading={!stats && !offline} />
        <StatBox label="Contributors" value={stats?.totalContributors ?? stats?.contributors ?? '--'} loading={!stats && !offline} />
      </div>

      {/* ============ Tab Content ============ */}
      <AnimatePresence mode="wait">
        {activeTab === 'Primitives' && (
          <motion.div key="primitives"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: PHI * 0.2 }}>
            {/* Search */}
            <div className="mb-4">
              <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search primitives..."
                className="w-full bg-black-800/60 border border-black-700 rounded-lg px-4 py-2 text-sm text-white placeholder-black-600 focus:border-matrix-600 focus:outline-none transition-colors font-mono" />
            </div>

            {/* Filter + Sort */}
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="flex flex-wrap gap-1 flex-1">
                {TYPES.map((t) => (
                  <button key={t} onClick={() => setFilter(t)}
                    className={`text-[10px] font-mono px-3 py-1 rounded-full transition-colors ${
                      filter === t ? 'bg-matrix-600 text-black-900 font-bold'
                        : 'bg-black-800/60 text-black-400 border border-black-700 hover:border-black-600'
                    }`}>{t}</button>
                ))}
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value)}
                className="flex-shrink-0 bg-black-800 border border-black-700 rounded-lg px-2 py-1 text-[10px] text-black-400 font-mono focus:border-matrix-600 focus:outline-none transition-colors">
                {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Loading skeleton */}
            {loading && (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="animate-pulse bg-black-800/40 border border-black-700/30 rounded-xl p-4 h-24" />
                ))}
              </div>
            )}

            {/* Feed */}
            {!loading && (
              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {primitives.map((p) => (
                    <PrimitiveCard key={p.id} p={p} onSelect={setSelected} onCite={handleCite}
                      onAuthor={setAuthorView} max={maxCit} connected={isConnected} />
                  ))}
                </AnimatePresence>
                {primitives.length === 0 && !offline && (
                  <div className="text-center py-12 text-black-500 text-xs font-mono">
                    No primitives found. {isConnected ? 'Create the first one.' : 'Connect wallet to contribute.'}
                  </div>
                )}
                {primitives.length === 0 && offline && (
                  <div className="text-center py-12">
                    <p className="text-black-500 text-xs font-mono mb-1">No data available</p>
                    <p className="text-black-600 text-[10px] font-mono">Start the backend to load primitives</p>
                  </div>
                )}
                {hasMore && <div ref={sentinelRef} className="h-4" />}
                {loadingMore && (
                  <div className="text-center py-4">
                    <span className="text-black-500 text-xs font-mono animate-pulse">Loading more...</span>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'Marketplace' && (
          <motion.div key="marketplace"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: PHI * 0.2 }}>
            <DataMarketplace connected={isConnected} />
          </motion.div>
        )}

        {activeTab === 'Signals' && (
          <motion.div key="signals"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: PHI * 0.2 }}>
            <SignalDashboard connected={isConnected} />
          </motion.div>
        )}

        {activeTab === 'Leaderboard' && (
          <motion.div key="leaderboard"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: PHI * 0.2 }}>
            <LeaderboardTab />
          </motion.div>
        )}
      </AnimatePresence>

      {!isConnected && (
        <div className="mt-6 text-center text-black-500 text-xs font-mono">
          Connect wallet to register knowledge primitives and earn Shapley rewards
        </div>
      )}

      {/* ============ Modals ============ */}
      <AnimatePresence>
        {selected && <DetailModal p={selected} onClose={() => setSelected(null)} onCite={handleCite}
          onAuthor={setAuthorView} max={maxCit} connected={isConnected} />}
      </AnimatePresence>
      <AnimatePresence>
        {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={handleCreated} existing={primitives} />}
      </AnimatePresence>
      <AnimatePresence>
        {authorView && <AuthorModal author={authorView} onClose={() => setAuthorView(null)} />}
      </AnimatePresence>
    </div>
  )
}

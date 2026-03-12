import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const BATCH_CYCLE = 10000 // 10-second batch cycle

const CHAINS = [
  { id: 'ethereum', label: 'Ethereum', color: '#627eea', short: 'ETH' },
  { id: 'arbitrum', label: 'Arbitrum', color: '#28a0f0', short: 'ARB' },
  { id: 'base', label: 'Base', color: '#0052ff', short: 'BASE' },
  { id: 'solana', label: 'Solana', color: '#9945ff', short: 'SOL' },
  { id: 'nervos', label: 'Nervos', color: '#3cc68a', short: 'CKB' },
]

const TOKEN_PAIRS = [
  'ETH/USDC', 'WBTC/ETH', 'ARB/USDC', 'SOL/USDC', 'CKB/USDC',
  'ETH/DAI', 'LINK/ETH', 'UNI/USDC', 'AAVE/ETH', 'OP/USDC',
]

const TICKER_METRICS = [
  'Total Volume (24h)', 'Batches Settled', 'MEV Saved', 'Active Traders',
  'Cross-Chain Txns', 'Avg Clearing Price Deviation', 'Commit Success Rate', 'Unique Pairs',
]

// ============ Seeded PRNG ============

function mulberry32(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ============ Particles Background ============

function Particles() {
  const particles = useMemo(() => {
    const rng = mulberry32(42)
    return Array.from({ length: 25 }, (_, i) => ({
      id: i,
      x: rng() * 100,
      y: rng() * 100,
      size: rng() * 2 + 1,
      duration: (rng() * 20 + 15) * PHI,
      delay: rng() * 10,
    }))
  }, [])

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size, background: CYAN, opacity: 0 }}
          animate={{ y: [0, -80, -160], opacity: [0, 0.3, 0] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'linear' }}
        />
      ))}
    </div>
  )
}

// ============ Helpers ============

function Section({ children, delay = 0 }) {
  return (
    <motion.section className="mb-10 md:mb-14" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5 * PHI, delay, ease: 'easeOut' }}>
      {children}
    </motion.section>
  )
}

function SectionHeader({ children }) {
  return <h2 className="font-mono text-lg md:text-xl font-bold tracking-wider mb-4 md:mb-6" style={{ color: CYAN }}>{children}</h2>
}

function PulseDot({ color = '#22c55e', size = 12 }) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <motion.span
        className="absolute inline-flex h-full w-full rounded-full opacity-75"
        style={{ backgroundColor: color }}
        animate={{ scale: [1, 1.8], opacity: [0.75, 0] }}
        transition={{ duration: PHI, repeat: Infinity, ease: 'easeOut' }}
      />
      <span className="relative inline-flex rounded-full h-full w-full" style={{ backgroundColor: color }} />
    </span>
  )
}

// ============ 7. Stats Ticker ============

function StatsTicker({ metrics }) {
  return (
    <div className="w-full overflow-hidden border-b border-gray-800/60 bg-gray-950/80 backdrop-blur-sm">
      <motion.div
        className="flex gap-12 py-2.5 px-4 whitespace-nowrap"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
      >
        {[...metrics, ...metrics].map((m, i) => (
          <span key={i} className="font-mono text-[11px] tracking-wider flex items-center gap-2">
            <span className="text-gray-500">{m.label}</span>
            <span style={{ color: CYAN }} className="font-bold tabular-nums">{m.value}</span>
            {m.delta && (
              <span className={`text-[10px] ${m.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {m.delta > 0 ? '+' : ''}{m.delta}%
              </span>
            )}
          </span>
        ))}
      </motion.div>
    </div>
  )
}

// ============ 4. Protocol Heartbeat ============

function ProtocolHeartbeat({ phase, progress }) {
  const svgRef = useRef(null)
  const width = 600
  const height = 80
  const midY = height / 2

  const pathD = useMemo(() => {
    const points = []
    const segments = 60
    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * width
      const t = i / segments
      let y = midY
      // Create heartbeat-like spikes at commit (0.0-0.8) and reveal (0.8-1.0) boundaries
      if (t > 0.18 && t < 0.22) {
        const local = (t - 0.18) / 0.04
        y = midY - Math.sin(local * Math.PI) * 28
      } else if (t > 0.38 && t < 0.42) {
        const local = (t - 0.38) / 0.04
        y = midY - Math.sin(local * Math.PI) * 18
      } else if (t > 0.58 && t < 0.62) {
        const local = (t - 0.58) / 0.04
        y = midY - Math.sin(local * Math.PI) * 22
      } else if (t > 0.78 && t < 0.84) {
        // Reveal spike — sharper
        const local = (t - 0.78) / 0.06
        y = midY - Math.sin(local * Math.PI) * 35
      } else if (t > 0.90 && t < 0.96) {
        // Settlement spike
        const local = (t - 0.90) / 0.06
        y = midY + Math.sin(local * Math.PI) * 15
      } else {
        // Gentle noise
        const rng = mulberry32(Math.floor(i * 7.3))
        y = midY + (rng() - 0.5) * 6
      }
      points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return points.join(' ')
  }, [])

  return (
    <GlassCard glowColor="terminal" className="p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <SectionHeader>// PROTOCOL HEARTBEAT</SectionHeader>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-gray-500">Phase:</span>
          <motion.span
            key={phase}
            className="font-bold tracking-wider"
            style={{ color: phase === 'COMMIT' ? '#22c55e' : phase === 'REVEAL' ? '#f59e0b' : CYAN }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {phase}
          </motion.span>
        </div>
      </div>
      <div className="relative w-full overflow-hidden" style={{ height }}>
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pulse-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={CYAN} stopOpacity="0.1" />
              <stop offset={`${progress * 100}%`} stopColor={CYAN} stopOpacity="0.8" />
              <stop offset={`${Math.min(progress * 100 + 2, 100)}%`} stopColor={CYAN} stopOpacity="0.1" />
            </linearGradient>
            <filter id="glow-line">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {/* Background grid lines */}
          {[0.2, 0.4, 0.6, 0.8].map((t) => (
            <line key={t} x1={t * width} y1={0} x2={t * width} y2={height} stroke="rgba(75,85,99,0.15)" strokeWidth="1" />
          ))}
          <line x1={0} y1={midY} x2={width} y2={midY} stroke="rgba(75,85,99,0.1)" strokeWidth="1" />
          {/* Phase boundary — commit/reveal at 80% */}
          <line x1={0.8 * width} y1={0} x2={0.8 * width} y2={height} stroke="rgba(245,158,11,0.3)" strokeWidth="1" strokeDasharray="4,4" />
          <text x={0.8 * width + 4} y={12} fill="rgba(245,158,11,0.5)" fontSize="9" fontFamily="monospace">REVEAL</text>
          {/* Heartbeat path */}
          <path d={pathD} fill="none" stroke="url(#pulse-grad)" strokeWidth="2" filter="url(#glow-line)" />
          {/* Scanning line */}
          <motion.line
            x1={0} y1={0} x2={0} y2={height}
            stroke={CYAN}
            strokeWidth="1.5"
            opacity={0.6}
            animate={{ x1: [0, width], x2: [0, width] }}
            transition={{ duration: BATCH_CYCLE / 1000, repeat: Infinity, ease: 'linear' }}
          />
        </svg>
      </div>
      {/* Progress bar */}
      <div className="mt-3 h-1.5 rounded-full bg-gray-800/60 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${CYAN}60, ${CYAN})`, width: `${progress * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <div className="flex justify-between mt-1.5 font-mono text-[10px] text-gray-600">
        <span>0s</span>
        <span>COMMIT (8s)</span>
        <span>REVEAL (2s)</span>
        <span>10s</span>
      </div>
    </GlassCard>
  )
}

// ============ 1. Live Batch Feed ============

function BatchCard({ batch, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.9 }}
      transition={{ duration: 0.35 * PHI, delay: index * 0.05 }}
    >
      <GlassCard glowColor="terminal" className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold" style={{ color: CYAN }}>BATCH #{batch.id}</span>
            <motion.span
              className="font-mono text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wider"
              style={{
                background: batch.status === 'SETTLED' ? 'rgba(34,197,94,0.15)' : batch.status === 'REVEALING' ? 'rgba(245,158,11,0.15)' : `${CYAN}15`,
                color: batch.status === 'SETTLED' ? '#22c55e' : batch.status === 'REVEALING' ? '#f59e0b' : CYAN,
                border: `1px solid ${batch.status === 'SETTLED' ? 'rgba(34,197,94,0.3)' : batch.status === 'REVEALING' ? 'rgba(245,158,11,0.3)' : `${CYAN}30`}`,
              }}
              animate={batch.status !== 'SETTLED' ? { opacity: [1, 0.6, 1] } : {}}
              transition={{ duration: PHI, repeat: Infinity }}
            >
              {batch.status}
            </motion.span>
          </div>
          <span className="font-mono text-[10px] text-gray-600">{batch.chain}</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <div className="font-mono text-[10px] text-gray-500 mb-0.5">Orders</div>
            <div className="font-mono text-sm font-bold tabular-nums">{batch.orders}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] text-gray-500 mb-0.5">Clearing Price</div>
            <div className="font-mono text-sm font-bold tabular-nums" style={{ color: CYAN }}>${batch.clearingPrice}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] text-gray-500 mb-0.5">MEV Saved</div>
            <div className="font-mono text-sm font-bold tabular-nums text-green-400">${batch.mevSaved}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="font-mono text-[10px] text-gray-600">{batch.pair}</span>
          <span className="font-mono text-[10px] text-gray-700">|</span>
          <span className="font-mono text-[10px] text-gray-600">{batch.time}</span>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ 2. Transaction Waterfall ============

function TransactionWaterfall({ events }) {
  return (
    <GlassCard glowColor="terminal" className="p-4 md:p-5">
      <SectionHeader>// TRANSACTION WATERFALL</SectionHeader>
      <div className="relative pl-6 space-y-3 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: `${CYAN}30 transparent` }}>
        {/* Vertical line */}
        <div className="absolute left-2 top-0 bottom-0 w-px" style={{ background: `linear-gradient(180deg, ${CYAN}40, ${CYAN}10)` }} />
        <AnimatePresence initial={false}>
          {events.map((ev, i) => (
            <motion.div
              key={ev.id}
              className="relative"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 * PHI, delay: i * 0.03 }}
            >
              {/* Dot on timeline */}
              <div
                className="absolute -left-6 top-1.5 w-2.5 h-2.5 rounded-full border-2"
                style={{
                  borderColor: ev.type === 'commit' ? CYAN : ev.type === 'reveal' ? '#f59e0b' : '#22c55e',
                  background: ev.type === 'commit' ? `${CYAN}30` : ev.type === 'reveal' ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)',
                }}
              />
              <div className="flex items-baseline gap-2">
                <span
                  className="font-mono text-[10px] font-bold tracking-wider uppercase"
                  style={{ color: ev.type === 'commit' ? CYAN : ev.type === 'reveal' ? '#f59e0b' : '#22c55e', minWidth: 70 }}
                >
                  {ev.type}
                </span>
                <span className="font-mono text-xs text-gray-300 truncate">{ev.detail}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 pl-[78px]">
                <span className="font-mono text-[10px] text-gray-600">{ev.addr}</span>
                <span className="font-mono text-[10px] text-gray-700">{ev.time}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}

// ============ 3. Chain Activity Map ============

function ChainActivityMap({ chainActivity }) {
  return (
    <GlassCard glowColor="terminal" className="p-4 md:p-5">
      <SectionHeader>// CHAIN ACTIVITY</SectionHeader>
      <div className="grid grid-cols-5 gap-3">
        {CHAINS.map((chain) => {
          const activity = chainActivity[chain.id] || 0
          const isActive = activity > 0
          return (
            <motion.div
              key={chain.id}
              className="text-center p-3 rounded-xl border"
              style={{
                borderColor: isActive ? `${chain.color}40` : 'rgba(55,65,81,0.2)',
                background: isActive ? `${chain.color}08` : 'transparent',
              }}
              animate={isActive ? { borderColor: [`${chain.color}40`, `${chain.color}20`, `${chain.color}40`] } : {}}
              transition={{ duration: 2 * PHI, repeat: Infinity }}
            >
              <div className="flex justify-center mb-2">
                {isActive ? (
                  <PulseDot color={chain.color} size={10} />
                ) : (
                  <span className="inline-flex w-2.5 h-2.5 rounded-full bg-gray-700" />
                )}
              </div>
              <div className="font-mono text-xs font-bold mb-0.5" style={{ color: isActive ? chain.color : '#6b7280' }}>
                {chain.short}
              </div>
              <div className="font-mono text-[10px] text-gray-500 tabular-nums">
                {activity} tx/s
              </div>
            </motion.div>
          )
        })}
      </div>
    </GlassCard>
  )
}

// ============ 5. Top Movers ============

function TopMovers({ movers }) {
  return (
    <GlassCard glowColor="terminal" className="p-4 md:p-5">
      <SectionHeader>// TOP MOVERS (1H)</SectionHeader>
      <div className="space-y-2">
        {movers.map((m, i) => (
          <motion.div
            key={m.pair}
            className="flex items-center justify-between py-2 px-3 rounded-lg"
            style={{ background: i === 0 ? `${CYAN}06` : 'transparent' }}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 * PHI }}
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] text-gray-600 w-4">{i + 1}</span>
              <span className="font-mono text-sm font-bold">{m.pair}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="font-mono text-xs text-gray-400 tabular-nums">${m.price}</span>
              <span className={`font-mono text-xs font-bold tabular-nums ${m.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {m.change >= 0 ? '+' : ''}{m.change.toFixed(2)}%
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  )
}

// ============ 6. Volume Heatmap ============

function VolumeHeatmap({ hourlyVolume }) {
  const maxVol = Math.max(...hourlyVolume, 1)
  return (
    <GlassCard glowColor="terminal" className="p-4 md:p-5">
      <SectionHeader>// VOLUME HEATMAP (24H)</SectionHeader>
      <div className="grid grid-cols-12 gap-1.5 md:gap-2">
        {hourlyVolume.map((vol, i) => {
          const intensity = vol / maxVol
          return (
            <motion.div
              key={i}
              className="aspect-square rounded-md relative group cursor-default"
              style={{
                background: `rgba(6,182,212,${0.05 + intensity * 0.55})`,
                border: `1px solid rgba(6,182,212,${0.1 + intensity * 0.3})`,
              }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.02 * PHI }}
              whileHover={{ scale: 1.15 }}
            >
              {/* Tooltip */}
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 rounded px-2 py-1 font-mono text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20">
                {String(i).padStart(2, '0')}:00 — ${(vol / 1000).toFixed(1)}K
              </div>
            </motion.div>
          )
        })}
      </div>
      {/* Hour labels */}
      <div className="grid grid-cols-12 gap-1.5 md:gap-2 mt-1.5">
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="font-mono text-[8px] text-gray-600 text-center tabular-nums">
            {i % 3 === 0 ? `${String(i).padStart(2, '0')}` : ''}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 mt-3">
        <span className="font-mono text-[10px] text-gray-600">Low</span>
        <div className="flex gap-0.5">
          {[0.1, 0.25, 0.4, 0.55, 0.7].map((o, i) => (
            <div key={i} className="w-3 h-3 rounded-sm" style={{ background: `rgba(6,182,212,${o})` }} />
          ))}
        </div>
        <span className="font-mono text-[10px] text-gray-600">High</span>
      </div>
    </GlassCard>
  )
}

// ============ Main Component ============

export default function LiveStream() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ---- Batch cycle state ----
  const [cycleTime, setCycleTime] = useState(0) // ms into current 10s cycle
  const phase = cycleTime < 8000 ? 'COMMIT' : cycleTime < 10000 ? 'REVEAL' : 'SETTLE'
  const progress = cycleTime / BATCH_CYCLE

  // ---- Live data state ----
  const [batches, setBatches] = useState([])
  const [waterfallEvents, setWaterfallEvents] = useState([])
  const [chainActivity, setChainActivity] = useState({})
  const [topMovers, setTopMovers] = useState([])
  const [hourlyVolume, setHourlyVolume] = useState([])
  const [tickerMetrics, setTickerMetrics] = useState([])
  const batchCounter = useRef(1000)

  // ---- Seeded initial data ----
  useEffect(() => {
    const rng = mulberry32(2025)
    // Initial hourly volume
    const vol = Array.from({ length: 24 }, () => Math.floor(rng() * 80000 + 5000))
    setHourlyVolume(vol)
    // Initial top movers
    const pairs = TOKEN_PAIRS.slice(0, 6).map((pair) => ({
      pair,
      price: (rng() * 3000 + 0.5).toFixed(2),
      change: (rng() - 0.4) * 12,
    }))
    pairs.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    setTopMovers(pairs)
    // Initial ticker
    const tickerVals = ['$4.2M', '1,847', '$312K', '2,493', '847', '0.03%', '99.2%', '142']
    setTickerMetrics(TICKER_METRICS.map((label, i) => ({
      label,
      value: tickerVals[i] || '—',
      delta: Math.round((rng() - 0.3) * 10),
    })))
    // Initial chain activity
    const ca = {}
    CHAINS.forEach((c) => { ca[c.id] = Math.floor(rng() * 40) })
    setChainActivity(ca)
    // Seed some initial batches
    const initialBatches = Array.from({ length: 4 }, (_, i) => {
      const chain = CHAINS[Math.floor(rng() * CHAINS.length)]
      const pair = TOKEN_PAIRS[Math.floor(rng() * TOKEN_PAIRS.length)]
      batchCounter.current++
      return {
        id: batchCounter.current,
        orders: Math.floor(rng() * 40 + 5),
        clearingPrice: (rng() * 3000 + 1).toFixed(2),
        mevSaved: (rng() * 500 + 10).toFixed(2),
        pair,
        chain: chain.short,
        status: 'SETTLED',
        time: `${Math.floor(rng() * 50 + 10)}s ago`,
      }
    })
    setBatches(initialBatches)
    // Seed waterfall
    const types = ['commit', 'reveal', 'settlement']
    const initEvents = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      type: types[Math.floor(rng() * types.length)],
      detail: `${TOKEN_PAIRS[Math.floor(rng() * TOKEN_PAIRS.length)]} — ${(rng() * 10 + 0.1).toFixed(3)} tokens`,
      addr: `0x${Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0')}...${Math.floor(rng() * 0xffff).toString(16).padStart(4, '0')}`,
      time: `${Math.floor(rng() * 55 + 5)}s ago`,
    }))
    setWaterfallEvents(initEvents)
  }, [])

  // ---- Batch cycle timer ----
  useEffect(() => {
    const iv = setInterval(() => {
      setCycleTime((prev) => (prev + 200) % BATCH_CYCLE)
    }, 200)
    return () => clearInterval(iv)
  }, [])

  // ---- Live batch generation (every ~10s) ----
  useEffect(() => {
    const iv = setInterval(() => {
      const rng = mulberry32(Date.now() & 0xffffff)
      const chain = CHAINS[Math.floor(rng() * CHAINS.length)]
      const pair = TOKEN_PAIRS[Math.floor(rng() * TOKEN_PAIRS.length)]
      batchCounter.current++
      const newBatch = {
        id: batchCounter.current,
        orders: Math.floor(rng() * 45 + 3),
        clearingPrice: (rng() * 3000 + 1).toFixed(2),
        mevSaved: (rng() * 600 + 5).toFixed(2),
        pair,
        chain: chain.short,
        status: 'COMMITTING',
        time: 'just now',
      }
      setBatches((prev) => [newBatch, ...prev.slice(0, 5)])
      // Transition through states
      setTimeout(() => {
        setBatches((prev) => prev.map((b) => b.id === newBatch.id ? { ...b, status: 'REVEALING' } : b))
      }, 3000)
      setTimeout(() => {
        setBatches((prev) => prev.map((b) => b.id === newBatch.id ? { ...b, status: 'SETTLED' } : b))
      }, 6000)
    }, BATCH_CYCLE)
    return () => clearInterval(iv)
  }, [])

  // ---- Live waterfall events (every ~2.5s) ----
  useEffect(() => {
    const eventCounter = { current: 100 }
    const iv = setInterval(() => {
      const rng = mulberry32((Date.now() & 0xffffff) + 7)
      const types = ['commit', 'commit', 'commit', 'reveal', 'reveal', 'settlement'] // weighted toward commits
      const type = types[Math.floor(rng() * types.length)]
      const pair = TOKEN_PAIRS[Math.floor(rng() * TOKEN_PAIRS.length)]
      eventCounter.current++
      const newEvent = {
        id: eventCounter.current,
        type,
        detail: `${pair} — ${(rng() * 10 + 0.01).toFixed(3)} tokens`,
        addr: `0x${Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0')}...${Math.floor(rng() * 0xffff).toString(16).padStart(4, '0')}`,
        time: 'just now',
      }
      setWaterfallEvents((prev) => [newEvent, ...prev.slice(0, 15)])
    }, 2500)
    return () => clearInterval(iv)
  }, [])

  // ---- Chain activity updates (every ~4s) ----
  useEffect(() => {
    const iv = setInterval(() => {
      const rng = mulberry32((Date.now() & 0xffffff) + 13)
      setChainActivity((prev) => {
        const next = { ...prev }
        CHAINS.forEach((c) => {
          const delta = Math.floor((rng() - 0.4) * 8)
          next[c.id] = Math.max(0, (next[c.id] || 0) + delta)
        })
        return next
      })
    }, 4000)
    return () => clearInterval(iv)
  }, [])

  // ---- Top movers update (every ~8s) ----
  useEffect(() => {
    const iv = setInterval(() => {
      const rng = mulberry32((Date.now() & 0xffffff) + 31)
      setTopMovers((prev) =>
        prev.map((m) => ({
          ...m,
          price: (parseFloat(m.price) * (1 + (rng() - 0.5) * 0.02)).toFixed(2),
          change: m.change + (rng() - 0.48) * 0.5,
        })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      )
    }, 8000)
    return () => clearInterval(iv)
  }, [])

  // ---- Hourly volume update (every ~15s — shift the latest hour) ----
  useEffect(() => {
    const iv = setInterval(() => {
      const rng = mulberry32((Date.now() & 0xffffff) + 53)
      setHourlyVolume((prev) => {
        const next = [...prev]
        const hour = new Date().getHours()
        next[hour] = Math.floor(next[hour] * (0.9 + rng() * 0.2) + rng() * 5000)
        return next
      })
    }, 15000)
    return () => clearInterval(iv)
  }, [])

  // ---- Ticker metrics update (every ~6s) ----
  useEffect(() => {
    const iv = setInterval(() => {
      const rng = mulberry32((Date.now() & 0xffffff) + 71)
      setTickerMetrics((prev) =>
        prev.map((m) => ({ ...m, delta: Math.round((rng() - 0.35) * 10) }))
      )
    }, 6000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white relative overflow-x-hidden">
      <Particles />

      {/* ============ 7. Stats Ticker ============ */}
      <div className="relative z-20 sticky top-0">
        <StatsTicker metrics={tickerMetrics} />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8 md:px-6 md:py-12">

        {/* ============ Header ============ */}
        <motion.div className="text-center mb-10 md:mb-14" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 * PHI }}>
          <h1 className="font-mono text-3xl md:text-5xl font-black tracking-widest mb-3" style={{ color: CYAN, textShadow: `0 0 20px ${CYAN}40, 0 0 60px ${CYAN}20` }}>
            LIVE FEED
          </h1>
          <p className="text-gray-400 font-mono text-sm md:text-base max-w-2xl mx-auto">
            Real-time protocol activity. Every batch, every trade, zero MEV.
          </p>
          <div className="flex items-center justify-center gap-3 mt-4">
            <PulseDot color="#22c55e" size={10} />
            <span className="font-mono text-xs text-green-400 font-bold tracking-wider">PROTOCOL ACTIVE</span>
          </div>
        </motion.div>

        {/* ============ 4. Protocol Heartbeat ============ */}
        <Section delay={0.05 * PHI}>
          <ProtocolHeartbeat phase={phase} progress={progress} />
        </Section>

        {/* ============ 1. Live Batch Feed + 2. Transaction Waterfall ============ */}
        <Section delay={0.1 * PHI}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
            {/* Batch Feed */}
            <div>
              <SectionHeader>// LIVE BATCH FEED</SectionHeader>
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {batches.map((batch, i) => (
                    <BatchCard key={batch.id} batch={batch} index={i} />
                  ))}
                </AnimatePresence>
                {batches.length === 0 && (
                  <div className="font-mono text-xs text-gray-500 text-center py-12">Waiting for batches...</div>
                )}
              </div>
            </div>
            {/* Waterfall */}
            <TransactionWaterfall events={waterfallEvents} />
          </div>
        </Section>

        {/* ============ 3. Chain Activity + 5. Top Movers ============ */}
        <Section delay={0.15 * PHI}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChainActivityMap chainActivity={chainActivity} />
            <TopMovers movers={topMovers} />
          </div>
        </Section>

        {/* ============ 6. Volume Heatmap ============ */}
        <Section delay={0.2 * PHI}>
          <VolumeHeatmap hourlyVolume={hourlyVolume} />
        </Section>

        {/* ============ Footer ============ */}
        <motion.footer className="text-center py-10 border-t border-gray-800/50" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: PHI }}>
          <blockquote className="font-mono text-sm md:text-base italic max-w-2xl mx-auto leading-relaxed" style={{ color: `${CYAN}90` }}>
            "Fairness above all. Every batch settled at uniform clearing price. Zero MEV extracted."
          </blockquote>
          <p className="font-mono text-xs text-gray-600 mt-4 tracking-wider">BUILDING IN THE CAVE.</p>
        </motion.footer>

      </div>
    </div>
  )
}

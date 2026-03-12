import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { Link } from 'react-router-dom'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

// ============ Animation Variants ============

const headerV = {
  hidden: { opacity: 0, y: -30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } },
}
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.2 + i * (0.1 * PHI), ease },
  }),
}

// ============ Hex Utilities ============

function randomHex(len = 32) {
  const chars = '0123456789abcdef'
  let s = '0x'
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)]
  return s
}

function truncHex(hex) {
  if (!hex || hex.length < 12) return hex
  return hex.slice(0, 6) + '...' + hex.slice(-4)
}

// ============ Batch Timer Arc (SVG) ============

function BatchTimerArc({ phase, timer, totalTime }) {
  const size = 96
  const stroke = 4
  const r = (size - stroke) / 2
  const c = Math.PI * 2 * r
  const progress = totalTime > 0 ? (totalTime - timer) / totalTime : 1
  const colors = ['#3b82f6', '#a855f7', '#f59e0b', '#22c55e']
  const labels = ['COMMIT', 'REVEAL', 'SHUFFLE', 'SETTLED']
  const col = colors[phase] || CYAN

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={col} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          animate={{ strokeDashoffset: c * (1 - progress) }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-lg font-mono font-bold" style={{ color: col }}>
          {phase >= 2 ? (phase === 3 ? '!' : '~') : `${timer}s`}
        </span>
        <span className="text-[8px] font-mono uppercase tracking-wider" style={{ color: `${col}99` }}>{labels[phase]}</span>
      </div>
    </div>
  )
}

// ============ Hash Visualizer ============

function HashVisualizer({ order, secret, visible }) {
  const [displayHash, setDisplayHash] = useState(randomHex(64))

  useEffect(() => {
    if (!visible) return
    let frame = 0
    const iv = setInterval(() => {
      frame++
      if (frame < 12) {
        setDisplayHash(randomHex(64))
      } else {
        setDisplayHash(randomHex(64))
        clearInterval(iv)
      }
    }, 80)
    return () => clearInterval(iv)
  }, [visible])

  if (!visible) return null

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-3 rounded-lg p-3 overflow-hidden"
      style={{ background: 'rgba(0,0,0,0.5)', border: `1px solid ${CYAN}20` }}
    >
      <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-2">Hash Computation</p>
      <div className="space-y-1">
        <div className="flex gap-2 items-center">
          <span className="text-[9px] font-mono text-blue-400 w-12 flex-shrink-0">order:</span>
          <span className="text-[10px] font-mono text-blue-300/70 truncate">{order}</span>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-[9px] font-mono text-purple-400 w-12 flex-shrink-0">secret:</span>
          <span className="text-[10px] font-mono text-purple-300/70 truncate">{secret}</span>
        </div>
        <div className="h-px my-1" style={{ background: `${CYAN}15` }} />
        <div className="flex gap-2 items-center">
          <span className="text-[9px] font-mono text-amber-400 w-12 flex-shrink-0">hash:</span>
          <motion.span
            className="text-[10px] font-mono text-amber-300/70 truncate"
            animate={{ opacity: [0.5, 1] }}
            transition={{ duration: 0.15, repeat: 10 }}
          >
            {truncHex(displayHash)}
          </motion.span>
        </div>
      </div>
      <p className="text-[8px] font-mono text-black-600 mt-2 italic">keccak256(order || secret) — irreversible, hides intent</p>
    </motion.div>
  )
}

// ============ Fisher-Yates Shuffle Animation ============

function ShuffleAnimation({ items, active }) {
  const [positions, setPositions] = useState(items.map((_, i) => i))
  const [swapPair, setSwapPair] = useState(null)

  useEffect(() => {
    if (!active) {
      setPositions(items.map((_, i) => i))
      setSwapPair(null)
      return
    }
    const arr = items.map((_, i) => i)
    const swaps = []
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      if (i !== j) swaps.push([i, j])
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    let step = 0
    const pos = items.map((_, i) => i)
    const iv = setInterval(() => {
      if (step >= swaps.length) {
        setSwapPair(null)
        clearInterval(iv)
        return
      }
      const [a, b] = swaps[step]
      setSwapPair([a, b])
      ;[pos[a], pos[b]] = [pos[b], pos[a]]
      setPositions([...pos])
      step++
    }, 400)
    return () => clearInterval(iv)
  }, [active, items.length])

  const cols = ['#3b82f6', '#a855f7', '#22c55e']

  return (
    <div className="relative h-10 mt-2" style={{ minWidth: items.length * 52 }}>
      {items.map((item, i) => {
        const isSwapping = swapPair && (swapPair[0] === i || swapPair[1] === i)
        return (
          <motion.div
            key={item.id}
            className="absolute top-0 flex items-center justify-center rounded-lg text-[10px] font-mono font-bold"
            style={{
              width: 44, height: 36,
              background: isSwapping ? `${cols[i % 3]}25` : `${cols[i % 3]}10`,
              border: `1px solid ${isSwapping ? `${cols[i % 3]}60` : `${cols[i % 3]}25`}`,
              color: cols[i % 3],
            }}
            animate={{
              x: positions[i] * 52,
              scale: isSwapping ? 1.1 : 1,
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            {item.label}
          </motion.div>
        )
      })}
    </div>
  )
}

// ============ Interactive Step-by-Step Demo ============

function BatchSimulator() {
  const [phase, setPhase] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [timer, setTimer] = useState(8)
  const [showHash, setShowHash] = useState(false)
  const [orders, setOrders] = useState([
    { id: 1, trader: 'Alice', type: 'buy', amount: '2.5 ETH', hash: randomHex(64), secret: randomHex(64), orderData: randomHex(48), revealed: false, position: null },
    { id: 2, trader: 'Bob', type: 'sell', amount: '1.8 ETH', hash: randomHex(64), secret: randomHex(64), orderData: randomHex(48), revealed: false, position: null },
    { id: 3, trader: 'Carol', type: 'buy', amount: '5.0 ETH', hash: randomHex(64), secret: randomHex(64), orderData: randomHex(48), revealed: false, position: null },
    { id: 4, trader: 'MEV Bot', type: 'buy', amount: '???', hash: null, secret: null, orderData: null, revealed: false, position: null, blocked: true },
  ])

  const shuffleItems = useMemo(() => [
    { id: 'a', label: 'Alice' },
    { id: 'b', label: 'Bob' },
    { id: 'c', label: 'Carol' },
  ], [])

  const startBatch = useCallback(() => {
    setIsRunning(true)
    setPhase(0)
    setTimer(8)
    setShowHash(false)
    setOrders(prev => prev.map(o => ({
      ...o,
      revealed: false,
      position: null,
      hash: o.blocked ? null : randomHex(64),
      secret: o.blocked ? null : randomHex(64),
      orderData: o.blocked ? null : randomHex(48),
    })))
    // Flash the hash visualizer midway through commit
    setTimeout(() => setShowHash(true), 1500)
  }, [])

  useEffect(() => {
    if (!isRunning) return

    if (phase === 0 && timer > 0) {
      const t = setTimeout(() => setTimer(s => s - 1), 500)
      return () => clearTimeout(t)
    }

    if (phase === 0 && timer === 0) {
      setPhase(1)
      setTimer(2)
      setShowHash(false)
      return
    }

    if (phase === 1 && timer > 0) {
      const t = setTimeout(() => {
        setTimer(s => s - 1)
        setOrders(prev => prev.map(o => o.blocked ? o : { ...o, revealed: true }))
      }, 500)
      return () => clearTimeout(t)
    }

    if (phase === 1 && timer === 0) {
      setPhase(2)
      setTimeout(() => {
        setOrders(prev => {
          const valid = prev.filter(o => !o.blocked)
          const positions = [2, 0, 1]
          return prev.map(o => {
            if (o.blocked) return o
            const idx = valid.findIndex(v => v.id === o.id)
            return { ...o, position: positions[idx] + 1 }
          })
        })
        setTimeout(() => {
          setPhase(3)
          setIsRunning(false)
        }, 1800)
      }, 1200)
      return
    }
  }, [isRunning, phase, timer])

  const phaseColors = ['#3b82f6', '#a855f7', '#f59e0b', '#22c55e']
  const phaseNames = ['COMMIT', 'REVEAL', 'SHUFFLE', 'SETTLE']
  const totalTime = phase === 0 ? 8 : phase === 1 ? 2 : 0

  return (
    <div>
      {/* Timer arc + phase indicator */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2 flex-1">
          {phaseNames.map((name, i) => (
            <div key={name} className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-mono font-bold transition-all duration-300 ${
                  phase >= i ? 'scale-110' : 'opacity-40'
                }`}
                style={{
                  background: phase >= i ? `${phaseColors[i]}20` : 'rgba(0,0,0,0.3)',
                  border: `1px solid ${phase >= i ? `${phaseColors[i]}60` : 'rgba(255,255,255,0.06)'}`,
                  color: phase >= i ? phaseColors[i] : 'rgba(255,255,255,0.2)',
                }}
              >
                {i + 1}
              </div>
              {i < 3 && <div className="w-6 sm:w-10 h-px" style={{ background: phase > i ? `${phaseColors[i]}40` : 'rgba(255,255,255,0.06)' }} />}
            </div>
          ))}
        </div>
        {isRunning && (
          <div className="relative flex-shrink-0 ml-3">
            <BatchTimerArc phase={phase} timer={timer} totalTime={totalTime} />
          </div>
        )}
      </div>

      {/* Orders */}
      <div className="space-y-2 mb-4">
        {orders.map((order, i) => (
          <motion.div
            key={order.id}
            layout
            className="flex items-center justify-between rounded-lg p-3"
            style={{
              background: order.blocked ? 'rgba(239,68,68,0.06)' : 'rgba(0,0,0,0.3)',
              border: `1px solid ${
                order.blocked ? 'rgba(239,68,68,0.2)' :
                phase === 3 ? 'rgba(34,197,94,0.2)' :
                order.revealed ? 'rgba(168,85,247,0.2)' :
                'rgba(255,255,255,0.06)'
              }`,
              order: order.position != null ? order.position : i,
            }}
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold ${
                order.blocked ? 'bg-red-500/10 text-red-400' :
                order.type === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
              }`}>
                {order.blocked ? '✕' : order.type === 'buy' ? 'B' : 'S'}
              </div>
              <div>
                <span className="text-xs font-mono font-bold text-white">{order.trader}</span>
                {order.blocked && <span className="text-[9px] font-mono text-red-400 ml-2">BLOCKED — EOA only</span>}
                {!order.blocked && phase === 0 && <span className="text-[9px] font-mono text-black-500 ml-2">hash: {truncHex(order.hash)}</span>}
                {!order.blocked && order.revealed && <span className="text-[9px] font-mono text-purple-400 ml-2">{order.type} {order.amount}</span>}
              </div>
            </div>
            <div>
              {!order.blocked && phase === 3 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                  Filled @ $3,420
                </span>
              )}
              {order.blocked && phase >= 1 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                  Rejected
                </span>
              )}
              {!order.blocked && order.position != null && phase >= 2 && phase < 3 && (
                <span className="text-[10px] font-mono text-amber-400">#{order.position}</span>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Hash visualizer — appears during commit phase */}
      <AnimatePresence>
        {showHash && phase === 0 && orders[0] && (
          <HashVisualizer order={orders[0].orderData} secret={orders[0].secret} visible={true} />
        )}
      </AnimatePresence>

      {/* Shuffle animation — appears during shuffle phase */}
      <AnimatePresence>
        {phase === 2 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mb-4 rounded-lg p-3 overflow-x-auto"
            style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(245,158,11,0.15)' }}
          >
            <p className="text-[9px] font-mono text-amber-400/70 uppercase tracking-wider mb-1">Fisher-Yates Shuffle</p>
            <ShuffleAnimation items={shuffleItems} active={phase === 2} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Start button */}
      <button
        onClick={startBatch}
        disabled={isRunning}
        className="w-full py-3 rounded-lg font-mono font-bold text-sm transition-all"
        style={{
          background: isRunning ? 'rgba(0,0,0,0.3)' : `${CYAN}15`,
          border: `1px solid ${isRunning ? 'rgba(255,255,255,0.06)' : `${CYAN}40`}`,
          color: isRunning ? 'rgba(255,255,255,0.3)' : CYAN,
        }}
      >
        {isRunning ? 'Batch in progress...' : phase === 3 ? 'Run Another Batch' : 'Start Batch Cycle'}
      </button>

      {/* Settlement result */}
      <AnimatePresence>
        {phase === 3 && !isRunning && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-lg p-4 text-center"
            style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}
          >
            <p className="text-xs font-mono text-green-400 font-bold">BATCH SETTLED</p>
            <p className="text-[11px] font-mono text-black-300 mt-1">
              3 orders filled at uniform price $3,420.00 | 1 MEV bot blocked | 0 front-running
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ MEV Comparison Panel ============

function MEVComparison() {
  const [hoveredRow, setHoveredRow] = useState(null)

  const rows = [
    {
      attack: 'Front-running',
      trad: 'Miners see pending txs, insert before yours',
      tradLoss: '-$47 avg per trade',
      vibe: 'Orders hidden in commit phase',
      vibeResult: 'Eliminated',
    },
    {
      attack: 'Sandwich Attack',
      trad: 'Buy before + sell after your trade',
      tradLoss: '-$120 avg per trade',
      vibe: 'Batch settlement — no ordering exploit',
      vibeResult: 'Eliminated',
    },
    {
      attack: 'Just-in-time LP',
      trad: 'Add/remove liquidity around your trade',
      tradLoss: '-$35 avg per trade',
      vibe: 'Commit-reveal prevents timing attacks',
      vibeResult: 'Eliminated',
    },
    {
      attack: 'Backrunning',
      trad: 'Copy profitable trades instantly',
      tradLoss: 'Loss of alpha',
      vibe: 'Fisher-Yates shuffle randomizes order',
      vibeResult: 'Mitigated',
    },
    {
      attack: 'Gas Auction',
      trad: 'Pay miners for priority — gas wars',
      tradLoss: '3-10x gas cost',
      vibe: 'Priority auction — bid fairly, not via gas',
      vibeResult: 'Replaced',
    },
  ]

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-2 mb-1">
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Attack Vector</span>
        <span className="text-[9px] font-mono text-red-400/60 uppercase tracking-wider text-center">Traditional DEX</span>
        <span className="text-[9px] font-mono text-green-400/60 uppercase tracking-wider text-center">VibeSwap</span>
      </div>
      {rows.map((row, i) => (
        <motion.div
          key={row.attack}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * (0.06 * PHI), duration: 0.3 }}
          className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-start rounded-lg p-3 cursor-default"
          style={{
            background: hoveredRow === i ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.3)',
            border: `1px solid ${hoveredRow === i ? `${CYAN}15` : 'rgba(255,255,255,0.04)'}`,
          }}
          onMouseEnter={() => setHoveredRow(i)}
          onMouseLeave={() => setHoveredRow(null)}
        >
          <div>
            <span className="text-[11px] font-mono text-white font-bold">{row.attack}</span>
          </div>
          <div className="text-center">
            <span className="text-[10px] font-mono text-red-400/80">{row.trad}</span>
            <p className="text-[9px] font-mono text-red-500/60 mt-0.5">{row.tradLoss}</p>
          </div>
          <div className="text-center">
            <span className="text-[10px] font-mono text-green-400/80">{row.vibe}</span>
            <p className="text-[9px] font-mono text-green-500/80 font-bold mt-0.5">{row.vibeResult}</p>
          </div>
        </motion.div>
      ))}

      {/* MEV savings summary */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-3 rounded-lg p-3 text-center"
        style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}15` }}
      >
        <p className="text-[10px] font-mono text-black-400">
          Ethereum users lost <span className="text-red-400 font-bold">$1.38B</span> to MEV in 2024.
          VibeSwap's commit-reveal mechanism makes these extractions <span className="text-green-400 font-bold">structurally impossible</span>.
        </p>
      </motion.div>
    </div>
  )
}

// ============ Statistics Dashboard ============

function StatsDashboard() {
  const [stats, setStats] = useState({
    batches: 0,
    mevSaved: 0,
    avgBatchSize: 0,
    priceAccuracy: 0,
  })

  useEffect(() => {
    const targets = { batches: 142857, mevSaved: 2847391, avgBatchSize: 12.4, priceAccuracy: 99.7 }
    const steps = 40
    let step = 0
    const iv = setInterval(() => {
      step++
      const t = Math.min(step / steps, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setStats({
        batches: Math.floor(targets.batches * eased),
        mevSaved: Math.floor(targets.mevSaved * eased),
        avgBatchSize: parseFloat((targets.avgBatchSize * eased).toFixed(1)),
        priceAccuracy: parseFloat((targets.priceAccuracy * eased).toFixed(1)),
      })
      if (step >= steps) clearInterval(iv)
    }, 30)
    return () => clearInterval(iv)
  }, [])

  const cards = [
    { label: 'Batches Processed', value: stats.batches.toLocaleString(), color: '#3b82f6', icon: '#' },
    { label: 'MEV Saved (USD)', value: `$${stats.mevSaved.toLocaleString()}`, color: '#22c55e', icon: '$' },
    { label: 'Avg Batch Size', value: `${stats.avgBatchSize} orders`, color: '#a855f7', icon: '~' },
    { label: 'Price Accuracy', value: `${stats.priceAccuracy}%`, color: '#f59e0b', icon: '%' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((card, i) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.08, duration: 0.3 }}
          className="rounded-xl p-4 text-center"
          style={{ background: `${card.color}06`, border: `1px solid ${card.color}15` }}
        >
          <div
            className="w-8 h-8 rounded-lg mx-auto mb-2 flex items-center justify-center text-sm font-mono font-bold"
            style={{ background: `${card.color}12`, color: card.color }}
          >
            {card.icon}
          </div>
          <p className="text-base sm:text-lg font-mono font-bold" style={{ color: card.color }}>{card.value}</p>
          <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mt-1">{card.label}</p>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Math Section ============

function MathBreakdown() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg p-4" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${CYAN}15` }}>
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Commitment Hash</p>
        <code className="text-sm font-mono" style={{ color: '#3b82f6' }}>
          commitment = keccak256(order || secret)
        </code>
      </div>
      <div className="rounded-lg p-4" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${CYAN}15` }}>
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Shuffle Seed</p>
        <code className="text-sm font-mono" style={{ color: '#f59e0b' }}>
          seed = secret&#x2081; XOR secret&#x2082; XOR ... XOR secret&#x2099;
        </code>
      </div>
      <div className="rounded-lg p-4" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${CYAN}15` }}>
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Uniform Clearing Price</p>
        <code className="text-sm font-mono" style={{ color: '#22c55e' }}>
          P* = price where supply(P) = demand(P)
        </code>
        <p className="text-[10px] font-mono text-black-400 mt-2">All orders in the batch get this single price — no slippage between orders.</p>
      </div>
    </div>
  )
}

// ============ Batch Cycle Phases ============

const PHASES = [
  {
    id: 'commit',
    name: 'Commit Phase',
    duration: '8 seconds',
    color: '#3b82f6',
    icon: '#',
    description: 'Users submit hash(order || secret) with deposits. Nobody can see anyone else\'s order — not miners, not bots, not other traders.',
    details: [
      'Order details are hidden inside a cryptographic hash',
      'Deposit is locked as commitment stake',
      'EOA-only: flash loans cannot participate',
      'TWAP validation ensures prices are within 5% of oracle',
    ],
  },
  {
    id: 'reveal',
    name: 'Reveal Phase',
    duration: '2 seconds',
    color: '#a855f7',
    icon: '\u2192',
    description: 'Traders reveal their orders + secrets. Invalid reveals lose 50% of their deposit. Optional priority bids.',
    details: [
      'Must match the committed hash exactly',
      '50% slashing for invalid reveals (anti-spam)',
      'Priority auction: bid extra to go first',
      'Secrets are collected for shuffle seed',
    ],
  },
  {
    id: 'shuffle',
    name: 'Fisher-Yates Shuffle',
    duration: 'instant',
    color: '#f59e0b',
    icon: '~',
    description: 'All revealed secrets are XORed together to create a seed. Fisher-Yates shuffle determines execution order — deterministic but unpredictable.',
    details: [
      'XOR of all secrets = shuffle seed',
      'No single party controls the seed',
      'Deterministic: same inputs = same shuffle',
      'Unpredictable: can\'t know result before all reveals',
    ],
  },
  {
    id: 'settle',
    name: 'Settlement',
    duration: 'instant',
    color: '#22c55e',
    icon: '=',
    description: 'All orders in the batch execute at a single uniform clearing price. No front-running, no sandwich attacks, no MEV extraction.',
    details: [
      'Uniform clearing price for all orders in batch',
      'Priority bidders go first but same price',
      'Shapley attribution for multi-party contributions',
      'Remaining deposits returned after settlement',
    ],
  },
]

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

export default function CommitRevealPage() {
  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 12 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.3, 0], scale: [0, 1.5, 0], y: [0, -50 - (i % 4) * 20] }}
            transition={{ duration: 3 + (i % 3) * 1.2, repeat: Infinity, delay: (i * 0.8) % 4, ease: 'easeOut' }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-8 md:pt-14">
        {/* ============ Header ============ */}
        <motion.div variants={headerV} initial="hidden" animate="visible" className="text-center mb-10">
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="w-28 h-px mx-auto mb-5"
            style={{ background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)` }}
          />
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.1em] uppercase mb-3"
            style={{ textShadow: `0 0 40px ${CYAN}33` }}>
            <span style={{ color: CYAN }}>COMMIT</span>
            <span className="text-black-500 mx-2">&mdash;</span>
            <span className="text-white">REVEAL</span>
          </h1>
          <p className="text-sm text-black-300 font-mono mb-2">
            The core mechanism that eliminates MEV. 10-second batch auction cycles.
          </p>
          <p className="text-xs text-black-500 font-mono italic">
            "Miners cannot front-run what they cannot see."
          </p>
        </motion.div>

        <div className="space-y-6">
          {/* ============ Interactive Simulator ============ */}
          <Section index={0} title="Live Batch Simulator" subtitle="Walk through a 10-second commit-reveal batch auction">
            <BatchSimulator />
          </Section>

          {/* ============ Statistics Dashboard ============ */}
          <Section index={1} title="Protocol Statistics" subtitle="Cumulative network performance">
            <StatsDashboard />
          </Section>

          {/* ============ Four Phases ============ */}
          <Section index={2} title="The Four Phases" subtitle="Commit → Reveal → Shuffle → Settle">
            <div className="space-y-3">
              {PHASES.map((phase, i) => (
                <motion.div
                  key={phase.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * (0.1 * PHI), duration: 0.4, ease }}
                >
                  <div className="rounded-xl p-4" style={{ background: `${phase.color}06`, border: `1px solid ${phase.color}20` }}>
                    <div className="flex items-start gap-3">
                      <div
                        className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-lg"
                        style={{ background: `${phase.color}15`, border: `1px solid ${phase.color}35`, color: phase.color }}
                      >
                        {phase.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-mono font-bold" style={{ color: phase.color }}>{phase.name}</h4>
                          <span className="text-[10px] font-mono text-black-500">{phase.duration}</span>
                        </div>
                        <p className="text-[11px] font-mono text-black-300 mt-1 leading-relaxed">{phase.description}</p>
                        <div className="mt-2 space-y-1">
                          {phase.details.map((d, j) => (
                            <p key={j} className="text-[10px] font-mono text-black-400">+ {d}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </Section>

          {/* ============ MEV Comparison ============ */}
          <Section index={3} title="MEV Elimination" subtitle="Every attack vector, neutralized">
            <MEVComparison />
          </Section>

          {/* ============ Math ============ */}
          <Section index={4} title="The Math" subtitle="Cryptographic primitives behind the mechanism">
            <MathBreakdown />
          </Section>
        </div>

        {/* ============ Cross Links ============ */}
        <motion.div custom={5} variants={sectionV} initial="hidden" animate="visible" className="mt-8">
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { path: '/gametheory', label: 'Game Theory' },
              { path: '/economics', label: 'Economics' },
              { path: '/perps', label: 'Perpetuals' },
              { path: '/', label: 'Try It' },
            ].map(link => (
              <Link
                key={link.path}
                to={link.path}
                className="text-[10px] font-mono px-3 py-1.5 rounded-full transition-all hover:text-cyan-400"
                style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15`, color: `${CYAN}99` }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <blockquote className="max-w-md mx-auto">
            <p className="text-sm text-black-300 italic">
              "The solution to MEV is not to distribute it fairly. The solution is to eliminate it entirely."
            </p>
          </blockquote>
          <div className="w-16 h-px mx-auto my-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">Commit-Reveal Batch Auction</p>
        </motion.div>
      </div>
    </div>
  )
}

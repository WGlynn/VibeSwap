import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import Sparkline from './ui/Sparkline'

// ============ Constants ============

const PHI = 1.618033988749895
const EMERALD = '#10b981'
const RED = '#ef4444'
const AMBER = '#f59e0b'
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG ============
// Lehmer / Park-Miller LCG — same algorithm used in DeterministicShuffle.sol

function seededRng(seed) {
  let s = seed | 0
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, delay: 0.2 + i * (0.1 * PHI), ease },
  }),
}

// ============ Fisher-Yates Shuffle (deterministic) ============

function fisherYatesShuffle(arr, rng) {
  const a = [...arr]
  const steps = []
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    steps.push({ i, j, swapped: false })
    ;[a[i], a[j]] = [a[j], a[i]]
    steps.push({ i, j, after: [...a], swapped: true })
  }
  return { result: a, steps }
}

// ============ Section 1: Race Visualization ============
// Side-by-side comparison: traditional DEX (miners reorder) vs VibeSwap (shuffle)

const RACERS = [
  { id: 'trader_a', label: 'Trader A', color: EMERALD },
  { id: 'trader_b', label: 'Trader B', color: CYAN },
  { id: 'trader_c', label: 'Trader C', color: AMBER },
  { id: 'mev_bot', label: 'MEV Bot', color: RED },
]

function RaceLane({ racer, position, blocked, finished }) {
  return (
    <div className="flex items-center gap-3 h-10">
      <span className="text-[11px] font-mono w-16 text-right" style={{ color: racer.color }}>
        {racer.label}
      </span>
      <div className="flex-1 relative h-8 rounded-lg bg-black-900 border border-black-700 overflow-hidden">
        {/* Track grid lines */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="flex-1 border-r border-black-800/60" />
          ))}
        </div>

        {/* Checkered finish line */}
        <div
          className="absolute right-0 top-0 bottom-0 w-0.5"
          style={{
            background: 'repeating-linear-gradient(0deg, #fff 0px, #fff 3px, transparent 3px, transparent 6px)',
            opacity: 0.15,
          }}
        />

        {/* Racer marker */}
        <motion.div
          className="absolute top-1 bottom-1 flex items-center"
          animate={{ left: `${Math.min(position, 94)}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        >
          <div
            className="h-5 w-5 rounded-md border-2 flex items-center justify-center text-[9px] font-bold"
            style={{ borderColor: racer.color, background: `${racer.color}22`, color: racer.color }}
          >
            {racer.id === 'mev_bot' ? 'M' : racer.label.slice(-1)}
          </div>
        </motion.div>

        {/* Blocked badge for MEV bot */}
        {blocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-end pr-3"
          >
            <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
              BLOCKED
            </span>
          </motion.div>
        )}

        {/* Finished badge for legitimate traders */}
        {finished && !blocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-emerald-400"
          >
            DONE
          </motion.div>
        )}
      </div>
    </div>
  )
}

function RaceVisualization() {
  const [mode, setMode] = useState(null)
  const [positions, setPositions] = useState({ trader_a: 0, trader_b: 0, trader_c: 0, mev_bot: 0 })
  const [phase, setPhase] = useState('idle')
  const [running, setRunning] = useState(false)

  const reset = useCallback(() => {
    setPositions({ trader_a: 0, trader_b: 0, trader_c: 0, mev_bot: 0 })
    setPhase('idle')
    setMode(null)
    setRunning(false)
  }, [])

  const runTraditional = useCallback(() => {
    reset()
    setMode('traditional')
    setRunning(true)
    setPhase('mempool')

    // MEV bot sees mempool, miner reorders, bot finishes first
    setTimeout(() => {
      setPhase('reordered')
      setPositions({ mev_bot: 40, trader_a: 10, trader_b: 8, trader_c: 5 })
    }, 600)
    setTimeout(() => {
      setPositions({ mev_bot: 75, trader_a: 30, trader_b: 25, trader_c: 20 })
    }, 1200)
    setTimeout(() => {
      setPhase('settled')
      setPositions({ mev_bot: 100, trader_a: 65, trader_b: 55, trader_c: 45 })
      setRunning(false)
    }, 2200)
  }, [reset])

  const runVibeSwap = useCallback(() => {
    reset()
    setMode('vibeswap')
    setRunning(true)
    setPhase('commit')

    // All traders advance together, MEV bot stuck at commit gate
    setTimeout(() => {
      setPositions({ trader_a: 25, trader_b: 25, trader_c: 25, mev_bot: 3 })
    }, 500)
    setTimeout(() => {
      setPhase('reveal')
      setPositions({ trader_a: 55, trader_b: 55, trader_c: 55, mev_bot: 3 })
    }, 1400)
    setTimeout(() => {
      setPhase('shuffle')
      setPositions({ trader_a: 80, trader_b: 80, trader_c: 80, mev_bot: 3 })
    }, 2200)
    setTimeout(() => {
      setPhase('settled')
      setPositions({ trader_a: 100, trader_b: 100, trader_c: 100, mev_bot: 3 })
      setRunning(false)
    }, 3000)
  }, [reset])

  const phaseLabels = {
    idle: 'Press a button to begin',
    mempool: 'Mempool exposed — MEV bot scanning...',
    reordered: 'Miner reorders: MEV bot first, you last',
    commit: 'Commit Phase — orders encrypted as hashes',
    reveal: 'Reveal Phase — secrets disclosed',
    shuffle: 'Fisher-Yates Shuffle — random order applied',
    settled: mode === 'traditional'
      ? 'MEV bot extracted your value'
      : 'Uniform clearing price — everyone equal',
  }

  const phaseColors = {
    idle: 'text-black-500',
    mempool: 'text-red-400',
    reordered: 'text-red-400',
    commit: 'text-blue-400',
    reveal: 'text-amber-400',
    shuffle: 'text-purple-400',
    settled: mode === 'traditional' ? 'text-red-400' : 'text-emerald-400',
  }

  return (
    <GlassCard glowColor="matrix" spotlight className="p-6">
      <h2 className="text-lg font-bold mb-1">The Race</h2>
      <p className="text-xs text-black-400 mb-5">
        Traditional DEX: miners reorder transactions for profit. VibeSwap: Fisher-Yates shuffle — everyone equal.
      </p>

      <div className="space-y-2 mb-4">
        {RACERS.map((r) => (
          <RaceLane
            key={r.id}
            racer={r}
            position={positions[r.id]}
            blocked={mode === 'vibeswap' && r.id === 'mev_bot' && phase === 'settled'}
            finished={phase === 'settled' && positions[r.id] >= 95}
          />
        ))}
      </div>

      {/* Phase readout */}
      <div className={`text-center text-[11px] font-mono mb-5 ${phaseColors[phase]}`}>
        {phaseLabels[phase]}
      </div>

      {/* Controls */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={runTraditional}
          disabled={running}
          className="px-5 py-2 rounded-xl text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Traditional DEX
        </button>
        <button
          onClick={runVibeSwap}
          disabled={running}
          className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          VibeSwap
        </button>
        {phase === 'settled' && (
          <button
            onClick={reset}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-black-800 text-black-400 border border-black-600 hover:border-black-500 transition-all"
          >
            Reset
          </button>
        )}
      </div>
    </GlassCard>
  )
}

// ============ Section 2: Fisher-Yates Shuffle Demo ============

function ShuffleDemo() {
  const [items, setItems] = useState([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  const [steps, setSteps] = useState([])
  const [stepIdx, setStepIdx] = useState(-1)
  const [distributions, setDistributions] = useState(null)
  const [simCount, setSimCount] = useState(0)

  const runShuffle = useCallback(() => {
    const rng = seededRng(Date.now())
    const { result, steps: ns } = fisherYatesShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rng)
    setSteps(ns)
    setStepIdx(0)

    let idx = 0
    const timer = setInterval(() => {
      idx++
      if (idx >= ns.length) {
        clearInterval(timer)
        setItems(result)
        setStepIdx(-1)
        return
      }
      setStepIdx(idx)
      if (ns[idx].after) setItems(ns[idx].after)
    }, Math.round(200 / PHI))
  }, [])

  const runSimulation = useCallback(() => {
    // Run 1000 shuffles and track where each element lands
    const dist = Array.from({ length: 10 }, () => Array(10).fill(0))
    const N = 1000
    const rng = seededRng(42)

    for (let run = 0; run < N; run++) {
      const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      arr.forEach((originalIdx, position) => {
        dist[originalIdx][position]++
      })
    }

    setDistributions(dist)
    setSimCount(N)
  }, [])

  const cs = stepIdx >= 0 && stepIdx < steps.length ? steps[stepIdx] : null

  return (
    <GlassCard glowColor="terminal" spotlight className="p-6">
      <h2 className="text-lg font-bold mb-1">Fisher-Yates Shuffle</h2>
      <p className="text-xs text-black-400 mb-5">
        Each permutation is equally likely. Pick random element, swap to end, repeat.
        This is how VibeSwap determines execution order — using XORed user secrets as the seed.
      </p>

      {/* Current array state */}
      <div className="flex justify-center gap-1.5 mb-4">
        {items.map((item, idx) => {
          const picking = cs && !cs.swapped && (idx === cs.i || idx === cs.j)
          const swapped = cs && cs.swapped && (idx === cs.i || idx === cs.j)
          return (
            <motion.div
              key={`${idx}-${item}`}
              layout
              className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold font-mono border"
              style={{
                borderColor: picking ? AMBER : swapped ? EMERALD : 'rgba(37,37,37,1)',
                background: picking ? 'rgba(245,158,11,0.15)' : swapped ? 'rgba(16,185,129,0.12)' : 'rgba(15,15,15,0.8)',
                color: picking ? AMBER : swapped ? EMERALD : '#e5e5e5',
              }}
              animate={{ scale: picking || swapped ? 1.1 : 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              {item}
            </motion.div>
          )
        })}
      </div>

      {/* Step readout */}
      <div className="text-center text-[10px] font-mono text-black-500 h-4 mb-4">
        {cs && !cs.swapped && (
          <span>
            Swap position <span className="text-amber-400">{cs.i}</span> with random position <span className="text-amber-400">{cs.j}</span>
          </span>
        )}
        {cs && cs.swapped && <span className="text-emerald-400">Swapped!</span>}
      </div>

      {/* Controls */}
      <div className="flex gap-3 justify-center mb-6">
        <button
          onClick={runShuffle}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 active:scale-95 transition-all"
        >
          Shuffle Once
        </button>
        <button
          onClick={runSimulation}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 active:scale-95 transition-all"
        >
          Simulate 1,000x
        </button>
      </div>

      {/* Distribution heatmap — proves uniform distribution */}
      <AnimatePresence>
        {distributions && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="text-[10px] font-mono text-black-500 text-center mb-2">
              Position distribution after {simCount.toLocaleString()} shuffles (element vs. final position)
            </div>
            <div className="overflow-x-auto">
              <div className="grid gap-px mx-auto" style={{ gridTemplateColumns: '40px repeat(10, 1fr)', maxWidth: 420 }}>
                <div />
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="text-[8px] font-mono text-black-500 text-center py-1">P{i}</div>
                ))}
                {distributions.map((row, el) => (
                  <>{/* row */}
                    <div key={`l-${el}`} className="text-[8px] font-mono text-black-500 flex items-center justify-end pr-1">
                      #{el + 1}
                    </div>
                    {row.map((count, pos) => {
                      const expected = simCount / 10
                      const deviation = Math.abs(count - expected) / expected
                      const isClose = deviation < 0.08
                      return (
                        <div
                          key={`${el}-${pos}`}
                          className="h-6 flex items-center justify-center text-[8px] font-mono rounded-sm"
                          style={{
                            background: isClose
                              ? `rgba(16,185,129,${0.08 + deviation * 0.8})`
                              : `rgba(245,158,11,${0.08 + deviation * 2.4})`,
                            color: isClose ? 'rgba(16,185,129,0.7)' : 'rgba(245,158,11,0.7)',
                          }}
                        >
                          {count}
                        </div>
                      )
                    })}
                  </>
                ))}
              </div>
            </div>
            <div className="text-[9px] text-black-500 text-center mt-2">
              Expected: ~{Math.round(simCount / 10)} per cell. Green = within 8% of expected.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

// ============ Section 3: MEV Sandwich Attack ============

const SANDWICH_UNISWAP = [
  { label: 'You submit swap: Buy 1 ETH', type: 'pending', price: '$1,800' },
  { label: 'MEV bot sees your tx in mempool', type: 'scan', price: null },
  { label: 'Bot front-runs: Buys ETH first', type: 'frontrun', price: '$1,800' },
  { label: 'Price pushed up by bot\'s buy', type: 'impact', price: '$1,824' },
  { label: 'Your trade executes at inflated price', type: 'victim', price: '$1,824' },
  { label: 'Bot back-runs: Sells ETH immediately', type: 'backrun', price: '$1,825' },
  { label: 'Bot profit: $25. Your loss: $24.', type: 'profit', price: null },
]

const SANDWICH_VIBESWAP = [
  { label: 'You commit: hash(Buy 1 ETH || secret)', type: 'commit', price: 'hidden' },
  { label: 'MEV bot sees commit — order encrypted', type: 'blocked', price: '???' },
  { label: 'Bot cannot determine direction or size', type: 'confused', price: '???' },
  { label: 'Reveal: all orders disclosed simultaneously', type: 'reveal', price: null },
  { label: 'Fisher-Yates shuffle: random execution order', type: 'shuffle', price: null },
  { label: 'Uniform clearing price: $1,801 for everyone', type: 'fair', price: '$1,801' },
  { label: 'Bot profit: $0. Your savings: $23.', type: 'saved', price: null },
]

function stepColor(type) {
  if ('frontrun backrun profit'.includes(type)) return RED
  if ('victim impact'.includes(type)) return 'rgba(239,68,68,0.7)'
  if ('scan blocked confused'.includes(type)) return RED
  if ('commit fair saved'.includes(type)) return EMERALD
  if ('reveal shuffle'.includes(type)) return AMBER
  return '#888'
}

function SandwichTimeline({ steps, variant }) {
  const [active, setActive] = useState(-1)
  const [playing, setPlaying] = useState(false)

  const play = useCallback(() => {
    setActive(-1)
    setPlaying(true)
    let s = 0
    const t = setInterval(() => {
      setActive(s)
      s++
      if (s >= steps.length) { clearInterval(t); setPlaying(false) }
    }, 700)
  }, [steps])

  return (
    <div>
      <div className="space-y-1.5 mb-4">
        {steps.map((step, idx) => {
          const on = idx <= active
          const cur = idx === active
          return (
            <motion.div
              key={idx}
              animate={{ opacity: on ? 1 : 0.3, x: cur ? 4 : 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-3"
            >
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0 border"
                style={{
                  borderColor: on ? stepColor(step.type) : 'rgba(55,55,55,1)',
                  background: on ? `${stepColor(step.type)}33` : 'transparent',
                }}
              />
              <span className="text-[11px] font-mono flex-1" style={{ color: on ? stepColor(step.type) : '#555' }}>
                {step.label}
              </span>
              {step.price && on && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black-800 border border-black-700"
                  style={{ color: stepColor(step.type) }}
                >
                  {step.price}
                </span>
              )}
            </motion.div>
          )
        })}
      </div>
      <button
        onClick={play}
        disabled={playing}
        className={`text-xs font-bold px-4 py-1.5 rounded-lg transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
          variant === 'bad'
            ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
        }`}
      >
        {playing ? 'Playing...' : 'Play Attack'}
      </button>
    </div>
  )
}

function SandwichSection() {
  return (
    <GlassCard glowColor="warning" spotlight className="p-6">
      <h2 className="text-lg font-bold mb-1">MEV Sandwich Attack</h2>
      <p className="text-xs text-black-400 mb-5">
        Front-run, victim, back-run. The most common MEV extraction — and how VibeSwap makes it structurally impossible.
      </p>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-red-400 mb-3">
            Uniswap / Traditional DEX
          </div>
          <SandwichTimeline steps={SANDWICH_UNISWAP} variant="bad" />
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 mb-3">
            VibeSwap
          </div>
          <SandwichTimeline steps={SANDWICH_VIBESWAP} variant="good" />
        </div>
      </div>
    </GlassCard>
  )
}

// ============ Section 4: Uniform Clearing Price ============

function ClearingPriceViz() {
  const W = 320, H = 200, pad = 30, N = 16, ci = 8
  const dPts = [], sPts = []

  for (let i = 0; i < N; i++) {
    const x = pad + (i / (N - 1)) * (W - 2 * pad)
    const t = i / (N - 1)
    dPts.push({ x, y: pad + (1 - (0.9 - t * 0.75)) * (H - 2 * pad) })
    sPts.push({ x, y: pad + (1 - (0.1 + t * 0.75)) * (H - 2 * pad) })
  }

  const ix = dPts[ci].x
  const iy = (dPts[ci].y + sPts[ci].y) / 2
  const toPath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')

  return (
    <GlassCard glowColor="matrix" spotlight className="p-6">
      <h2 className="text-lg font-bold mb-1">Uniform Clearing Price</h2>
      <p className="text-xs text-black-400 mb-5">
        All buy orders form the demand curve. All sell orders form the supply curve.
        The intersection determines one clearing price. Everyone gets the SAME price — no preferential treatment.
      </p>

      {/* Supply/demand SVG chart */}
      <div className="flex justify-center mb-4">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
          {/* Grid */}
          {[0.25, 0.5, 0.75].map((t) => (
            <line key={t} x1={pad} y1={pad + t * (H - 2 * pad)} x2={W - pad} y2={pad + t * (H - 2 * pad)} stroke="rgba(255,255,255,0.04)" />
          ))}
          {/* Demand curve (cyan) */}
          <path d={toPath(dPts)} fill="none" stroke={CYAN} strokeWidth={2} opacity={0.8} />
          {/* Supply curve (amber) */}
          <path d={toPath(sPts)} fill="none" stroke={AMBER} strokeWidth={2} opacity={0.8} />
          {/* Clearing price crosshairs */}
          <line x1={pad} y1={iy} x2={W - pad} y2={iy} stroke={EMERALD} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
          <line x1={ix} y1={pad} x2={ix} y2={H - pad} stroke={EMERALD} strokeWidth={1} strokeDasharray="4 3" opacity={0.4} />
          {/* Intersection dot */}
          <circle cx={ix} cy={iy} r={5} fill={EMERALD} opacity={0.9} />
          <circle cx={ix} cy={iy} r={8} fill="none" stroke={EMERALD} strokeWidth={1} opacity={0.4} />
          {/* Curve labels */}
          <text x={W - pad + 4} y={dPts[N - 1].y + 4} fill={CYAN} fontSize={9} fontFamily="monospace" opacity={0.7}>demand</text>
          <text x={W - pad + 4} y={sPts[N - 1].y + 4} fill={AMBER} fontSize={9} fontFamily="monospace" opacity={0.7}>supply</text>
          <text x={ix} y={pad - 6} fill={EMERALD} fontSize={9} fontFamily="monospace" textAnchor="middle" opacity={0.8}>clearing price</text>
          {/* Axis labels */}
          <text x={W / 2} y={H - 4} fill="#555" fontSize={9} fontFamily="monospace" textAnchor="middle">quantity</text>
          <text x={8} y={H / 2} fill="#555" fontSize={9} fontFamily="monospace" textAnchor="middle" transform={`rotate(-90,8,${H / 2})`}>price</text>
        </svg>
      </div>

      {/* Explainer cards */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="p-3 rounded-lg bg-black-900 border border-black-800">
          <div className="text-[10px] font-mono text-cyan-400 mb-1">Buyers</div>
          <div className="text-xs text-black-300">All fill at clearing price or better</div>
        </div>
        <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <div className="text-[10px] font-mono text-emerald-400 mb-1">Clearing Price</div>
          <div className="text-xs text-black-300">Single uniform price for all participants</div>
        </div>
        <div className="p-3 rounded-lg bg-black-900 border border-black-800">
          <div className="text-[10px] font-mono text-amber-400 mb-1">Sellers</div>
          <div className="text-xs text-black-300">All fill at clearing price or better</div>
        </div>
      </div>
    </GlassCard>
  )
}

// ============ Section 5: Fairness Metrics Dashboard ============

const METRICS = [
  { label: 'MEV Saved', value: 2400000, prefix: '$', suffix: '', decimals: 0, change: 12.4, sparkSeed: 1337 },
  { label: 'Batches Processed', value: 1200000, prefix: '', suffix: '', decimals: 0, change: 8.2, sparkSeed: 42 },
  { label: 'Avg Slippage', value: 0.02, prefix: '', suffix: '%', decimals: 2, change: -3.1, sparkSeed: 999 },
  { label: 'Front-Runs Blocked', value: 34000, prefix: '', suffix: '', decimals: 0, change: 18.7, sparkSeed: 7777 },
]

// ============ Section 6: The 5% Cluster ============

function FivePercentCluster() {
  const [generation, setGeneration] = useState(0)
  const [cells, setCells] = useState(() => initGrid(42))

  function initGrid(seed) {
    const rng = seededRng(seed)
    // Axelrod: 5% cooperators is enough to seed cooperative dominance
    return Array.from({ length: 100 }, () => rng() < 0.05 ? 'coop' : 'defect')
  }

  const evolve = useCallback(() => {
    setCells((prev) => {
      const next = [...prev]
      const rng = seededRng(generation * 31 + 7)
      for (let i = 0; i < 100; i++) {
        const neighbors = [i - 10, i + 10, i - 1, i + 1].filter((n) => n >= 0 && n < 100)
        const coopNeighbors = neighbors.filter((n) => prev[n] === 'coop').length
        if (prev[i] === 'defect' && coopNeighbors >= 2 && rng() < coopNeighbors * 0.25) {
          next[i] = 'coop' // convert: cooperation is infectious when clustered
        } else if (prev[i] === 'coop' && coopNeighbors === 0 && rng() < 0.1) {
          next[i] = 'defect' // isolated cooperators sometimes defect
        }
      }
      return next
    })
    setGeneration((g) => g + 1)
  }, [generation])

  const coopCount = cells.filter((c) => c === 'coop').length

  return (
    <GlassCard glowColor="matrix" spotlight className="p-6">
      <h2 className="text-lg font-bold mb-1">The 5% Cluster</h2>
      <p className="text-xs text-black-400 mb-4">
        Axelrod's tournament insight: only 5% cooperative participants are needed to seed cooperative dominance.
        VibeSwap's early adopters bootstrap a fair ecosystem. Watch cooperation spread through proximity.
      </p>

      {/* 10x10 cooperation grid */}
      <div className="flex justify-center mb-4">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(10, 1fr)', width: 220 }}>
          {cells.map((cell, i) => (
            <motion.div
              key={i}
              className="w-5 h-5 rounded-sm"
              style={{ border: '1px solid' }}
              animate={{
                backgroundColor: cell === 'coop' ? 'rgba(16,185,129,0.7)' : 'rgba(55,55,55,0.4)',
                borderColor: cell === 'coop' ? 'rgba(16,185,129,0.4)' : 'rgba(40,40,40,0.6)',
              }}
              transition={{ duration: 0.3 }}
            />
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex justify-center gap-6 mb-4 text-center">
        <div>
          <div className="text-[10px] font-mono text-black-500">Generation</div>
          <div className="text-sm font-bold font-mono text-white">{generation}</div>
        </div>
        <div>
          <div className="text-[10px] font-mono text-black-500">Cooperators</div>
          <div className="text-sm font-bold font-mono text-emerald-400">{coopCount}%</div>
        </div>
        <div>
          <div className="text-[10px] font-mono text-black-500">Defectors</div>
          <div className="text-sm font-bold font-mono text-black-400">{100 - coopCount}%</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={evolve}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 active:scale-95 transition-all"
        >
          Evolve Generation
        </button>
        <button
          onClick={() => { setCells(initGrid(Date.now())); setGeneration(0) }}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-black-800 text-black-400 border border-black-600 hover:border-black-500 active:scale-95 transition-all"
        >
          Reset Grid
        </button>
      </div>
    </GlassCard>
  )
}

// ============ Main Page ============

export default function FairnessRace() {
  return (
    <div className="min-h-screen pb-20">
      <PageHero
        category="knowledge"
        title="Fairness Race"
        subtitle="Why order doesn't matter when everyone gets the same price"
        badge="Interactive"
        badgeColor={EMERALD}
      />

      <div className="max-w-4xl mx-auto px-4 space-y-8">
        {/* Section 1: Race Visualization */}
        <motion.div custom={0} initial="hidden" animate="visible" variants={sectionV}>
          <RaceVisualization />
        </motion.div>

        {/* Section 2: Fisher-Yates Shuffle Demo */}
        <motion.div custom={1} initial="hidden" animate="visible" variants={sectionV}>
          <ShuffleDemo />
        </motion.div>

        {/* Section 3: MEV Sandwich Attack */}
        <motion.div custom={2} initial="hidden" animate="visible" variants={sectionV}>
          <SandwichSection />
        </motion.div>

        {/* Section 4: Uniform Clearing Price */}
        <motion.div custom={3} initial="hidden" animate="visible" variants={sectionV}>
          <ClearingPriceViz />
        </motion.div>

        {/* Section 5: Fairness Metrics Dashboard */}
        <motion.div custom={4} initial="hidden" animate="visible" variants={sectionV}>
          <div>
            <h2 className="text-lg font-bold mb-1">Fairness Metrics</h2>
            <p className="text-xs text-black-400 mb-4">
              Cumulative protocol statistics demonstrating MEV elimination at scale.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {METRICS.map((m) => (
                <StatCard
                  key={m.label}
                  label={m.label}
                  value={m.value}
                  prefix={m.prefix}
                  suffix={m.suffix}
                  decimals={m.decimals}
                  change={m.change}
                  sparkSeed={m.sparkSeed}
                  size="sm"
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* Section 6: The 5% Cluster */}
        <motion.div custom={5} initial="hidden" animate="visible" variants={sectionV}>
          <FivePercentCluster />
        </motion.div>

        {/* Footer — P-000 axiom */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, delay: 2.5 }}
          className="text-center pt-8 pb-4 border-t border-black-800"
        >
          <p className="text-[11px] font-mono text-black-500 italic max-w-lg mx-auto">
            "Fairness above all. If something is clearly unfair, amending the code is a responsibility,
            a credo, a law, a canon." — P-000
          </p>
        </motion.div>
      </div>
    </div>
  )
}

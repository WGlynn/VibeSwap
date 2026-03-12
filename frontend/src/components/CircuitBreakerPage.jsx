import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const STATUS_COLORS = { armed: '#22c55e', tripped: '#ef4444', cooldown: '#f59e0b' }
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const fmtVal = (val, unit) => {
  if (unit === '$') return `$${(val / 1_000_000).toFixed(1)}M`
  if (unit === 's') return `${Math.round(val)}s`
  return `${typeof val === 'number' ? val.toFixed(1) : val}${unit}`
}

// ============ Data ============

const BREAKERS = [
  {
    id: 'volume', name: 'Volume Breaker',
    description: 'Trips when hourly volume exceeds threshold, preventing wash-trading and volume manipulation.',
    threshold: 10_000_000, current: 4_320_000, unit: '$', status: 'armed', cooldown: 0, color: '#3b82f6',
    lastTrip: { time: '2025-12-18 14:32 UTC', duration: '12 min', cause: 'Flash loan cascade on ETH/USDC pair' },
  },
  {
    id: 'price', name: 'Price Breaker',
    description: 'Trips on >5% price deviation from TWAP oracle, blocking oracle manipulation attacks.',
    threshold: 5.0, current: 1.8, unit: '%', status: 'armed', cooldown: 0, color: '#a855f7',
    lastTrip: { time: '2026-01-03 09:17 UTC', duration: '8 min', cause: 'Stale Chainlink feed during L1 congestion' },
  },
  {
    id: 'withdrawal', name: 'Withdrawal Breaker',
    description: 'Trips on large withdrawal spikes, protecting liquidity pools from bank-run dynamics.',
    threshold: 2_000_000, current: 780_000, unit: '$', status: 'cooldown', cooldown: 47, color: '#f59e0b',
    lastTrip: { time: '2026-03-12 06:41 UTC', duration: '5 min', cause: 'Coordinated withdrawal from whale cluster' },
  },
  {
    id: 'oracle', name: 'Oracle Breaker',
    description: 'Trips when oracle feeds diverge beyond tolerance, preventing stale or manipulated price data.',
    threshold: 3.0, current: 0.4, unit: '%', status: 'armed', cooldown: 0, color: '#22c55e',
    lastTrip: { time: '2025-11-29 21:05 UTC', duration: '22 min', cause: 'Chainlink vs Pyth divergence during high volatility' },
  },
  {
    id: 'bridge', name: 'Bridge Breaker',
    description: 'Trips on cross-chain message delays, halting bridging when LayerZero delivery times spike.',
    threshold: 120, current: 34, unit: 's', status: 'tripped', cooldown: 0, color: '#ef4444',
    lastTrip: { time: '2026-03-12 11:58 UTC', duration: 'ongoing', cause: 'Arbitrum sequencer downtime causing message backlog' },
  },
]

const TRIP_HISTORY = [
  { breaker: 'Bridge', time: '11:58 UTC', date: 'Today',
    duration: 'ongoing', status: 'tripped', color: '#ef4444' },
  { breaker: 'Withdrawal', time: '06:41 UTC', date: 'Today',
    duration: '5 min', status: 'recovered', color: '#f59e0b' },
  { breaker: 'Price', time: '09:17 UTC', date: 'Jan 3',
    duration: '8 min', status: 'recovered', color: '#a855f7' },
  { breaker: 'Volume', time: '14:32 UTC', date: 'Dec 18',
    duration: '12 min', status: 'recovered', color: '#3b82f6' },
  { breaker: 'Oracle', time: '21:05 UTC', date: 'Nov 29',
    duration: '22 min', status: 'recovered', color: '#22c55e' },
]

const TRIP_STEPS = [
  { title: 'Threshold Exceeded',
    desc: 'A monitored metric crosses its safety threshold. The on-chain monitor emits a TripEvent.',
    color: '#ef4444' },
  { title: 'Trading Halted',
    desc: 'New commits are rejected for the affected pair. Existing reveal phase completes normally.',
    color: '#f59e0b' },
  { title: 'Cooldown Timer',
    desc: 'A mandatory cooldown period begins. Duration scales with severity (5 min to 24 hours).',
    color: '#a855f7' },
  { title: 'Oracle Re-validation',
    desc: 'Kalman filter oracle re-checks price feeds. All sources must converge within tolerance.',
    color: '#3b82f6' },
  { title: 'Gradual Resume',
    desc: 'Trading resumes with reduced limits (50% capacity), scaling back to full over 30 minutes.',
    color: '#22c55e' },
]

const TRADFI_COMPARISON = [
  { feature: 'Trigger',
    tradfi: 'Index drops 7% / 13% / 20%',
    vibe: 'Per-metric thresholds (volume, price, oracle, withdrawal, bridge)' },
  { feature: 'Scope',
    tradfi: 'Entire market halted',
    vibe: 'Granular — only affected pairs/routes paused' },
  { feature: 'Duration',
    tradfi: '15 min / rest of day',
    vibe: 'Dynamic cooldown scaled to severity (5 min to 24h)' },
  { feature: 'Recovery',
    tradfi: 'Manual reopening bell',
    vibe: 'Automatic self-healing with gradual capacity ramp' },
  { feature: 'Transparency',
    tradfi: 'Exchange decides internally',
    vibe: 'On-chain: anyone can verify thresholds and state' },
  { feature: 'After-hours',
    tradfi: 'No protection outside trading hours',
    vibe: '24/7 — always monitoring, always protecting' },
]

const RECOVERY_STEPS = [
  { phase: 'Detection', icon: '!',
    desc: 'Circuit breaker identifies anomaly and halts affected operations within 1 block confirmation.' },
  { phase: 'Isolation', icon: '|',
    desc: 'Affected trading pairs are quarantined. Unrelated pairs continue operating normally.' },
  { phase: 'Diagnosis', icon: '?',
    desc: 'Oracle cross-references multiple price feeds. Kalman filter separates signal from noise.' },
  { phase: 'Stabilization', icon: '~',
    desc: 'TWAP recalculates over extended window. Liquidity positions are frozen to prevent panic withdrawals.' },
  { phase: 'Gradual Resume', icon: '+',
    desc: 'Trading resumes at 50% capacity. Rate limits are tightened. Full capacity restores over 30 minutes.' },
  { phase: 'Post-Mortem', icon: '=',
    desc: 'Trip event logged on-chain. Threshold parameters auto-adjust if the trip was a false positive.' },
]

// ============ SVG Gauge Component ============

function BreakerGauge({ breaker }) {
  const pct = Math.min((breaker.current / breaker.threshold) * 100, 100)
  const startAngle = -210, endAngle = 30, totalArc = endAngle - startAngle
  const needleAngle = startAngle + (pct / 100) * totalArc
  const r = 38, cx = 50, cy = 50
  const toRad = (deg) => (deg * Math.PI) / 180
  const arcPath = (s, e) => {
    const x1 = cx + r * Math.cos(toRad(s)), y1 = cy + r * Math.sin(toRad(s))
    const x2 = cx + r * Math.cos(toRad(e)), y2 = cy + r * Math.sin(toRad(e))
    return `M ${x1} ${y1} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${x2} ${y2}`
  }
  const greenEnd = startAngle + totalArc * 0.6, yellowEnd = startAngle + totalArc * 0.85
  const needleX = cx + (r - 8) * Math.cos(toRad(needleAngle))
  const needleY = cy + (r - 8) * Math.sin(toRad(needleAngle))

  return (
    <svg viewBox="0 0 100 70" className="w-full max-w-[140px] mx-auto block">
      <path d={arcPath(startAngle, endAngle)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" strokeLinecap="round" />
      <path d={arcPath(startAngle, greenEnd)} fill="none" stroke="rgba(34,197,94,0.25)" strokeWidth="5" strokeLinecap="round" />
      <path d={arcPath(greenEnd, yellowEnd)} fill="none" stroke="rgba(245,158,11,0.25)" strokeWidth="5" strokeLinecap="round" />
      <path d={arcPath(yellowEnd, endAngle)} fill="none" stroke="rgba(239,68,68,0.25)" strokeWidth="5" strokeLinecap="round" />
      <motion.path d={arcPath(startAngle, needleAngle)} fill="none" stroke={breaker.color} strokeWidth="5" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }} />
      <motion.line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="white" strokeWidth="1.5" strokeLinecap="round"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} />
      <circle cx={cx} cy={cy} r="2.5" fill="white" opacity="0.8" />
      <text x={cx} y={cy + 14} textAnchor="middle" fill="white" fontSize="7" fontFamily="monospace" fontWeight="bold">
        {fmtVal(breaker.current, breaker.unit)}
      </text>
      <text x={cx} y={cy + 21} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="4.5" fontFamily="monospace">
        / {fmtVal(breaker.threshold, breaker.unit)}
      </text>
    </svg>
  )
}

// ============ Breaker Card ============

function BreakerCard({ breaker, index }) {
  const pct = Math.min((breaker.current / breaker.threshold) * 100, 100)
  const sc = STATUS_COLORS[breaker.status]
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 + index * (0.08 * PHI), duration: 0.5, ease }}>
      <GlassCard glowColor="terminal" className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sc,
              boxShadow: breaker.status === 'tripped' ? `0 0 8px ${sc}` : 'none',
              animation: breaker.status === 'tripped' ? 'pulse 1.5s infinite' : 'none' }} />
            <h3 className="text-sm font-mono font-bold" style={{ color: breaker.color }}>{breaker.name}</h3>
          </div>
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: `${sc}10`, border: `1px solid ${sc}30`, color: sc }}>
            {breaker.status === 'cooldown' ? `cooldown ${breaker.cooldown}s` : breaker.status}
          </span>
        </div>
        <p className="text-[10px] font-mono text-black-400 mb-3 leading-relaxed">{breaker.description}</p>
        <BreakerGauge breaker={breaker} />
        <div className="mt-3 mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-mono text-black-500">Current</span>
            <span className="text-[9px] font-mono text-black-500">Threshold</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
              style={{ background: pct > 85 ? `linear-gradient(90deg, ${breaker.color}, #ef4444)` : pct > 60 ? `linear-gradient(90deg, ${breaker.color}, #f59e0b)` : breaker.color }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] font-mono font-bold" style={{ color: breaker.color }}>{fmtVal(breaker.current, breaker.unit)}</span>
            <span className="text-[10px] font-mono text-black-500">{fmtVal(breaker.threshold, breaker.unit)}</span>
          </div>
        </div>
        <div className="rounded-lg p-2 mt-2" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1">Last Trip</p>
          <p className="text-[10px] font-mono text-black-300">{breaker.lastTrip.time}</p>
          <p className="text-[10px] font-mono text-black-400">{breaker.lastTrip.cause}</p>
          <p className="text-[10px] font-mono" style={{ color: breaker.color }}>Duration: {breaker.lastTrip.duration}</p>
        </div>
      </GlassCard>
    </motion.div>
  )
}

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

// ============ Simulated Breaker Activity ============

function useSimulatedValues() {
  const [values, setValues] = useState(() => BREAKERS.map((b) => b.current))
  useEffect(() => {
    const interval = setInterval(() => {
      setValues((prev) => prev.map((val, i) => {
        const b = BREAKERS[i]
        if (b.status === 'tripped') return val
        return Math.max(0, Math.min(val + (Math.random() - 0.48) * b.threshold * 0.015, b.threshold * 0.98))
      }))
    }, 2000)
    return () => clearInterval(interval)
  }, [])
  return values
}

// ============ Main Component ============

export default function CircuitBreakerPage() {
  const simulatedValues = useSimulatedValues()
  const [isAdmin] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const breakersLive = useMemo(() =>
    BREAKERS.map((b, i) => ({ ...b, current: simulatedValues[i] })), [simulatedValues])

  const activeCount = breakersLive.filter((b) => b.status !== 'armed').length
  const tripsToday = TRIP_HISTORY.filter((t) => t.date === 'Today').length

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 19) % 100}%`, top: `${(i * PHI * 29) % 100}%` }}
            animate={{ opacity: [0, 0.25, 0], scale: [0, 1.5, 0], y: [0, -40 - (i % 3) * 15] }}
            transition={{ duration: 3.5 + (i % 3) * 1.4, repeat: Infinity, delay: (i * 0.9) % 4.5, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-2">
        {/* ============ Page Hero ============ */}
        <PageHero title="Circuit Breakers" category="system" subtitle="Automatic protection when things go wrong"
          badge={activeCount > 0 ? `${activeCount} Active` : 'All Clear'} badgeColor={activeCount > 0 ? '#ef4444' : '#22c55e'} />

        {/* ============ Stat Cards ============ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Breakers Active" value={activeCount} decimals={0} sparkSeed={42} />
          <StatCard label="Trips Today" value={tripsToday} decimals={0} sparkSeed={87} />
          <StatCard label="Avg Recovery" value={8.3} suffix=" min" decimals={1} sparkSeed={123} />
          <StatCard label="Protected TVL" value={47.2} prefix="$" suffix="M" decimals={1} sparkSeed={256} change={2.4} />
        </div>

        <div className="space-y-6">
          {/* ============ Breaker Status Grid ============ */}
          <Section index={0} title="Breaker Status" subtitle="Real-time monitoring of all five circuit breakers">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {breakersLive.map((b, i) => <BreakerCard key={b.id} breaker={b} index={i} />)}
            </div>
          </Section>

          {/* ============ Trip History Timeline ============ */}
          <Section index={1} title="Trip History" subtitle="Recent breaker activations and recovery events">
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px" style={{ background: `linear-gradient(180deg, ${CYAN}40, transparent)` }} />
              <div className="space-y-3">
                {TRIP_HISTORY.map((trip, i) => (
                  <motion.div key={`${trip.breaker}-${trip.date}`} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * (0.07 * PHI), duration: 0.4, ease }} className="flex items-start gap-3 pl-1">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 z-10"
                      style={{ background: `${trip.color}15`, border: `1.5px solid ${trip.color}50`,
                        boxShadow: trip.status === 'tripped' ? `0 0 6px ${trip.color}40` : 'none' }}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: trip.color }} />
                    </div>
                    <div className="flex-1 rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${trip.color}15` }}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono font-bold" style={{ color: trip.color }}>{trip.breaker} Breaker</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full" style={{
                          background: trip.status === 'tripped' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                          border: `1px solid ${trip.status === 'tripped' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
                          color: trip.status === 'tripped' ? '#ef4444' : '#22c55e' }}>{trip.status}</span>
                      </div>
                      <p className="text-[10px] font-mono text-black-500 mt-1">{trip.date} at {trip.time} — {trip.duration}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </Section>

          {/* ============ What Happens When a Breaker Trips ============ */}
          <Section index={2} title="When a Breaker Trips" subtitle="Step-by-step protection sequence">
            <div className="space-y-2">
              {TRIP_STEPS.map((step, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * (0.06 * PHI), duration: 0.4, ease }} className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
                    style={{ background: `${step.color}12`, border: `1px solid ${step.color}30`, color: step.color }}>{i + 1}</div>
                  <div className="flex-1 rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <h4 className="text-[11px] font-mono font-bold" style={{ color: step.color }}>{step.title}</h4>
                    <p className="text-[10px] font-mono text-black-400 mt-1 leading-relaxed">{step.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </Section>

          {/* ============ Recovery Procedures ============ */}
          <Section index={3} title="Self-Healing Recovery" subtitle="How the protocol automatically recovers after a trip">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {RECOVERY_STEPS.map((step, i) => (
                <motion.div key={step.phase} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * (0.07 * PHI), duration: 0.4, ease }}
                  className="rounded-xl p-3" style={{ background: `${CYAN}04`, border: `1px solid ${CYAN}12` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center font-mono font-bold text-xs"
                      style={{ background: `${CYAN}10`, border: `1px solid ${CYAN}25`, color: CYAN }}>{step.icon}</div>
                    <div>
                      <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Phase {i + 1}</span>
                      <h4 className="text-[11px] font-mono font-bold text-white">{step.phase}</h4>
                    </div>
                  </div>
                  <p className="text-[10px] font-mono text-black-400 leading-relaxed">{step.desc}</p>
                </motion.div>
              ))}
            </div>
          </Section>

          {/* ============ Admin Override ============ */}
          <Section index={4} title="Manual Override" subtitle="Emergency controls for protocol administrators">
            <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-mono font-bold"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>!</div>
                <h4 className="text-xs font-mono font-bold text-red-400">Emergency Pause</h4>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 ml-auto">Admin Only</span>
              </div>
              <p className="text-[10px] font-mono text-black-400 mb-3 leading-relaxed">
                Emergency pause halts ALL trading across ALL pairs immediately. Requires multi-sig governance approval (3-of-5 signers).
                Only use when automated breakers are insufficient to contain systemic risk.
              </p>
              <div className="space-y-2 mb-4">
                {[{ label: 'Pause all trading', desc: 'Reject all new commits and reveals' },
                  { label: 'Freeze withdrawals', desc: 'Lock all LP positions temporarily' },
                  { label: 'Halt bridge messages', desc: 'Stop cross-chain LayerZero sends' }].map((action) => (
                  <div key={action.label} className="flex items-center justify-between rounded-lg p-2.5"
                    style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div>
                      <p className="text-[10px] font-mono text-white font-bold">{action.label}</p>
                      <p className="text-[9px] font-mono text-black-500">{action.desc}</p>
                    </div>
                    <button disabled={!isAdmin} className="text-[9px] font-mono font-bold px-3 py-1.5 rounded-md transition-all"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                        color: 'rgba(255,255,255,0.2)', cursor: 'not-allowed' }}>Locked</button>
                  </div>
                ))}
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1.5">Multi-sig Status</p>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <div key={n} className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-mono"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.2)' }}>{n}</div>
                  ))}
                  <span className="text-[9px] font-mono text-black-500 ml-auto">0 / 3 required</span>
                </div>
              </div>
            </div>
          </Section>

          {/* ============ TradFi Comparison ============ */}
          <Section index={5} title="vs. TradFi Circuit Breakers" subtitle="How VibeSwap improves on NYSE Rule 80B and market-wide halts">
            <div className="space-y-2">
              <div className="grid grid-cols-[0.8fr_1fr_1fr] gap-2 px-2 mb-1">
                <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Feature</span>
                <span className="text-[9px] font-mono text-red-400/60 uppercase tracking-wider text-center">TradFi (NYSE)</span>
                <span className="text-[9px] font-mono uppercase tracking-wider text-center" style={{ color: `${CYAN}99` }}>VibeSwap</span>
              </div>
              {TRADFI_COMPARISON.map((row, i) => (
                <motion.div key={row.feature} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * (0.06 * PHI), duration: 0.3, ease }}
                  className="grid grid-cols-[0.8fr_1fr_1fr] gap-2 items-start rounded-lg p-3"
                  style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span className="text-[11px] font-mono text-white font-bold">{row.feature}</span>
                  <span className="text-[10px] font-mono text-red-400/80 text-center">{row.tradfi}</span>
                  <span className="text-[10px] font-mono text-center" style={{ color: `${CYAN}cc` }}>{row.vibe}</span>
                </motion.div>
              ))}
              <div className="mt-4 rounded-lg p-4" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}15` }}>
                <p className="text-[10px] font-mono text-black-400 leading-relaxed">
                  <span className="text-white font-bold">Key insight:</span> Traditional circuit breakers are blunt instruments — they
                  halt the entire market when a single threshold is breached. VibeSwap's breakers are <span style={{ color: CYAN }}>surgical</span>:
                  each metric has its own breaker, each pair can be paused independently, and recovery is automatic with gradual capacity ramp-up.
                  The protocol self-heals. No human needs to ring a bell.
                </p>
              </div>
            </div>
          </Section>
        </div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <blockquote className="max-w-md mx-auto">
            <p className="text-sm text-black-300 italic">"The best safety system is one you never notice — until the day it saves you."</p>
          </blockquote>
          <div className="w-16 h-px mx-auto my-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">Circuit Breaker Protection System</p>
        </motion.div>
      </div>
    </div>
  )
}

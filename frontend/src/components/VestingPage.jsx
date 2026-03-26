import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Mock Vesting Positions ============

const VESTING_POSITIONS = [
  {
    id: 1,
    name: 'Team Allocation',
    icon: '\u2726',
    totalAmount: 500_000,
    vestedAmount: 125_000,
    claimedAmount: 80_000,
    cliffDate: new Date('2025-06-01'),
    startDate: new Date('2025-01-01'),
    endDate: new Date('2027-01-01'),
    status: 'vesting',
    color: '#a78bfa',
    recipient: '0x1a2b...3c4d',
  },
  {
    id: 2,
    name: 'Advisor Grant',
    icon: '\u25C8',
    totalAmount: 150_000,
    vestedAmount: 75_000,
    claimedAmount: 75_000,
    cliffDate: new Date('2025-04-01'),
    startDate: new Date('2025-01-01'),
    endDate: new Date('2026-07-01'),
    status: 'vesting',
    color: '#fbbf24',
    recipient: '0x5e6f...7a8b',
  },
  {
    id: 3,
    name: 'Community Rewards',
    icon: '\u25CB',
    totalAmount: 1_000_000,
    vestedAmount: 400_000,
    claimedAmount: 350_000,
    cliffDate: new Date('2025-02-01'),
    startDate: new Date('2025-01-01'),
    endDate: new Date('2026-01-01'),
    status: 'vesting',
    color: '#34d399',
    recipient: '0x9c0d...1e2f',
  },
  {
    id: 4,
    name: 'Airdrop Vesting',
    icon: '\u2B21',
    totalAmount: 200_000,
    vestedAmount: 200_000,
    claimedAmount: 180_000,
    cliffDate: new Date('2025-01-15'),
    startDate: new Date('2025-01-01'),
    endDate: new Date('2025-07-01'),
    status: 'completed',
    color: '#627eea',
    recipient: '0x3a4b...5c6d',
  },
]

// ============ Mock Unlock Calendar Events ============

const UNLOCK_EVENTS = [
  { id: 1, date: new Date(Date.now() + 2 * 86400000), grant: 'Team Allocation', amount: 20_833, color: '#a78bfa' },
  { id: 2, date: new Date(Date.now() + 5 * 86400000), grant: 'Community Rewards', amount: 83_333, color: '#34d399' },
  { id: 3, date: new Date(Date.now() + 9 * 86400000), grant: 'Advisor Grant', amount: 8_333, color: '#fbbf24' },
  { id: 4, date: new Date(Date.now() + 14 * 86400000), grant: 'Team Allocation', amount: 20_833, color: '#a78bfa' },
  { id: 5, date: new Date(Date.now() + 21 * 86400000), grant: 'Community Rewards', amount: 83_333, color: '#34d399' },
  { id: 6, date: new Date(Date.now() + 30 * 86400000), grant: 'Advisor Grant', amount: 8_333, color: '#fbbf24' },
]

// ============ Cliff Period Options ============

const CLIFF_OPTIONS = [
  { label: 'None', days: 0 },
  { label: '1 Month', days: 30 },
  { label: '3 Months', days: 90 },
  { label: '6 Months', days: 180 },
  { label: '1 Year', days: 365 },
]

const DURATION_OPTIONS = [
  { label: '6 Months', days: 180 },
  { label: '1 Year', days: 365 },
  { label: '2 Years', days: 730 },
  { label: '3 Years', days: 1095 },
  { label: '4 Years', days: 1460 },
]

// ============ Utility Functions ============

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtShortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysUntil(d) { return Math.max(0, Math.ceil((d - Date.now()) / 86400000)) }

function daysBetween(a, b) { return Math.max(0, Math.ceil((b - a) / 86400000)) }

// ============ Section Wrapper ============

function Section({ num, title, delay = 0, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <h2 className="text-lg font-bold font-mono text-white mb-3 flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span>
        <span>{title}</span>
      </h2>
      {children}
    </motion.div>
  )
}

// ============ Vesting Timeline SVG ============

function VestingTimeline({ position }) {
  const W = 500, H = 80, PAD_L = 10, PAD_R = 10, PAD_T = 20, PAD_B = 25
  const plotW = W - PAD_L - PAD_R
  const now = Date.now()
  const totalDuration = position.endDate - position.startDate
  const cliffOffset = ((position.cliffDate - position.startDate) / totalDuration) * plotW
  const nowOffset = Math.min(plotW, Math.max(0, ((now - position.startDate) / totalDuration) * plotW))
  const progress = Math.min(1, Math.max(0, (now - position.startDate) / totalDuration))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Background track */}
      <rect x={PAD_L} y={PAD_T} width={plotW} height={16} rx={4} fill="#1f2937" />

      {/* Cliff zone */}
      {cliffOffset > 0 && (
        <rect x={PAD_L} y={PAD_T} width={cliffOffset} height={16} rx={4}
          fill="rgba(239,68,68,0.15)" />
      )}

      {/* Cliff marker */}
      {cliffOffset > 0 && (
        <>
          <line x1={PAD_L + cliffOffset} y1={PAD_T - 4} x2={PAD_L + cliffOffset} y2={PAD_T + 20}
            stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3,2" />
          <text x={PAD_L + cliffOffset} y={PAD_T - 7} fill="#ef4444" fontSize="7"
            fontFamily="monospace" textAnchor="middle">Cliff</text>
        </>
      )}

      {/* Vested portion */}
      <motion.rect x={PAD_L} y={PAD_T} height={16} rx={4}
        style={{ fill: position.color }}
        initial={{ width: 0 }}
        animate={{ width: nowOffset }}
        transition={{ duration: PHI, ease: 'easeOut' }} />

      {/* Shimmer on vested portion */}
      {progress > 0.05 && (
        <motion.rect x={PAD_L} y={PAD_T} height={16} rx={4}
          style={{ fill: 'url(#shimmer)' }}
          initial={{ width: 0 }}
          animate={{ width: nowOffset }}
          transition={{ duration: PHI, ease: 'easeOut' }} />
      )}

      {/* Now marker */}
      <motion.line x1={PAD_L + nowOffset} y1={PAD_T - 2} x2={PAD_L + nowOffset} y2={PAD_T + 18}
        stroke={CYAN} strokeWidth="2"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} />
      <motion.text x={PAD_L + nowOffset} y={PAD_T + 30} fill={CYAN} fontSize="7"
        fontFamily="monospace" textAnchor="middle"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
        Now
      </motion.text>

      {/* Date labels */}
      <text x={PAD_L} y={H - 4} fill="#6b7280" fontSize="7" fontFamily="monospace">
        {fmtShortDate(position.startDate)}
      </text>
      <text x={W - PAD_R} y={H - 4} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="end">
        {fmtShortDate(position.endDate)}
      </text>

      {/* Progress percentage */}
      <text x={W / 2} y={PAD_T + 12} fill="white" fontSize="9" fontFamily="monospace"
        textAnchor="middle" fontWeight="bold">
        {(progress * 100).toFixed(1)}% vested
      </text>

      <defs>
        <linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.12)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ============ Create Vesting Preview Curve ============

function VestingPreviewCurve({ cliffDays, durationDays, amount }) {
  const W = 300, H = 90, PAD_L = 35, PAD_R = 10, PAD_T = 10, PAD_B = 22
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const total = parseFloat(amount) || 0
  if (total <= 0 || durationDays <= 0) return null

  const cliffPct = cliffDays / durationDays
  const pts = Array.from({ length: 50 }, (_, i) => {
    const t = i / 49
    let vested = 0
    if (t >= cliffPct) {
      vested = ((t - cliffPct) / (1 - cliffPct)) * total
    }
    return {
      x: PAD_L + t * plotW,
      y: PAD_T + plotH - (vested / total) * plotH,
    }
  })
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-3" preserveAspectRatio="xMidYMid meet">
      {[0, 1, 2, 3].map(i => {
        const y = PAD_T + (i / 3) * plotH
        const val = fmt(total - (i / 3) * total)
        return (
          <g key={i}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#1f2937" strokeWidth="0.5" />
            <text x={PAD_L - 4} y={y + 3} fill="#6b7280" fontSize="6" fontFamily="monospace"
              textAnchor="end">{val}</text>
          </g>
        )
      })}
      <motion.path d={linePath} fill="none" stroke={CYAN} strokeWidth="1.5" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: PHI, ease: 'easeOut' }} />
      {cliffPct > 0 && (
        <line x1={PAD_L + cliffPct * plotW} y1={PAD_T} x2={PAD_L + cliffPct * plotW} y2={PAD_T + plotH}
          stroke="#ef4444" strokeWidth="1" strokeDasharray="3,2" />
      )}
      <text x={PAD_L} y={H - 2} fill="#6b7280" fontSize="6" fontFamily="monospace">Start</text>
      <text x={W - PAD_R} y={H - 2} fill="#6b7280" fontSize="6" fontFamily="monospace"
        textAnchor="end">{durationDays}d</text>
      {cliffPct > 0 && (
        <text x={PAD_L + cliffPct * plotW} y={H - 2} fill="#ef4444" fontSize="6"
          fontFamily="monospace" textAnchor="middle">Cliff</text>
      )}
    </svg>
  )
}

// ============ Main Component ============

export default function VestingPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ============ Create Vesting Form State ============
  const [createRecipient, setCreateRecipient] = useState('')
  const [createAmount, setCreateAmount] = useState('')
  const [createCliff, setCreateCliff] = useState(2)
  const [createDuration, setCreateDuration] = useState(2)
  const [selectedPosition, setSelectedPosition] = useState(0)

  // ============ Computed Stats ============

  const stats = useMemo(() => {
    const totalVesting = VESTING_POSITIONS.reduce((s, p) => s + p.totalAmount, 0)
    const totalVested = VESTING_POSITIONS.reduce((s, p) => s + p.vestedAmount, 0)
    const totalClaimed = VESTING_POSITIONS.reduce((s, p) => s + p.claimedAmount, 0)
    const claimable = totalVested - totalClaimed
    const nextUnlock = UNLOCK_EVENTS.length > 0 ? UNLOCK_EVENTS[0] : null
    return { totalVesting, totalVested, totalClaimed, claimable, nextUnlock }
  }, [])

  const createPreview = useMemo(() => {
    const cliff = CLIFF_OPTIONS[createCliff]
    const duration = DURATION_OPTIONS[createDuration]
    const amount = parseFloat(createAmount) || 0
    const startDate = new Date()
    const cliffDate = new Date(Date.now() + cliff.days * 86400000)
    const endDate = new Date(Date.now() + duration.days * 86400000)
    return { cliff, duration, amount, startDate, cliffDate, endDate }
  }, [createCliff, createDuration, createAmount])

  // ============ Not Connected ============

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard glowColor="terminal" className="max-w-md mx-auto p-8 text-center">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}40` }}>
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">
              Token <span style={{ color: CYAN }}>Vesting</span>
            </h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">
              Track your vesting schedules, claim unlocked tokens, and create new vesting contracts.
            </p>
            <button onClick={connect} className="px-8 py-3 rounded-xl font-mono font-bold text-sm"
              style={{ background: CYAN, color: '#000', boxShadow: `0 0 20px ${CYAN}40` }}>
              Sign In
            </button>
          </motion.div>
        </GlassCard>
      </div>
    )
  }

  // ============ Connected ============

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">

      {/* ============ Page Hero ============ */}
      <PageHero
        title="Token Vesting"
        subtitle="Track your vesting schedules, cliff periods, and upcoming token unlocks"
        category="account"
      />

      {/* ============ 1. Overview Stats ============ */}
      <Section num="01" title="Vesting Overview" delay={0.05}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Vesting', value: `${fmt(stats.totalVesting)} JUL` },
            { label: 'Unlocked So Far', value: `${fmt(stats.totalVested)} JUL` },
            { label: 'Next Unlock', value: stats.nextUnlock ? `${daysUntil(stats.nextUnlock.date)}d` : '--' },
            { label: 'Claimable Now', value: `${fmt(stats.claimable)} JUL` },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * (0.06 / PHI) }}>
              <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                <div className="text-xl sm:text-2xl font-bold font-mono text-white">{s.value}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{s.label}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 2. Vesting Schedule Visualization ============ */}
      <Section num="02" title="Vesting Schedule" delay={0.05 + 0.07 / PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {VESTING_POSITIONS.map((pos, i) => (
              <button key={pos.id} onClick={() => setSelectedPosition(i)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold whitespace-nowrap transition-all"
                style={{
                  background: selectedPosition === i ? `${CYAN}20` : 'rgba(0,0,0,0.3)',
                  color: selectedPosition === i ? CYAN : '#6b7280',
                  border: `1px solid ${selectedPosition === i ? `${CYAN}40` : '#374151'}`,
                }}>
                {pos.icon} {pos.name}
              </button>
            ))}
          </div>

          <VestingTimeline position={VESTING_POSITIONS[selectedPosition]} />

          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { label: 'Total Grant', value: fmt(VESTING_POSITIONS[selectedPosition].totalAmount), suffix: 'JUL' },
              { label: 'Vested', value: fmt(VESTING_POSITIONS[selectedPosition].vestedAmount), suffix: 'JUL', cy: true },
              { label: 'Cliff Date', value: fmtShortDate(VESTING_POSITIONS[selectedPosition].cliffDate), suffix: '' },
              { label: 'End Date', value: fmtShortDate(VESTING_POSITIONS[selectedPosition].endDate), suffix: '' },
            ].map((item) => (
              <div key={item.label} className="p-3 rounded-xl border text-center"
                style={{ background: 'rgba(0,0,0,0.3)', borderColor: item.cy ? `${CYAN}20` : '#1f2937' }}>
                <div className="text-base sm:text-lg font-mono font-bold" style={item.cy ? { color: CYAN } : { color: 'white' }}>
                  {item.value}
                </div>
                {item.suffix && <div className="text-[10px] font-mono text-gray-500 mt-0.5">{item.suffix}</div>}
                <div className="text-[10px] font-mono text-gray-600">{item.label}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 3. Active Vesting Positions ============ */}
      <Section num="03" title="Active Vesting Positions" delay={0.18}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-7 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Grant</div>
            <div>Total</div>
            <div>Vested</div>
            <div>Cliff</div>
            <div>End Date</div>
            <div>Status</div>
            <div>Progress</div>
          </div>
          {VESTING_POSITIONS.map((pos, i) => {
            const progress = pos.vestedAmount / pos.totalAmount
            const isComplete = pos.status === 'completed'
            return (
              <motion.div key={pos.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * (0.04 * PHI) }}
                className="grid grid-cols-2 sm:grid-cols-7 gap-2 px-5 py-3 border-b border-gray-800/50 items-center hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-lg" style={{ color: pos.color }}>{pos.icon}</span>
                  <div>
                    <div className="font-mono text-sm text-white font-bold">{pos.name}</div>
                    <div className="text-[10px] font-mono text-gray-600">{pos.recipient}</div>
                  </div>
                </div>
                <div className="font-mono text-sm text-gray-300">{fmt(pos.totalAmount)}</div>
                <div className="font-mono text-sm" style={{ color: CYAN }}>{fmt(pos.vestedAmount)}</div>
                <div className="font-mono text-sm text-gray-400">{fmtShortDate(pos.cliffDate)}</div>
                <div className="font-mono text-sm text-gray-400">{fmtShortDate(pos.endDate)}</div>
                <div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold"
                    style={{
                      background: isComplete ? '#34d39920' : `${CYAN}20`,
                      color: isComplete ? '#34d399' : CYAN,
                    }}>
                    {isComplete ? 'Completed' : 'Vesting'}
                  </span>
                </div>
                <div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full rounded-full"
                      style={{ background: isComplete ? '#34d399' : pos.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${progress * 100}%` }}
                      transition={{ duration: PHI, ease: 'easeOut' }} />
                  </div>
                  <div className="text-[10px] font-mono text-gray-600 mt-0.5">
                    {(progress * 100).toFixed(0)}%
                  </div>
                </div>
              </motion.div>
            )
          })}
          <div className="px-5 py-3 flex items-center justify-between border-t border-gray-800">
            <span className="text-[10px] font-mono text-gray-500">
              Total across {VESTING_POSITIONS.length} grants:{' '}
              <span className="text-white font-bold">{fmt(stats.totalVesting)} JUL</span>
            </span>
            <span className="text-[10px] font-mono text-gray-600">
              Unlocked: <span style={{ color: CYAN }}>{((stats.totalVested / stats.totalVesting) * 100).toFixed(1)}%</span>
            </span>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 4. Unlock Calendar ============ */}
      <Section num="04" title="Unlock Calendar" delay={0.22}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="text-[10px] font-mono text-gray-500 mb-4">Next 6 upcoming unlock events</div>
          <div className="space-y-3">
            {UNLOCK_EVENTS.map((event, i) => {
              const days = daysUntil(event.date)
              const isImminent = days <= 3
              return (
                <motion.div key={event.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.24 + i * (0.04 * PHI) }}
                  className="flex items-center gap-4 p-3 rounded-xl border"
                  style={{
                    background: isImminent ? `${CYAN}06` : 'rgba(0,0,0,0.2)',
                    borderColor: isImminent ? `${CYAN}20` : '#1f2937',
                  }}>
                  {/* Date badge */}
                  <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0"
                    style={{ background: `${event.color}15`, border: `1px solid ${event.color}30` }}>
                    <div className="text-xs font-mono font-bold text-white">
                      {event.date.toLocaleDateString('en-US', { month: 'short' })}
                    </div>
                    <div className="text-lg font-mono font-bold" style={{ color: event.color }}>
                      {event.date.getDate()}
                    </div>
                  </div>
                  {/* Event details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-white font-bold">{event.grant}</span>
                      {isImminent && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold"
                          style={{ background: `${CYAN}20`, color: CYAN }}>Soon</span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-gray-500 mt-0.5">
                      {fmtDate(event.date)} ({days === 0 ? 'Today' : `in ${days} day${days !== 1 ? 's' : ''}`})
                    </div>
                  </div>
                  {/* Amount */}
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm font-bold" style={{ color: event.color }}>
                      +{fmt(event.amount)}
                    </div>
                    <div className="text-[10px] font-mono text-gray-600">JUL</div>
                  </div>
                </motion.div>
              )
            })}
          </div>
          <div className="mt-3 text-center text-[10px] font-mono text-gray-600">
            Total upcoming unlocks: <span style={{ color: CYAN }}>
              {fmt(UNLOCK_EVENTS.reduce((s, e) => s + e.amount, 0))} JUL
            </span> over the next {daysUntil(UNLOCK_EVENTS[UNLOCK_EVENTS.length - 1].date)} days
          </div>
        </GlassCard>
      </Section>

      {/* ============ 5. Claim Section ============ */}
      <Section num="05" title="Claim Unlocked Tokens" delay={0.26}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Left: Claimable summary */}
            <div>
              <div className="flex items-center gap-4 mb-4">
                <div className="relative w-24 h-24 shrink-0">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#1f2937" strokeWidth="8" />
                    <motion.circle cx="50" cy="50" r="40" fill="none" stroke={CYAN} strokeWidth="8"
                      strokeLinecap="round" strokeDasharray={2 * Math.PI * 40}
                      initial={{ strokeDashoffset: 2 * Math.PI * 40 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 40 * (1 - stats.claimable / stats.totalVested) }}
                      transition={{ duration: PHI, ease: 'easeOut' }}
                      style={{ filter: `drop-shadow(0 0 6px ${CYAN}60)` }} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-sm font-mono font-bold text-white">{fmt(stats.claimable)}</div>
                    <div className="text-[8px] font-mono text-gray-500">claimable</div>
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xs text-gray-400">Available to Claim</div>
                  <div className="font-mono text-2xl font-bold" style={{ color: CYAN }}>{fmt(stats.claimable)} JUL</div>
                  <div className="font-mono text-[10px] text-gray-500 mt-1">
                    {fmt(stats.totalClaimed)} already claimed of {fmt(stats.totalVested)} vested
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg border text-center" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                  <div className="font-mono text-xs text-gray-400">Total Claimed</div>
                  <div className="font-mono text-sm font-bold text-white">{fmt(stats.totalClaimed)}</div>
                </div>
                <div className="p-2 rounded-lg border text-center" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                  <div className="font-mono text-xs text-gray-400">Still Locked</div>
                  <div className="font-mono text-sm font-bold text-gray-300">{fmt(stats.totalVesting - stats.totalVested)}</div>
                </div>
              </div>
            </div>

            {/* Right: Claim action */}
            <div>
              <div className="p-4 rounded-xl border mb-3" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                <div className="text-xs font-mono text-gray-400 mb-2">Destination Address</div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg border"
                  style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#374151' }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: `${CYAN}20` }}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                    </svg>
                  </div>
                  <span className="font-mono text-xs text-gray-400 truncate">0x1a2b...3c4d (Connected Wallet)</span>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {VESTING_POSITIONS.filter(p => p.vestedAmount - p.claimedAmount > 0).map((pos) => {
                  const claimable = pos.vestedAmount - pos.claimedAmount
                  return (
                    <div key={pos.id} className="flex items-center justify-between p-2 rounded-lg border"
                      style={{ background: 'rgba(0,0,0,0.15)', borderColor: '#1f293780' }}>
                      <div className="flex items-center gap-2">
                        <span style={{ color: pos.color }}>{pos.icon}</span>
                        <span className="font-mono text-xs text-gray-300">{pos.name}</span>
                      </div>
                      <span className="font-mono text-xs font-bold" style={{ color: pos.color }}>{fmt(claimable)}</span>
                    </div>
                  )
                })}
              </div>

              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                className="w-full py-3 rounded-xl font-mono font-bold text-sm"
                style={{
                  background: stats.claimable > 0 ? CYAN : '#374151',
                  color: stats.claimable > 0 ? '#000' : '#6b7280',
                  boxShadow: stats.claimable > 0 ? `0 0 20px ${CYAN}30` : 'none',
                }}>
                Claim {fmt(stats.claimable)} JUL
              </motion.button>
              <div className="text-center text-[10px] font-mono text-gray-600 mt-2">
                Gas estimate: ~0.003 ETH
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 6. Vesting Breakdown by Grant ============ */}
      <Section num="06" title="Vesting Breakdown" delay={0.30}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="space-y-4">
            {VESTING_POSITIONS.map((pos) => {
              const vestedPct = (pos.vestedAmount / pos.totalAmount) * 100
              const claimedPct = (pos.claimedAmount / pos.totalAmount) * 100
              const lockedPct = 100 - vestedPct
              return (
                <div key={pos.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span style={{ color: pos.color }}>{pos.icon}</span>
                      <span className="font-mono text-xs font-bold text-white">{pos.name}</span>
                    </div>
                    <span className="font-mono text-[10px] text-gray-500">
                      {fmt(pos.vestedAmount)} / {fmt(pos.totalAmount)} JUL
                    </span>
                  </div>
                  {/* Stacked progress: claimed | claimable | locked */}
                  <div className="h-3 rounded-full overflow-hidden flex" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full"
                      style={{ background: '#34d399' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${claimedPct}%` }}
                      transition={{ duration: PHI, ease: 'easeOut' }} />
                    <motion.div className="h-full"
                      style={{ background: pos.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${vestedPct - claimedPct}%` }}
                      transition={{ duration: PHI, ease: 'easeOut', delay: 0.1 }} />
                  </div>
                  <div className="flex items-center gap-4 mt-1">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm" style={{ background: '#34d399' }} />
                      <span className="text-[9px] font-mono text-gray-500">Claimed {claimedPct.toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm" style={{ background: pos.color }} />
                      <span className="text-[9px] font-mono text-gray-500">Claimable {(vestedPct - claimedPct).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-sm" style={{ background: '#1f2937' }} />
                      <span className="text-[9px] font-mono text-gray-500">Locked {lockedPct.toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 7. Create Vesting Schedule ============ */}
      <Section num="07" title="Create Vesting Schedule" delay={0.34}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="text-[10px] font-mono text-gray-500 mb-4">
            Create a new vesting contract for token distribution. Only available to token creators and DAO administrators.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Left: Form inputs */}
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-mono text-gray-500 block mb-1">Recipient Address</label>
                <input type="text" value={createRecipient}
                  onChange={(e) => setCreateRecipient(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none"
                  style={{ borderColor: createRecipient ? `${CYAN}60` : undefined }} />
              </div>
              <div>
                <label className="text-[10px] font-mono text-gray-500 block mb-1">Total Amount (JUL)</label>
                <input type="number" value={createAmount}
                  onChange={(e) => setCreateAmount(e.target.value)}
                  placeholder="100000"
                  className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none"
                  style={{ borderColor: createAmount ? `${CYAN}60` : undefined }} />
              </div>
              <div>
                <label className="text-[10px] font-mono text-gray-500 block mb-1">
                  Cliff Period: <span style={{ color: CYAN }}>{CLIFF_OPTIONS[createCliff].label}</span>
                </label>
                <input type="range" min={0} max={CLIFF_OPTIONS.length - 1} value={createCliff}
                  onChange={(e) => setCreateCliff(Number(e.target.value))}
                  className="w-full mt-1 accent-cyan-500" />
                <div className="flex justify-between text-[9px] font-mono text-gray-600 mt-1">
                  {CLIFF_OPTIONS.map(c => <span key={c.label}>{c.label}</span>)}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-gray-500 block mb-1">
                  Vesting Duration: <span style={{ color: CYAN }}>{DURATION_OPTIONS[createDuration].label}</span>
                </label>
                <input type="range" min={0} max={DURATION_OPTIONS.length - 1} value={createDuration}
                  onChange={(e) => setCreateDuration(Number(e.target.value))}
                  className="w-full mt-1 accent-cyan-500" />
                <div className="flex justify-between text-[9px] font-mono text-gray-600 mt-1">
                  {DURATION_OPTIONS.map(d => <span key={d.label}>{d.label}</span>)}
                </div>
              </div>
            </div>

            {/* Right: Preview */}
            <div>
              <div className="text-[10px] font-mono text-gray-500 mb-2">Vesting Preview</div>
              <VestingPreviewCurve
                cliffDays={CLIFF_OPTIONS[createCliff].days}
                durationDays={DURATION_OPTIONS[createDuration].days}
                amount={createAmount || '100000'}
              />
              <div className="grid grid-cols-2 gap-2 mt-3">
                {[
                  { l: 'Cliff Ends', v: fmtShortDate(createPreview.cliffDate) },
                  { l: 'Fully Vested', v: fmtShortDate(createPreview.endDate) },
                  { l: 'Monthly Unlock', v: createPreview.amount > 0
                    ? fmt(createPreview.amount / (DURATION_OPTIONS[createDuration].days / 30))
                    : '--', cy: true },
                  { l: 'Vesting Type', v: 'Linear' },
                ].map((x) => (
                  <div key={x.l} className="p-2 rounded-xl border text-center"
                    style={{ background: 'rgba(0,0,0,0.3)', borderColor: x.cy ? `${CYAN}20` : '#1f2937' }}>
                    <div className="text-[9px] font-mono text-gray-500">{x.l}</div>
                    <div className="text-xs font-mono font-bold"
                      style={x.cy ? { color: CYAN } : { color: 'white' }}>{x.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            disabled={!createRecipient || !createAmount || parseFloat(createAmount) <= 0}
            className="w-full mt-4 py-3 rounded-xl font-mono font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: createRecipient && createAmount && parseFloat(createAmount) > 0 ? CYAN : '#374151',
              color: createRecipient && createAmount && parseFloat(createAmount) > 0 ? '#000' : '#6b7280',
              boxShadow: createRecipient && createAmount && parseFloat(createAmount) > 0 ? `0 0 20px ${CYAN}30` : 'none',
            }}>
            Create Vesting Schedule
          </motion.button>
          <div className="text-center text-[10px] font-mono text-gray-600 mt-2">
            Tokens will be locked in a smart contract and released linearly after the cliff period
          </div>
        </GlassCard>
      </Section>

      {/* ============ 8. How Vesting Works ============ */}
      <Section num="08" title="How Vesting Works" delay={0.38}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[
              { step: '1', title: 'Grant Created', desc: 'Tokens are locked in a vesting contract with defined cliff and duration parameters. No tokens are accessible yet.', color: '#a78bfa' },
              { step: '2', title: 'Cliff Period', desc: 'A mandatory waiting period before any tokens unlock. If the recipient leaves early, unvested tokens return to the DAO.', color: '#ef4444' },
              { step: '3', title: 'Linear Vesting', desc: 'After the cliff, tokens unlock continuously on a linear schedule. Each second, more tokens become claimable.', color: CYAN },
              { step: '4', title: 'Claim Tokens', desc: 'Recipients can claim unlocked tokens at any time. Unclaimed tokens continue accumulating until the vesting end date.', color: '#34d399' },
            ].map((item) => (
              <motion.div key={item.step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.40 + parseInt(item.step) * (0.04 * PHI) }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center mb-2 font-mono font-bold text-sm"
                  style={{ background: `${item.color}20`, color: item.color, border: `1px solid ${item.color}30` }}>
                  {item.step}
                </div>
                <div className="font-mono text-sm text-white font-bold mb-1">{item.title}</div>
                <div className="font-mono text-[10px] text-gray-500 leading-relaxed">{item.desc}</div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 9. Vesting Parameters ============ */}
      <Section num="09" title="Protocol Vesting Parameters" delay={0.42}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: 'Revocability', value: 'DAO Vote', desc: 'Vesting schedules can only be revoked through a governance vote with 67% quorum. Protects recipients from unilateral revocation.', pct: 67 },
              { title: 'Acceleration Clause', value: 'On Acquisition', desc: 'If VibeSwap is acquired or merged, vesting accelerates by 50%. Ensures contributors are rewarded for value created.', pct: 50 },
              { title: 'Slashing Protection', value: '90% Safe', desc: 'Insurance pool covers up to 90% of vested tokens in case of a smart contract exploit. Audited by three firms.', pct: 90 },
            ].map((item) => (
              <div key={item.title}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-sm text-white font-bold">{item.title}</span>
                  <span className="font-mono text-sm font-bold" style={{ color: CYAN }}>{item.value}</span>
                </div>
                <div className="font-mono text-[10px] text-gray-500 leading-relaxed mb-2">{item.desc}</div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                  <motion.div className="h-full rounded-full"
                    style={{ background: item.pct >= 70 ? '#34d399' : item.pct >= 40 ? '#fbbf24' : '#f87171' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${item.pct}%` }}
                    transition={{ duration: 1.2, ease: 'easeOut' }} />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 10. Cooperative Vesting Philosophy ============ */}
      <Section num="10" title="Cooperative Vesting" delay={0.46}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { side: 'Recipient Benefits', color: CYAN, items: [
                { label: 'Guaranteed Allocation', desc: 'Smart contract enforced', pct: 100 },
                { label: 'Continuous Unlocks', desc: 'No large cliff dumps', pct: 85 },
                { label: 'Slashing Insurance', desc: 'Protocol covers exploits', pct: 90 },
              ]},
              { side: 'Protocol Benefits', color: '#34d399', items: [
                { label: 'Aligned Incentives', desc: 'Long-term commitment', pct: 95 },
                { label: 'Reduced Sell Pressure', desc: 'Gradual distribution', pct: 88 },
                { label: 'Governance Stability', desc: 'Steady token distribution', pct: 82 },
              ]},
            ].map((col) => (
              <div key={col.side}>
                <div className="font-mono text-sm text-white font-bold mb-2">{col.side}</div>
                <div className="space-y-2">
                  {col.items.map((item) => (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-mono text-[10px] text-gray-300">{item.label}</span>
                        <span className="font-mono text-[9px] text-gray-600">{item.desc}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                        <motion.div className="h-full rounded-full" style={{ background: col.color }}
                          initial={{ width: 0 }} animate={{ width: `${item.pct}%` }}
                          transition={{ duration: 1, ease: 'easeOut' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-xl border text-center" style={{ background: `${CYAN}06`, borderColor: `${CYAN}15` }}>
            <div className="font-mono text-xs text-gray-300 leading-relaxed">
              Vesting aligns individual contributor incentives with long-term protocol health.
              Smart contract enforcement ensures trustless token distribution without centralized custody.{' '}
              <span style={{ color: CYAN }}>Fair distribution is a protocol guarantee.</span>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* Bottom Spacer */}
      <div style={{ height: PHI * 24 }} />
    </div>
  )
}

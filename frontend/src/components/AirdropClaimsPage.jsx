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
const FADE = 1 / (PHI * PHI)
const STAGGER = 1 / (PHI * PHI * PHI * PHI)

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Mock Data ============

const CLAIMABLE_AIRDROPS = [
  { id: 1, protocol: 'VibeSwap',   token: 'VIBE',  amount: 4250,   usdValue: 8925,   expiry: new Date(Date.now() + 14 * 864e5), reason: 'Early adopter allocation',       logo: 'V', color: '#22c55e' },
  { id: 2, protocol: 'LayerZero',  token: 'ZRO',   amount: 312.5,  usdValue: 1562.5, expiry: new Date(Date.now() + 30 * 864e5), reason: 'Cross-chain messaging usage',    logo: 'L', color: '#6366f1' },
  { id: 3, protocol: 'Arbitrum',   token: 'ARB',   amount: 1875,   usdValue: 2250,   expiry: new Date(Date.now() +  7 * 864e5), reason: 'STIP retroactive distribution',  logo: 'A', color: '#3b82f6' },
  { id: 4, protocol: 'Optimism',   token: 'OP',    amount: 640,    usdValue: 1408,   expiry: new Date(Date.now() + 60 * 864e5), reason: 'RetroPGF round 5 allocation',    logo: 'O', color: '#ef4444' },
  { id: 5, protocol: 'Eigenlayer', token: 'EIGEN', amount: 125,    usdValue: 487.5,  expiry: new Date(Date.now() + 21 * 864e5), reason: 'Restaking season 3 rewards',     logo: 'E', color: '#a855f7' },
]

const UPCOMING_AIRDROPS = [
  { id: 1, protocol: 'Monad',     status: 'confirmed',   estDate: new Date(Date.now() + 45 * 864e5),  requirements: ['Bridge to Monad testnet', '10+ transactions', 'Hold NFT badge'],              eligibility: 85, color: '#a855f7' },
  { id: 2, protocol: 'Berachain', status: 'confirmed',   estDate: new Date(Date.now() + 30 * 864e5),  requirements: ['Provide liquidity on BEX', 'Delegate BGT', 'Governance participation'],       eligibility: 62, color: '#f59e0b' },
  { id: 3, protocol: 'Scroll',    status: 'speculative', estDate: new Date(Date.now() + 90 * 864e5),  requirements: ['Bridge to Scroll', 'Use 3+ dApps', 'Hold position 30+ days'],                eligibility: 40, color: '#f97316' },
  { id: 4, protocol: 'zkSync Era',status: 'speculative', estDate: new Date(Date.now() + 120 * 864e5), requirements: ['Volume >$10k', 'Unique contracts >20', 'Active 6+ months'],                   eligibility: 71, color: '#6366f1' },
  { id: 5, protocol: 'StarkNet',  status: 'speculative', estDate: new Date(Date.now() + 75 * 864e5),  requirements: ['Deploy account', 'Use bridges', 'Interact with ecosystem dApps'],             eligibility: 55, color: '#0ea5e9' },
]

const ELIGIBILITY_PROTOCOLS = [
  { name: 'VibeSwap',   criteria: 'Trade volume > $1,000',       status: 'eligible',   token: 'VIBE'  },
  { name: 'LayerZero',  criteria: 'Cross-chain messages > 5',    status: 'eligible',   token: 'ZRO'   },
  { name: 'Arbitrum',   criteria: 'Bridge + 10 txns',            status: 'eligible',   token: 'ARB'   },
  { name: 'Optimism',   criteria: 'Governance participation',    status: 'partial',    token: 'OP'    },
  { name: 'Eigenlayer', criteria: 'Restake > 1 ETH for 90+ d',  status: 'partial',    token: 'EIGEN' },
  { name: 'Monad',      criteria: 'Testnet activity + NFT',      status: 'ineligible', token: 'MON'   },
  { name: 'Scroll',     criteria: 'Bridge + 3 dApps',            status: 'ineligible', token: 'SCR'   },
  { name: 'Berachain',  criteria: 'Provide liquidity on BEX',    status: 'partial',    token: 'BERA'  },
]

function generateClaimHistory(seed, count = 12) {
  const rng = seededRandom(seed)
  const protos = ['VibeSwap', 'Arbitrum', 'Optimism', 'Uniswap', 'Aave', 'LayerZero']
  const tokens = ['VIBE', 'ARB', 'OP', 'UNI', 'AAVE', 'ZRO']
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    id: count - i,
    date: new Date(now - (i + 1) * 864e5 * (3 + rng() * 12)),
    protocol: protos[Math.floor(rng() * protos.length)],
    token: tokens[Math.floor(rng() * tokens.length)],
    amount: 50 + rng() * 5000,
    usdValue: 100 + rng() * 12000,
    txHash: '0x' + Array.from({ length: 16 }, () => Math.floor(rng() * 16).toString(16)).join('') + '...',
  }))
}

function generateCalendarEvents() {
  const now = new Date()
  const m = now.getMonth()
  const y = now.getFullYear()
  return [
    { day: 3,  label: 'ARB Season 2',       type: 'snapshot', color: '#3b82f6' },
    { day: 7,  label: 'VIBE Early Adopter',  type: 'claim',    color: '#22c55e' },
    { day: 12, label: 'OP RetroPGF R5',      type: 'snapshot', color: '#ef4444' },
    { day: 15, label: 'ZRO Distribution',     type: 'claim',    color: '#6366f1' },
    { day: 18, label: 'Monad Testnet End',    type: 'deadline', color: '#a855f7' },
    { day: 22, label: 'EIGEN S3 Claim',       type: 'claim',    color: '#a855f7' },
    { day: 25, label: 'Scroll Snapshot',      type: 'snapshot', color: '#f97316' },
    { day: 28, label: 'Berachain TGE',        type: 'claim',    color: '#f59e0b' },
  ].map(e => ({ ...e, date: new Date(y, m, e.day) }))
}

// ============ Utilities ============

function daysUntil(d) {
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 864e5))
}

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtUsd(n) {
  return '$' + n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtShortDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ============ Sub-Components ============

function SectionHeader({ tag, title, delay = 0 }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }} transition={{ delay, duration: FADE }} className="mb-4">
      <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: `${CYAN}b3` }}>{tag}</span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
    </motion.div>
  )
}

function ClaimBtn({ onClick, claiming, label = 'Claim' }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={claiming}
      className="px-4 py-1.5 rounded-lg font-mono text-xs font-bold transition-all disabled:opacity-50"
      style={{
        backgroundColor: 'rgba(245,158,11,0.15)',
        border: '1px solid rgba(245,158,11,0.3)',
        color: '#f59e0b',
      }}
      whileHover={{ scale: 1.05, backgroundColor: 'rgba(245,158,11,0.25)' }}
      whileTap={{ scale: 0.95 }}
    >
      {claiming ? 'Claiming...' : label}
    </motion.button>
  )
}

function ClaimAllButton({ totalUsd, onClaim, claiming, count }) {
  return (
    <motion.button
      onClick={onClaim}
      disabled={claiming || count === 0}
      className="relative w-full py-4 rounded-2xl font-bold font-mono text-lg overflow-hidden disabled:opacity-50 transition-all"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Gradient background — amber to cyan for the cooperative capitalism vibe */}
      <div className="absolute inset-0 bg-gradient-to-r from-amber-600 via-amber-500 to-cyan-500" />

      {/* Animated shine sweep */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
        animate={{ x: ['-100%', '200%'] }}
        transition={{ repeat: Infinity, duration: 3 * PHI, ease: 'linear' }}
        style={{ width: '50%' }}
      />

      {/* Pulsing border ring when claimable */}
      {count > 0 && !claiming && (
        <motion.div
          className="absolute inset-0 rounded-2xl border-2 border-amber-400/40"
          animate={{ scale: [1, 1.04, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ repeat: Infinity, duration: 2 / PHI, ease: 'easeInOut' }}
        />
      )}

      <span className="relative z-10 text-black drop-shadow-sm">
        {claiming ? 'Claiming All...' : `Claim All ${count} Airdrops (${fmtUsd(totalUsd)})`}
      </span>
    </motion.button>
  )
}

function EligibilityBadge({ status }) {
  const configs = {
    eligible: {
      text: 'Eligible',
      color: '#22c55e',
      bg: 'rgba(34,197,94,0.12)',
      border: 'rgba(34,197,94,0.3)',
    },
    partial: {
      text: 'Partial',
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(245,158,11,0.3)',
    },
    ineligible: {
      text: 'Not Eligible',
      color: '#6b7280',
      bg: 'rgba(107,114,128,0.12)',
      border: 'rgba(107,114,128,0.3)',
    },
  }
  const cfg = configs[status] || configs.ineligible

  return (
    <span
      className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full"
      style={{
        color: cfg.color,
        backgroundColor: cfg.bg,
        border: `1px solid ${cfg.border}`,
      }}
    >
      {cfg.text}
    </span>
  )
}

function CalTypeBadge({ type }) {
  const configs = {
    snapshot: { text: 'Snapshot', color: '#3b82f6' },
    claim:    { text: 'Claim',    color: '#22c55e' },
    deadline: { text: 'Deadline', color: '#ef4444' },
  }
  const cfg = configs[type] || configs.snapshot

  return (
    <span
      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
      style={{ color: cfg.color, backgroundColor: `${cfg.color}20` }}
    >
      {cfg.text}
    </span>
  )
}

// ============ Calendar Grid ============

function AirdropCalendar({ events }) {
  const now = new Date()
  const year = now.getFullYear(), month = now.getMonth(), today = now.getDate()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const monthName = new Date(year, month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const eventsByDay = useMemo(() => {
    const m = {}
    events.forEach(e => { if (!m[e.day]) m[e.day] = []; m[e.day].push(e) })
    return m
  }, [events])

  // Build calendar cells
  const cells = []

  // Leading empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} className="h-16 sm:h-20" />)
  }

  // Day cells with event indicators
  for (let d = 1; d <= daysInMonth; d++) {
    const dayEvents = eventsByDay[d] || []
    const isToday = d === today
    const hasPastDate = new Date(year, month, d) < new Date(year, month, today)

    cells.push(
      <motion.div
        key={`day-${d}`}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: d * 0.01, duration: 0.3 }}
        className={`h-16 sm:h-20 rounded-lg p-1 border transition-colors relative ${
          isToday
            ? 'border-cyan-500/40 bg-cyan-500/5'
            : dayEvents.length > 0
              ? 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
              : 'border-transparent'
        }`}
      >
        <span
          className={`text-[10px] font-mono block ${
            isToday
              ? 'text-cyan-400 font-bold'
              : hasPastDate
                ? 'text-gray-600'
                : 'text-gray-500'
          }`}
        >
          {d}
        </span>
        <div className="space-y-0.5 mt-0.5">
          {dayEvents.map((ev, idx) => (
            <div
              key={idx}
              className="text-[8px] sm:text-[9px] font-mono truncate rounded px-0.5"
              style={{ color: ev.color, backgroundColor: `${ev.color}15` }}
              title={ev.label}
            >
              {ev.label}
            </div>
          ))}
        </div>
      </motion.div>,
    )
  }

  return (
    <div>
      {/* Month title */}
      <div className="text-center mb-3">
        <span className="text-sm font-mono font-bold text-white">{monthName}</span>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {dayNames.map((name) => (
          <div
            key={name}
            className="text-center text-[9px] font-mono text-gray-500 uppercase"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Calendar day grid */}
      <div className="grid grid-cols-7 gap-1">{cells}</div>
    </div>
  )
}

// ============ Main Component ============

export default function AirdropClaimsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [claimingId, setClaimingId] = useState(null)
  const [claimingAll, setClaimingAll] = useState(false)
  const [claimedIds, setClaimedIds] = useState(new Set())
  const [eligibilityAddr, setEligibilityAddr] = useState('')
  const [eligibilityChecked, setEligibilityChecked] = useState(false)
  const [upcomingFilter, setUpcomingFilter] = useState('all')

  const activeAirdrops = useMemo(() => CLAIMABLE_AIRDROPS.filter(a => !claimedIds.has(a.id)), [claimedIds])
  const totalClaimableUsd = useMemo(() => activeAirdrops.reduce((s, a) => s + a.usdValue, 0), [activeAirdrops])
  const totalClaimedUsd = useMemo(() => CLAIMABLE_AIRDROPS.filter(a => claimedIds.has(a.id)).reduce((s, a) => s + a.usdValue, 0), [claimedIds])
  const claimHistory = useMemo(() => generateClaimHistory(7777), [])
  const calendarEvents = useMemo(() => generateCalendarEvents(), [])
  const filteredUpcoming = useMemo(() => upcomingFilter === 'all' ? UPCOMING_AIRDROPS : UPCOMING_AIRDROPS.filter(a => a.status === upcomingFilter), [upcomingFilter])

  // ============ Handlers ============

  const handleClaimSingle = (id) => {
    setClaimingId(id)
    setTimeout(() => {
      setClaimedIds((prev) => new Set([...prev, id]))
      setClaimingId(null)
    }, 1500)
  }

  const handleClaimAll = () => {
    setClaimingAll(true)
    setTimeout(() => {
      setClaimedIds(new Set(CLAIMABLE_AIRDROPS.map((a) => a.id)))
      setClaimingAll(false)
    }, 2500)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      {/* ============ Page Hero ============ */}
      <PageHero category="defi" title="Airdrop Claims" subtitle="All your claimable rewards in one place"
        badge={activeAirdrops.length > 0 ? `${activeAirdrops.length} Available` : 'None'}
        badgeColor={activeAirdrops.length > 0 ? '#f59e0b' : '#6b7280'} />

      {/* ============ Not Connected ============ */}
      {!isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: FADE }}
        >
          <GlassCard glowColor="warning" className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <span className="text-2xl font-mono font-bold text-amber-400">?</span>
            </div>
            <p className="text-lg font-mono font-bold text-amber-400 mb-2">
              Connect Wallet to View Airdrops
            </p>
            <p className="text-xs font-mono text-gray-400 max-w-md mx-auto leading-relaxed">
              Sign in with an external wallet or device wallet to check your
              claimable airdrops across all supported protocols. We aggregate
              drops from VibeSwap, LayerZero, Arbitrum, Optimism, and more.
            </p>
          </GlassCard>
        </motion.div>
      )}

      {isConnected && (
        <div className="space-y-10">
          {/* ============ Section 1: Overview Stats ============ */}
          <section>
            <SectionHeader tag="Overview" title="Airdrop Summary" delay={0.1} />
            <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }} transition={{ duration: FADE }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Claimable Now',  value: fmtUsd(totalClaimableUsd), color: '#f59e0b' },
                { label: 'Airdrops Found', value: activeAirdrops.length,      color: CYAN },
                { label: 'Total Claimed',  value: fmtUsd(totalClaimedUsd),    color: '#22c55e' },
                { label: 'Upcoming',       value: UPCOMING_AIRDROPS.length,   color: '#a855f7' },
              ].map((stat, i) => (
                <motion.div key={stat.label} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }} transition={{ delay: i * STAGGER, duration: FADE }}>
                  <GlassCard glowColor="none" className="p-4">
                    <p className="text-[10px] font-mono text-gray-500 uppercase mb-1">{stat.label}</p>
                    <p className="text-xl font-bold font-mono" style={{ color: stat.color }}>{stat.value}</p>
                  </GlassCard>
                </motion.div>
              ))}
            </motion.div>
          </section>

          {/* ============ Section 2: Claimable Now ============ */}
          <section>
            <SectionHeader tag="Ready to Claim" title="Claimable Now" delay={0.1 / PHI} />
            <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }} transition={{ duration: FADE }} className="space-y-3">
              {activeAirdrops.length === 0 && (
                <GlassCard glowColor="none" className="p-6 text-center">
                  <p className="text-sm font-mono text-gray-400">All airdrops claimed. Check back for new drops.</p>
                </GlassCard>
              )}
              {activeAirdrops.map((a, i) => {
                const dl = daysUntil(a.expiry), expSoon = dl <= 7
                return (
                  <motion.div key={a.id} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }} transition={{ delay: i * STAGGER, duration: FADE }}>
                    <GlassCard glowColor="warning" spotlight className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-lg shrink-0"
                          style={{ backgroundColor: `${a.color}15`, color: a.color, border: `1px solid ${a.color}33` }}>
                          {a.logo}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-mono font-bold text-white">{a.protocol}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                              style={{ color: a.color, backgroundColor: `${a.color}15` }}>{a.token}</span>
                          </div>
                          <p className="text-[10px] font-mono text-gray-500 truncate">{a.reason}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs font-mono font-bold text-amber-400">{a.amount.toLocaleString()} {a.token}</span>
                            <span className="text-[10px] font-mono text-gray-500">({fmtUsd(a.usdValue)})</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <span className={`text-[10px] font-mono ${expSoon ? 'text-red-400' : 'text-gray-500'}`}>
                            {dl === 0 ? 'Expires today' : `${dl}d left`}
                          </span>
                          <ClaimBtn onClick={() => handleClaimSingle(a.id)} claiming={claimingId === a.id} />
                        </div>
                      </div>
                      <div className="mt-3 h-1 bg-black/30 rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} whileInView={{ width: `${Math.max(5, 100 - dl * 1.5)}%` }}
                          viewport={{ once: true }} transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-full" style={{ backgroundColor: expSoon ? '#ef4444' : a.color }} />
                      </div>
                    </GlassCard>
                  </motion.div>
                )
              })}
            </motion.div>
          </section>

          {/* ============ Section 3: Claim All ============ */}
          <section>
            <SectionHeader tag="Batch Operation" title="Claim All" delay={0.1 / (PHI * PHI)} />
            <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }} transition={{ duration: FADE }}>
              <GlassCard glowColor="warning" className="p-5">
                <div className="text-center mb-4">
                  <p className="text-xs font-mono text-gray-500 uppercase mb-2">Total Claimable Value</p>
                  <p className="text-4xl font-bold font-mono text-amber-400">{fmtUsd(totalClaimableUsd)}</p>
                  <p className="text-[10px] font-mono text-gray-500 mt-1">
                    across {activeAirdrops.length} protocol{activeAirdrops.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-5">
                  {activeAirdrops.map(a => (
                    <div key={a.id} className="text-center p-2 rounded-lg"
                      style={{ backgroundColor: `${a.color}08`, border: `1px solid ${a.color}20` }}>
                      <p className="text-xs font-mono font-bold" style={{ color: a.color }}>{a.token}</p>
                      <p className="text-[10px] font-mono text-gray-500">{a.amount.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <ClaimAllButton totalUsd={totalClaimableUsd} onClaim={handleClaimAll} claiming={claimingAll} count={activeAirdrops.length} />
                <div className="mt-4 bg-black/30 rounded-lg p-3 border border-amber-500/15">
                  <p className="text-[10px] font-mono text-gray-500 text-center">
                    Batch claiming executes all claims in a single transaction via VibeSwap's
                    cross-chain aggregator. Gas is estimated at ~0.003 ETH for all protocols
                    combined. Failed claims are automatically retried.
                  </p>
                </div>
              </GlassCard>
            </motion.div>
          </section>

          {/* ============ Section 4: Upcoming Airdrops ============ */}
          <section>
            <SectionHeader tag="Coming Soon" title="Upcoming Airdrops" delay={0.1} />
            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              transition={{ duration: FADE }} className="flex gap-2 mb-4">
              {['all', 'confirmed', 'speculative'].map(f => (
                <button key={f} onClick={() => setUpcomingFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all border ${
                    upcomingFilter === f ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400' : 'border-gray-700/30 text-gray-500 hover:text-gray-400'}`}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </motion.div>
            <div className="space-y-3">
              {filteredUpcoming.map((a, i) => {
                const da = daysUntil(a.estDate)
                return (
                  <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }} transition={{ delay: i * STAGGER, duration: FADE }}>
                    <GlassCard glowColor="terminal" className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-mono font-bold text-white">{a.protocol}</span>
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                              style={{ color: a.status === 'confirmed' ? '#22c55e' : '#f59e0b',
                                backgroundColor: a.status === 'confirmed' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)' }}>
                              {a.status.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-gray-500">Est. {fmtDate(a.estDate)} ({da} days away)</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-mono text-gray-500 uppercase">Eligibility</p>
                          <p className="text-lg font-bold font-mono"
                            style={{ color: a.eligibility >= 70 ? '#22c55e' : a.eligibility >= 40 ? '#f59e0b' : '#6b7280' }}>
                            {a.eligibility}%
                          </p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-mono text-gray-500 uppercase">Requirements</p>
                        {a.requirements.map((req, j) => {
                          const met = seededRandom(a.id * 100 + j)() > 0.4
                          return (
                            <div key={j} className="flex items-center gap-2 text-[11px] font-mono">
                              <span className={`w-4 h-4 rounded flex items-center justify-center text-[9px] ${met ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/10 text-gray-500'}`}>
                                {met ? '+' : '-'}
                              </span>
                              <span className={met ? 'text-gray-300' : 'text-gray-500'}>{req}</span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="mt-3 h-1.5 bg-black/30 rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} whileInView={{ width: `${a.eligibility}%` }}
                          viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.1, duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-full" style={{ backgroundColor: a.color }} />
                      </div>
                    </GlassCard>
                  </motion.div>
                )
              })}
            </div>
          </section>

          {/* ============ Section 5: Claim History ============ */}
          <section>
            <SectionHeader tag="Ledger" title="Claim History" delay={0.1 / (PHI * PHI)} />
            <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }} transition={{ duration: FADE }}>
              <GlassCard glowColor="matrix" className="p-5">
                <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-gray-700/30 text-[10px] font-mono text-gray-500 uppercase">
                  <div className="col-span-3">Date</div>
                  <div className="col-span-2">Protocol</div>
                  <div className="col-span-2">Token</div>
                  <div className="col-span-2 text-right">Amount</div>
                  <div className="col-span-3 text-right">Tx Hash</div>
                </div>
                <div className="space-y-0.5 max-h-[380px] overflow-y-auto scrollbar-hide">
                  {claimHistory.map((e, i) => (
                    <motion.div key={e.id} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
                      viewport={{ once: true }} transition={{ delay: i * 0.02, duration: 0.3 }}
                      className="grid grid-cols-12 gap-2 py-2 border-b border-gray-700/15 text-[11px] font-mono hover:bg-white/[0.02] rounded transition-colors">
                      <div className="col-span-3 text-gray-400 truncate">
                        {e.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                      </div>
                      <div className="col-span-2 text-white truncate">{e.protocol}</div>
                      <div className="col-span-2" style={{ color: CYAN }}>{e.token}</div>
                      <div className="col-span-2 text-right text-green-400 font-bold">+{e.amount.toFixed(2)}</div>
                      <div className="col-span-3 text-right text-gray-600 truncate">{e.txHash}</div>
                    </motion.div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-700/30 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-gray-500">Showing {claimHistory.length} past claims</span>
                  <span className="text-[10px] font-mono text-green-400">
                    Total: {fmtUsd(claimHistory.reduce((s, e) => s + e.usdValue, 0))}
                  </span>
                </div>
              </GlassCard>
            </motion.div>
          </section>

          {/* ============ Section 6: Eligibility Checker ============ */}
          <section>
            <SectionHeader tag="Discovery" title="Eligibility Checker" delay={0.1 / PHI} />
            <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }} transition={{ duration: FADE }}>
              <GlassCard glowColor="terminal" className="p-5">
                <p className="text-xs font-mono text-gray-400 mb-4">
                  Check if your address qualifies for known airdrops across protocols.
                </p>
                <div className="flex gap-2 mb-5">
                  <input type="text" value={eligibilityAddr}
                    onChange={e => { setEligibilityAddr(e.target.value); setEligibilityChecked(false) }}
                    placeholder="0x... or use connected wallet"
                    className="flex-1 bg-black/40 rounded-lg px-3 py-2.5 font-mono text-sm text-white border border-gray-700/30 focus:border-cyan-500/40 focus:outline-none transition-colors placeholder:text-gray-600" />
                  <motion.button onClick={() => setEligibilityChecked(true)}
                    className="shrink-0 px-5 py-2.5 rounded-lg font-mono text-xs font-bold"
                    style={{ backgroundColor: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)', color: CYAN }}
                    whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>Check</motion.button>
                </div>
                {eligibilityChecked && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: FADE }} className="space-y-2">
                    {ELIGIBILITY_PROTOCOLS.map((p, i) => (
                      <motion.div key={p.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * STAGGER, duration: 0.3 }}
                        className="flex items-center justify-between py-2 border-b border-gray-700/10 hover:bg-white/[0.02] rounded transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-white">{p.name}</span>
                          <span className="text-[10px] font-mono text-gray-500">({p.token})</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-mono text-gray-500 hidden sm:inline max-w-[180px] truncate">{p.criteria}</span>
                          <EligibilityBadge status={p.status} />
                        </div>
                      </motion.div>
                    ))}
                    <div className="mt-4 bg-black/30 rounded-lg p-3 border border-cyan-500/15">
                      <div className="flex items-center justify-between text-[10px] font-mono text-gray-500">
                        <span>Eligible: <span className="text-green-400 font-bold">{ELIGIBILITY_PROTOCOLS.filter(p => p.status === 'eligible').length}</span></span>
                        <span>Partial: <span className="text-amber-400 font-bold">{ELIGIBILITY_PROTOCOLS.filter(p => p.status === 'partial').length}</span></span>
                        <span>Not Eligible: <span className="text-gray-400 font-bold">{ELIGIBILITY_PROTOCOLS.filter(p => p.status === 'ineligible').length}</span></span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </GlassCard>
            </motion.div>
          </section>

          {/* ============ Section 7: Airdrop Calendar ============ */}
          <section>
            <SectionHeader tag="Timeline" title="Airdrop Calendar" delay={0.1 / (PHI * PHI)} />
            <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }} transition={{ duration: FADE }}>
              <GlassCard glowColor="terminal" className="p-5">
                <AirdropCalendar events={calendarEvents} />
                {/* Legend */}
                <div className="mt-4 pt-3 border-t border-gray-700/30 flex flex-wrap gap-4 justify-center">
                  {[{ type: 'snapshot', label: 'Eligibility snapshot' }, { type: 'claim', label: 'Claim opens' }, { type: 'deadline', label: 'Deadline' }].map(l => (
                    <div key={l.type} className="flex items-center gap-1.5">
                      <CalTypeBadge type={l.type} />
                      <span className="text-[10px] font-mono text-gray-500">{l.label}</span>
                    </div>
                  ))}
                </div>
                {/* Upcoming events list */}
                <div className="mt-4 space-y-2">
                  <p className="text-[10px] font-mono text-gray-500 uppercase">Upcoming Events This Month</p>
                  {calendarEvents.filter(e => e.date >= new Date()).sort((a, b) => a.date - b.date).slice(0, 5).map((ev, i) => (
                    <motion.div key={i} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
                      viewport={{ once: true }} transition={{ delay: i * 0.05, duration: 0.3 }}
                      className="flex items-center justify-between py-1.5 border-b border-gray-700/10">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ev.color }} />
                        <span className="text-[11px] font-mono text-white">{ev.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CalTypeBadge type={ev.type} />
                        <span className="text-[10px] font-mono text-gray-500">
                          {ev.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          </section>

          {/* ============ Explore More ============ */}
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            transition={{ delay: 0.2, duration: 1 / PHI }} className="flex flex-wrap justify-center gap-3 pt-4">
            <Link to="/rewards" className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">Rewards</Link>
            <Link to="/activity" className="text-xs font-mono px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors">Activity</Link>
            <Link to="/cross-chain" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Cross-Chain</Link>
            <Link to="/insurance" className="text-xs font-mono px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">Insurance</Link>
          </motion.div>

          {/* ============ Footer Quote ============ */}
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 1 / PHI }} className="text-center">
            <p className="text-[10px] font-mono text-gray-500">"Free money is never free — it's your marginal contribution, recognized."</p>
          </motion.div>
        </div>
      )}
    </div>
  )
}

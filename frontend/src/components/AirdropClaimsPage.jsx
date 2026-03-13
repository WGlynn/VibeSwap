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
const FADE_DURATION = 1 / (PHI * PHI)
const STAGGER_STEP = 1 / (PHI * PHI * PHI * PHI)

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Mock Data: Claimable Airdrops ============

const CLAIMABLE_AIRDROPS = [
  {
    id: 1,
    protocol: 'VibeSwap',
    token: 'VIBE',
    amount: 4_250.00,
    usdValue: 8_925.00,
    expiry: new Date(Date.now() + 14 * 86400000),
    reason: 'Early adopter allocation',
    logo: 'V',
    color: '#22c55e',
  },
  {
    id: 2,
    protocol: 'LayerZero',
    token: 'ZRO',
    amount: 312.50,
    usdValue: 1_562.50,
    expiry: new Date(Date.now() + 30 * 86400000),
    reason: 'Cross-chain messaging usage',
    logo: 'L',
    color: '#6366f1',
  },
  {
    id: 3,
    protocol: 'Arbitrum',
    token: 'ARB',
    amount: 1_875.00,
    usdValue: 2_250.00,
    expiry: new Date(Date.now() + 7 * 86400000),
    reason: 'STIP retroactive distribution',
    logo: 'A',
    color: '#3b82f6',
  },
  {
    id: 4,
    protocol: 'Optimism',
    token: 'OP',
    amount: 640.00,
    usdValue: 1_408.00,
    expiry: new Date(Date.now() + 60 * 86400000),
    reason: 'RetroPGF round 5 allocation',
    logo: 'O',
    color: '#ef4444',
  },
  {
    id: 5,
    protocol: 'Eigenlayer',
    token: 'EIGEN',
    amount: 125.00,
    usdValue: 487.50,
    expiry: new Date(Date.now() + 21 * 86400000),
    reason: 'Restaking season 3 rewards',
    logo: 'E',
    color: '#a855f7',
  },
]

// ============ Mock Data: Upcoming Airdrops ============

const UPCOMING_AIRDROPS = [
  {
    id: 1,
    protocol: 'Monad',
    status: 'confirmed',
    estimatedDate: new Date(Date.now() + 45 * 86400000),
    requirements: ['Bridge to Monad testnet', 'Complete 10+ transactions', 'Hold NFT badge'],
    eligibilityScore: 85,
    color: '#a855f7',
  },
  {
    id: 2,
    protocol: 'Berachain',
    status: 'confirmed',
    estimatedDate: new Date(Date.now() + 30 * 86400000),
    requirements: ['Provide liquidity on BEX', 'Delegate BGT', 'Participate in governance'],
    eligibilityScore: 62,
    color: '#f59e0b',
  },
  {
    id: 3,
    protocol: 'Scroll',
    status: 'speculative',
    estimatedDate: new Date(Date.now() + 90 * 86400000),
    requirements: ['Bridge to Scroll', 'Use 3+ dApps', 'Hold position for 30+ days'],
    eligibilityScore: 40,
    color: '#f97316',
  },
  {
    id: 4,
    protocol: 'zkSync Era',
    status: 'speculative',
    estimatedDate: new Date(Date.now() + 120 * 86400000),
    requirements: ['Volume threshold >$10k', 'Unique contract interactions >20', 'Active for 6+ months'],
    eligibilityScore: 71,
    color: '#6366f1',
  },
  {
    id: 5,
    protocol: 'StarkNet',
    status: 'speculative',
    estimatedDate: new Date(Date.now() + 75 * 86400000),
    requirements: ['Deploy account', 'Use bridges', 'Interact with ecosystem dApps'],
    eligibilityScore: 55,
    color: '#0ea5e9',
  },
]

// ============ Mock Data: Claim History ============

function generateClaimHistory(seed, count = 15) {
  const rng = seededRandom(seed)
  const protocols = ['VibeSwap', 'Arbitrum', 'Optimism', 'Uniswap', 'Aave', 'LayerZero']
  const tokens = ['VIBE', 'ARB', 'OP', 'UNI', 'AAVE', 'ZRO']
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    id: count - i,
    date: new Date(now - (i + 1) * 86400000 * (3 + rng() * 12)),
    protocol: protocols[Math.floor(rng() * protocols.length)],
    token: tokens[Math.floor(rng() * tokens.length)],
    amount: 50 + rng() * 5000,
    usdValue: 100 + rng() * 12000,
    txHash: '0x' + Array.from({ length: 16 }, () => Math.floor(rng() * 16).toString(16)).join('') + '...',
  }))
}

// ============ Mock Data: Eligibility Protocols ============

const ELIGIBILITY_PROTOCOLS = [
  { name: 'VibeSwap', criteria: 'Trade volume > $1,000', status: 'eligible', token: 'VIBE' },
  { name: 'LayerZero', criteria: 'Cross-chain messages > 5', status: 'eligible', token: 'ZRO' },
  { name: 'Arbitrum', criteria: 'Bridge + 10 txns on Arbitrum', status: 'eligible', token: 'ARB' },
  { name: 'Optimism', criteria: 'Governance participation', status: 'partial', token: 'OP' },
  { name: 'Eigenlayer', criteria: 'Restake > 1 ETH for 90+ days', status: 'partial', token: 'EIGEN' },
  { name: 'Monad', criteria: 'Testnet activity + NFT badge', status: 'ineligible', token: 'MON' },
  { name: 'Scroll', criteria: 'Bridge + use 3 dApps', status: 'ineligible', token: 'SCR' },
  { name: 'Berachain', criteria: 'Provide liquidity on BEX', status: 'partial', token: 'BERA' },
]

// ============ Mock Data: Calendar Events ============

function generateCalendarEvents(seed) {
  const rng = seededRandom(seed)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const events = [
    { day: 3, label: 'ARB Season 2', type: 'snapshot', color: '#3b82f6' },
    { day: 7, label: 'VIBE Early Adopter', type: 'claim', color: '#22c55e' },
    { day: 12, label: 'OP RetroPGF R5', type: 'snapshot', color: '#ef4444' },
    { day: 15, label: 'ZRO Distribution', type: 'claim', color: '#6366f1' },
    { day: 18, label: 'Monad Testnet End', type: 'deadline', color: '#a855f7' },
    { day: 22, label: 'EIGEN S3 Claim', type: 'claim', color: '#a855f7' },
    { day: 25, label: 'Scroll Snapshot', type: 'snapshot', color: '#f97316' },
    { day: 28, label: 'Berachain TGE', type: 'claim', color: '#f59e0b' },
  ]
  return events.map((e) => ({
    ...e,
    date: new Date(year, month, e.day),
    importance: Math.floor(rng() * 3) + 1,
  }))
}

// ============ Utility Functions ============

function daysUntil(date) {
  const diff = date.getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86400000))
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatUsd(n) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ============ Section Header ============

function SectionHeader({ tag, title, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay, duration: FADE_DURATION, ease: 'easeOut' }}
      className="mb-4"
    >
      <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: `${CYAN}b3` }}>
        {tag}
      </span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
    </motion.div>
  )
}

// ============ Claim Button (Single) ============

function ClaimSingleButton({ onClaim, claiming, label = 'Claim' }) {
  return (
    <motion.button
      onClick={onClaim}
      disabled={claiming}
      className="px-4 py-1.5 rounded-lg font-mono text-xs font-bold transition-all disabled:opacity-50"
      style={{
        backgroundColor: 'rgba(245,158,11,0.15)',
        borderColor: 'rgba(245,158,11,0.3)',
        color: '#f59e0b',
        border: '1px solid',
      }}
      whileHover={{ scale: 1.05, backgroundColor: 'rgba(245,158,11,0.25)' }}
      whileTap={{ scale: 0.95 }}
    >
      {claiming ? 'Claiming...' : label}
    </motion.button>
  )
}

// ============ Claim All Button ============

function ClaimAllButton({ totalUsd, onClaim, claiming, count }) {
  return (
    <motion.button
      onClick={onClaim}
      disabled={claiming || count === 0}
      className="relative w-full py-4 rounded-2xl font-bold font-mono text-lg overflow-hidden disabled:opacity-50 transition-all"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Background gradient — amber to cyan */}
      <div className="absolute inset-0 bg-gradient-to-r from-amber-600 via-amber-500 to-cyan-500" />
      {/* Animated shine */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
        animate={{ x: ['-100%', '200%'] }}
        transition={{ repeat: Infinity, duration: 3 * PHI, ease: 'linear' }}
        style={{ width: '50%' }}
      />
      {/* Pulse ring */}
      {count > 0 && !claiming && (
        <motion.div
          className="absolute inset-0 rounded-2xl border-2 border-amber-400/40"
          animate={{ scale: [1, 1.04, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ repeat: Infinity, duration: 2 / PHI, ease: 'easeInOut' }}
        />
      )}
      <span className="relative z-10 text-black drop-shadow-sm">
        {claiming
          ? 'Claiming All...'
          : `Claim All ${count} Airdrops (${formatUsd(totalUsd)})`}
      </span>
    </motion.button>
  )
}

// ============ Eligibility Status Badge ============

function EligibilityBadge({ status }) {
  const config = {
    eligible: { text: 'Eligible', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)' },
    partial: { text: 'Partial', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
    ineligible: { text: 'Not Eligible', color: '#6b7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.3)' },
  }
  const cfg = config[status] || config.ineligible
  return (
    <span
      className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {cfg.text}
    </span>
  )
}

// ============ Calendar Type Badge ============

function CalendarTypeBadge({ type }) {
  const config = {
    snapshot: { text: 'Snapshot', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
    claim: { text: 'Claim', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    deadline: { text: 'Deadline', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  }
  const cfg = config[type] || config.snapshot
  return (
    <span
      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      {cfg.text}
    </span>
  )
}

// ============ Calendar Grid ============

function AirdropCalendar({ events }) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const today = now.getDate()

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const monthName = new Date(year, month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const eventsByDay = useMemo(() => {
    const map = {}
    events.forEach((e) => {
      const d = e.day
      if (!map[d]) map[d] = []
      map[d].push(e)
    })
    return map
  }, [events])

  const cells = []
  // Leading empty cells
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push(<div key={`empty-${i}`} className="h-16 sm:h-20" />)
  }
  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dayEvents = eventsByDay[d] || []
    const isToday = d === today
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
            isToday ? 'text-cyan-400 font-bold' : 'text-gray-500'
          }`}
        >
          {d}
        </span>
        <div className="space-y-0.5 mt-0.5">
          {dayEvents.map((ev, i) => (
            <div
              key={i}
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
      <div className="text-center mb-3">
        <span className="text-sm font-mono font-bold text-white">{monthName}</span>
      </div>
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {dayNames.map((name) => (
          <div key={name} className="text-center text-[9px] font-mono text-gray-500 uppercase">
            {name}
          </div>
        ))}
      </div>
      {/* Calendar grid */}
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
  const [eligibilityAddress, setEligibilityAddress] = useState('')
  const [eligibilityChecked, setEligibilityChecked] = useState(false)
  const [selectedFilter, setSelectedFilter] = useState('all')

  // ============ Derived Data ============

  const activeAirdrops = useMemo(
    () => CLAIMABLE_AIRDROPS.filter((a) => !claimedIds.has(a.id)),
    [claimedIds],
  )

  const totalClaimableUsd = useMemo(
    () => activeAirdrops.reduce((sum, a) => sum + a.usdValue, 0),
    [activeAirdrops],
  )

  const totalClaimedUsd = useMemo(() => {
    return CLAIMABLE_AIRDROPS.filter((a) => claimedIds.has(a.id)).reduce(
      (sum, a) => sum + a.usdValue,
      0,
    )
  }, [claimedIds])

  const claimHistory = useMemo(() => generateClaimHistory(7777, 15), [])

  const calendarEvents = useMemo(() => generateCalendarEvents(9999), [])

  const filteredUpcoming = useMemo(() => {
    if (selectedFilter === 'all') return UPCOMING_AIRDROPS
    return UPCOMING_AIRDROPS.filter((a) => a.status === selectedFilter)
  }, [selectedFilter])

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

  const handleCheckEligibility = () => {
    setEligibilityChecked(true)
  }

  // ============ Render ============

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="defi"
        title="Airdrop Claims"
        subtitle="All your claimable rewards in one place"
        badge={activeAirdrops.length > 0 ? `${activeAirdrops.length} Available` : 'None'}
        badgeColor={activeAirdrops.length > 0 ? '#f59e0b' : '#6b7280'}
      />

      {/* ============ Not Connected State ============ */}
      {!isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: FADE_DURATION, ease: 'easeOut' }}
        >
          <GlassCard glowColor="warning" className="p-8 text-center">
            <p className="text-lg font-mono font-bold text-amber-400 mb-2">
              Connect Wallet to View Airdrops
            </p>
            <p className="text-xs font-mono text-gray-400 max-w-md mx-auto">
              Sign in with an external wallet or device wallet to check your claimable
              airdrops across all supported protocols.
            </p>
          </GlassCard>
        </motion.div>
      )}

      {isConnected && (
        <div className="space-y-10">
          {/* ============ Section 1: Overview Stats ============ */}
          <section>
            <SectionHeader tag="Overview" title="Airdrop Summary" delay={0.1} />
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: FADE_DURATION, ease: 'easeOut' }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            >
              {[
                {
                  label: 'Claimable Now',
                  value: formatUsd(totalClaimableUsd),
                  color: '#f59e0b',
                  border: 'rgba(245,158,11,0.2)',
                },
                {
                  label: 'Airdrops Found',
                  value: activeAirdrops.length.toString(),
                  color: CYAN,
                  border: 'rgba(6,182,212,0.2)',
                },
                {
                  label: 'Total Claimed',
                  value: formatUsd(totalClaimedUsd),
                  color: '#22c55e',
                  border: 'rgba(34,197,94,0.2)',
                },
                {
                  label: 'Upcoming',
                  value: UPCOMING_AIRDROPS.length.toString(),
                  color: '#a855f7',
                  border: 'rgba(168,85,247,0.2)',
                },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * STAGGER_STEP, duration: FADE_DURATION }}
                >
                  <GlassCard glowColor="none" className="p-4">
                    <p className="text-[10px] font-mono text-gray-500 uppercase mb-1">{stat.label}</p>
                    <p className="text-xl font-bold font-mono" style={{ color: stat.color }}>
                      {stat.value}
                    </p>
                  </GlassCard>
                </motion.div>
              ))}
            </motion.div>
          </section>

          {/* ============ Section 2: Claimable Now ============ */}
          <section>
            <SectionHeader tag="Ready to Claim" title="Claimable Now" delay={0.1 / PHI} />
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: FADE_DURATION, ease: 'easeOut' }}
              className="space-y-3"
            >
              {activeAirdrops.length === 0 && (
                <GlassCard glowColor="none" className="p-6 text-center">
                  <p className="text-sm font-mono text-gray-400">
                    All airdrops claimed. Check back for new drops.
                  </p>
                </GlassCard>
              )}
              {activeAirdrops.map((airdrop, i) => {
                const daysLeft = daysUntil(airdrop.expiry)
                const isExpiringSoon = daysLeft <= 7
                const isClaiming = claimingId === airdrop.id
                return (
                  <motion.div
                    key={airdrop.id}
                    initial={{ opacity: 0, x: -12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{
                      delay: i * STAGGER_STEP,
                      duration: FADE_DURATION,
                      ease: 'easeOut',
                    }}
                  >
                    <GlassCard glowColor="warning" spotlight className="p-4">
                      <div className="flex items-center gap-4">
                        {/* Protocol logo */}
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-lg shrink-0"
                          style={{
                            backgroundColor: `${airdrop.color}15`,
                            color: airdrop.color,
                            border: `1px solid ${airdrop.color}33`,
                          }}
                        >
                          {airdrop.logo}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-mono font-bold text-white">
                              {airdrop.protocol}
                            </span>
                            <span
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                              style={{
                                color: airdrop.color,
                                backgroundColor: `${airdrop.color}15`,
                              }}
                            >
                              {airdrop.token}
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-gray-500 truncate">
                            {airdrop.reason}
                          </p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs font-mono font-bold text-amber-400">
                              {airdrop.amount.toLocaleString()} {airdrop.token}
                            </span>
                            <span className="text-[10px] font-mono text-gray-500">
                              ({formatUsd(airdrop.usdValue)})
                            </span>
                          </div>
                        </div>

                        {/* Expiry + Claim */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <span
                            className={`text-[10px] font-mono ${
                              isExpiringSoon ? 'text-red-400' : 'text-gray-500'
                            }`}
                          >
                            {daysLeft === 0 ? 'Expires today' : `${daysLeft}d left`}
                          </span>
                          <ClaimSingleButton
                            onClaim={() => handleClaimSingle(airdrop.id)}
                            claiming={isClaiming}
                          />
                        </div>
                      </div>

                      {/* Expiry progress bar */}
                      <div className="mt-3 h-1 bg-black/30 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${Math.max(5, 100 - daysLeft * 1.5)}%` }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-full"
                          style={{
                            backgroundColor: isExpiringSoon ? '#ef4444' : airdrop.color,
                          }}
                        />
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
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: FADE_DURATION, ease: 'easeOut' }}
            >
              <GlassCard glowColor="warning" className="p-5">
                <div className="text-center mb-4">
                  <p className="text-xs font-mono text-gray-500 uppercase mb-2">
                    Total Claimable Value
                  </p>
                  <p className="text-4xl font-bold font-mono text-amber-400">
                    {formatUsd(totalClaimableUsd)}
                  </p>
                  <p className="text-[10px] font-mono text-gray-500 mt-1">
                    across {activeAirdrops.length} protocol{activeAirdrops.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* Token breakdown */}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-5">
                  {activeAirdrops.map((a) => (
                    <div
                      key={a.id}
                      className="text-center p-2 rounded-lg"
                      style={{
                        backgroundColor: `${a.color}08`,
                        border: `1px solid ${a.color}20`,
                      }}
                    >
                      <p
                        className="text-xs font-mono font-bold"
                        style={{ color: a.color }}
                      >
                        {a.token}
                      </p>
                      <p className="text-[10px] font-mono text-gray-500">
                        {a.amount.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>

                <ClaimAllButton
                  totalUsd={totalClaimableUsd}
                  onClaim={handleClaimAll}
                  claiming={claimingAll}
                  count={activeAirdrops.length}
                />

                <p className="text-[10px] font-mono text-gray-500 text-center mt-3">
                  Batch claiming executes all claims in a single transaction.
                  Gas is estimated at ~0.003 ETH for all protocols combined.
                </p>
              </GlassCard>
            </motion.div>
          </section>

          {/* ============ Section 4: Upcoming Airdrops ============ */}
          <section>
            <SectionHeader tag="Coming Soon" title="Upcoming Airdrops" delay={0.1} />

            {/* Filter tabs */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: FADE_DURATION }}
              className="flex gap-2 mb-4"
            >
              {['all', 'confirmed', 'speculative'].map((filter) => (
                <button
                  key={filter}
                  onClick={() => setSelectedFilter(filter)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all border ${
                    selectedFilter === filter
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                      : 'border-gray-700/30 bg-transparent text-gray-500 hover:text-gray-400'
                  }`}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: FADE_DURATION, ease: 'easeOut' }}
              className="space-y-3"
            >
              {filteredUpcoming.map((airdrop, i) => {
                const daysAway = daysUntil(airdrop.estimatedDate)
                return (
                  <motion.div
                    key={airdrop.id}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{
                      delay: i * STAGGER_STEP,
                      duration: FADE_DURATION,
                    }}
                  >
                    <GlassCard glowColor="terminal" className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-mono font-bold text-white">
                              {airdrop.protocol}
                            </span>
                            <span
                              className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                              style={{
                                color: airdrop.status === 'confirmed' ? '#22c55e' : '#f59e0b',
                                backgroundColor:
                                  airdrop.status === 'confirmed'
                                    ? 'rgba(34,197,94,0.12)'
                                    : 'rgba(245,158,11,0.12)',
                              }}
                            >
                              {airdrop.status.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-gray-500">
                            Est. {formatDate(airdrop.estimatedDate)} ({daysAway} days away)
                          </p>
                        </div>
                        {/* Eligibility score */}
                        <div className="text-right">
                          <p className="text-[10px] font-mono text-gray-500 uppercase">
                            Eligibility
                          </p>
                          <p
                            className="text-lg font-bold font-mono"
                            style={{
                              color:
                                airdrop.eligibilityScore >= 70
                                  ? '#22c55e'
                                  : airdrop.eligibilityScore >= 40
                                    ? '#f59e0b'
                                    : '#6b7280',
                            }}
                          >
                            {airdrop.eligibilityScore}%
                          </p>
                        </div>
                      </div>

                      {/* Requirements */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-mono text-gray-500 uppercase">
                          Requirements
                        </p>
                        {airdrop.requirements.map((req, j) => {
                          const rng = seededRandom(airdrop.id * 100 + j)
                          const met = rng() > 0.4
                          return (
                            <div
                              key={j}
                              className="flex items-center gap-2 text-[11px] font-mono"
                            >
                              <span
                                className={`w-4 h-4 rounded flex items-center justify-center text-[9px] ${
                                  met
                                    ? 'bg-green-500/15 text-green-400'
                                    : 'bg-gray-500/10 text-gray-500'
                                }`}
                              >
                                {met ? '+' : '-'}
                              </span>
                              <span className={met ? 'text-gray-300' : 'text-gray-500'}>
                                {req}
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Eligibility bar */}
                      <div className="mt-3 h-1.5 bg-black/30 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${airdrop.eligibilityScore}%` }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.3 + i * 0.1, duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: airdrop.color }}
                        />
                      </div>
                    </GlassCard>
                  </motion.div>
                )
              })}
            </motion.div>
          </section>

          {/* ============ Section 5: Claim History ============ */}
          <section>
            <SectionHeader
              tag="Ledger"
              title="Claim History"
              delay={0.1 / (PHI * PHI)}
            />
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: FADE_DURATION, ease: 'easeOut' }}
            >
              <GlassCard glowColor="matrix" className="p-5">
                {/* Table header */}
                <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-gray-700/30 text-[10px] font-mono text-gray-500 uppercase">
                  <div className="col-span-3">Date</div>
                  <div className="col-span-2">Protocol</div>
                  <div className="col-span-2">Token</div>
                  <div className="col-span-2 text-right">Amount</div>
                  <div className="col-span-3 text-right">Tx Hash</div>
                </div>

                {/* Table rows */}
                <div className="space-y-0.5 max-h-[380px] overflow-y-auto scrollbar-hide">
                  {claimHistory.map((entry, i) => {
                    const dateStr = entry.date.toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: '2-digit',
                    })
                    return (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.02, duration: 0.3 }}
                        className="grid grid-cols-12 gap-2 py-2 border-b border-gray-700/15 text-[11px] font-mono hover:bg-white/[0.02] rounded transition-colors"
                      >
                        <div className="col-span-3 text-gray-400 truncate">{dateStr}</div>
                        <div className="col-span-2 text-white truncate">{entry.protocol}</div>
                        <div className="col-span-2" style={{ color: CYAN }}>
                          {entry.token}
                        </div>
                        <div className="col-span-2 text-right text-green-400 font-bold">
                          +{entry.amount.toFixed(2)}
                        </div>
                        <div className="col-span-3 text-right text-gray-600 truncate font-mono">
                          {entry.txHash}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>

                {/* Footer */}
                <div className="mt-3 pt-3 border-t border-gray-700/30 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-gray-500">
                    Showing {claimHistory.length} past claims
                  </span>
                  <span className="text-[10px] font-mono text-green-400">
                    Total: {formatUsd(claimHistory.reduce((sum, e) => sum + e.usdValue, 0))}
                  </span>
                </div>
              </GlassCard>
            </motion.div>
          </section>

          {/* ============ Section 6: Eligibility Checker ============ */}
          <section>
            <SectionHeader
              tag="Discovery"
              title="Eligibility Checker"
              delay={0.1 / PHI}
            />
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: FADE_DURATION, ease: 'easeOut' }}
            >
              <GlassCard glowColor="terminal" className="p-5">
                <p className="text-xs font-mono text-gray-400 mb-4">
                  Check if your address qualifies for known airdrops across protocols.
                  Enter an address or use your connected wallet.
                </p>

                {/* Address input */}
                <div className="flex gap-2 mb-5">
                  <input
                    type="text"
                    value={eligibilityAddress}
                    onChange={(e) => {
                      setEligibilityAddress(e.target.value)
                      setEligibilityChecked(false)
                    }}
                    placeholder="0x... or use connected wallet"
                    className="flex-1 bg-black/40 rounded-lg px-3 py-2.5 font-mono text-sm text-white border border-gray-700/30 focus:border-cyan-500/40 focus:outline-none transition-colors placeholder:text-gray-600"
                  />
                  <motion.button
                    onClick={handleCheckEligibility}
                    className="shrink-0 px-5 py-2.5 rounded-lg font-mono text-xs font-bold transition-all"
                    style={{
                      backgroundColor: 'rgba(6,182,212,0.15)',
                      border: '1px solid rgba(6,182,212,0.3)',
                      color: CYAN,
                    }}
                    whileHover={{ scale: 1.03, backgroundColor: 'rgba(6,182,212,0.25)' }}
                    whileTap={{ scale: 0.97 }}
                  >
                    Check
                  </motion.button>
                </div>

                {/* Eligibility results */}
                {eligibilityChecked && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: FADE_DURATION }}
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-700/30">
                      <span className="text-[10px] font-mono text-gray-500 uppercase">
                        Protocol
                      </span>
                      <div className="flex gap-12">
                        <span className="text-[10px] font-mono text-gray-500 uppercase">
                          Criteria
                        </span>
                        <span className="text-[10px] font-mono text-gray-500 uppercase">
                          Status
                        </span>
                      </div>
                    </div>

                    {ELIGIBILITY_PROTOCOLS.map((protocol, i) => (
                      <motion.div
                        key={protocol.name}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * STAGGER_STEP, duration: 0.3 }}
                        className="flex items-center justify-between py-2 border-b border-gray-700/10 hover:bg-white/[0.02] rounded transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-white">
                            {protocol.name}
                          </span>
                          <span className="text-[10px] font-mono text-gray-500">
                            ({protocol.token})
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-mono text-gray-500 hidden sm:inline max-w-[200px] truncate">
                            {protocol.criteria}
                          </span>
                          <EligibilityBadge status={protocol.status} />
                        </div>
                      </motion.div>
                    ))}

                    {/* Summary */}
                    <div className="mt-4 bg-black/30 rounded-lg p-3 border border-cyan-500/15">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-gray-500">
                          Eligible:{' '}
                          <span className="text-green-400 font-bold">
                            {ELIGIBILITY_PROTOCOLS.filter((p) => p.status === 'eligible').length}
                          </span>
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">
                          Partial:{' '}
                          <span className="text-amber-400 font-bold">
                            {ELIGIBILITY_PROTOCOLS.filter((p) => p.status === 'partial').length}
                          </span>
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">
                          Not Eligible:{' '}
                          <span className="text-gray-400 font-bold">
                            {ELIGIBILITY_PROTOCOLS.filter((p) => p.status === 'ineligible').length}
                          </span>
                        </span>
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
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: FADE_DURATION, ease: 'easeOut' }}
            >
              <GlassCard glowColor="terminal" className="p-5">
                <AirdropCalendar events={calendarEvents} />

                {/* Legend */}
                <div className="mt-4 pt-3 border-t border-gray-700/30">
                  <div className="flex flex-wrap gap-4 justify-center">
                    <div className="flex items-center gap-1.5">
                      <CalendarTypeBadge type="snapshot" />
                      <span className="text-[10px] font-mono text-gray-500">
                        Eligibility snapshot
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CalendarTypeBadge type="claim" />
                      <span className="text-[10px] font-mono text-gray-500">
                        Claim opens
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CalendarTypeBadge type="deadline" />
                      <span className="text-[10px] font-mono text-gray-500">
                        Deadline
                      </span>
                    </div>
                  </div>
                </div>

                {/* Upcoming events list */}
                <div className="mt-4 space-y-2">
                  <p className="text-[10px] font-mono text-gray-500 uppercase">
                    Upcoming Events This Month
                  </p>
                  {calendarEvents
                    .filter((e) => e.date >= new Date())
                    .sort((a, b) => a.date - b.date)
                    .slice(0, 5)
                    .map((event, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.05, duration: 0.3 }}
                        className="flex items-center justify-between py-1.5 border-b border-gray-700/10"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: event.color }}
                          />
                          <span className="text-[11px] font-mono text-white">
                            {event.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <CalendarTypeBadge type={event.type} />
                          <span className="text-[10px] font-mono text-gray-500">
                            {event.date.toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                </div>
              </GlassCard>
            </motion.div>
          </section>

          {/* ============ Explore More ============ */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2, duration: 1 / PHI }}
            className="flex flex-wrap justify-center gap-3 pt-4"
          >
            <Link
              to="/rewards"
              className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors"
            >
              Rewards
            </Link>
            <Link
              to="/activity"
              className="text-xs font-mono px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
            >
              Activity
            </Link>
            <Link
              to="/cross-chain"
              className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors"
            >
              Cross-Chain
            </Link>
            <Link
              to="/insurance"
              className="text-xs font-mono px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
            >
              Insurance
            </Link>
          </motion.div>

          {/* ============ Footer Quote ============ */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 1 / PHI }}
            className="text-center"
          >
            <p className="text-[10px] font-mono text-gray-500">
              "Free money is never free — it's your marginal contribution, recognized."
            </p>
          </motion.div>
        </div>
      )}
    </div>
  )
}

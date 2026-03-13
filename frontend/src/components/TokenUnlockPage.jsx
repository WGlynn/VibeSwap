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

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Animation Variants ============

const stagger = { hidden: {}, show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
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
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtShortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysUntil(d) {
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000))
}

function daysAgo(d) {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

// ============ Section Header ============

function SectionHeader({ num, title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold font-mono text-white flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span>
        <span>{title}</span>
      </h2>
      {subtitle && <p className="text-sm text-gray-500 font-mono mt-0.5">{subtitle}</p>}
    </div>
  )
}

// ============ Unlock Event Data ============

const UNLOCK_TYPES = ['Cliff', 'Linear']
const PROTOCOL_COLORS = {
  'Arbitrum': '#3b82f6',
  'Optimism': '#ef4444',
  'Starknet': '#8b5cf6',
  'LayerZero': '#06b6d4',
  'Celestia': '#a855f7',
  'Aptos': '#22c55e',
  'Sui': '#3b82f6',
  'Jito': '#f97316',
  'Jupiter': '#eab308',
  'Eigenlayer': '#6366f1',
  'Wormhole': '#ec4899',
  'VibeSwap': CYAN,
}

function generateUnlockEvents() {
  const rng = seededRandom(7749)
  const protocols = [
    { name: 'Arbitrum', token: 'ARB', totalSupply: 10_000_000_000 },
    { name: 'Optimism', token: 'OP', totalSupply: 4_294_967_296 },
    { name: 'Starknet', token: 'STRK', totalSupply: 10_000_000_000 },
    { name: 'LayerZero', token: 'ZRO', totalSupply: 1_000_000_000 },
    { name: 'Celestia', token: 'TIA', totalSupply: 1_000_000_000 },
    { name: 'Aptos', token: 'APT', totalSupply: 1_100_000_000 },
    { name: 'Sui', token: 'SUI', totalSupply: 10_000_000_000 },
    { name: 'Jito', token: 'JTO', totalSupply: 1_000_000_000 },
    { name: 'Jupiter', token: 'JUP', totalSupply: 10_000_000_000 },
    { name: 'Eigenlayer', token: 'EIGEN', totalSupply: 1_670_000_000 },
  ]

  const events = []
  const now = Date.now()

  for (let i = 0; i < 10; i++) {
    const proto = protocols[i % protocols.length]
    const dayOffset = Math.floor(rng() * 90) + 1
    const date = new Date(now + dayOffset * 86400000)
    const amount = Math.round((rng() * 200_000_000 + 10_000_000))
    const price = rng() * 8 + 0.5
    const usdValue = Math.round(amount * price)
    const pctSupply = ((amount / proto.totalSupply) * 100).toFixed(2)
    const type = rng() > 0.5 ? 'Cliff' : 'Linear'
    const recipient = rng() > 0.6 ? 'Team' : rng() > 0.4 ? 'Investors' : 'Ecosystem'

    events.push({
      id: i + 1,
      protocol: proto.name,
      token: proto.token,
      amount,
      usdValue,
      date,
      type,
      pctSupply: parseFloat(pctSupply),
      recipient,
      daysUntil: dayOffset,
      color: PROTOCOL_COLORS[proto.name] || CYAN,
    })
  }

  return events.sort((a, b) => a.date - b.date)
}

// ============ Historical Impact Data ============

function generateImpactData() {
  const rng = seededRandom(3141)
  const entries = [
    { protocol: 'Arbitrum', token: 'ARB', date: new Date(2025, 2, 16), unlockSize: 92_650_000 },
    { protocol: 'Optimism', token: 'OP', date: new Date(2025, 5, 30), unlockSize: 31_340_000 },
    { protocol: 'Starknet', token: 'STRK', date: new Date(2025, 3, 15), unlockSize: 127_000_000 },
    { protocol: 'Celestia', token: 'TIA', date: new Date(2025, 4, 21), unlockSize: 87_500_000 },
    { protocol: 'Aptos', token: 'APT', date: new Date(2025, 1, 12), unlockSize: 11_310_000 },
    { protocol: 'Jupiter', token: 'JUP', date: new Date(2025, 7, 8), unlockSize: 182_000_000 },
    { protocol: 'Eigenlayer', token: 'EIGEN', date: new Date(2025, 6, 1), unlockSize: 51_200_000 },
    { protocol: 'Sui', token: 'SUI', date: new Date(2025, 8, 3), unlockSize: 64_190_000 },
  ]

  return entries.map((e) => {
    const priceBefore = 0.5 + rng() * 10
    const impactPct = -(rng() * 18 + 2)
    const priceAfter = priceBefore * (1 + impactPct / 100)
    const recoveryDays = Math.round(rng() * 30 + 3)
    const recovered = rng() > 0.35

    return {
      ...e,
      priceBefore: parseFloat(priceBefore.toFixed(4)),
      priceAfter: parseFloat(priceAfter.toFixed(4)),
      impactPct: parseFloat(impactPct.toFixed(2)),
      recoveryDays,
      recovered,
      color: PROTOCOL_COLORS[e.protocol] || CYAN,
    }
  })
}

// ============ Active Vesting Schedules ============

function generateVestingSchedules() {
  const rng = seededRandom(2718)
  const schedules = [
    { protocol: 'Arbitrum', token: 'ARB', recipient: 'Team', totalAmount: 650_000_000, startDate: new Date(2023, 2, 23), durationMonths: 48 },
    { protocol: 'Optimism', token: 'OP', recipient: 'Core Contributors', totalAmount: 773_000_000, startDate: new Date(2022, 5, 1), durationMonths: 48 },
    { protocol: 'Starknet', token: 'STRK', recipient: 'Early Contributors', totalAmount: 1_264_000_000, startDate: new Date(2024, 1, 20), durationMonths: 36 },
    { protocol: 'LayerZero', token: 'ZRO', recipient: 'Team + Advisors', totalAmount: 254_000_000, startDate: new Date(2024, 5, 20), durationMonths: 36 },
    { protocol: 'Celestia', token: 'TIA', recipient: 'Series A/B Investors', totalAmount: 196_000_000, startDate: new Date(2023, 9, 31), durationMonths: 48 },
    { protocol: 'Jupiter', token: 'JUP', recipient: 'Team', totalAmount: 500_000_000, startDate: new Date(2024, 0, 31), durationMonths: 24 },
    { protocol: 'VibeSwap', token: 'VIBE', recipient: 'Core Team', totalAmount: 150_000_000, startDate: new Date(2025, 0, 1), durationMonths: 48 },
    { protocol: 'Eigenlayer', token: 'EIGEN', recipient: 'Contributors', totalAmount: 251_000_000, startDate: new Date(2024, 8, 1), durationMonths: 36 },
  ]

  return schedules.map((s) => {
    const now = new Date()
    const endDate = new Date(s.startDate)
    endDate.setMonth(endDate.getMonth() + s.durationMonths)
    const totalDays = (endDate.getTime() - s.startDate.getTime()) / 86400000
    const elapsedDays = Math.max(0, (now.getTime() - s.startDate.getTime()) / 86400000)
    const progress = Math.min(1, elapsedDays / totalDays)
    const vestedAmount = Math.round(s.totalAmount * progress)
    const remainingAmount = s.totalAmount - vestedAmount
    const monthlyRate = Math.round(s.totalAmount / s.durationMonths)

    return {
      ...s,
      endDate,
      progress,
      vestedAmount,
      remainingAmount,
      monthlyRate,
      color: PROTOCOL_COLORS[s.protocol] || CYAN,
    }
  })
}

// ============ Static Data Generation ============

const UNLOCK_EVENTS = generateUnlockEvents()
const IMPACT_DATA = generateImpactData()
const VESTING_SCHEDULES = generateVestingSchedules()

// ============ Calendar Helpers ============

function getCalendarMonth(year, month) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []

  for (let i = 0; i < firstDay; i++) {
    cells.push({ day: null, events: [] })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d)
    const dayEvents = UNLOCK_EVENTS.filter((ev) => {
      return ev.date.getFullYear() === year &&
        ev.date.getMonth() === month &&
        ev.date.getDate() === d
    })
    cells.push({ day: d, events: dayEvents, date })
  }

  return cells
}

// ============ Impact Bar Chart ============

function ImpactChart({ data }) {
  const W = 640, H = 200
  const PAD = { top: 20, right: 20, bottom: 40, left: 60 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top - PAD.bottom
  const maxImpact = Math.max(...data.map((d) => Math.abs(d.impactPct)))
  const barW = (iW / data.length) * 0.65
  const gap = (iW / data.length) * 0.35

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Zero line */}
      <line x1={PAD.left} y1={PAD.top + iH / 2} x2={W - PAD.right} y2={PAD.top + iH / 2}
        stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      {/* Grid lines */}
      {[-15, -10, -5, 0, 5].map((pct) => {
        const y = PAD.top + iH / 2 - (pct / maxImpact) * (iH / 2)
        return (
          <g key={pct}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
              stroke="rgba(255,255,255,0.04)" strokeDasharray="3,3" />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end"
              fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">
              {pct}%
            </text>
          </g>
        )
      })}
      {/* Bars */}
      {data.map((d, i) => {
        const x = PAD.left + i * (barW + gap) + gap / 2
        const barH = (Math.abs(d.impactPct) / maxImpact) * (iH / 2)
        const y = d.impactPct < 0
          ? PAD.top + iH / 2
          : PAD.top + iH / 2 - barH
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx="3"
              fill={d.impactPct < 0 ? '#ef4444' : '#22c55e'} opacity="0.75" />
            <text x={x + barW / 2} y={y + (d.impactPct < 0 ? barH + 12 : -6)}
              textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="8" fontFamily="monospace">
              {d.impactPct.toFixed(1)}%
            </text>
            <text x={x + barW / 2} y={H - 8} textAnchor="middle"
              fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="monospace">
              {d.token}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ============ Vesting Progress Bar ============

function VestingBar({ schedule }) {
  return (
    <div className="p-4 rounded-xl border" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: schedule.color }} />
          <span className="font-mono text-sm text-white font-bold">{schedule.protocol}</span>
          <span className="font-mono text-xs text-gray-500">{schedule.token}</span>
        </div>
        <span className="font-mono text-xs text-gray-400">{schedule.recipient}</span>
      </div>
      <div className="h-3 rounded-full overflow-hidden mb-2" style={{ background: '#1f2937' }}>
        <motion.div
          className="h-full rounded-full relative"
          style={{ background: `linear-gradient(90deg, ${schedule.color}80, ${schedule.color})` }}
          initial={{ width: 0 }}
          animate={{ width: `${schedule.progress * 100}%` }}
          transition={{ duration: PHI, ease: 'easeOut' }}
        >
          {schedule.progress > 0.05 && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)' }}
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 4, ease: 'easeInOut' }}
            />
          )}
        </motion.div>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-gray-500">
        <span>Vested: {fmtNum(schedule.vestedAmount)} / {fmtNum(schedule.totalAmount)} {schedule.token}</span>
        <span>{(schedule.progress * 100).toFixed(1)}%</span>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-gray-600 mt-1">
        <span>{fmtShortDate(schedule.startDate)} - {fmtShortDate(schedule.endDate)}</span>
        <span>~{fmtNum(schedule.monthlyRate)}/mo</span>
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function TokenUnlockPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedEvent, setSelectedEvent] = useState(null)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [watchlist, setWatchlist] = useState(['Arbitrum', 'LayerZero', 'VibeSwap'])
  const [watchlistInput, setWatchlistInput] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [filterType, setFilterType] = useState('All')

  // ============ Sorted & Filtered Events ============

  const sortedEvents = useMemo(() => {
    let filtered = [...UNLOCK_EVENTS]
    if (filterType !== 'All') {
      filtered = filtered.filter((e) => e.type === filterType)
    }
    if (sortBy === 'date') filtered.sort((a, b) => a.date - b.date)
    else if (sortBy === 'value') filtered.sort((a, b) => b.usdValue - a.usdValue)
    else if (sortBy === 'supply') filtered.sort((a, b) => b.pctSupply - a.pctSupply)
    return filtered
  }, [sortBy, filterType])

  // ============ Calendar Data ============

  const calendarCells = useMemo(() => {
    return getCalendarMonth(calendarMonth.year, calendarMonth.month)
  }, [calendarMonth])

  const monthName = new Date(calendarMonth.year, calendarMonth.month).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  })

  // ============ Watchlisted Events ============

  const watchlistedEvents = useMemo(() => {
    return UNLOCK_EVENTS.filter((e) => watchlist.includes(e.protocol))
  }, [watchlist])

  const watchlistedVesting = useMemo(() => {
    return VESTING_SCHEDULES.filter((s) => watchlist.includes(s.protocol))
  }, [watchlist])

  // ============ Aggregate Stats ============

  const totalUnlockValue = useMemo(() => {
    return UNLOCK_EVENTS.reduce((sum, e) => sum + e.usdValue, 0)
  }, [])

  const avgImpact = useMemo(() => {
    const impacts = IMPACT_DATA.map((d) => d.impactPct)
    return (impacts.reduce((s, v) => s + v, 0) / impacts.length).toFixed(2)
  }, [])

  const nextUnlock = UNLOCK_EVENTS[0]

  // ============ Handlers ============

  function handleAddWatchlist() {
    const trimmed = watchlistInput.trim()
    if (trimmed && !watchlist.includes(trimmed)) {
      setWatchlist([...watchlist, trimmed])
      setWatchlistInput('')
    }
  }

  function handleRemoveWatchlist(proto) {
    setWatchlist(watchlist.filter((w) => w !== proto))
  }

  function prevMonth() {
    setCalendarMonth((prev) => {
      const m = prev.month - 1
      if (m < 0) return { year: prev.year - 1, month: 11 }
      return { ...prev, month: m }
    })
  }

  function nextMonth() {
    setCalendarMonth((prev) => {
      const m = prev.month + 1
      if (m > 11) return { year: prev.year + 1, month: 0 }
      return { ...prev, month: m }
    })
  }

  // ============ Render ============

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title="Token Unlocks"
        subtitle="Track upcoming token unlock schedules"
        category="defi"
        badge="Live"
        badgeColor={CYAN}
      >
        <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
          {['All', 'Cliff', 'Linear'].map((t) => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                filterType === t ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'
              }`}>{t}</button>
          ))}
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4">
        <motion.div variants={stagger} initial="hidden" animate="show">

          {/* ============ Stat Cards Row ============ */}
          <motion.div variants={fadeUp} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Upcoming Value', value: fmt(totalUnlockValue) },
              { label: 'Next Unlock', value: `${nextUnlock.daysUntil}d` },
              { label: 'Avg Price Impact', value: `${avgImpact}%` },
              { label: 'Active Vestings', value: String(VESTING_SCHEDULES.length) },
            ].map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * (0.06 / PHI) }}>
                <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                  <div className="text-xl sm:text-2xl font-bold font-mono text-white">{s.value}</div>
                  <div className="text-[10px] font-mono text-gray-500 mt-1">{s.label}</div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>

          {/* ============ 1. Upcoming Unlocks Timeline ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <SectionHeader num="01" title="Upcoming Unlocks" subtitle="Next 10 scheduled token unlock events" />
                <div className="flex gap-1 p-1 bg-black/30 rounded-lg border border-gray-800">
                  {[{ key: 'date', label: 'Date' }, { key: 'value', label: 'Value' }, { key: 'supply', label: '% Supply' }].map((s) => (
                    <button key={s.key} onClick={() => setSortBy(s.key)}
                      className={`px-2 py-1 rounded-md text-[10px] font-mono transition-colors ${
                        sortBy === s.key ? 'text-white' : 'text-gray-600 hover:text-gray-400'
                      }`}
                      style={{ background: sortBy === s.key ? `${CYAN}20` : 'transparent' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-800">
                      <th className="pb-3 font-medium font-mono text-xs">#</th>
                      <th className="pb-3 font-medium font-mono text-xs">Protocol</th>
                      <th className="pb-3 font-medium font-mono text-xs">Token</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Amount</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">USD Value</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Date</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Type</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">% Supply</th>
                      <th className="pb-3 font-medium font-mono text-xs text-right">Recipient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEvents.map((ev, i) => (
                      <motion.tr
                        key={ev.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 + i * (0.03 * PHI) }}
                        className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                          selectedEvent === ev.id ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                        }`}
                        onClick={() => setSelectedEvent(selectedEvent === ev.id ? null : ev.id)}
                      >
                        <td className="py-3 font-mono text-gray-600 text-xs">{String(i + 1).padStart(2, '0')}</td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ev.color }} />
                            <span className="font-mono font-medium text-white">{ev.protocol}</span>
                          </div>
                        </td>
                        <td className="py-3 font-mono text-gray-400">{ev.token}</td>
                        <td className="py-3 text-right font-mono text-gray-300">{fmtNum(ev.amount)}</td>
                        <td className="py-3 text-right font-mono" style={{ color: CYAN }}>{fmt(ev.usdValue)}</td>
                        <td className="py-3 text-right font-mono text-gray-400">
                          <div>{fmtShortDate(ev.date)}</div>
                          <div className="text-[10px] text-gray-600">{ev.daysUntil}d away</div>
                        </td>
                        <td className="py-3 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                            ev.type === 'Cliff'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : 'bg-green-500/10 text-green-400 border border-green-500/20'
                          }`}>
                            {ev.type}
                          </span>
                        </td>
                        <td className="py-3 text-right font-mono">
                          <span className={ev.pctSupply > 3 ? 'text-red-400' : ev.pctSupply > 1 ? 'text-yellow-400' : 'text-gray-400'}>
                            {ev.pctSupply}%
                          </span>
                        </td>
                        <td className="py-3 text-right font-mono text-gray-500 text-xs">{ev.recipient}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Expanded detail row */}
              {selectedEvent && (() => {
                const ev = UNLOCK_EVENTS.find((e) => e.id === selectedEvent)
                if (!ev) return null
                return (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-4 p-4 rounded-xl border overflow-hidden"
                    style={{ background: `${ev.color}08`, borderColor: `${ev.color}20` }}
                  >
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                      <div>
                        <div className="text-[10px] font-mono text-gray-500">Unlock Amount</div>
                        <div className="font-mono text-sm font-bold text-white">{fmtNum(ev.amount)} {ev.token}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-mono text-gray-500">USD Value</div>
                        <div className="font-mono text-sm font-bold" style={{ color: CYAN }}>{fmt(ev.usdValue)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-mono text-gray-500">Unlock Date</div>
                        <div className="font-mono text-sm font-bold text-white">{fmtDate(ev.date)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-mono text-gray-500">Supply Impact</div>
                        <div className={`font-mono text-sm font-bold ${ev.pctSupply > 3 ? 'text-red-400' : 'text-yellow-400'}`}>
                          {ev.pctSupply}% of supply
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-center">
                      <span className="font-mono text-[10px] text-gray-500">
                        {ev.type} unlock for {ev.recipient} -- {ev.daysUntil} days remaining
                      </span>
                    </div>
                  </motion.div>
                )
              })()}
            </GlassCard>
          </motion.div>

          {/* ============ 2. Calendar View ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader num="02" title="Calendar View" subtitle="Monthly unlock schedule with size indicators" />

              <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="px-3 py-1 rounded-lg text-xs font-mono text-gray-400 hover:text-white transition-colors border border-gray-800 hover:border-gray-600">
                  Prev
                </button>
                <span className="font-mono text-sm text-white font-bold">{monthName}</span>
                <button onClick={nextMonth} className="px-3 py-1 rounded-lg text-xs font-mono text-gray-400 hover:text-white transition-colors border border-gray-800 hover:border-gray-600">
                  Next
                </button>
              </div>

              {/* Day labels */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="text-center text-[10px] font-mono text-gray-600 py-1">{d}</div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((cell, i) => {
                  const isToday = cell.date &&
                    cell.date.toDateString() === new Date().toDateString()
                  const hasEvents = cell.events && cell.events.length > 0
                  const maxUsd = hasEvents ? Math.max(...cell.events.map((e) => e.usdValue)) : 0
                  const sizeClass = maxUsd > 500_000_000 ? 'ring-2 ring-red-500/40' :
                    maxUsd > 100_000_000 ? 'ring-2 ring-yellow-500/30' :
                    maxUsd > 10_000_000 ? 'ring-1 ring-cyan-500/20' : ''

                  return (
                    <div
                      key={i}
                      className={`relative rounded-lg p-1.5 min-h-[52px] transition-colors ${
                        cell.day ? 'bg-black/20 border border-gray-800/50 hover:border-gray-700' : ''
                      } ${isToday ? 'border-cyan-500/40' : ''} ${sizeClass}`}
                    >
                      {cell.day && (
                        <>
                          <div className={`text-[10px] font-mono mb-1 ${isToday ? 'font-bold' : 'text-gray-500'}`}
                            style={{ color: isToday ? CYAN : undefined }}>
                            {cell.day}
                          </div>
                          {hasEvents && cell.events.map((ev, ei) => (
                            <div key={ei} className="flex items-center gap-1 mb-0.5">
                              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                              <span className="text-[8px] font-mono text-gray-400 truncate">{ev.token}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Calendar legend */}
              <div className="flex items-center gap-4 mt-4 justify-center">
                {[
                  { label: '> $500M', color: 'ring-red-500/40' },
                  { label: '> $100M', color: 'ring-yellow-500/30' },
                  { label: '> $10M', color: 'ring-cyan-500/20' },
                ].map((l) => (
                  <div key={l.label} className="flex items-center gap-1.5">
                    <div className={`w-3 h-3 rounded ring-2 ${l.color} bg-black/30`} />
                    <span className="text-[10px] font-mono text-gray-500">{l.label}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ 3. Impact Analysis ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader num="03" title="Impact Analysis" subtitle="Historical correlation of token unlocks with price movements" />

              <ImpactChart data={IMPACT_DATA} />

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-800">
                      <th className="pb-2 font-medium font-mono text-[10px]">Protocol</th>
                      <th className="pb-2 font-medium font-mono text-[10px]">Token</th>
                      <th className="pb-2 font-medium font-mono text-[10px] text-right">Unlock Size</th>
                      <th className="pb-2 font-medium font-mono text-[10px] text-right">Price Before</th>
                      <th className="pb-2 font-medium font-mono text-[10px] text-right">Price After</th>
                      <th className="pb-2 font-medium font-mono text-[10px] text-right">Impact</th>
                      <th className="pb-2 font-medium font-mono text-[10px] text-right">Recovery</th>
                    </tr>
                  </thead>
                  <tbody>
                    {IMPACT_DATA.map((d, i) => (
                      <tr key={i} className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors">
                        <td className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                            <span className="font-mono text-xs text-white">{d.protocol}</span>
                          </div>
                        </td>
                        <td className="py-2.5 font-mono text-xs text-gray-400">{d.token}</td>
                        <td className="py-2.5 text-right font-mono text-xs text-gray-300">{fmtNum(d.unlockSize)}</td>
                        <td className="py-2.5 text-right font-mono text-xs text-gray-400">${d.priceBefore.toFixed(2)}</td>
                        <td className="py-2.5 text-right font-mono text-xs text-gray-400">${d.priceAfter.toFixed(2)}</td>
                        <td className="py-2.5 text-right font-mono text-xs text-red-400">{d.impactPct.toFixed(2)}%</td>
                        <td className="py-2.5 text-right">
                          <span className={`font-mono text-xs ${d.recovered ? 'text-green-400' : 'text-yellow-400'}`}>
                            {d.recovered ? `${d.recoveryDays}d` : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Aggregate stats */}
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                <div className="p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}>
                  <div className="text-[10px] font-mono text-gray-500">Avg Impact</div>
                  <div className="font-mono text-sm font-bold text-red-400">{avgImpact}%</div>
                </div>
                <div className="p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}>
                  <div className="text-[10px] font-mono text-gray-500">Avg Recovery</div>
                  <div className="font-mono text-sm font-bold text-green-400">
                    {Math.round(IMPACT_DATA.filter((d) => d.recovered).reduce((s, d) => s + d.recoveryDays, 0) / IMPACT_DATA.filter((d) => d.recovered).length)}d
                  </div>
                </div>
                <div className="p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}>
                  <div className="text-[10px] font-mono text-gray-500">Recovery Rate</div>
                  <div className="font-mono text-sm font-bold" style={{ color: CYAN }}>
                    {((IMPACT_DATA.filter((d) => d.recovered).length / IMPACT_DATA.length) * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ 4. Watchlist ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader num="04" title="Watchlist" subtitle="Save specific protocols to track their unlock schedules" />

              {/* Add to watchlist */}
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={watchlistInput}
                    onChange={(e) => setWatchlistInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddWatchlist()}
                    placeholder="Add protocol name..."
                    className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none"
                    style={{ borderColor: watchlistInput ? `${CYAN}60` : undefined }}
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleAddWatchlist}
                  className="px-4 py-2.5 rounded-xl font-mono font-bold text-xs"
                  style={{ background: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}30` }}
                >
                  Add
                </motion.button>
              </div>

              {/* Watchlist tags */}
              <div className="flex flex-wrap gap-2 mb-4">
                {watchlist.map((proto) => (
                  <motion.div
                    key={proto}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono border"
                    style={{
                      background: `${PROTOCOL_COLORS[proto] || CYAN}10`,
                      borderColor: `${PROTOCOL_COLORS[proto] || CYAN}30`,
                      color: PROTOCOL_COLORS[proto] || CYAN,
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PROTOCOL_COLORS[proto] || CYAN }} />
                    {proto}
                    <button
                      onClick={() => handleRemoveWatchlist(proto)}
                      className="ml-1 text-gray-500 hover:text-white transition-colors"
                    >
                      x
                    </button>
                  </motion.div>
                ))}
              </div>

              {/* Watchlisted upcoming unlocks */}
              {watchlistedEvents.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2">Tracked Upcoming Unlocks</div>
                  {watchlistedEvents.map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between p-3 rounded-xl border transition-colors hover:bg-white/[0.02]"
                      style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                      <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ev.color }} />
                        <div>
                          <span className="font-mono text-sm text-white font-bold">{ev.protocol}</span>
                          <span className="font-mono text-xs text-gray-500 ml-2">{ev.token}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm" style={{ color: CYAN }}>{fmt(ev.usdValue)}</div>
                        <div className="font-mono text-[10px] text-gray-500">{fmtShortDate(ev.date)} ({ev.daysUntil}d)</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="font-mono text-sm text-gray-500">No tracked protocols have upcoming unlocks</div>
                  <div className="font-mono text-[10px] text-gray-600 mt-1">Add protocols above to track their schedules</div>
                </div>
              )}

              {/* Watchlisted vesting */}
              {watchlistedVesting.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2">Tracked Vesting Schedules</div>
                  <div className="space-y-2">
                    {watchlistedVesting.map((s, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-xl border"
                        style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="font-mono text-xs text-white">{s.protocol}</span>
                          <span className="font-mono text-[10px] text-gray-600">{s.recipient}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                            <div className="h-full rounded-full" style={{ width: `${s.progress * 100}%`, background: s.color }} />
                          </div>
                          <span className="font-mono text-[10px] text-gray-400 w-10 text-right">{(s.progress * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </GlassCard>
          </motion.div>

          {/* ============ 5. Active Vesting ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader num="05" title="Active Vesting" subtitle="Ongoing linear vesting schedules with progress tracking" />

              {/* Summary stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                  { label: 'Total Vesting', value: fmtNum(VESTING_SCHEDULES.reduce((s, v) => s + v.totalAmount, 0)) },
                  { label: 'Total Vested', value: fmtNum(VESTING_SCHEDULES.reduce((s, v) => s + v.vestedAmount, 0)) },
                  { label: 'Remaining', value: fmtNum(VESTING_SCHEDULES.reduce((s, v) => s + v.remainingAmount, 0)) },
                  { label: 'Avg Progress', value: `${(VESTING_SCHEDULES.reduce((s, v) => s + v.progress, 0) / VESTING_SCHEDULES.length * 100).toFixed(1)}%` },
                ].map((stat) => (
                  <div key={stat.label} className="text-center p-3 rounded-xl border"
                    style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                    <div className="text-[10px] font-mono text-gray-500 mb-1">{stat.label}</div>
                    <div className="font-mono text-sm font-bold" style={{ color: CYAN }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Vesting schedule bars */}
              <div className="space-y-3">
                {VESTING_SCHEDULES.map((schedule, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * (0.04 * PHI) }}
                  >
                    <VestingBar schedule={schedule} />
                  </motion.div>
                ))}
              </div>

              {/* Aggregate vesting timeline */}
              <div className="mt-6 p-4 rounded-xl border" style={{ background: `${CYAN}06`, borderColor: `${CYAN}15` }}>
                <div className="text-xs font-mono text-gray-400 mb-3">Aggregate Monthly Unlock Rate</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(() => {
                    const totalMonthly = VESTING_SCHEDULES.reduce((s, v) => s + v.monthlyRate, 0)
                    const activeCount = VESTING_SCHEDULES.filter((v) => v.progress < 1).length
                    const nearComplete = VESTING_SCHEDULES.filter((v) => v.progress > 0.8 && v.progress < 1).length
                    const highestRate = VESTING_SCHEDULES.reduce((max, v) => v.monthlyRate > max.monthlyRate ? v : max, VESTING_SCHEDULES[0])
                    return [
                      { label: 'Monthly Rate', value: `${fmtNum(totalMonthly)} tokens` },
                      { label: 'Active Schedules', value: String(activeCount) },
                      { label: 'Near Completion', value: String(nearComplete) },
                      { label: 'Highest Rate', value: `${highestRate.protocol} (${fmtNum(highestRate.monthlyRate)}/mo)` },
                    ].map((s) => (
                      <div key={s.label} className="text-center">
                        <div className="text-[10px] font-mono text-gray-500 mb-0.5">{s.label}</div>
                        <div className="font-mono text-xs font-bold text-white">{s.value}</div>
                      </div>
                    ))
                  })()}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Protocol Distribution ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader num="06" title="Unlock Distribution" subtitle="Breakdown of upcoming unlocks by protocol and type" />

              {/* Stacked bar by protocol */}
              <div className="mb-4">
                <div className="text-[10px] font-mono text-gray-500 mb-2 uppercase tracking-wider">By Protocol (USD Value)</div>
                <div className="flex rounded-full overflow-hidden h-4 mb-2">
                  {UNLOCK_EVENTS.map((ev, i) => {
                    const pct = (ev.usdValue / totalUnlockValue) * 100
                    return (
                      <div
                        key={i}
                        style={{ width: `${pct}%`, backgroundColor: ev.color }}
                        className="transition-all hover:brightness-125"
                        title={`${ev.protocol}: ${fmt(ev.usdValue)} (${pct.toFixed(1)}%)`}
                      />
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {UNLOCK_EVENTS.map((ev, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ev.color }} />
                      <span className="font-mono text-gray-400">{ev.protocol}</span>
                      <span className="font-mono text-gray-600">{fmt(ev.usdValue)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* By type breakdown */}
              <div className="mt-4">
                <div className="text-[10px] font-mono text-gray-500 mb-2 uppercase tracking-wider">By Unlock Type</div>
                <div className="grid grid-cols-2 gap-3">
                  {UNLOCK_TYPES.map((type) => {
                    const events = UNLOCK_EVENTS.filter((e) => e.type === type)
                    const total = events.reduce((s, e) => s + e.usdValue, 0)
                    const count = events.length
                    return (
                      <div key={type} className="p-3 rounded-xl border text-center"
                        style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                        <div className={`text-sm font-mono font-bold ${type === 'Cliff' ? 'text-red-400' : 'text-green-400'}`}>
                          {type}
                        </div>
                        <div className="text-xs font-mono text-gray-400 mt-1">{count} events</div>
                        <div className="font-mono text-sm font-bold mt-1" style={{ color: CYAN }}>{fmt(total)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* By recipient */}
              <div className="mt-4">
                <div className="text-[10px] font-mono text-gray-500 mb-2 uppercase tracking-wider">By Recipient</div>
                <div className="grid grid-cols-3 gap-3">
                  {['Team', 'Investors', 'Ecosystem'].map((r) => {
                    const events = UNLOCK_EVENTS.filter((e) => e.recipient === r)
                    const total = events.reduce((s, e) => s + e.usdValue, 0)
                    const pct = totalUnlockValue > 0 ? ((total / totalUnlockValue) * 100).toFixed(1) : '0'
                    return (
                      <div key={r} className="p-3 rounded-xl border"
                        style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                        <div className="text-xs font-mono text-white font-bold">{r}</div>
                        <div className="font-mono text-sm font-bold mt-1" style={{ color: CYAN }}>{fmt(total)}</div>
                        <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: '#1f2937' }}>
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: CYAN }}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: PHI, ease: 'easeOut' }}
                          />
                        </div>
                        <div className="text-[10px] font-mono text-gray-500 mt-1">{pct}% of total</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Risk Assessment ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader num="07" title="Risk Assessment" subtitle="Supply dilution risk scoring for upcoming unlocks" />

              <div className="space-y-3">
                {UNLOCK_EVENTS.slice(0, 6).map((ev, i) => {
                  const riskScore = ev.pctSupply > 5 ? 'High' : ev.pctSupply > 2 ? 'Medium' : 'Low'
                  const riskColor = riskScore === 'High' ? '#ef4444' : riskScore === 'Medium' ? '#eab308' : '#22c55e'
                  const riskBarPct = Math.min(100, ev.pctSupply * 10)

                  return (
                    <motion.div
                      key={ev.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 + i * (0.04 * PHI) }}
                      className="p-3 rounded-xl border"
                      style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ev.color }} />
                          <span className="font-mono text-sm text-white font-bold">{ev.protocol}</span>
                          <span className="font-mono text-xs text-gray-500">{ev.token}</span>
                        </div>
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold"
                          style={{ background: `${riskColor}15`, color: riskColor, border: `1px solid ${riskColor}30` }}
                        >
                          {riskScore} Risk
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: riskColor }}
                            initial={{ width: 0 }}
                            animate={{ width: `${riskBarPct}%` }}
                            transition={{ duration: PHI, ease: 'easeOut' }}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-gray-400 w-16 text-right">{ev.pctSupply}% supply</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px] font-mono text-gray-600">
                        <span>{ev.type} unlock in {ev.daysUntil}d</span>
                        <span>{fmt(ev.usdValue)} ({ev.recipient})</span>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              <div className="mt-4 p-3 rounded-xl border text-center"
                style={{ background: `${CYAN}06`, borderColor: `${CYAN}15` }}>
                <div className="font-mono text-[10px] text-gray-400 leading-relaxed">
                  Risk scores are based on unlock size relative to circulating supply.
                  Cliff unlocks carry higher immediate impact risk than linear vesting.
                  Historical data shows an average price recovery within {Math.round(IMPACT_DATA.filter((d) => d.recovered).reduce((s, d) => s + d.recoveryDays, 0) / IMPACT_DATA.filter((d) => d.recovered).length)} days.
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Navigation Links ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <div className="flex items-center justify-center gap-4">
              <Link to="/analytics" className="px-4 py-2 rounded-xl font-mono text-xs text-gray-400 border border-gray-800 hover:border-gray-600 hover:text-white transition-colors">
                Analytics
              </Link>
              <Link to="/tokenomics" className="px-4 py-2 rounded-xl font-mono text-xs text-gray-400 border border-gray-800 hover:border-gray-600 hover:text-white transition-colors">
                Tokenomics
              </Link>
              <Link to="/governance" className="px-4 py-2 rounded-xl font-mono text-xs text-gray-400 border border-gray-800 hover:border-gray-600 hover:text-white transition-colors">
                Governance
              </Link>
            </div>
          </motion.div>

        </motion.div>
      </div>

      {/* Bottom Spacer */}
      <div style={{ height: PHI * 24 }} />
    </div>
  )
}

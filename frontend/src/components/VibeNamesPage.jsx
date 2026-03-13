import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const TAX_RATE = 0.05
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

// ============ Mock Registry Data ============

const MOCK_REGISTRY = {
  'will': { taken: true, owner: '0x7a3B...f91d', value: 500, resolver: '0x7a3B...f91d', depositDays: 142, registered: Date.now() - 86400000 * 90 },
  'jarvis': { taken: true, owner: '0x1c9F...a3e2', value: 1000, resolver: '0x1c9F...a3e2', depositDays: 365, registered: Date.now() - 86400000 * 200 },
  'satoshi': { taken: false },
  'vitalik': { taken: true, owner: '0x4e2a...8bc1', value: 50000, resolver: '0x4e2a...8bc1', depositDays: 730, registered: Date.now() - 86400000 * 400 },
  'degen': { taken: true, owner: '0x9f1d...c4a7', value: 100, resolver: '0x9f1d...c4a7', depositDays: 30, registered: Date.now() - 86400000 * 15 },
  'gm': { taken: true, owner: '0xb2e8...7f3c', value: 2500, resolver: '0xb2e8...7f3c', depositDays: 200, registered: Date.now() - 86400000 * 120 },
  'wagmi': { taken: true, owner: '0xd4f6...1a9e', value: 800, resolver: '0xd4f6...1a9e', depositDays: 90, registered: Date.now() - 86400000 * 45 },
  'ethereum': { taken: true, owner: '0x3a8c...e5d2', value: 25000, resolver: '0x3a8c...e5d2', depositDays: 500, registered: Date.now() - 86400000 * 300 },
  'moon': { taken: false },
  'alpha': { taken: false },
  'vibe': { taken: true, owner: '0x0000...0001', value: 100000, resolver: '0x0000...0001', depositDays: 999, registered: Date.now() - 86400000 * 365 },
}

// ============ Mock User Names (for "My Names") ============

const MOCK_MY_NAMES = [
  {
    name: 'will',
    value: 500,
    dailyTax: (500 * TAX_RATE / 365).toFixed(4),
    depositRemaining: 48.22,
    daysUntilExpiry: 142,
    resolver: '0x7a3B...f91d',
  },
  {
    name: 'jarvis',
    value: 1000,
    dailyTax: (1000 * TAX_RATE / 365).toFixed(4),
    depositRemaining: 136.99,
    daysUntilExpiry: 365,
    resolver: '0x1c9F...a3e2',
  },
]

// ============ Mock Activity Feed ============

const MOCK_ACTIVITY = [
  { id: 1, name: 'will', event: 'registered', value: 500, timestamp: Date.now() - 120000, actor: '0x7a3B...f91d' },
  { id: 2, name: 'degen', event: 'force-acquired', value: 100, timestamp: Date.now() - 340000, actor: '0x9f1d...c4a7', prevOwner: '0xaaaa...bbbb' },
  { id: 3, name: 'gm', event: 'price-adjusted', value: 2500, timestamp: Date.now() - 900000, actor: '0xb2e8...7f3c', prevValue: 1800 },
  { id: 4, name: 'moon', event: 'registered', value: 75, timestamp: Date.now() - 1800000, actor: '0xcccc...dddd' },
  { id: 5, name: 'wagmi', event: 'tax-deposited', value: 800, timestamp: Date.now() - 3600000, actor: '0xd4f6...1a9e', depositAmount: 40 },
  { id: 6, name: 'ethereum', event: 'registered', value: 25000, timestamp: Date.now() - 7200000, actor: '0x3a8c...e5d2' },
  { id: 7, name: 'alpha', event: 'force-acquired', value: 200, timestamp: Date.now() - 14400000, actor: '0xeeee...ffff', prevOwner: '0x1111...2222' },
  { id: 8, name: 'vibe', event: 'price-adjusted', value: 100000, timestamp: Date.now() - 28800000, actor: '0x0000...0001', prevValue: 80000 },
  { id: 9, name: 'satoshi', event: 'expired', value: 0, timestamp: Date.now() - 43200000, actor: '0x5555...6666' },
  { id: 10, name: 'jarvis', event: 'resolver-updated', value: 1000, timestamp: Date.now() - 86400000, actor: '0x1c9F...a3e2' },
]

// ============ Mock Stats ============

const MOCK_STATS = {
  totalRegistered: 8472,
  totalTaxCollected: 284739,
  activeNames: 7891,
  avgValue: 3420,
}

// ============ Helpers ============

function fmtAge(ts) {
  const d = Date.now() - ts
  if (d < 60000) return 'Just now'
  if (d < 3600000) return `${Math.round(d / 60000)}m ago`
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`
  return `${Math.round(d / 86400000)}d ago`
}

function fmtUsd(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtUsdDecimal(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)
}

function eventLabel(event) {
  switch (event) {
    case 'registered': return { text: 'Registered', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.2)' }
    case 'force-acquired': return { text: 'Force-Acquired', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' }
    case 'price-adjusted': return { text: 'Price Adjusted', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.2)' }
    case 'tax-deposited': return { text: 'Tax Deposited', color: '#a855f7', bg: 'rgba(168,85,247,0.1)', border: 'rgba(168,85,247,0.2)' }
    case 'expired': return { text: 'Expired', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' }
    case 'resolver-updated': return { text: 'Resolver Updated', color: CYAN, bg: `${CYAN}15`, border: `${CYAN}30` }
    default: return { text: event, color: '#888', bg: 'rgba(136,136,136,0.1)', border: 'rgba(136,136,136,0.2)' }
  }
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

// ============ Name Search Component ============

function NameSearch() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [searching, setSearching] = useState(false)

  const handleSearch = () => {
    if (!query.trim()) return
    setSearching(true)
    setResult(null)
    // Simulate async lookup
    setTimeout(() => {
      const normalized = query.trim().toLowerCase().replace(/\.vibe$/, '')
      const entry = MOCK_REGISTRY[normalized]
      if (entry) {
        setResult({ name: normalized, ...entry })
      } else {
        setResult({ name: normalized, taken: false })
      }
      setSearching(false)
    }, 600)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch()
  }

  return (
    <div>
      {/* Search Input */}
      <div className="flex items-stretch gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search for a name..."
            className="w-full bg-black/40 rounded-xl px-4 py-3.5 pr-16 text-white placeholder-black-500 outline-none font-mono text-sm transition-all"
            style={{
              border: `1px solid ${result === null ? 'rgba(255,255,255,0.08)' : result.taken ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}`,
            }}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-mono text-black-500">.vibe</span>
        </div>
        <motion.button
          onClick={handleSearch}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-6 rounded-xl font-mono font-bold text-sm transition-all flex items-center gap-2"
          style={{
            background: `${CYAN}15`,
            border: `1px solid ${CYAN}40`,
            color: CYAN,
          }}
        >
          {searching ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              className="w-4 h-4 border-2 rounded-full"
              style={{ borderColor: `${CYAN}40`, borderTopColor: CYAN }}
            />
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search
            </>
          )}
        </motion.button>
      </div>

      {/* Search Results */}
      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={result.name + (result.taken ? 'taken' : 'available')}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="mt-4 rounded-xl p-4"
            style={{
              background: result.taken ? 'rgba(245,158,11,0.05)' : 'rgba(34,197,94,0.05)',
              border: `1px solid ${result.taken ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)'}`,
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-lg"
                  style={{
                    background: result.taken ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
                    border: `1px solid ${result.taken ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}`,
                    color: result.taken ? '#f59e0b' : '#22c55e',
                  }}
                >
                  {result.taken ? '!' : '+'}
                </div>
                <div>
                  <span className="text-base font-mono font-bold text-white">{result.name}.vibe</span>
                  {result.taken ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Taken
                      </span>
                      <span className="text-[10px] font-mono text-black-500">Owner: {result.owner}</span>
                    </div>
                  ) : (
                    <div className="mt-0.5">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                        Available
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                {result.taken ? (
                  <div>
                    <p className="text-sm font-mono font-bold text-amber-400">Force-buy for {fmtUsd(result.value)}</p>
                    <p className="text-[10px] font-mono text-black-500 mt-0.5">Current tax: {fmtUsdDecimal(result.value * TAX_RATE / 365)}/day</p>
                  </div>
                ) : (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="px-4 py-2 rounded-lg font-mono font-bold text-sm"
                    style={{
                      background: 'rgba(34,197,94,0.15)',
                      border: '1px solid rgba(34,197,94,0.35)',
                      color: '#22c55e',
                    }}
                  >
                    Register Now
                  </motion.button>
                )}
              </div>
            </div>

            {result.taken && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full mt-3 py-2.5 rounded-lg font-mono font-bold text-sm transition-all"
                style={{
                  background: 'rgba(245,158,11,0.12)',
                  border: '1px solid rgba(245,158,11,0.3)',
                  color: '#f59e0b',
                }}
              >
                Force-Buy for {fmtUsd(result.value)}
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Search Suggestions */}
      {!result && (
        <div className="mt-3 flex flex-wrap gap-2">
          {['will', 'jarvis', 'satoshi', 'vitalik', 'moon', 'degen'].map((name) => (
            <button
              key={name}
              onClick={() => { setQuery(name); setTimeout(() => { setQuery(name); setSearching(true); setResult(null); setTimeout(() => { const entry = MOCK_REGISTRY[name]; setResult(entry ? { name, ...entry } : { name, taken: false }); setSearching(false) }, 400) }, 0) }}
              className="text-[10px] font-mono px-3 py-1.5 rounded-full transition-all hover:text-white"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}
            >
              {name}.vibe
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============ How It Works ============

const HOW_IT_WORKS_STEPS = [
  {
    step: 1,
    title: 'Register',
    description: 'Pick a name, set what you think it\'s worth. Your self-assessed price determines both your tax and your vulnerability to force-buys.',
    icon: '+',
    color: '#22c55e',
    detail: 'The price you set IS the price others can buy it for.',
  },
  {
    step: 2,
    title: 'Pay Tax',
    description: '5% of your assessed value per year, streamed per-second to the DAO treasury. Continuous, not lump-sum.',
    icon: '%',
    color: '#3b82f6',
    detail: '$1,000 name = $0.14/day streamed to treasury.',
  },
  {
    step: 3,
    title: 'Anyone Can Buy',
    description: 'At your self-assessed price. Set it too low? Someone takes it. Set it too high? Expensive tax. No negotiation.',
    icon: '$',
    color: '#f59e0b',
    detail: 'Force-buy is instant and permissionless.',
  },
  {
    step: 4,
    title: 'Squatters Lose',
    description: 'Economics make idle ownership irrational. Either use the name and price it fairly, or lose it to someone who will.',
    icon: '!',
    color: '#ef4444',
    detail: 'Traditional DNS squatting is eliminated by design.',
  },
]

function HowItWorks() {
  const [expandedStep, setExpandedStep] = useState(null)

  return (
    <div className="space-y-3">
      {HOW_IT_WORKS_STEPS.map((step, i) => (
        <motion.div
          key={step.step}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 + i * (0.08 * PHI), duration: 0.4, ease }}
          className="cursor-pointer"
          onClick={() => setExpandedStep(expandedStep === step.step ? null : step.step)}
        >
          <div
            className="rounded-xl p-4 transition-all"
            style={{
              background: `${step.color}06`,
              border: `1px solid ${expandedStep === step.step ? `${step.color}40` : `${step.color}15`}`,
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-lg"
                style={{ background: `${step.color}15`, border: `1px solid ${step.color}30`, color: step.color }}
              >
                {step.icon}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-mono font-bold" style={{ color: step.color }}>
                    Step {step.step}: {step.title}
                  </h4>
                  <svg
                    className="w-4 h-4 transition-transform"
                    style={{ color: `${step.color}60`, transform: expandedStep === step.step ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <p className="text-[11px] font-mono text-black-300 mt-1 leading-relaxed">{step.description}</p>
                <AnimatePresence>
                  {expandedStep === step.step && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div
                        className="mt-2 p-2.5 rounded-lg"
                        style={{ background: `${step.color}08`, border: `1px solid ${step.color}15` }}
                      >
                        <p className="text-[10px] font-mono" style={{ color: `${step.color}cc` }}>{step.detail}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      ))}

      {/* Harberger Tax Visual */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-2 rounded-xl p-4 text-center"
        style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}15` }}
      >
        <p className="text-[10px] font-mono text-black-400">
          Harberger tax was proposed by economists <span className="text-white">Arnold Harberger</span> and <span className="text-white">Glen Weyl</span>.
          It creates efficient allocation by forcing owners to price assets at their true value — balancing the tax cost against the risk of being bought out.
        </p>
      </motion.div>
    </div>
  )
}

// ============ My Names Table ============

function MyNames() {
  const [adjustingName, setAdjustingName] = useState(null)
  const [newValue, setNewValue] = useState('')

  return (
    <div>
      <div className="space-y-3">
        {MOCK_MY_NAMES.map((entry, i) => {
          const expiryUrgent = entry.daysUntilExpiry < 30
          const expiryWarning = entry.daysUntilExpiry < 90
          return (
            <motion.div
              key={entry.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="rounded-xl overflow-hidden"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              {/* Name Header */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
                      style={{ background: `${CYAN}12`, border: `1px solid ${CYAN}25`, color: CYAN }}
                    >
                      {entry.name[0].toUpperCase()}
                    </div>
                    <div>
                      <span className="text-sm font-mono font-bold text-white">{entry.name}.vibe</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                          Active
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-bold text-white">{fmtUsd(entry.value)}</p>
                    <p className="text-[9px] font-mono text-black-500">Self-Assessed</p>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg p-2.5 text-center" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)' }}>
                    <p className="text-[9px] font-mono text-black-500 uppercase">Daily Tax</p>
                    <p className="text-xs font-mono font-bold text-blue-400">{fmtUsdDecimal(parseFloat(entry.dailyTax))}</p>
                  </div>
                  <div
                    className="rounded-lg p-2.5 text-center"
                    style={{
                      background: expiryUrgent ? 'rgba(239,68,68,0.08)' : expiryWarning ? 'rgba(245,158,11,0.06)' : 'rgba(34,197,94,0.06)',
                      border: `1px solid ${expiryUrgent ? 'rgba(239,68,68,0.2)' : expiryWarning ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.12)'}`,
                    }}
                  >
                    <p className="text-[9px] font-mono text-black-500 uppercase">Deposit Left</p>
                    <p className={`text-xs font-mono font-bold ${expiryUrgent ? 'text-red-400' : expiryWarning ? 'text-amber-400' : 'text-green-400'}`}>
                      {fmtUsdDecimal(entry.depositRemaining)}
                    </p>
                  </div>
                  <div
                    className="rounded-lg p-2.5 text-center"
                    style={{
                      background: expiryUrgent ? 'rgba(239,68,68,0.08)' : 'rgba(168,85,247,0.06)',
                      border: `1px solid ${expiryUrgent ? 'rgba(239,68,68,0.2)' : 'rgba(168,85,247,0.12)'}`,
                    }}
                  >
                    <p className="text-[9px] font-mono text-black-500 uppercase">Expires In</p>
                    <p className={`text-xs font-mono font-bold ${expiryUrgent ? 'text-red-400' : 'text-purple-400'}`}>
                      {entry.daysUntilExpiry}d
                    </p>
                  </div>
                </div>

                {/* Resolver */}
                <div className="mt-2 flex items-center justify-between px-1">
                  <span className="text-[9px] font-mono text-black-500">Resolver: <span className="text-black-400">{entry.resolver}</span></span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="border-t border-white/5 p-3 flex items-center gap-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setAdjustingName(adjustingName === entry.name ? null : entry.name)}
                  className="flex-1 py-2 rounded-lg font-mono font-bold text-[10px] transition-all"
                  style={{ background: `${CYAN}10`, border: `1px solid ${CYAN}25`, color: CYAN }}
                >
                  Adjust Price
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 py-2 rounded-lg font-mono font-bold text-[10px] transition-all"
                  style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}
                >
                  Deposit Tax
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 py-2 rounded-lg font-mono font-bold text-[10px] transition-all"
                  style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)', color: '#a855f7' }}
                >
                  Set Resolver
                </motion.button>
              </div>

              {/* Adjust Price Drawer */}
              <AnimatePresence>
                {adjustingName === entry.name && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-white/5 p-4">
                      <p className="text-[10px] font-mono text-black-400 mb-2">
                        Set a new self-assessed value. Higher = more tax, harder to buy. Lower = less tax, easier to buy.
                      </p>
                      <div className="flex items-stretch gap-2">
                        <div className="flex-1 relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono text-black-500">$</span>
                          <input
                            type="number"
                            value={newValue}
                            onChange={(e) => setNewValue(e.target.value)}
                            placeholder={entry.value.toString()}
                            className="w-full bg-black/40 rounded-lg pl-7 pr-3 py-2.5 text-white placeholder-black-500 outline-none font-mono text-sm"
                            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                          />
                        </div>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="px-4 rounded-lg font-mono font-bold text-[10px]"
                          style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}35`, color: CYAN }}
                        >
                          Confirm
                        </motion.button>
                      </div>
                      {newValue && parseFloat(newValue) > 0 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="mt-2 p-2 rounded-lg"
                          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}
                        >
                          <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-black-500">New daily tax:</span>
                            <span className="text-blue-400">{fmtUsdDecimal(parseFloat(newValue) * TAX_RATE / 365)}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-mono mt-1">
                            <span className="text-black-500">Force-buy price:</span>
                            <span className="text-amber-400">{fmtUsd(parseFloat(newValue))}</span>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>

      {/* Register New Name CTA */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="w-full mt-3 py-3 rounded-xl font-mono font-bold text-sm flex items-center justify-center gap-2 transition-all"
        style={{ background: `${CYAN}08`, border: `1px dashed ${CYAN}30`, color: `${CYAN}99` }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Register Another Name
      </motion.button>
    </div>
  )
}

// ============ Live Activity Feed ============

function LiveActivity() {
  const [visibleCount, setVisibleCount] = useState(6)

  return (
    <div>
      <div className="space-y-2">
        {MOCK_ACTIVITY.slice(0, visibleCount).map((entry, i) => {
          const label = eventLabel(entry.event)
          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              className="flex items-center justify-between rounded-lg p-3"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0"
                  style={{ background: label.bg, border: `1px solid ${label.border}`, color: label.color }}
                >
                  {entry.event === 'registered' && '+'}
                  {entry.event === 'force-acquired' && '$'}
                  {entry.event === 'price-adjusted' && '~'}
                  {entry.event === 'tax-deposited' && '%'}
                  {entry.event === 'expired' && 'x'}
                  {entry.event === 'resolver-updated' && '@'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-white">{entry.name}.vibe</span>
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                      style={{ background: label.bg, border: `1px solid ${label.border}`, color: label.color }}
                    >
                      {label.text}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-black-500 mt-0.5">
                    {entry.event === 'registered' && `Registered at ${fmtUsd(entry.value)} by ${entry.actor}`}
                    {entry.event === 'force-acquired' && `Force-acquired for ${fmtUsd(entry.value)} by ${entry.actor}`}
                    {entry.event === 'price-adjusted' && `Price changed from ${fmtUsd(entry.prevValue)} to ${fmtUsd(entry.value)}`}
                    {entry.event === 'tax-deposited' && `${fmtUsd(entry.depositAmount)} deposited by ${entry.actor}`}
                    {entry.event === 'expired' && `Tax deposit depleted, name released`}
                    {entry.event === 'resolver-updated' && `Resolver updated by ${entry.actor}`}
                  </p>
                </div>
              </div>
              <span className="text-[9px] font-mono text-black-600 flex-shrink-0 ml-2">{fmtAge(entry.timestamp)}</span>
            </motion.div>
          )
        })}
      </div>

      {visibleCount < MOCK_ACTIVITY.length && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setVisibleCount(MOCK_ACTIVITY.length)}
          className="w-full mt-3 py-2.5 rounded-lg font-mono text-[10px] text-black-400 hover:text-black-200 transition-colors"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          Show all {MOCK_ACTIVITY.length} entries
        </motion.button>
      )}
    </div>
  )
}

// ============ Stats Bar ============

function StatsBar() {
  const [stats, setStats] = useState({
    totalRegistered: 0,
    totalTaxCollected: 0,
    activeNames: 0,
    avgValue: 0,
  })

  useEffect(() => {
    const targets = MOCK_STATS
    const steps = 40
    let step = 0
    const iv = setInterval(() => {
      step++
      const t = Math.min(step / steps, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setStats({
        totalRegistered: Math.floor(targets.totalRegistered * eased),
        totalTaxCollected: Math.floor(targets.totalTaxCollected * eased),
        activeNames: Math.floor(targets.activeNames * eased),
        avgValue: Math.floor(targets.avgValue * eased),
      })
      if (step >= steps) clearInterval(iv)
    }, 30)
    return () => clearInterval(iv)
  }, [])

  const cards = [
    { label: 'Total Registered', value: stats.totalRegistered.toLocaleString(), color: CYAN, icon: '#' },
    { label: 'Tax Collected', value: fmtUsd(stats.totalTaxCollected), color: '#22c55e', icon: '$' },
    { label: 'Active Names', value: stats.activeNames.toLocaleString(), color: '#a855f7', icon: '~' },
    { label: 'Avg Assessed Value', value: fmtUsd(stats.avgValue), color: '#f59e0b', icon: '%' },
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

// ============ Economics Explainer ============

function EconomicsExplainer() {
  const [exampleValue, setExampleValue] = useState(1000)
  const annualTax = exampleValue * TAX_RATE
  const dailyTax = annualTax / 365
  const monthlyTax = annualTax / 12

  const presets = [1, 100, 1000, 10000, 100000]

  return (
    <div>
      {/* Interactive Slider */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Self-Assessed Value</span>
          <span className="text-sm font-mono font-bold text-white">{fmtUsd(exampleValue)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={100000}
          step={1}
          value={exampleValue}
          onChange={(e) => setExampleValue(parseInt(e.target.value))}
          className="w-full accent-cyan-500 cursor-pointer"
          style={{ accentColor: CYAN }}
        />
        <div className="flex items-center justify-between mt-2 gap-1.5">
          {presets.map((v) => (
            <button
              key={v}
              onClick={() => setExampleValue(v)}
              className="flex-1 py-1.5 rounded-lg font-mono text-[9px] transition-all"
              style={{
                background: exampleValue === v ? `${CYAN}20` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${exampleValue === v ? `${CYAN}40` : 'rgba(255,255,255,0.06)'}`,
                color: exampleValue === v ? CYAN : 'rgba(255,255,255,0.4)',
              }}
            >
              {fmtUsd(v)}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="space-y-2">
        <div
          className="flex items-center justify-between rounded-lg p-3"
          style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>Y</div>
            <span className="text-[11px] font-mono text-black-300">Annual Tax (5%)</span>
          </div>
          <span className="text-sm font-mono font-bold text-blue-400">{fmtUsdDecimal(annualTax)}</span>
        </div>
        <div
          className="flex items-center justify-between rounded-lg p-3"
          style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>M</div>
            <span className="text-[11px] font-mono text-black-300">Monthly Tax</span>
          </div>
          <span className="text-sm font-mono font-bold text-purple-400">{fmtUsdDecimal(monthlyTax)}</span>
        </div>
        <div
          className="flex items-center justify-between rounded-lg p-3"
          style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}15` }}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold" style={{ background: `${CYAN}15`, color: CYAN }}>D</div>
            <span className="text-[11px] font-mono text-black-300">Daily Tax</span>
          </div>
          <span className="text-sm font-mono font-bold" style={{ color: CYAN }}>{fmtUsdDecimal(dailyTax)}</span>
        </div>
        <div
          className="flex items-center justify-between rounded-lg p-3"
          style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>!</div>
            <span className="text-[11px] font-mono text-black-300">Force-Buy Price</span>
          </div>
          <span className="text-sm font-mono font-bold text-amber-400">{fmtUsd(exampleValue)}</span>
        </div>
      </div>

      {/* The Sweet Spot Explanation */}
      <div className="mt-4 space-y-2">
        <div className="rounded-lg p-3" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <p className="text-[10px] font-mono text-black-400">
            <span className="text-red-400 font-bold">Set it at $1:</span> Cheap tax ({fmtUsdDecimal(1 * TAX_RATE / 365)}/day),
            but anyone can grab it for just $1.
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)' }}>
          <p className="text-[10px] font-mono text-black-400">
            <span className="text-amber-400 font-bold">Set it at $100,000:</span> Nobody will buy it,
            but you pay {fmtUsdDecimal(100000 * TAX_RATE / 365)}/day in tax.
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
          <p className="text-[10px] font-mono text-black-400">
            <span className="text-green-400 font-bold">The sweet spot:</span> Price it at what it's <span className="text-white">actually worth to you</span>.
            That's the Nash equilibrium — the Harberger-optimal strategy.
          </p>
        </div>
      </div>

      {/* Tax Flow */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="mt-4 rounded-xl p-4 text-center"
        style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}15` }}
      >
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px]" style={{ background: `${CYAN}15`, color: CYAN }}>$</div>
            <span className="text-[10px] font-mono text-black-400">Tax</span>
          </div>
          <svg className="w-4 h-4 text-black-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px]" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>D</div>
            <span className="text-[10px] font-mono text-black-400">DAO Treasury</span>
          </div>
          <svg className="w-4 h-4 text-black-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px]" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>P</div>
            <span className="text-[10px] font-mono text-black-400">Public Goods</span>
          </div>
        </div>
        <p className="text-[9px] font-mono text-black-500 mt-2">
          All tax revenue flows to the DAO treasury and funds public goods. No rent extraction.
        </p>
      </motion.div>
    </div>
  )
}

// ============ Comparison Table: Traditional DNS vs .vibe ============

function ComparisonTable() {
  const [hoveredRow, setHoveredRow] = useState(null)

  const rows = [
    { aspect: 'Squatting', dns: 'Legal, profitable', vibe: 'Economically irrational', dnsColor: '#ef4444', vibeColor: '#22c55e' },
    { aspect: 'Pricing', dns: 'Flat fee ($12/yr)', vibe: 'Self-assessed + 5% tax', dnsColor: '#f59e0b', vibeColor: '#22c55e' },
    { aspect: 'Transfers', dns: 'Negotiation required', vibe: 'Instant force-buy at listed price', dnsColor: '#ef4444', vibeColor: '#22c55e' },
    { aspect: 'Revenue', dns: 'Goes to registrar (ICANN)', vibe: 'Goes to DAO treasury (public goods)', dnsColor: '#ef4444', vibeColor: '#22c55e' },
    { aspect: 'Disputes', dns: 'UDRP (expensive, slow)', vibe: 'None needed (market resolves)', dnsColor: '#ef4444', vibeColor: '#22c55e' },
    { aspect: 'Idle Cost', dns: 'Near zero ($12/yr)', vibe: '5% of assessed value/yr', dnsColor: '#22c55e', vibeColor: '#f59e0b' },
  ]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-2 mb-1">
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Aspect</span>
        <span className="text-[9px] font-mono text-red-400/60 uppercase tracking-wider text-center">Traditional DNS</span>
        <span className="text-[9px] font-mono uppercase tracking-wider text-center" style={{ color: `${CYAN}99` }}>.vibe Network</span>
      </div>
      {rows.map((row, i) => (
        <motion.div
          key={row.aspect}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * (0.06 * PHI), duration: 0.3 }}
          className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center rounded-lg p-3 cursor-default"
          style={{
            background: hoveredRow === i ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.3)',
            border: `1px solid ${hoveredRow === i ? `${CYAN}15` : 'rgba(255,255,255,0.04)'}`,
          }}
          onMouseEnter={() => setHoveredRow(i)}
          onMouseLeave={() => setHoveredRow(null)}
        >
          <span className="text-[11px] font-mono text-white font-bold">{row.aspect}</span>
          <span className="text-[10px] font-mono text-center" style={{ color: `${row.dnsColor}cc` }}>{row.dns}</span>
          <span className="text-[10px] font-mono text-center" style={{ color: `${row.vibeColor}cc` }}>{row.vibe}</span>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Main Component ============

export default function VibeNamesPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 14 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 19) % 100}%`, top: `${(i * PHI * 27) % 100}%` }}
            animate={{ opacity: [0, 0.25, 0], scale: [0, 1.5, 0], y: [0, -40 - (i % 5) * 15] }}
            transition={{ duration: 3.5 + (i % 4) * 1, repeat: Infinity, delay: (i * 0.7) % 5, ease: 'easeOut' }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-8 md:pt-14">
        {/* ============ Hero Header ============ */}
        <motion.div variants={headerV} initial="hidden" animate="visible" className="text-center mb-10">
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="w-28 h-px mx-auto mb-5"
            style={{ background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)` }}
          />
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.08em] uppercase mb-3"
            style={{ textShadow: `0 0 40px ${CYAN}33` }}>
            <span style={{ color: CYAN }}>.vibe</span>
            <span className="text-black-500 mx-2"> </span>
            <span className="text-white">network</span>
          </h1>
          <p className="text-sm text-black-300 font-mono mb-2 max-w-lg mx-auto">
            Own your identity. Pay what it's worth. Squatters pay or get bought out.
          </p>
          <p className="text-xs text-black-500 font-mono italic max-w-md mx-auto">
            Harberger tax = self-assessed value + continuous tax + anyone can force-buy at your price.
            No squatting. No rent-seeking. Just fair allocation.
          </p>

          {/* Badges */}
          <div className="flex items-center justify-center space-x-2 mt-4 flex-wrap gap-y-1">
            <span className="flex items-center space-x-1.5 px-2 py-1 rounded-full" style={{ background: `${CYAN}0F`, border: `1px solid ${CYAN}25` }}>
              <span className="text-[10px] font-medium" style={{ color: CYAN }}>Harberger Tax</span>
            </span>
            <span className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20">
              <span className="text-[10px] text-green-400 font-medium">Anti-Squatter</span>
            </span>
            <span className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">
              <span className="text-[10px] text-purple-400 font-medium">DAO Treasury</span>
            </span>
          </div>
        </motion.div>

        <div className="space-y-6">
          {/* ============ Name Search ============ */}
          <Section index={0} title="Search Names" subtitle="Check availability or find force-buy prices">
            <NameSearch />
          </Section>

          {/* ============ How It Works ============ */}
          <Section index={1} title="How It Works" subtitle="Four steps to Harberger-optimal naming">
            <HowItWorks />
          </Section>

          {/* ============ My Names (Connected Only) ============ */}
          {isConnected && (
            <Section index={2} title="My Names" subtitle="Manage your .vibe name portfolio">
              <MyNames />
            </Section>
          )}

          {/* ============ Not Connected Prompt ============ */}
          {!isConnected && (
            <motion.div custom={2} variants={sectionV} initial="hidden" animate="visible">
              <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
                <div className="text-center py-4">
                  <div
                    className="w-14 h-14 rounded-xl mx-auto mb-3 flex items-center justify-center"
                    style={{ background: `${CYAN}10`, border: `1px solid ${CYAN}20` }}
                  >
                    <svg className="w-7 h-7" style={{ color: `${CYAN}60` }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <p className="text-sm font-mono text-black-300 mb-1">Connect wallet to manage your .vibe names</p>
                  <p className="text-[10px] font-mono text-black-500">Register names, adjust prices, deposit tax, set resolvers</p>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* ============ Live Activity Feed ============ */}
          <Section index={3} title="Live Names" subtitle="Recent registrations, force-acquisitions, and updates">
            <LiveActivity />
          </Section>

          {/* ============ Stats Bar ============ */}
          <Section index={4} title="Network Statistics" subtitle="Cumulative .vibe network metrics">
            <StatsBar />
          </Section>

          {/* ============ Economics Explainer ============ */}
          <Section index={5} title="Economics" subtitle="Interactive Harberger tax calculator">
            <EconomicsExplainer />
          </Section>

          {/* ============ Comparison Table ============ */}
          <Section index={6} title="Traditional DNS vs .vibe" subtitle="Why Harberger taxation is superior for naming">
            <ComparisonTable />
          </Section>
        </div>

        {/* ============ Cross Links ============ */}
        <motion.div custom={7} variants={sectionV} initial="hidden" animate="visible" className="mt-8">
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { path: '/governance', label: 'Governance' },
              { path: '/economics', label: 'Economics' },
              { path: '/gametheory', label: 'Game Theory' },
              { path: '/', label: 'Trade' },
            ].map(link => (
              <a
                key={link.path}
                href={link.path}
                className="text-[10px] font-mono px-3 py-1.5 rounded-full transition-all hover:text-cyan-400"
                style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15`, color: `${CYAN}99` }}
              >
                {link.label}
              </a>
            ))}
          </div>
        </motion.div>

        {/* ============ Footer Quote ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <blockquote className="max-w-md mx-auto">
            <p className="text-sm text-black-300 italic">
              "Property is most justly owned when it is most productively used. Harberger taxation
              aligns ownership with utility — the idle pay, the active thrive."
            </p>
          </blockquote>
          <div className="w-16 h-px mx-auto my-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">.vibe network — Harberger Names</p>
        </motion.div>
      </div>
    </div>
  )
}

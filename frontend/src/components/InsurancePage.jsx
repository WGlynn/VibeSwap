import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Coverage Types ============

const COVERAGE_TYPES = [
  { id: 'smart-contract', label: 'Smart Contract Risk', icon: '\u{1F4DC}', availableCover: 12_500_000, premiumRate: 2.6, riskScore: 72, description: 'Covers losses from smart contract bugs or exploits' },
  { id: 'stablecoin-depeg', label: 'Stablecoin Depeg', icon: '\u{1F4B5}', availableCover: 8_200_000, premiumRate: 1.8, riskScore: 45, description: 'Protects against stablecoin depegging events' },
  { id: 'oracle-failure', label: 'Oracle Failure', icon: '\u{1F52E}', availableCover: 5_700_000, premiumRate: 3.1, riskScore: 58, description: 'Covers losses from oracle manipulation or downtime' },
  { id: 'bridge-exploit', label: 'Bridge Exploit', icon: '\u{1F309}', availableCover: 9_400_000, premiumRate: 4.2, riskScore: 81, description: 'Protection against cross-chain bridge vulnerabilities' },
  { id: 'liquidation', label: 'Liquidation Protection', icon: '\u{1F6E1}', availableCover: 6_800_000, premiumRate: 2.1, riskScore: 34, description: 'Guards against cascading liquidation events' },
]

// ============ Mock Policies ============

const MOCK_POLICIES = [
  { id: 1, type: 'Smart Contract Risk', covered: 50_000, premium: 1_300, expiry: new Date(Date.now() + 45 * 86400000), status: 'active' },
  { id: 2, type: 'Bridge Exploit', covered: 25_000, premium: 1_050, expiry: new Date(Date.now() + 120 * 86400000), status: 'active' },
  { id: 3, type: 'Stablecoin Depeg', covered: 100_000, premium: 1_800, expiry: new Date(Date.now() - 10 * 86400000), status: 'expired' },
]

// ============ Mock Risk Protocols ============

const PROTOCOL_RISKS = [
  { name: 'VibeSwap AMM', score: 92, audits: 3, tvl: 48_000_000, category: 'DEX' },
  { name: 'Aave V3', score: 95, audits: 7, tvl: 12_400_000_000, category: 'Lending' },
  { name: 'Compound', score: 91, audits: 5, tvl: 2_100_000_000, category: 'Lending' },
  { name: 'Curve Finance', score: 88, audits: 4, tvl: 3_800_000_000, category: 'DEX' },
  { name: 'Lido', score: 90, audits: 6, tvl: 14_200_000_000, category: 'Staking' },
  { name: 'GMX', score: 85, audits: 2, tvl: 580_000_000, category: 'Perps' },
]

// ============ Mock DeFi Positions ============

const MOCK_POSITIONS = [
  { protocol: 'VibeSwap AMM', asset: 'ETH/USDC LP', value: 12_400, covered: true },
  { protocol: 'Aave V3', asset: 'USDC Supply', value: 25_000, covered: false },
  { protocol: 'Lido', asset: 'stETH', value: 8_200, covered: false },
  { protocol: 'Curve Finance', asset: '3pool LP', value: 15_800, covered: false },
]

// ============ Exploit History (for premium model) ============

const EXPLOIT_HISTORY = [
  { year: 2021, exploits: 12, totalLoss: 1_300_000_000 },
  { year: 2022, exploits: 31, totalLoss: 3_800_000_000 },
  { year: 2023, exploits: 18, totalLoss: 1_700_000_000 },
  { year: 2024, exploits: 9, totalLoss: 420_000_000 },
  { year: 2025, exploits: 4, totalLoss: 180_000_000 },
]

// ============ Duration Options ============

const DURATIONS = [
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 180, label: '180d' },
  { days: 365, label: '365d' },
]

// ============ Claims Steps ============

const CLAIMS_STEPS = [
  { step: 1, title: 'File Claim', description: 'Submit evidence of the exploit or failure event with on-chain proof', icon: '\u{1F4CB}', duration: 'Instant' },
  { step: 2, title: 'Community Vote', description: 'VIBE token holders review evidence and vote on claim validity', icon: '\u{1F5F3}', duration: '48-72 hours' },
  { step: 3, title: 'Payout', description: 'Approved claims are paid automatically from the insurance pool', icon: '\u{1F4B0}', duration: 'Within 24 hours' },
]

// ============ Utility Functions ============

function fmt(n) {
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K'
  return '$' + n.toFixed(0)
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(0)
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(d) { return Math.max(0, Math.ceil((d - Date.now()) / 86400000)) }

function riskColor(score) {
  if (score >= 90) return '#22c55e'
  if (score >= 75) return '#eab308'
  if (score >= 60) return '#f97316'
  return '#ef4444'
}

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

// ============ Animated Shield ============

function CoverageShield({ isConnected, totalCovered }) {
  const rings = 3
  return (
    <div className="relative w-32 h-32 mx-auto">
      {Array.from({ length: rings }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute inset-0 rounded-full border"
          style={{
            borderColor: isConnected ? `${CYAN}${Math.round(30 + i * 20).toString(16)}` : 'rgba(55,55,55,0.4)',
            inset: `${i * 12}px`,
          }}
          animate={{
            scale: [1, 1 + (0.03 / (i + 1)), 1],
            opacity: [0.6, 1, 0.6],
          }}
          transition={{
            duration: PHI * (1.5 + i * 0.4),
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.3,
          }}
        />
      ))}
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: PHI * 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <svg className="w-14 h-14" viewBox="0 0 24 24" fill="none" stroke={isConnected ? CYAN : '#555'} strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      </motion.div>
      {isConnected && (
        <motion.div
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs font-mono whitespace-nowrap"
          style={{ color: CYAN }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          {fmt(totalCovered)} covered
        </motion.div>
      )}
    </div>
  )
}

// ============ Main Component ============

export default function InsurancePage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ============ State ============
  const [selectedCoverage, setSelectedCoverage] = useState(0)
  const [coverAmount, setCoverAmount] = useState('')
  const [selectedDuration, setSelectedDuration] = useState(1)
  const [depositAmount, setDepositAmount] = useState('')
  const [activeTab, setActiveTab] = useState('overview')

  // ============ Mock pool data ============
  const poolTVL = 42_800_000
  const userStake = 15_000
  const earnedPremiums = 842
  const poolAPY = 9.4

  // ============ Computed premium ============
  const premium = useMemo(() => {
    const amount = parseFloat(coverAmount) || 0
    const rate = COVERAGE_TYPES[selectedCoverage].premiumRate / 100
    const duration = DURATIONS[selectedDuration].days
    return amount * rate * (duration / 365)
  }, [coverAmount, selectedCoverage, selectedDuration])

  // User-specific data: real when connected (empty), mock for demo
  const policies = isConnected ? [] : MOCK_POLICIES
  const userPositions = isConnected ? [] : MOCK_POSITIONS

  const totalCoveredAmount = policies
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + p.covered, 0)

  // ============ Not Connected ============

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard glowColor="terminal" className="max-w-md mx-auto p-8 text-center">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
            <CoverageShield isConnected={false} totalCovered={0} />
            <h2 className="text-2xl font-bold font-mono mb-3 mt-8 text-white">
              Connect to <span style={{ color: CYAN }}>Protect</span>
            </h2>
            <p className="text-black-400 mb-6">
              Mutualized DeFi insurance powered by cooperative capitalism.
              Protect your positions against exploits, depegs, and failures.
            </p>
            <button
              onClick={connect}
              className="px-8 py-3 rounded-xl font-semibold transition-all"
              style={{ background: CYAN, color: '#000' }}
            >
              Sign In
            </button>
          </motion.div>
        </GlassCard>
      </div>
    )
  }

  // ============ Connected Layout ============

  return (
    <div className="max-w-4xl mx-auto px-4 space-y-6">

      {/* ============ Header ============ */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-5d">Insurance</h1>
            <p className="text-black-400 mt-1">Mutualized risk protection for your DeFi positions</p>
            <div className="flex items-center space-x-2 mt-2">
              <div className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-matrix-500/10 border border-matrix-500/20">
                <svg className="w-3 h-3 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-[10px] text-matrix-500 font-medium">cooperative capitalism</span>
              </div>
            </div>
          </div>
          <CoverageShield isConnected={true} totalCovered={totalCoveredAmount} />
        </div>
      </motion.div>

      {/* ============ Tab Navigation ============ */}
      <div className="flex space-x-1 p-1 bg-black-800/50 rounded-xl w-fit">
        {['overview', 'buy', 'policies', 'underwrite', 'claims'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
              activeTab === tab
                ? 'bg-black-700 text-white'
                : 'text-black-400 hover:text-black-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ============ 1. Insurance Overview ============ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <Section num="01" title="Insurance Overview" delay={0.1}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Cover', value: fmt(totalCoveredAmount), color: CYAN },
                { label: 'Active Policies', value: policies.filter(p => p.status === 'active').length.toString(), color: '#22c55e' },
                { label: 'Claims Paid', value: '$0', color: '#a855f7' },
                { label: 'Pool TVL', value: fmt(poolTVL), color: '#eab308' },
              ].map(({ label, value, color }) => (
                <GlassCard key={label} glowColor="terminal" className="p-4">
                  <div className="text-xs text-black-400 mb-1">{label}</div>
                  <div className="text-xl font-bold font-mono" style={{ color }}>{value}</div>
                </GlassCard>
              ))}
            </div>
          </Section>

          {/* ============ 2. Coverage Types Grid ============ */}
          <Section num="02" title="Coverage Types" delay={0.2}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {COVERAGE_TYPES.map((ct, i) => (
                <motion.div
                  key={ct.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.08 }}
                >
                  <GlassCard glowColor="terminal" className="p-4 cursor-pointer" onClick={() => { setSelectedCoverage(i); setActiveTab('buy') }}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{ct.icon}</span>
                      <div>
                        <div className="font-semibold text-sm">{ct.label}</div>
                        <div className="text-xs text-black-400">{ct.premiumRate}% annual premium</div>
                      </div>
                    </div>
                    <p className="text-xs text-black-500 mb-3">{ct.description}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-black-400">Available Cover</span>
                      <span className="font-mono" style={{ color: CYAN }}>{fmt(ct.availableCover)}</span>
                    </div>
                    <div className="mt-2 w-full h-1.5 bg-black-700 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: CYAN }}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, ct.riskScore)}%` }}
                        transition={{ duration: 0.8, delay: 0.3 + i * 0.1 }}
                      />
                    </div>
                    <div className="text-[10px] text-black-500 mt-1 text-right">Risk: {ct.riskScore}/100</div>
                  </GlassCard>
                </motion.div>
              ))}
            </div>
          </Section>

          {/* ============ 7. Risk Assessment Dashboard ============ */}
          <Section num="03" title="Risk Assessment" delay={0.3}>
            <GlassCard glowColor="terminal" className="p-4">
              <div className="space-y-3">
                {PROTOCOL_RISKS.map((p) => (
                  <div key={p.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                        style={{ background: `${riskColor(p.score)}20`, color: riskColor(p.score) }}>
                        {p.score}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-xs text-black-500">{p.category} &middot; {p.audits} audits &middot; TVL {fmt(p.tvl)}</div>
                      </div>
                    </div>
                    <div className="flex-shrink-0 w-24 h-2 bg-black-700 rounded-full overflow-hidden ml-3">
                      <div className="h-full rounded-full" style={{ width: `${p.score}%`, background: riskColor(p.score) }} />
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </Section>

          {/* ============ 9. Premium Pricing Model ============ */}
          <Section num="04" title="Premium Pricing Model" delay={0.4}>
            <GlassCard glowColor="terminal" className="p-4">
              <p className="text-sm text-black-400 mb-4">
                Premiums are calculated from historical exploit frequency, protocol TVL, and current pool capacity.
                Lower risk protocols receive lower premiums, incentivizing secure development.
              </p>
              <div className="grid grid-cols-5 gap-2">
                {EXPLOIT_HISTORY.map((e) => (
                  <div key={e.year} className="text-center">
                    <div className="relative h-20 flex items-end justify-center mb-2">
                      <motion.div
                        className="w-8 rounded-t"
                        style={{ background: `${CYAN}80` }}
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.min(100, (e.exploits / 35) * 100)}%` }}
                        transition={{ duration: 0.6, delay: 0.5 }}
                      />
                    </div>
                    <div className="text-xs font-mono text-black-300">{e.year}</div>
                    <div className="text-[10px] text-black-500">{e.exploits} exploits</div>
                    <div className="text-[10px] font-mono" style={{ color: CYAN }}>{fmt(e.totalLoss)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-lg bg-black-900/50 text-xs text-black-400">
                <span className="font-semibold text-black-300">Formula: </span>
                Premium = Coverage Amount x Base Rate x (Protocol Risk / 100) x (Duration / 365)
              </div>
            </GlassCard>
          </Section>

          {/* ============ 10. Mutualized Risk Explanation ============ */}
          <Section num="05" title="Mutualized Risk" delay={0.5}>
            <GlassCard glowColor="terminal" className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4">
                  <motion.div
                    className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
                    style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}30` }}
                    animate={{ scale: [1, 1 + 0.03 / PHI, 1] }}
                    transition={{ duration: PHI * 2, repeat: Infinity }}
                  >
                    <span className="text-xl">{'\u{1F91D}'}</span>
                  </motion.div>
                  <div className="font-semibold text-sm mb-1">Pool Together</div>
                  <p className="text-xs text-black-400">
                    Underwriters deposit capital into a shared pool. Risk is distributed across all
                    participants, not concentrated on any single entity.
                  </p>
                </div>
                <div className="text-center p-4">
                  <motion.div
                    className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
                    style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}30` }}
                    animate={{ scale: [1, 1 + 0.03 / PHI, 1] }}
                    transition={{ duration: PHI * 2, repeat: Infinity, delay: 0.5 }}
                  >
                    <span className="text-xl">{'\u{1F4CA}'}</span>
                  </motion.div>
                  <div className="font-semibold text-sm mb-1">Earn Premiums</div>
                  <p className="text-xs text-black-400">
                    Premium payments from coverage buyers flow to underwriters proportional to their
                    stake. Higher capital commitment earns more premium income.
                  </p>
                </div>
                <div className="text-center p-4">
                  <motion.div
                    className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
                    style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}30` }}
                    animate={{ scale: [1, 1 + 0.03 / PHI, 1] }}
                    transition={{ duration: PHI * 2, repeat: Infinity, delay: 1.0 }}
                  >
                    <span className="text-xl">{'\u{1F6E1}'}</span>
                  </motion.div>
                  <div className="font-semibold text-sm mb-1">Shared Protection</div>
                  <p className="text-xs text-black-400">
                    Claims are paid from the pool. No single underwriter bears catastrophic loss.
                    Community governance ensures fair claim resolution.
                  </p>
                </div>
              </div>
              <div className="mt-4 p-3 rounded-lg bg-black-900/50 text-xs text-black-400 text-center">
                Cooperative Capitalism: mutualized risk pools + free-market premium competition = fairness above all.
              </div>
            </GlassCard>
          </Section>
        </div>
      )}

      {/* ============ 3. Buy Coverage Tab ============ */}
      {activeTab === 'buy' && (
        <div className="space-y-6">
          <Section num="01" title="Buy Coverage" delay={0.1}>
            <GlassCard glowColor="terminal" className="p-5">
              {/* Coverage Type Selector */}
              <div className="mb-5">
                <label className="text-sm text-black-400 mb-2 block">Coverage Type</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {COVERAGE_TYPES.map((ct, i) => (
                    <button
                      key={ct.id}
                      onClick={() => setSelectedCoverage(i)}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                        selectedCoverage === i
                          ? 'border-terminal-500/50 bg-terminal-500/10'
                          : 'border-black-700 bg-black-800/50 hover:border-black-600'
                      }`}
                    >
                      <span className="text-xl">{ct.icon}</span>
                      <div>
                        <div className="text-sm font-medium">{ct.label}</div>
                        <div className="text-xs text-black-500">{ct.premiumRate}% annual</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount to Cover */}
              <div className="mb-5">
                <label className="text-sm text-black-400 mb-2 block">Amount to Cover (USD)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black-500 font-mono">$</span>
                  <input
                    type="number"
                    value={coverAmount}
                    onChange={(e) => setCoverAmount(e.target.value)}
                    placeholder="10,000"
                    className="w-full bg-black-700 rounded-xl px-8 py-3 text-lg font-mono outline-none focus:ring-1 focus:ring-terminal-500/50 placeholder-black-500"
                  />
                </div>
                <div className="text-xs text-black-500 mt-1">
                  Available: {fmt(COVERAGE_TYPES[selectedCoverage].availableCover)}
                </div>
              </div>

              {/* Duration Selector */}
              <div className="mb-5">
                <label className="text-sm text-black-400 mb-2 block">Duration</label>
                <div className="flex gap-2">
                  {DURATIONS.map((d, i) => (
                    <button
                      key={d.days}
                      onClick={() => setSelectedDuration(i)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        selectedDuration === i
                          ? 'bg-terminal-500/20 border border-terminal-500/40 text-white'
                          : 'bg-black-700 border border-black-600 text-black-400 hover:text-black-200'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Premium Calculator */}
              <div className="p-4 rounded-xl bg-black-900/50 space-y-3 mb-5">
                <div className="text-sm font-semibold text-black-300">Premium Breakdown</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black-400">Coverage Amount</span>
                  <span className="font-mono">{coverAmount ? fmt(parseFloat(coverAmount)) : '$0'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black-400">Annual Rate</span>
                  <span className="font-mono">{COVERAGE_TYPES[selectedCoverage].premiumRate}%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black-400">Duration</span>
                  <span className="font-mono">{DURATIONS[selectedDuration].days} days</span>
                </div>
                <div className="border-t border-black-700 my-2" />
                <div className="flex items-center justify-between">
                  <span className="text-black-300 font-medium">Total Premium</span>
                  <span className="text-lg font-bold font-mono" style={{ color: CYAN }}>{fmt(premium)}</span>
                </div>
              </div>

              {/* Buy Button */}
              <button
                className="w-full py-4 rounded-xl font-semibold text-lg transition-all"
                style={{
                  background: coverAmount && parseFloat(coverAmount) > 0 ? CYAN : '#333',
                  color: coverAmount && parseFloat(coverAmount) > 0 ? '#000' : '#666',
                }}
              >
                {coverAmount && parseFloat(coverAmount) > 0
                  ? `Buy Coverage for ${fmt(premium)}`
                  : 'Enter Coverage Amount'}
              </button>
            </GlassCard>
          </Section>

          {/* ============ 8. Coverage Adequacy Check ============ */}
          <Section num="02" title="Are You Covered?" delay={0.2}>
            <GlassCard glowColor="terminal" className="p-4">
              <p className="text-sm text-black-400 mb-4">
                We scan your DeFi positions and recommend coverage to protect your portfolio.
              </p>
              <div className="space-y-3">
                {userPositions.map((pos) => (
                  <div key={pos.protocol + pos.asset} className="flex items-center justify-between p-3 rounded-xl bg-black-800/50">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        pos.covered ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
                      }`} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{pos.protocol}</div>
                        <div className="text-xs text-black-500">{pos.asset}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-sm font-mono">{fmt(pos.value)}</div>
                        <div className={`text-xs ${pos.covered ? 'text-green-400' : 'text-yellow-400'}`}>
                          {pos.covered ? 'Covered' : 'Unprotected'}
                        </div>
                      </div>
                      {!pos.covered && (
                        <button
                          onClick={() => { setCoverAmount(pos.value.toString()); setActiveTab('buy') }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                          style={{ background: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}40` }}
                        >
                          Cover
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <div className="flex items-start gap-2">
                  <span className="text-yellow-400 text-sm mt-0.5">{'\u26A0'}</span>
                  <div className="text-xs text-black-300">
                    <span className="font-semibold text-yellow-400">
                      {userPositions.filter(p => !p.covered).length} positions unprotected
                    </span>
                    <span className="text-black-400"> &mdash; {fmt(userPositions.filter(p => !p.covered).reduce((s, p) => s + p.value, 0))} at risk. </span>
                    Consider purchasing coverage to protect your portfolio.
                  </div>
                </div>
              </div>
            </GlassCard>
          </Section>
        </div>
      )}

      {/* ============ 4. Your Policies Tab ============ */}
      {activeTab === 'policies' && (
        <Section num="01" title="Your Policies" delay={0.1}>
          <GlassCard glowColor="terminal" className="p-4">
            {policies.length === 0 ? (
              <div className="text-center py-8 text-black-400">
                No active policies. Buy coverage to protect your positions.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-black-500 text-xs border-b border-black-700">
                      <th className="text-left py-3 font-medium">Type</th>
                      <th className="text-right py-3 font-medium">Covered</th>
                      <th className="text-right py-3 font-medium">Premium</th>
                      <th className="text-right py-3 font-medium">Expiry</th>
                      <th className="text-right py-3 font-medium">Status</th>
                      <th className="text-right py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((policy, i) => (
                      <motion.tr
                        key={policy.id}
                        className="border-b border-black-800 last:border-0"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 + i * 0.05 }}
                      >
                        <td className="py-3 font-medium">{policy.type}</td>
                        <td className="py-3 text-right font-mono">{fmt(policy.covered)}</td>
                        <td className="py-3 text-right font-mono">{fmt(policy.premium)}</td>
                        <td className="py-3 text-right text-xs">
                          <div>{fmtDate(policy.expiry)}</div>
                          {policy.status === 'active' && (
                            <div className="text-black-500">{daysUntil(policy.expiry)}d left</div>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            policy.status === 'active'
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-black-700 text-black-400'
                          }`}>
                            {policy.status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          {policy.status === 'active' && (
                            <button
                              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                              style={{ background: '#ef444420', color: '#ef4444', border: '1px solid #ef444440' }}
                            >
                              Claim
                            </button>
                          )}
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </Section>
      )}

      {/* ============ 5. Insurance Pool (Underwriting) Tab ============ */}
      {activeTab === 'underwrite' && (
        <div className="space-y-6">
          <Section num="01" title="Underwriting Pool" delay={0.1}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Pool TVL', value: fmt(poolTVL), color: CYAN },
                { label: 'Your Stake', value: fmt(userStake), color: '#22c55e' },
                { label: 'Earned Premiums', value: fmt(earnedPremiums), color: '#a855f7' },
                { label: 'Pool APY', value: poolAPY.toFixed(1) + '%', color: '#eab308' },
              ].map(({ label, value, color }) => (
                <GlassCard key={label} glowColor="terminal" className="p-4">
                  <div className="text-xs text-black-400 mb-1">{label}</div>
                  <div className="text-xl font-bold font-mono" style={{ color }}>{value}</div>
                </GlassCard>
              ))}
            </div>

            <GlassCard glowColor="terminal" className="p-5">
              <div className="text-sm font-semibold text-black-300 mb-4">Deposit to Earn Premiums</div>

              <div className="mb-4">
                <label className="text-sm text-black-400 mb-2 block">Deposit Amount (USDC)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black-500 font-mono">$</span>
                  <input
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="5,000"
                    className="w-full bg-black-700 rounded-xl px-8 py-3 text-lg font-mono outline-none focus:ring-1 focus:ring-terminal-500/50 placeholder-black-500"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-black-900/50 space-y-2 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black-400">Current APY</span>
                  <span className="font-mono text-green-400">{poolAPY}%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black-400">Estimated Monthly Earnings</span>
                  <span className="font-mono" style={{ color: CYAN }}>
                    {depositAmount ? fmt(parseFloat(depositAmount) * poolAPY / 100 / 12) : '$0'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black-400">Your Share of Pool</span>
                  <span className="font-mono text-black-300">
                    {depositAmount
                      ? ((parseFloat(depositAmount) + userStake) / (poolTVL + parseFloat(depositAmount)) * 100).toFixed(3) + '%'
                      : (userStake / poolTVL * 100).toFixed(3) + '%'
                    }
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  className="py-3 rounded-xl font-semibold transition-all"
                  style={{
                    background: depositAmount && parseFloat(depositAmount) > 0 ? CYAN : '#333',
                    color: depositAmount && parseFloat(depositAmount) > 0 ? '#000' : '#666',
                  }}
                >
                  Deposit
                </button>
                <button
                  className="py-3 rounded-xl font-semibold bg-black-700 text-black-300 hover:bg-black-600 transition-all"
                >
                  Withdraw Stake
                </button>
              </div>

              <div className="mt-4 p-3 rounded-lg bg-terminal-500/10 border border-terminal-500/20 text-xs text-black-400">
                <span className="font-semibold text-terminal-400">Risk disclosure: </span>
                Underwriting capital may be used to pay valid claims. Your deposits are subject to
                partial loss if claims exceed the pool reserve ratio.
              </div>
            </GlassCard>
          </Section>

          {/* Pool Utilization */}
          <Section num="02" title="Pool Utilization" delay={0.2}>
            <GlassCard glowColor="terminal" className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-black-400">Active Coverage / Pool TVL</span>
                <span className="font-mono text-sm" style={{ color: CYAN }}>
                  {((COVERAGE_TYPES.reduce((s, c) => s + c.availableCover, 0) / poolTVL) * 10).toFixed(1)}%
                </span>
              </div>
              <div className="w-full h-4 bg-black-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${CYAN}, #22c55e)` }}
                  initial={{ width: 0 }}
                  animate={{ width: '62%' }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-black-500">
                <span>0%</span>
                <span className="text-yellow-400">Warning: 80%</span>
                <span>100%</span>
              </div>
              <p className="text-xs text-black-500 mt-3">
                When utilization exceeds 80%, premium rates increase dynamically to attract more underwriting capital and maintain pool solvency.
              </p>
            </GlassCard>
          </Section>
        </div>
      )}

      {/* ============ 6. Claims Process Tab ============ */}
      {activeTab === 'claims' && (
        <div className="space-y-6">
          <Section num="01" title="Claims Process" delay={0.1}>
            <GlassCard glowColor="terminal" className="p-5">
              <div className="flex flex-col md:flex-row gap-4 md:gap-0 items-start">
                {CLAIMS_STEPS.map((step, i) => (
                  <div key={step.step} className="flex-1 flex md:flex-col items-start md:items-center gap-4 md:gap-0 relative">
                    {/* Connector Line (desktop) */}
                    {i < CLAIMS_STEPS.length - 1 && (
                      <div className="hidden md:block absolute top-6 left-[calc(50%+24px)] right-[calc(-50%+24px)] h-px bg-black-600" />
                    )}
                    <motion.div
                      className="relative z-10 w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: `${CYAN}20`, border: `2px solid ${CYAN}40` }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 + i * 0.15, type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      <span className="text-xl">{step.icon}</span>
                    </motion.div>
                    <div className="md:text-center md:mt-3">
                      <div className="text-xs font-mono mb-1" style={{ color: CYAN }}>Step {step.step}</div>
                      <div className="font-semibold text-sm mb-1">{step.title}</div>
                      <p className="text-xs text-black-400 leading-relaxed">{step.description}</p>
                      <div className="text-xs text-black-500 mt-2 font-mono">{step.duration}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 rounded-xl bg-black-900/50">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-semibold text-black-300">Timeline</span>
                </div>
                <div className="relative pl-4">
                  <div className="absolute left-1.5 top-0 bottom-0 w-px bg-black-600" />
                  {[
                    { time: 'T+0', event: 'Exploit occurs on-chain', color: '#ef4444' },
                    { time: 'T+1h', event: 'Claim filed with on-chain proof', color: '#f97316' },
                    { time: 'T+48h', event: 'Community voting period begins', color: '#eab308' },
                    { time: 'T+72h', event: 'Voting closes, result finalized', color: CYAN },
                    { time: 'T+96h', event: 'Payout executed from pool', color: '#22c55e' },
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      className="flex items-center gap-3 py-2"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.1 }}
                    >
                      <div className="w-3 h-3 rounded-full flex-shrink-0 relative -left-[7px]"
                        style={{ background: item.color }} />
                      <div className="font-mono text-xs text-black-500 w-12 flex-shrink-0">{item.time}</div>
                      <div className="text-sm text-black-300">{item.event}</div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </Section>

          {/* File a Claim */}
          <Section num="02" title="File a Claim" delay={0.2}>
            <GlassCard glowColor="terminal" className="p-5">
              <p className="text-sm text-black-400 mb-4">
                If you have experienced a covered loss event, file a claim below.
                You will need to provide on-chain evidence (transaction hash, block number).
              </p>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-black-400 mb-2 block">Select Policy</label>
                  <select className="w-full bg-black-700 rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-terminal-500/50 text-sm">
                    {policies.filter(p => p.status === 'active').map((p) => (
                      <option key={p.id} value={p.id}>{p.type} &mdash; {fmt(p.covered)} cover</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-black-400 mb-2 block">Loss Amount (USD)</label>
                  <input
                    type="number"
                    placeholder="0"
                    className="w-full bg-black-700 rounded-xl px-4 py-3 font-mono outline-none focus:ring-1 focus:ring-terminal-500/50 placeholder-black-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-black-400 mb-2 block">Evidence (Transaction Hash)</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    className="w-full bg-black-700 rounded-xl px-4 py-3 font-mono text-sm outline-none focus:ring-1 focus:ring-terminal-500/50 placeholder-black-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-black-400 mb-2 block">Description</label>
                  <textarea
                    rows={3}
                    placeholder="Describe the event and how it caused your loss..."
                    className="w-full bg-black-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-terminal-500/50 placeholder-black-500 resize-none"
                  />
                </div>
                <button
                  className="w-full py-3 rounded-xl font-semibold transition-all"
                  style={{ background: '#ef444420', color: '#ef4444', border: '1px solid #ef444440' }}
                >
                  Submit Claim for Review
                </button>
              </div>
            </GlassCard>
          </Section>
        </div>
      )}
    </div>
  )
}

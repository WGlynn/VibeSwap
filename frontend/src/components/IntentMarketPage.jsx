import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const AMBER = '#fbbf24'
const GREEN = '#34d399'
const RED = '#f87171'
const PURPLE = '#a78bfa'
const ease = [0.25, 0.1, 0.25, 1]

const PHASE_CONFIG = {
  COMMIT: { label: 'Commit', color: CYAN, icon: '\u{1F512}', desc: 'Submit hidden buy order' },
  REVEAL: { label: 'Reveal', color: PURPLE, icon: '\u{1F513}', desc: 'Reveal order + secret' },
  SETTLING: { label: 'Settling', color: AMBER, icon: '\u23F3', desc: 'Computing uniform price' },
  SETTLED: { label: 'Settled', color: GREEN, icon: '\u2713', desc: 'Claim your tokens' },
  FAILED: { label: 'Failed', color: RED, icon: '\u2717', desc: 'Launch did not meet threshold' },
}

const REPUTATION_TIERS = [
  { id: 0, name: 'FLAGGED', color: RED, min: 0 },
  { id: 1, name: 'SUSPICIOUS', color: '#fb923c', min: 20 },
  { id: 2, name: 'CAUTIOUS', color: AMBER, min: 40 },
  { id: 3, name: 'NORMAL', color: CYAN, min: 60 },
  { id: 4, name: 'TRUSTED', color: GREEN, min: 80 },
]

const GEV_FIXES = [
  { id: 1, title: 'Commit-Reveal Launches', desc: 'All buy orders hidden during commit phase. No sniping, no front-running.', icon: '\u{1F512}', contract: 'CommitRevealAuction' },
  { id: 2, title: 'Duplicate Elimination', desc: 'One canonical token per intent signal. No copycat floods.', icon: '\u{1F3AF}', contract: 'intentToLaunch mapping' },
  { id: 3, title: 'Anti-Rug Protection', desc: 'Creator locks liquidity with time-lock. Violation = 50% slashed to LPs.', icon: '\u{1F6E1}\uFE0F', contract: 'CreatorLiquidityLock' },
  { id: 4, title: 'Wash Trade Resistance', desc: 'CogProof behavioral reputation gates participation. Sybils flagged.', icon: '\u{1F575}\uFE0F', contract: 'BehavioralReputationVerifier' },
  { id: 5, title: '0% Protocol Fees', desc: 'Zero extraction. 100% of fees go to liquidity providers.', icon: '\u{1F91D}', contract: 'PROTOCOL_FEE_BPS = 0' },
]

// ============ Mock Data ============
const MOCK_LAUNCHES = [
  {
    id: 1, creator: '0xF4a1...8c2D', token: 'VIBES', tokenAddress: '0x1234...5678',
    intentSignal: 'vibes-are-eternal', totalTokens: '10,000,000', totalCommitted: '15.4',
    uniformPrice: null, phase: 'COMMIT', participants: 42, lockDuration: '90 days',
    creatorDeposit: '5.0', createdAt: Date.now() - 3600000, timeLeft: 7200000,
    creatorTier: 'TRUSTED', creatorScore: 87,
  },
  {
    id: 2, creator: '0xA9b3...1eF0', token: 'BASED', tokenAddress: '0xabcd...ef01',
    intentSignal: 'based-and-fair-pilled', totalTokens: '50,000,000', totalCommitted: '82.1',
    uniformPrice: '0.00000164', phase: 'SETTLED', participants: 189, lockDuration: '180 days',
    creatorDeposit: '20.0', createdAt: Date.now() - 86400000, timeLeft: 0,
    creatorTier: 'NORMAL', creatorScore: 72,
  },
  {
    id: 3, creator: '0x7D2e...4Fa8', token: 'COPE', tokenAddress: '0x9876...5432',
    intentSignal: 'cope-harder', totalTokens: '100,000,000', totalCommitted: '3.2',
    uniformPrice: null, phase: 'REVEAL', participants: 12, lockDuration: '60 days',
    creatorDeposit: '2.0', createdAt: Date.now() - 7200000, timeLeft: 1800000,
    creatorTier: 'CAUTIOUS', creatorScore: 51,
  },
  {
    id: 4, creator: '0x0Bad...Dead', token: 'SCAM', tokenAddress: '0x0000...0001',
    intentSignal: 'definitely-not-a-rug', totalTokens: '999,999,999', totalCommitted: '0',
    uniformPrice: null, phase: 'FAILED', participants: 0, lockDuration: '30 days',
    creatorDeposit: '0.1', createdAt: Date.now() - 172800000, timeLeft: 0,
    creatorTier: 'FLAGGED', creatorScore: 8,
  },
]

const MOCK_USER = {
  trustScore: 74, tier: 'NORMAL', credentialScore: 32, credentialTier: 'GOLD',
  reveals: 48, commits: 50, revealRate: '96%', burns: 3,
}

// ============ Animation Variants ============
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.08, ease } }),
}
const stagger = { visible: { transition: { staggerChildren: 0.08 } } }

// ============ Main Component ============
export default function IntentMarketPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [tab, setTab] = useState('active')
  const [showCreate, setShowCreate] = useState(false)
  const [expandedFix, setExpandedFix] = useState(null)

  const filteredLaunches = useMemo(() => {
    if (tab === 'active') return MOCK_LAUNCHES.filter(l => ['COMMIT', 'REVEAL', 'SETTLING'].includes(l.phase))
    if (tab === 'settled') return MOCK_LAUNCHES.filter(l => l.phase === 'SETTLED')
    if (tab === 'failed') return MOCK_LAUNCHES.filter(l => l.phase === 'FAILED')
    return MOCK_LAUNCHES
  }, [tab])

  return (
    <div className="min-h-screen px-4 py-8 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}
        className="text-center mb-10">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
          Memecoin Intent Market
        </h1>
        <p className="text-gray-400 text-sm md:text-base max-w-2xl mx-auto">
          Fair token launches via commit-reveal batch auction. Zero extraction. Behavioral reputation.
          Every participant pays the same uniform clearing price.
        </p>
      </motion.div>

      {/* 5 GEV Fixes */}
      <motion.div initial="hidden" animate="visible" variants={stagger} className="mb-10">
        <motion.h2 variants={fadeUp} custom={1}
          className="text-xs uppercase tracking-widest text-gray-500 mb-4 text-center">
          5 GEV Resistance Mechanisms
        </motion.h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {GEV_FIXES.map((fix, i) => (
            <motion.div key={fix.id} variants={fadeUp} custom={i + 2}>
              <GlassCard glowColor="terminal" hover className="p-4 cursor-pointer h-full"
                onClick={() => setExpandedFix(expandedFix === fix.id ? null : fix.id)}>
                <div className="text-center">
                  <div className="text-2xl mb-2">{fix.icon}</div>
                  <p className="text-white text-xs font-semibold mb-1">Fix {fix.id}</p>
                  <p className="text-cyan-400 text-[11px] font-medium leading-tight">{fix.title}</p>
                  <AnimatePresence>
                    {expandedFix === fix.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <p className="text-gray-400 text-[10px] mt-2 leading-relaxed">{fix.desc}</p>
                        <p className="text-gray-600 text-[9px] mt-1 font-mono">{fix.contract}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Launches */}
        <div className="lg:col-span-3 space-y-6">
          {/* Tab Bar + Create */}
          <motion.div variants={fadeUp} custom={7} initial="hidden" animate="visible"
            className="flex items-center justify-between">
            <div className="flex gap-1 bg-black/30 rounded-lg p-1">
              {[
                { id: 'active', label: 'Active' },
                { id: 'settled', label: 'Settled' },
                { id: 'failed', label: 'Failed' },
                { id: 'all', label: 'All' },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    tab === t.id ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-500 hover:text-gray-300'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            <button onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg text-xs font-medium hover:bg-cyan-500/30 border border-cyan-500/20 transition-colors">
              + Create Launch
            </button>
          </motion.div>

          {/* Create Form */}
          <AnimatePresence>
            {showCreate && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <CreateLaunchForm onClose={() => setShowCreate(false)} isConnected={isConnected} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Launches */}
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} className="space-y-4">
              {filteredLaunches.length === 0 ? (
                <GlassCard className="p-8 text-center">
                  <p className="text-gray-500">No launches in this category</p>
                </GlassCard>
              ) : (
                filteredLaunches.map((launch, i) => (
                  <LaunchCard key={launch.id} launch={launch} index={i} isConnected={isConnected} />
                ))
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right: User Reputation Sidebar */}
        <div className="space-y-4">
          <motion.div variants={fadeUp} custom={8} initial="hidden" animate="visible">
            <ReputationSidebar isConnected={isConnected} user={MOCK_USER} />
          </motion.div>
          <motion.div variants={fadeUp} custom={9} initial="hidden" animate="visible">
            <HowItWorks />
          </motion.div>
        </div>
      </div>
    </div>
  )
}

// ============ Launch Card ============
function LaunchCard({ launch, index, isConnected }) {
  const [expanded, setExpanded] = useState(false)
  const phase = PHASE_CONFIG[launch.phase]
  const tierData = REPUTATION_TIERS.find(t => t.name === launch.creatorTier) || REPUTATION_TIERS[0]

  return (
    <motion.div variants={fadeUp} custom={index} initial="hidden" animate="visible">
      <GlassCard glowColor={launch.phase === 'SETTLED' ? 'matrix' : launch.phase === 'FAILED' ? 'warning' : 'terminal'}
        hover spotlight className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold"
              style={{ background: `${phase.color}15`, color: phase.color }}>
              {launch.token.charAt(0)}
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm">${launch.token}</h3>
              <p className="text-gray-500 text-[11px] font-mono">{launch.creator}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 rounded-md text-[10px] font-semibold"
              style={{ background: `${tierData.color}20`, color: tierData.color }}>
              {launch.creatorTier}
            </span>
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1"
              style={{ background: `${phase.color}15`, color: phase.color }}>
              {phase.icon} {phase.label}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Stat label="For Sale" value={launch.totalTokens} />
          <Stat label="Committed" value={`${launch.totalCommitted} ETH`} />
          <Stat label="Participants" value={launch.participants} />
          <Stat label={launch.uniformPrice ? 'Price' : 'Lock'}
            value={launch.uniformPrice || launch.lockDuration} />
        </div>

        {/* Intent Signal */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-gray-600 text-[10px] uppercase tracking-wider">Intent:</span>
          <span className="text-purple-400 text-xs font-mono bg-purple-500/10 px-2 py-0.5 rounded">
            {launch.intentSignal}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {launch.phase === 'COMMIT' && (
            <ActionButton color={CYAN} disabled={!isConnected}
              label={isConnected ? 'Commit Buy Order' : 'Connect Wallet'}
              onClick={() => {}} />
          )}
          {launch.phase === 'REVEAL' && (
            <ActionButton color={PURPLE} disabled={!isConnected}
              label="Reveal Order" onClick={() => {}} />
          )}
          {launch.phase === 'SETTLED' && (
            <ActionButton color={GREEN} disabled={!isConnected}
              label="Claim Tokens" onClick={() => {}} />
          )}
          {launch.phase === 'FAILED' && (
            <ActionButton color={RED} disabled={!isConnected}
              label="Refund Deposit" onClick={() => {}} />
          )}
          <button onClick={() => setExpanded(!expanded)}
            className="px-3 py-2 text-gray-500 text-xs hover:text-gray-300 transition-colors">
            {expanded ? 'Less' : 'Details'}
          </button>
        </div>

        {/* Expanded Details */}
        <AnimatePresence>
          {expanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
                {/* Phase Timeline */}
                <PhaseTimeline currentPhase={launch.phase} />

                {/* Lock Details */}
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Creator Deposit" value={`${launch.creatorDeposit} ETH`} small />
                  <Stat label="Lock Duration" value={launch.lockDuration} small />
                  <Stat label="Creator Score" value={`${launch.creatorScore}/100`} small />
                </div>

                {/* Contract Info */}
                <div className="text-[10px] text-gray-600 font-mono space-y-1">
                  <p>Token: {launch.tokenAddress}</p>
                  <p>Protocol Fee: 0% (Fix #5)</p>
                  <p>Slash Rate: 50% to LP pool (Fix #3)</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Phase Timeline ============
function PhaseTimeline({ currentPhase }) {
  const phases = ['COMMIT', 'REVEAL', 'SETTLING', 'SETTLED']
  const currentIdx = phases.indexOf(currentPhase)

  return (
    <div className="flex items-center gap-0">
      {phases.map((p, i) => {
        const config = PHASE_CONFIG[p]
        const isDone = i < currentIdx
        const isCurrent = i === currentIdx
        const isFailed = currentPhase === 'FAILED'

        return (
          <div key={p} className="flex items-center flex-1">
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              isFailed ? 'bg-red-500/10 text-red-400/50' :
              isCurrent ? `text-white` : isDone ? 'text-green-400/70' : 'text-gray-600'
            }`} style={isCurrent ? { background: `${config.color}20`, color: config.color } : {}}>
              {isDone ? '\u2713' : config.icon} {config.label}
            </div>
            {i < phases.length - 1 && (
              <div className={`flex-1 h-px mx-1 ${isDone ? 'bg-green-500/30' : 'bg-gray-800'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============ Create Launch Form ============
function CreateLaunchForm({ onClose, isConnected }) {
  const [form, setForm] = useState({
    intentSignal: '', tokenAddress: '', totalTokens: '', creatorDeposit: '', lockDuration: '90',
  })

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <GlassCard glowColor="terminal" className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-white font-semibold text-sm">Create Token Launch</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">Close</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Intent Signal</label>
          <input type="text" placeholder="e.g. vibes-are-eternal" value={form.intentSignal}
            onChange={e => set('intentSignal', e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-sm placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none" />
          <p className="text-[9px] text-gray-600 mt-1">Unique cultural signal. One token per intent (Fix #2).</p>
        </div>

        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Token Address</label>
          <input type="text" placeholder="0x..." value={form.tokenAddress}
            onChange={e => set('tokenAddress', e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-sm placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none font-mono" />
        </div>

        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Tokens For Sale</label>
          <input type="text" placeholder="10,000,000" value={form.totalTokens}
            onChange={e => set('totalTokens', e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-sm placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none" />
        </div>

        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Creator Deposit (ETH)</label>
          <input type="text" placeholder="5.0" value={form.creatorDeposit}
            onChange={e => set('creatorDeposit', e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-sm placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none" />
          <p className="text-[9px] text-gray-600 mt-1">Locked as anti-rug collateral. 50% slashed on violation (Fix #3).</p>
        </div>

        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Lock Duration</label>
          <select value={form.lockDuration} onChange={e => set('lockDuration', e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-sm focus:border-cyan-500/50 focus:outline-none">
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">365 days</option>
          </select>
        </div>
      </div>

      {/* Fix Indicators */}
      <div className="flex flex-wrap gap-2 mt-5 mb-4">
        <FixBadge n={1} label="Commit-reveal" active />
        <FixBadge n={2} label="Dedup" active={!!form.intentSignal} />
        <FixBadge n={3} label="Anti-rug" active={!!form.creatorDeposit} />
        <FixBadge n={4} label="Reputation" active />
        <FixBadge n={5} label="0% fee" active />
      </div>

      <button disabled={!isConnected}
        className="w-full py-3 rounded-lg text-sm font-semibold transition-colors bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
        {isConnected ? 'Create Launch' : 'Connect Wallet to Create'}
      </button>

      <p className="text-[9px] text-gray-600 text-center mt-2">
        Requires CAUTIOUS reputation tier or above (score &ge; 40)
      </p>
    </GlassCard>
  )
}

// ============ Reputation Sidebar ============
function ReputationSidebar({ isConnected, user }) {
  const trustTier = REPUTATION_TIERS.find(t => t.name === user.tier) || REPUTATION_TIERS[0]

  return (
    <GlassCard glowColor="matrix" className="p-5">
      <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-4">Your Reputation</h3>

      {!isConnected ? (
        <div className="text-center py-4">
          <p className="text-gray-500 text-sm mb-2">Connect wallet to see reputation</p>
          <p className="text-gray-600 text-[10px]">Behavioral reputation gates access</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Trust Score Gauge */}
          <div className="text-center">
            <div className="relative w-20 h-20 mx-auto mb-2">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1f2937" strokeWidth="2.5" />
                <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="2.5"
                  stroke={trustTier.color} strokeDasharray={`${user.trustScore}, 100`}
                  strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-white font-bold text-lg">{user.trustScore}</span>
              </div>
            </div>
            <p className="text-xs font-semibold" style={{ color: trustTier.color }}>{user.tier}</p>
            <p className="text-[10px] text-gray-500">Trust Score</p>
          </div>

          {/* Credential Score */}
          <div className="bg-black/20 rounded-lg p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Credential Score</span>
              <span className="text-amber-400 font-semibold">{user.credentialScore} {user.credentialTier}</span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Reveals" value={user.reveals} />
            <MiniStat label="Commits" value={user.commits} />
            <MiniStat label="Reveal Rate" value={user.revealRate} />
            <MiniStat label="Burns" value={user.burns} />
          </div>

          {/* Eligibility */}
          <div className="space-y-2 text-[11px]">
            <EligibilityRow label="Create launches" required="CAUTIOUS" current={user.tier} />
            <EligibilityRow label="Participate in launches" required="SUSPICIOUS" current={user.tier} />
          </div>
        </div>
      )}
    </GlassCard>
  )
}

// ============ How It Works ============
function HowItWorks() {
  return (
    <GlassCard className="p-5">
      <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-4">How It Works</h3>
      <div className="space-y-3">
        {[
          { step: 1, label: 'Creator deposits', desc: 'Token + ETH collateral locked' },
          { step: 2, label: 'Commit phase', desc: 'Buyers submit hidden orders' },
          { step: 3, label: 'Reveal phase', desc: 'Orders revealed, hash verified' },
          { step: 4, label: 'Settlement', desc: 'Uniform price, fair distribution' },
          { step: 5, label: 'Claim', desc: 'Everyone gets tokens at same price' },
        ].map(s => (
          <div key={s.step} className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
              {s.step}
            </div>
            <div>
              <p className="text-white text-xs font-medium">{s.label}</p>
              <p className="text-gray-500 text-[10px]">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}

// ============ Small Components ============
function Stat({ label, value, small }) {
  return (
    <div>
      <p className={`text-gray-500 ${small ? 'text-[9px]' : 'text-[10px]'} uppercase tracking-wider`}>{label}</p>
      <p className={`text-white font-semibold ${small ? 'text-xs' : 'text-sm'} mt-0.5`}>{value}</p>
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="bg-black/20 rounded p-2 text-center">
      <p className="text-white text-sm font-semibold">{value}</p>
      <p className="text-gray-500 text-[9px]">{label}</p>
    </div>
  )
}

function ActionButton({ color, label, disabled, onClick }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: disabled ? undefined : `${color}20`,
        color: disabled ? '#6b7280' : color,
        borderColor: disabled ? 'transparent' : `${color}30`,
        borderWidth: '1px',
      }}>
      {label}
    </button>
  )
}

function FixBadge({ n, label, active }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
      active ? 'bg-cyan-500/15 text-cyan-400' : 'bg-gray-800 text-gray-600'
    }`}>
      #{n} {label}
    </span>
  )
}

function EligibilityRow({ label, required, current }) {
  const tiers = REPUTATION_TIERS.map(t => t.name)
  const eligible = tiers.indexOf(current) >= tiers.indexOf(required)
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={eligible ? 'text-green-400' : 'text-red-400'}>
        {eligible ? '\u2713' : '\u2717'} {required}+
      </span>
    </div>
  )
}

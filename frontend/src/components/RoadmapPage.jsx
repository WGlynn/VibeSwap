import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const MATRIX = '#22c55e'

// ============ Phase Data ============
const PHASES = [
  { id: 1, name: 'Genesis', period: 'Q4 2025', status: 'completed',
    description: 'Core contracts, commit-reveal auction, AMM, testnet',
    milestones: [
      { text: 'Commit-reveal batch auction engine', status: 'done' },
      { text: 'Constant product AMM (x*y=k)', status: 'done' },
      { text: 'Circuit breaker system', status: 'done' },
      { text: 'Frontend MVP with device wallet', status: 'done' },
      { text: 'Shapley value reward distribution', status: 'done' },
      { text: 'TWAP oracle integration', status: 'done' },
      { text: 'Flash loan protection (EOA-only commits)', status: 'done' },
      { text: 'Foundry test suite (unit + fuzz + invariant)', status: 'done' },
      { text: 'Testnet deployment and validation', status: 'done' },
    ] },
  { id: 2, name: 'Expansion', period: 'Q1-Q2 2026', status: 'in-progress',
    description: 'Cross-chain (LayerZero), oracle network, circuit breakers, governance',
    milestones: [
      { text: 'CrossChainRouter via LayerZero V2 OApp', status: 'done' },
      { text: 'Multi-chain deployment (Ethereum, Arbitrum, Base)', status: 'done' },
      { text: 'Kalman filter oracle network', status: 'done' },
      { text: 'Circuit breaker hardening (volume, price, withdrawal)', status: 'done' },
      { text: 'DeFi primitives: lending, staking, yield', status: 'in-progress' },
      { text: 'Governance bootstrap and community launch', status: 'in-progress' },
      { text: 'Token generation event', status: 'pending' },
      { text: 'Insurance pool activation', status: 'pending' },
      { text: 'Liquidity mining program', status: 'pending' },
      { text: 'Partner integrations (aggregators, wallets)', status: 'pending' },
    ] },
  { id: 3, name: 'Ecosystem', period: 'Q3 2026', status: 'upcoming',
    description: 'VSOS apps, DePIN integration, prediction markets, AI agents',
    milestones: [
      { text: 'VSOS (VibeSwap Operating System) app framework', status: 'pending' },
      { text: 'DePIN integration hub', status: 'pending' },
      { text: 'Prediction market module', status: 'pending' },
      { text: 'AI agent trading economy', status: 'pending' },
      { text: 'Mobile app (iOS + Android)', status: 'pending' },
      { text: 'InfoFi data marketplace', status: 'pending' },
      { text: 'Advanced order types (TWAP, iceberg, limit)', status: 'pending' },
    ] },
  { id: 4, name: 'Sovereignty', period: 'Q4 2026', status: 'planned',
    description: 'Full DAO transition, Shapley governance, privacy pools',
    milestones: [
      { text: 'Full DAO transition (multi-sig to on-chain)', status: 'pending' },
      { text: 'Shapley-weighted governance voting', status: 'pending' },
      { text: 'Privacy pools with zero-knowledge proofs', status: 'pending' },
      { text: 'ContributionDAG attribution system', status: 'pending' },
      { text: 'Treasury stabilizer (Trinomial Stability System)', status: 'pending' },
      { text: 'Constitutional governance framework', status: 'pending' },
      { text: 'Protocol-owned liquidity (POL) strategy', status: 'pending' },
    ] },
  { id: 5, name: 'Convergence', period: '2027', status: 'vision',
    description: 'Multi-chain settlement, ZK rollup, institutional features',
    milestones: [
      { text: 'Omnichain settlement layer', status: 'pending' },
      { text: 'ZK rollup for private batch auctions', status: 'pending' },
      { text: 'Institutional API, SDK, and compliance', status: 'pending' },
      { text: 'PsiNet decentralized AI consensus', status: 'pending' },
      { text: 'Self-evolving protocol via AI-assisted governance', status: 'pending' },
      { text: '"Everything App" convergence: trade, lend, govern, build', status: 'pending' },
    ] },
]

const COMMUNITY_REQUESTS = [
  { id: 'mobile', label: 'Mobile app with biometric signing', votes: 1243 },
  { id: 'options', label: 'Options trading module (European-style)', votes: 891 },
  { id: 'perps', label: 'Perpetual futures with batch funding rates', votes: 764 },
  { id: 'pol', label: 'Protocol-owned liquidity bootstrapping', votes: 612 },
  { id: 'nft', label: 'NFT marketplace with fair auction pricing', votes: 438 },
]

const RECENT_MILESTONES = [
  { text: 'Full security audit completed (9 critical fixes)', date: 'Feb 2026' },
  { text: 'CrossChainRouter deployed via LayerZero V2', date: 'Jan 2026' },
  { text: 'Circuit breaker system hardened', date: 'Jan 2026' },
  { text: 'Kalman filter oracle network live', date: 'Dec 2025' },
  { text: 'Device wallet with WebAuthn/passkeys shipped', date: 'Dec 2025' },
]

// ============ Status Config ============
const STATUS_CFG = {
  completed: { label: 'Completed', color: MATRIX, bg: `${MATRIX}15` },
  'in-progress': { label: 'In Progress', color: CYAN, bg: `${CYAN}15` },
  upcoming: { label: 'Upcoming', color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
  planned: { label: 'Planned', color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
  vision: { label: 'Vision', color: '#6b7280', bg: 'rgba(107,114,128,0.06)' },
}
const MS_ICON = {
  done: { sym: '\u2713', color: MATRIX },
  'in-progress': { sym: null, color: CYAN },
  pending: { sym: '\u25CB', color: 'rgba(255,255,255,0.2)' },
}

// ============ Animation Variants ============
const phiEase = [0.25, 0.1, 1 / PHI, 1]
const containerV = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 1 / (PHI * PHI * PHI), delayChildren: 1 / (PHI * PHI) } },
}
const itemV = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 1 / (PHI * PHI), ease: phiEase } },
}
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 1 / PHI, ease: phiEase } },
}

// ============ Sub-Components ============
function PulsingDot({ color }) {
  return (
    <span className="relative flex h-3 w-3">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: color }} />
      <span className="relative inline-flex rounded-full h-3 w-3" style={{ backgroundColor: color }} />
    </span>
  )
}

function Spinner({ color, size = 14 }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}>
      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </motion.svg>
  )
}

function MilestoneIcon({ status }) {
  const c = MS_ICON[status]
  if (status === 'in-progress') return <Spinner color={c.color} size={16} />
  return <span className="text-xs font-bold" style={{ color: c.color }}>{c.sym}</span>
}

function StatusBadge({ status }) {
  const c = STATUS_CFG[status]
  return (
    <div className="flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-full border border-white/5" style={{ backgroundColor: c.bg }}>
      {status === 'in-progress' ? <PulsingDot color={c.color} /> :
       status === 'completed' ? <span style={{ color: c.color }}>{'\u2713'}</span> :
       <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `${c.color}40` }} />}
      <span style={{ color: c.color }}>{c.label}</span>
    </div>
  )
}

// ============ Timeline Node ============
function TimelineNode({ phase, index, expandedId, setExpandedId }) {
  const isExpanded = expandedId === phase.id
  const cfg = STATUS_CFG[phase.status]
  const done = phase.milestones.filter((m) => m.status === 'done').length
  const wip = phase.milestones.filter((m) => m.status === 'in-progress').length
  const pct = Math.round(((done + wip * 0.5) / phase.milestones.length) * 100)
  const isActive = phase.status === 'in-progress'
  const isDone = phase.status === 'completed'
  const toggle = () => setExpandedId(isExpanded ? null : phase.id)

  return (
    <motion.div variants={itemV} className="relative flex gap-4 sm:gap-6">
      {/* Vertical spine */}
      <div className="flex flex-col items-center flex-shrink-0">
        <motion.button onClick={toggle}
          className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 focus:outline-none"
          style={{ borderColor: cfg.color, backgroundColor: isDone ? `${cfg.color}20` : 'rgba(0,0,0,0.6)',
            boxShadow: isActive ? `0 0 20px ${cfg.color}40` : 'none' }}
          whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.95 }}>
          {isDone ? <span style={{ color: cfg.color }}>{'\u2713'}</span> : <span style={{ color: cfg.color }}>{phase.id}</span>}
          {isActive && (
            <motion.div className="absolute inset-0 rounded-full border-2" style={{ borderColor: cfg.color }}
              animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} />
          )}
        </motion.button>
        {index < PHASES.length - 1 && (
          <svg className="flex-1" width="2" style={{ minHeight: 40 }} preserveAspectRatio="none">
            <defs>
              <linearGradient id={`lg-${phase.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`${cfg.color}60`} />
                <stop offset="100%" stopColor={`${STATUS_CFG[PHASES[index + 1].status].color}30`} />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="2" height="100%" fill={`url(#lg-${phase.id})`} />
          </svg>
        )}
      </div>
      {/* Card */}
      <div className="flex-1 pb-6">
        <GlassCard glowColor={isActive ? 'terminal' : isDone ? 'matrix' : 'none'} hover={true} className="p-0">
          <motion.div className="p-5 cursor-pointer select-none" onClick={toggle}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-bold" style={{ color: cfg.color }}>Phase {phase.id}</span>
                  <span className="text-[10px] font-mono text-white/30">{phase.period}</span>
                  <StatusBadge status={phase.status} />
                </div>
                <h3 className="text-lg font-bold tracking-tight">{phase.name}</h3>
                <p className="text-sm text-white/40 mt-1">{phase.description}</p>
              </div>
              {/* Progress ring */}
              <div className="relative w-12 h-12 flex-shrink-0">
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                  <motion.circle cx="18" cy="18" r="14" fill="none" stroke={cfg.color} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${pct * 0.88} 88`} initial={{ strokeDasharray: '0 88' }}
                    whileInView={{ strokeDasharray: `${pct * 0.88} 88` }} viewport={{ once: true }}
                    transition={{ duration: 1.2, ease: 'easeOut' }} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-mono font-bold" style={{ color: cfg.color }}>{pct}%</span>
                </div>
              </div>
            </div>
            <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
              <motion.div className="h-full rounded-full" style={{ backgroundColor: cfg.color }}
                initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }}
                transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-white/30 font-mono">{done}/{phase.milestones.length} milestones</span>
              <motion.span className="text-[10px] font-mono" animate={{ rotate: isExpanded ? 180 : 0 }} style={{ color: cfg.color }}>{'\u25BC'}</motion.span>
            </div>
          </motion.div>
          {/* Expanded sub-milestones */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 1 / (PHI * PHI), ease: phiEase }} className="overflow-hidden">
                <div className="px-5 pb-5 border-t border-white/5 pt-4">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-white/40 mb-3">Milestones</h4>
                  <div className="space-y-1">
                    {phase.milestones.map((m, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }} transition={{ delay: i * 0.05, duration: 0.3 }}
                        className="flex items-center gap-3 py-1.5">
                        <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                          style={{
                            backgroundColor: m.status === 'done' ? `${MATRIX}20` : m.status === 'in-progress' ? `${CYAN}15` : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${m.status === 'done' ? `${MATRIX}40` : m.status === 'in-progress' ? `${CYAN}30` : 'rgba(255,255,255,0.08)'}`,
                          }}>
                          <MilestoneIcon status={m.status} />
                        </div>
                        <span className={`text-sm ${m.status === 'done' ? 'text-white/80' : m.status === 'in-progress' ? 'text-white/70' : 'text-white/35'}`}>
                          {m.text}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </div>
    </motion.div>
  )
}

// ============ Main Component ============
export default function RoadmapPage() {
  const [expandedId, setExpandedId] = useState(2)
  const [votedId, setVotedId] = useState(null)

  const currentPhase = PHASES.find((p) => p.status === 'in-progress')
  const totalMs = PHASES.reduce((s, p) => s + p.milestones.length, 0)
  const completedMs = PHASES.reduce((s, p) => s + p.milestones.filter((m) => m.status === 'done').length, 0)
  const curDone = currentPhase ? currentPhase.milestones.filter((m) => m.status === 'done').length : 0
  const curTotal = currentPhase ? currentPhase.milestones.length : 1
  const totalVotes = COMMUNITY_REQUESTS.reduce((s, r) => s + r.votes, 0)

  return (
    <div className="min-h-screen pb-24">
      <PageHero category="system" title="Roadmap" subtitle="Building the future of fair exchange"
        badge={currentPhase ? `Phase ${currentPhase.id}` : undefined} badgeColor={CYAN} />

      <div className="max-w-4xl mx-auto px-4">
        {/* ============ Current Phase Highlight ============ */}
        <motion.div variants={fadeUp} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" className="p-5 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <PulsingDot color={CYAN} />
                <div>
                  <div className="text-xs font-mono text-white/40 uppercase tracking-wider">Current Phase</div>
                  <div className="text-xl font-bold tracking-tight">
                    Phase 2: <span style={{ color: CYAN }}>Expansion</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold font-mono" style={{ color: CYAN }}>65%</div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider">Phase Progress</div>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex justify-between mb-1.5">
                <span className="text-[10px] font-mono text-white/30">{curDone}/{curTotal} milestones</span>
                <span className="text-[10px] font-mono" style={{ color: CYAN }}>65%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <motion.div className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${MATRIX}, ${CYAN})` }}
                  initial={{ width: 0 }} animate={{ width: '65%' }}
                  transition={{ duration: 1.5, ease: 'easeOut', delay: 0.3 }} />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Timeline ============ */}
        <motion.div variants={containerV} initial="hidden" animate="visible" className="relative">
          {PHASES.map((phase, index) => (
            <TimelineNode key={phase.id} phase={phase} index={index}
              expandedId={expandedId} setExpandedId={setExpandedId} />
          ))}
        </motion.div>

        {/* ============ Community Requests ============ */}
        <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
          <GlassCard glowColor="terminal" className="p-6 mt-4 mb-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                style={{ backgroundColor: `${CYAN}15`, border: `1px solid ${CYAN}30` }}>
                {'\u2691'}
              </div>
              <div>
                <h3 className="text-lg font-bold tracking-tight">Community Requests</h3>
                <p className="text-xs text-white/40">Top voted features — signal what matters most</p>
              </div>
            </div>
            <div className="space-y-3">
              {COMMUNITY_REQUESTS.map((req) => {
                const pct = Math.round((req.votes / totalVotes) * 100)
                const isVoted = votedId === req.id
                return (
                  <motion.button key={req.id} onClick={() => setVotedId(req.id)}
                    className="w-full text-left relative rounded-lg overflow-hidden border transition-colors"
                    style={{ borderColor: isVoted ? `${CYAN}40` : 'rgba(255,255,255,0.06)',
                      backgroundColor: isVoted ? `${CYAN}08` : 'rgba(255,255,255,0.02)' }}
                    whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.995 }}>
                    <motion.div className="absolute inset-y-0 left-0" style={{ backgroundColor: `${CYAN}08` }}
                      initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }}
                      transition={{ duration: 0.8, ease: 'easeOut' }} />
                    <div className="relative px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                          style={{ borderColor: isVoted ? CYAN : 'rgba(255,255,255,0.2)' }}>
                          {isVoted && <motion.div className="w-2 h-2 rounded-full" style={{ backgroundColor: CYAN }}
                            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500 }} />}
                        </div>
                        <span className="text-sm text-white/80">{req.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-white/30">{(req.votes + (isVoted ? 1 : 0)).toLocaleString()} votes</span>
                        <span className="text-xs font-mono font-bold" style={{ color: CYAN }}>{pct}%</span>
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </div>
            {votedId && (
              <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="text-xs text-white/30 mt-3 text-center">
                Your signal has been recorded. On-chain governance coming in Phase 4: Sovereignty.
              </motion.p>
            )}
          </GlassCard>
        </motion.div>

        {/* ============ Recent Milestones ============ */}
        <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
          <GlassCard glowColor="matrix" className="p-6 mb-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                style={{ backgroundColor: `${MATRIX}15`, border: `1px solid ${MATRIX}30` }}>
                {'\u2605'}
              </div>
              <div>
                <h3 className="text-lg font-bold tracking-tight">Recent Milestones</h3>
                <p className="text-xs text-white/40">Latest completed milestones across all phases</p>
              </div>
            </div>
            <div className="space-y-2">
              {RECENT_MILESTONES.map((ms, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.4 }}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border"
                  style={{ backgroundColor: `${MATRIX}06`, borderColor: `${MATRIX}12` }}>
                  <span style={{ color: MATRIX }} className="text-sm flex-shrink-0">{'\u2713'}</span>
                  <span className="text-sm text-white/70 flex-1">{ms.text}</span>
                  <span className="text-[10px] font-mono text-white/30 flex-shrink-0">{ms.date}</span>
                </motion.div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          transition={{ duration: 1 }} className="text-center py-8">
          <div className="inline-flex items-center gap-3 mb-4">
            {PHASES.map((p) => {
              const c = STATUS_CFG[p.status]
              return (
                <div key={p.id} className="w-2 h-2 rounded-full transition-all"
                  style={{ backgroundColor: (p.status === 'completed' || p.status === 'in-progress') ? c.color : `${c.color}40`,
                    boxShadow: p.status === 'in-progress' ? `0 0 8px ${c.color}60` : 'none' }} />
              )
            })}
          </div>
          <p className="text-sm text-white/20 font-mono">Building the future of fair exchange — one phase at a time</p>
          <p className="text-[10px] text-white/10 mt-2">{completedMs} of {totalMs} milestones completed across {PHASES.length} phases</p>
        </motion.div>
      </div>
    </div>
  )
}

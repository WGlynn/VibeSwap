import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============================================================
// Governance Page — Proposals, voting, delegation, treasury
// Democratic protocol control bounded by the Ten Covenants.
// Cooperative Capitalism in action. Fairness above all.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.1 / PHI, ease: 'easeOut' } }),
}

// ============ Categories for Proposal Creation ============

const PROPOSAL_CATEGORIES = ['Protocol', 'Treasury', 'Emergency', 'Community']

const CATEGORY_COLORS = {
  Protocol: CYAN,
  Treasury: '#a78bfa',
  Emergency: '#ef4444',
  Community: '#34d399',
}

// ============ Mock Data ============

const TOTAL_SUPPLY = 10_000_000
const QUORUM_THRESHOLD = 0.30 // 30% of total supply

const PROPOSALS = [
  {
    id: 'VIP-017',
    title: 'Increase LP base fee to 0.10%',
    status: 'ACTIVE',
    category: 'Protocol',
    forVotes: 842000,
    againstVotes: 268000,
    abstainVotes: 58000,
    endTime: '2d 14h',
    proposer: '0x7a3F...c91E',
    createdAt: 'Mar 6, 2026',
    description: 'Raise the base swap fee from 0.05% to 0.10% to increase LP yield. The additional 0.05% is split 60/40 between LPs and the DAO treasury. Modeling shows this remains competitive with Uniswap V3.',
    discussion: [
      { author: '0xaB92...1fD7', text: 'Supports LP retention. Modeling looks solid.' },
      { author: '0x3bE1...d4F2', text: 'What about impact on volume? Higher fees could deter arb bots.' },
    ],
    timeline: { created: true, discussion: true, voting: true, execution: false },
  },
  {
    id: 'VIP-018',
    title: 'Deploy SOL/USDC cross-chain pool',
    status: 'ACTIVE',
    category: 'Protocol',
    forVotes: 1120000,
    againstVotes: 74000,
    abstainVotes: 37000,
    endTime: '5d 8h',
    proposer: '0x3bE1...d4F2',
    createdAt: 'Mar 3, 2026',
    description: 'Deploy a new SOL/USDC liquidity pool via LayerZero cross-chain messaging. Initial emission gauge weight of 10%. Solana bridging handled by the CrossChainRouter with 30-second finality.',
    discussion: [
      { author: '0xf1C8...e3A0', text: 'Solana integration is overdue. Full support.' },
    ],
    timeline: { created: true, discussion: true, voting: true, execution: false },
  },
  {
    id: 'VIP-019',
    title: 'Fund Memehunter analytics module',
    status: 'ACTIVE',
    category: 'Treasury',
    forVotes: 456000,
    againstVotes: 197000,
    abstainVotes: 49000,
    endTime: '3d 2h',
    proposer: '0xf1C8...e3A0',
    createdAt: 'Mar 5, 2026',
    description: 'Allocate 50,000 JUL from the DAO treasury to fund the Memehunter analytics module. Deliverables: smart contract scanner, social sentiment feed, and frontend integration within 90 days.',
    discussion: [],
    timeline: { created: true, discussion: true, voting: true, execution: false },
  },
  {
    id: 'VIP-016',
    title: 'Reduce commit phase to 8 seconds',
    status: 'EXECUTED',
    category: 'Protocol',
    forVotes: 1380000,
    againstVotes: 141000,
    abstainVotes: 47000,
    endTime: 'Executed',
    proposer: '0xaB92...1fD7',
    createdAt: 'Feb 20, 2026',
    description: 'Lower the commit-reveal auction minimum commitment from 10 seconds to 8 seconds. Analysis of 50,000 batch cycles shows 99.7% of reveals complete within 1.8 seconds.',
    discussion: [],
    timeline: { created: true, discussion: true, voting: true, execution: true },
  },
]

const EXECUTED_HISTORY = [
  { id: 'VIP-016', title: 'Reduce commit phase to 8 seconds', date: 'Mar 2, 2026', result: 'Passed 88%' },
  { id: 'VIP-014', title: 'Increase circuit breaker threshold to 8%', date: 'Feb 18, 2026', result: 'Passed 76%' },
  { id: 'VIP-011', title: 'Add ARB/ETH gauge', date: 'Feb 4, 2026', result: 'Passed 92%' },
  { id: 'VIP-009', title: 'Lower slashing penalty from 75% to 50%', date: 'Jan 20, 2026', result: 'Passed 81%' },
  { id: 'VIP-007', title: 'Implement Shapley distributor v2', date: 'Jan 5, 2026', result: 'Passed 95%' },
]

// ============ Mock Vote History ============

const VOTE_HISTORY = [
  { proposalId: 'VIP-016', title: 'Reduce commit phase to 8 seconds', yourVote: 'For', outcome: 'Passed', date: 'Mar 2, 2026' },
  { proposalId: 'VIP-014', title: 'Increase circuit breaker threshold to 8%', yourVote: 'For', outcome: 'Passed', date: 'Feb 18, 2026' },
  { proposalId: 'VIP-011', title: 'Add ARB/ETH gauge', yourVote: 'For', outcome: 'Passed', date: 'Feb 4, 2026' },
  { proposalId: 'VIP-009', title: 'Lower slashing penalty from 75% to 50%', yourVote: 'Against', outcome: 'Passed', date: 'Jan 20, 2026' },
  { proposalId: 'VIP-005', title: 'Enable cross-chain messaging v2', yourVote: 'For', outcome: 'Passed', date: 'Dec 15, 2025' },
  { proposalId: 'VIP-003', title: 'Increase treasury diversification cap', yourVote: 'Abstain', outcome: 'Rejected', date: 'Dec 1, 2025' },
]

// ============ Governance Stats ============

const GOV_STATS = {
  totalProposals: 19,
  passed: 16,
  rejected: 3,
  participationRate: 64.2,
  treasuryBalance: '$7.5M',
}

const TEN_COVENANTS = [
  'No governance action may seize or redirect user funds',
  'Commit-reveal fairness ordering is immutable',
  'MEV extraction by protocol insiders is permanently prohibited',
  'Private keys must never leave user custody',
  'Circuit breakers cannot be disabled by governance vote',
  'Flash loan protections are architecturally permanent',
  'Shapley attribution cannot be gamed by sybil splitting',
  'Cross-chain messages require cryptographic proof of origin',
  'Treasury withdrawals require multi-sig + timelock',
  'Fairness above all — P-000 is the genesis primitive',
]

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div
      custom={index}
      variants={sectionVariants}
      initial="hidden"
      animate="visible"
      className="mb-4"
    >
      <GlassCard glowColor="terminal" hover={false} className="p-5">
        <div className="mb-4">
          <h2 className="text-sm font-bold tracking-wider uppercase" style={{ color: CYAN }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs font-mono text-black-400 mt-1">{subtitle}</p>
          )}
          <div
            className="h-px mt-3"
            style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }}
          />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Animated Vote Progress Bar ============

function VoteProgressBar({ label, value, total, color, delay = 0 }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-mono text-black-500 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-black-900/80 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8 * PHI, delay, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[10px] font-mono text-black-400 w-12 text-right">
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

// ============ Quadratic Voting SVG ============

function QuadraticVotingSVG() {
  const pts = Array.from({ length: 20 }, (_, i) => {
    const t = (i + 1) * 5
    return { x: 20 + (i / 19) * 260, y: 130 - (Math.sqrt(t) / Math.sqrt(100)) * 110 }
  })
  const curve = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const linear = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${130 - ((i + 1) / 20) * 110}`).join(' ')
  return (
    <svg viewBox="0 0 300 150" className="w-full h-32">
      <defs>
        <linearGradient id="qvGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.2" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <line x1="20" y1="130" x2="280" y2="130" stroke="#333" strokeWidth="0.5" />
      <line x1="20" y1="20" x2="20" y2="130" stroke="#333" strokeWidth="0.5" />
      <path d={linear} fill="none" stroke="#555" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
      <motion.path d={curve} fill="none" stroke="url(#qvGrad)" strokeWidth="2"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 1.5 * PHI, ease: 'easeOut' }} />
      <text x="150" y="148" textAnchor="middle" fill="#666" fontSize="8" fontFamily="monospace">JUL Staked</text>
      <text x="8" y="75" textAnchor="middle" fill="#666" fontSize="8" fontFamily="monospace" transform="rotate(-90 8 75)">Votes</text>
      <text x="265" y="90" fill="#555" fontSize="7" fontFamily="monospace">linear</text>
      <text x="240" y="55" fill={CYAN} fontSize="7" fontFamily="monospace">quadratic</text>
    </svg>
  )
}

// ============ Proposal Timeline Mini ============

const TIMELINE_STAGES = ['Created', 'Discussion', 'Voting', 'Execution']
const TIMELINE_KEYS = ['created', 'discussion', 'voting', 'execution']

function ProposalTimeline({ timeline }) {
  return (
    <div className="flex items-center gap-1 mt-2">
      {TIMELINE_STAGES.map((stage, i) => {
        const active = timeline[TIMELINE_KEYS[i]]
        return (
          <div key={stage} className="flex items-center">
            <div className="flex flex-col items-center">
              <motion.div
                className="w-2.5 h-2.5 rounded-full border"
                style={{
                  background: active ? CYAN : 'transparent',
                  borderColor: active ? CYAN : '#444',
                  boxShadow: active ? `0 0 8px ${CYAN}40` : 'none',
                }}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: i * 0.1, duration: 0.3 }}
              />
              <span className={`text-[8px] font-mono mt-0.5 ${active ? 'text-cyan-400' : 'text-black-600'}`}>
                {stage}
              </span>
            </div>
            {i < TIMELINE_STAGES.length - 1 && (
              <div
                className="w-6 h-px mx-0.5 mb-3"
                style={{ background: timeline[TIMELINE_KEYS[i + 1]] ? CYAN : '#333' }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============ Quorum Progress Bar ============

function QuorumTracker({ proposal }) {
  const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes
  const quorumRequired = TOTAL_SUPPLY * QUORUM_THRESHOLD
  const quorumPct = Math.min((totalVotes / quorumRequired) * 100, 100)
  const met = totalVotes >= quorumRequired

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Quorum</span>
        <span className={`text-[9px] font-mono ${met ? 'text-green-400' : 'text-amber-400'}`}>
          {met ? 'Met' : `${quorumPct.toFixed(1)}% of 30%`}
        </span>
      </div>
      <div className="h-1.5 bg-black-900/80 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: met
              ? 'linear-gradient(90deg, #34d39980, #34d399)'
              : `linear-gradient(90deg, #f59e0b60, #f59e0b)`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${quorumPct}%` }}
          transition={{ duration: 1.0 * PHI, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ============ Voting Power Pie Chart SVG ============

function VotingPowerPie({ staked, delegated, lpBoost, total }) {
  const r = 40
  const cx = 50
  const cy = 50
  const segments = [
    { value: staked, color: CYAN, label: 'Staked' },
    { value: delegated, color: '#a78bfa', label: 'Delegated' },
    { value: lpBoost, color: '#34d399', label: 'LP Boost' },
  ]
  let cumulative = 0
  const arcs = segments.map((seg) => {
    const pct = seg.value / total
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2
    cumulative += pct
    const endAngle = cumulative * 2 * Math.PI - Math.PI / 2
    const largeArc = pct > 0.5 ? 1 : 0
    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    return { ...seg, d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`, pct }
  })

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0">
        {arcs.map((arc, i) => (
          <motion.path
            key={arc.label}
            d={arc.d}
            fill={arc.color}
            opacity={0.85}
            initial={{ scale: 0, transformOrigin: '50px 50px' }}
            animate={{ scale: 1 }}
            transition={{ delay: i * 0.15, duration: 0.5, ease: 'easeOut' }}
          />
        ))}
        <circle cx={cx} cy={cy} r="20" fill="#0a0a0a" />
        <text x={cx} y={cy - 3} textAnchor="middle" fill="#fff" fontSize="8" fontFamily="monospace" fontWeight="bold">
          {total.toLocaleString()}
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" fill="#888" fontSize="5" fontFamily="monospace">
          TOTAL
        </text>
      </svg>
      <div className="space-y-1.5">
        {arcs.map((arc) => (
          <div key={arc.label} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: arc.color }} />
            <span className="text-[10px] font-mono text-black-400">{arc.label}</span>
            <span className="text-[10px] font-mono text-white">{arc.value.toLocaleString()}</span>
            <span className="text-[9px] font-mono text-black-600">({(arc.pct * 100).toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function GovernancePage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [expandedProposal, setExpandedProposal] = useState(null)
  const [votes, setVotes] = useState({})
  const [confirmVote, setConfirmVote] = useState(null)
  const [delegateAddr, setDelegateAddr] = useState('')
  const [currentDelegate, setCurrentDelegate] = useState(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newCategory, setNewCategory] = useState('Protocol')
  const [activeTab, setActiveTab] = useState('proposals') // 'proposals' | 'history'

  const activeProposals = useMemo(() => PROPOSALS.filter(p => p.status === 'ACTIVE'), [])
  const userPower = useMemo(() => ({ staked: 12400, delegated: 3200, lpBoost: 1860, total: 17460 }), [])

  const handleDelegate = () => {
    if (delegateAddr) {
      setCurrentDelegate(delegateAddr)
      setDelegateAddr('')
    }
  }

  const handleUndelegate = () => {
    setCurrentDelegate(null)
  }

  const handleVote = (pid, choice) => {
    if (confirmVote?.id === pid && confirmVote?.choice === choice) {
      setVotes(prev => ({ ...prev, [pid]: choice }))
      setConfirmVote(null)
    } else {
      setConfirmVote({ id: pid, choice })
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* ============ Header ============ */}
      <motion.div className="text-center mb-8" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display">
          <span style={{ color: CYAN }}>GOVERN</span>ANCE
        </h1>
        <p className="text-black-400 text-sm mt-2 font-mono max-w-md mx-auto">
          Democratic protocol control. Vote on proposals, delegate power, shape the protocol. All governance bounded by the Ten Covenants.
        </p>
      </motion.div>

      {/* ============ 1. Governance Stats Bar ============ */}
      <Section index={0} title="Governance Stats" subtitle="Protocol governance at a glance">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total Proposals', value: GOV_STATS.totalProposals, accent: true },
            { label: 'Passed / Rejected', value: `${GOV_STATS.passed} / ${GOV_STATS.rejected}` },
            { label: 'Participation', value: `${GOV_STATS.participationRate}%` },
            { label: 'Treasury', value: GOV_STATS.treasuryBalance },
            { label: 'Your Power', value: isConnected ? userPower.total.toLocaleString() : '--', accent: true },
          ].map((s) => (
            <div key={s.label} className="text-center p-2 rounded-lg bg-black-900/40">
              <div className={`font-mono font-bold text-lg ${s.accent ? 'text-cyan-400' : 'text-white'}`}
                style={s.accent ? { textShadow: `0 0 20px ${CYAN}40` } : {}}>{s.value}</div>
              <div className="text-black-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ============ 2-4. Proposals + Detail + Voting + Vote History Tab ============ */}
      <Section index={1} title="Proposals" subtitle="Vote on pending protocol changes">
        {/* Tab switcher */}
        <div className="flex gap-2 mb-4">
          {[
            { key: 'proposals', label: 'Active Proposals' },
            { key: 'history', label: 'Your Vote History' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold transition-all border ${
                activeTab === tab.key
                  ? 'text-cyan-400 border-cyan-800/50 bg-cyan-900/20'
                  : 'text-black-500 border-black-700/30 hover:text-black-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'proposals' ? (
          <div className="space-y-3">
            {PROPOSALS.map((p) => {
              const total = p.forVotes + p.againstVotes + p.abstainVotes
              const isExp = expandedProposal === p.id
              const isActive = p.status === 'ACTIVE'
              const myVote = votes[p.id]
              const catColor = CATEGORY_COLORS[p.category] || CYAN
              return (
                <div key={p.id} className="rounded-xl border border-black-700/30 bg-black-900/30 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono text-cyan-500/70 tracking-wider">{p.id}</span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${isActive ? 'text-cyan-400 bg-cyan-900/20 border border-cyan-800/40' : 'text-green-400 bg-green-900/20 border border-green-800/40'}`}>{p.status}</span>
                        <span
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border"
                          style={{ color: catColor, borderColor: `${catColor}40`, background: `${catColor}10` }}
                        >
                          {p.category}
                        </span>
                      </div>
                      <h3 className="text-white text-sm font-semibold cursor-pointer hover:text-cyan-300 transition-colors"
                        onClick={() => setExpandedProposal(isExp ? null : p.id)}>
                        {p.title}<span className="text-black-500 text-[10px] ml-2">{isExp ? '\u25B2' : '\u25BC'}</span>
                      </h3>
                    </div>
                    <span className={`text-[10px] font-mono shrink-0 ml-3 ${isActive ? 'text-cyan-500/70' : 'text-black-600'}`}>{p.endTime}</span>
                  </div>
                  {/* Animated vote progress bars */}
                  <div className="space-y-1.5 mb-2">
                    <VoteProgressBar label="For" value={p.forVotes} total={total} color={`linear-gradient(90deg, ${CYAN}80, ${CYAN})`} />
                    <VoteProgressBar label="Against" value={p.againstVotes} total={total} color="linear-gradient(90deg, #ef444480, #ef4444)" delay={0.1} />
                    <VoteProgressBar label="Abstain" value={p.abstainVotes} total={total} color="linear-gradient(90deg, #6b728080, #6b7280)" delay={0.2} />
                  </div>
                  <div className="text-[10px] font-mono text-black-500 mb-1">{total.toLocaleString()} votes | {p.proposer}</div>
                  {/* Quorum tracker */}
                  {isActive && <QuorumTracker proposal={p} />}
                  {/* Proposal timeline */}
                  <ProposalTimeline timeline={p.timeline} />
                  {/* Expandable detail view */}
                  <AnimatePresence>
                    {isExp && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                        <div className="border-t border-black-700/30 pt-3 mt-2 space-y-3">
                          <p className="text-black-400 text-xs font-mono leading-relaxed pl-2 border-l-2 border-cyan-800/30">{p.description}</p>
                          {p.discussion.length > 0 && (
                            <div>
                              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Discussion</div>
                              {p.discussion.map((d, i) => (
                                <div key={i} className="text-[11px] font-mono text-black-400 mb-1.5 pl-2 border-l border-black-700/40">
                                  <span className="text-cyan-500/60">{d.author}:</span> {d.text}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* Vote casting: For / Against / Abstain with confirmation */}
                  {isActive && isConnected && !myVote && (
                    <div className="flex gap-2 mt-3">
                      {['For', 'Against', 'Abstain'].map((c) => {
                        const confirming = confirmVote?.id === p.id && confirmVote?.choice === c
                        const cm = { For: confirming ? 'bg-cyan-600 text-white border-cyan-500' : 'border-cyan-800/40 text-cyan-400 hover:bg-cyan-900/30',
                          Against: confirming ? 'bg-red-600 text-white border-red-500' : 'border-red-800/40 text-red-400 hover:bg-red-900/30',
                          Abstain: confirming ? 'bg-gray-600 text-white border-gray-500' : 'border-gray-700/40 text-gray-400 hover:bg-gray-900/30' }
                        return (
                          <button key={c} onClick={() => handleVote(p.id, c)}
                            className={`flex-1 py-1.5 text-[11px] font-mono font-semibold rounded-lg border transition-all ${cm[c]}`}>
                            {confirming ? `Confirm ${c}?` : c}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {myVote && <div className="mt-3 text-[11px] font-mono text-cyan-400/70 text-center">You voted: {myVote}</div>}
                  {isActive && !isConnected && <div className="mt-3 text-[10px] font-mono text-black-600 text-center">Connect wallet to vote</div>}
                </div>
              )
            })}
          </div>
        ) : (
          /* ============ Vote History Tab ============ */
          <div className="space-y-2">
            {isConnected ? (
              VOTE_HISTORY.length > 0 ? (
                VOTE_HISTORY.map((v, i) => {
                  const voteColor = v.yourVote === 'For' ? CYAN : v.yourVote === 'Against' ? '#ef4444' : '#6b7280'
                  const outcomeColor = v.outcome === 'Passed' ? '#34d399' : '#ef4444'
                  return (
                    <motion.div
                      key={v.proposalId}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 / PHI, duration: 0.3 }}
                      className="flex items-center justify-between p-3 rounded-lg bg-black-900/30 border border-black-800/30"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-white truncate">{v.title}</div>
                        <div className="text-[10px] font-mono text-black-500">{v.proposalId} | {v.date}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border"
                          style={{ color: voteColor, borderColor: `${voteColor}40` }}>
                          {v.yourVote}
                        </span>
                        <span className="text-[10px] font-mono" style={{ color: outcomeColor }}>
                          {v.outcome}
                        </span>
                      </div>
                    </motion.div>
                  )
                })
              ) : (
                <div className="text-sm font-mono text-black-500 text-center py-4">No vote history yet</div>
              )
            ) : (
              <div className="text-sm font-mono text-black-500 text-center py-4">Connect wallet to view vote history</div>
            )}
          </div>
        )}
      </Section>

      {/* ============ 5. Delegation Panel ============ */}
      <Section index={2} title="Delegation" subtitle="Delegate your voting power or see who delegates to you">
        {isConnected ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-black-900/40 text-center">
                <div className="text-white font-mono font-bold text-lg">{userPower.total.toLocaleString()}</div>
                <div className="text-[10px] font-mono text-black-500">Your Total Power</div>
              </div>
              <div className="p-3 rounded-lg bg-black-900/40 text-center">
                <div className="text-cyan-400 font-mono font-bold text-lg">{userPower.delegated.toLocaleString()}</div>
                <div className="text-[10px] font-mono text-black-500">Delegated to You</div>
              </div>
            </div>
            {/* Current delegate display */}
            {currentDelegate && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="p-3 rounded-lg bg-cyan-900/10 border border-cyan-800/30"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-0.5">Currently Delegated To</div>
                    <div className="text-xs font-mono text-cyan-400">{currentDelegate}</div>
                  </div>
                  <button
                    onClick={handleUndelegate}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold border border-red-800/40 text-red-400 hover:bg-red-900/20 transition-all"
                  >
                    Undelegate
                  </button>
                </div>
              </motion.div>
            )}
            <div className="flex gap-2">
              <input type="text" value={delegateAddr} onChange={(e) => setDelegateAddr(e.target.value)}
                placeholder="0x... delegate address"
                className="flex-1 bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50" />
              <button onClick={handleDelegate} disabled={!delegateAddr} className="px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all"
                style={delegateAddr ? { background: CYAN, color: '#000', boxShadow: `0 0 16px ${CYAN}30` } : { background: '#333', color: '#666' }}>
                {currentDelegate ? 'Redelegate' : 'Delegate'}
              </button>
            </div>
            <div className="text-[10px] font-mono text-black-500">
              {currentDelegate
                ? 'Your voting power is currently delegated. You can redelegate to a new address or undelegate to reclaim it.'
                : 'Delegating transfers your voting weight but not your tokens. Revoke at any time.'}
            </div>
          </div>
        ) : <div className="text-sm font-mono text-black-500 text-center py-4">Connect wallet to manage delegation</div>}
      </Section>

      {/* ============ 6. Proposal Creation Form ============ */}
      <Section index={3} title="Create Proposal" subtitle="Requires 10,000+ voting power">
        {isConnected && userPower.total >= 10000 ? (
          !showCreateForm ? (
            <button onClick={() => setShowCreateForm(true)}
              className="w-full py-3 rounded-lg text-sm font-mono font-semibold border transition-all hover:bg-cyan-900/20"
              style={{ color: CYAN, borderColor: `${CYAN}40` }}>+ Draft New Proposal</button>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Proposal title"
                className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50" />
              <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Full description and rationale..." rows={4}
                className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50 resize-none" />
              {/* Category dropdown */}
              <div>
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1.5">Category</div>
                <div className="flex gap-2">
                  {PROPOSAL_CATEGORIES.map((cat) => {
                    const catColor = CATEGORY_COLORS[cat]
                    const selected = newCategory === cat
                    return (
                      <button
                        key={cat}
                        onClick={() => setNewCategory(cat)}
                        className="flex-1 py-1.5 text-[11px] font-mono font-semibold rounded-lg border transition-all"
                        style={{
                          color: selected ? '#000' : catColor,
                          background: selected ? catColor : 'transparent',
                          borderColor: selected ? catColor : `${catColor}40`,
                        }}
                      >
                        {cat}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="p-3 bg-black-900/60 rounded-lg border border-black-700/40">
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Execution Preview</div>
                <div className="text-[11px] font-mono text-cyan-500/60">
                  {newTitle ? `GovernorBravo.propose([targets], [values], [calldatas], "${newTitle}")` : 'Enter title to see execution code...'}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowCreateForm(false); setNewTitle(''); setNewDescription(''); setNewCategory('Protocol') }}
                  className="flex-1 py-2 rounded-lg text-xs font-mono text-black-400 border border-black-700/40 hover:bg-black-800/50">Cancel</button>
                <button disabled={!newTitle || !newDescription} className="flex-1 py-2 rounded-lg text-xs font-mono font-bold transition-all"
                  style={newTitle && newDescription ? { background: CYAN, color: '#000' } : { background: '#333', color: '#666' }}>Submit Proposal</button>
              </div>
            </motion.div>
          )
        ) : <div className="text-sm font-mono text-black-500 text-center py-4">{isConnected ? 'Insufficient voting power (need 10,000+)' : 'Connect wallet to create proposals'}</div>}
      </Section>

      {/* ============ 7. Governance Timeline ============ */}
      <Section index={4} title="Governance Timeline" subtitle="Past 5 executed proposals">
        <div className="space-y-2">
          {EXECUTED_HISTORY.map((item, i) => (
            <motion.div key={item.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08, duration: 0.3 }}
              className="flex items-center justify-between p-2.5 rounded-lg bg-black-900/30 border border-black-800/30">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500/60" />
                <div>
                  <div className="text-xs font-mono text-white">{item.title}</div>
                  <div className="text-[10px] font-mono text-black-500">{item.id} | {item.date}</div>
                </div>
              </div>
              <span className="text-[10px] font-mono text-green-400/70 shrink-0 ml-3">{item.result}</span>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 8. Voting Power Breakdown ============ */}
      <Section index={5} title="Voting Power Breakdown" subtitle={isConnected ? 'Staked JUL + delegated + LP boost' : 'Connect wallet to view'}>
        {isConnected ? (
          <div className="space-y-4">
            {/* Pie chart visualization */}
            <VotingPowerPie
              staked={userPower.staked}
              delegated={userPower.delegated}
              lpBoost={userPower.lpBoost}
              total={userPower.total}
            />
            {/* Bar breakdown */}
            <div className="space-y-2">
              {[
                { label: 'Staked JUL', value: userPower.staked, color: CYAN },
                { label: 'Delegated', value: userPower.delegated, color: '#a78bfa' },
                { label: 'LP Boost', value: userPower.lpBoost, color: '#34d399' },
              ].map((src) => (
                <div key={src.label} className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-black-500 w-20 shrink-0">{src.label}</span>
                  <div className="flex-1 h-3 bg-black-900/80 rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: src.color }}
                      initial={{ width: 0 }} animate={{ width: `${(src.value / userPower.total) * 100}%` }}
                      transition={{ duration: 0.8 * PHI, ease: 'easeOut' }} />
                  </div>
                  <span className="text-[11px] font-mono text-white w-16 text-right">{src.value.toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2 border-t border-black-700/30">
                <span className="text-xs font-mono text-black-400">Total</span>
                <span className="text-xs font-mono font-bold text-cyan-400">{userPower.total.toLocaleString()} votes</span>
              </div>
            </div>
          </div>
        ) : <div className="text-sm font-mono text-black-500 text-center py-4">--</div>}
      </Section>

      {/* ============ 9. Constitutional Constraints (Ten Covenants) ============ */}
      <Section index={6} title="The Ten Covenants" subtitle="Things governance CANNOT override — immutable protocol law">
        <div className="space-y-2">
          {TEN_COVENANTS.map((covenant, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }} className="flex items-start gap-2.5 text-[11px] font-mono">
              <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5"
                style={{ background: `${CYAN}20`, color: CYAN }}>{i + 1}</span>
              <span className="text-black-300 leading-relaxed">{covenant}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-3 p-2.5 rounded-lg bg-amber-900/10 border border-amber-800/20">
          <div className="text-[10px] font-mono text-amber-500/80">
            These constraints are enforced at the smart contract level. No governance vote, multisig, or admin key can bypass them. Fairness above all.
          </div>
        </div>
      </Section>

      {/* ============ 10. Quadratic Voting Weight Visualization ============ */}
      <Section index={7} title="Quadratic Voting Weight" subtitle="Vote power = sqrt(tokens staked) — diminishing returns prevent plutocracy">
        <QuadraticVotingSVG />
        <div className="flex justify-between text-[10px] font-mono text-black-500 mt-2">
          <span>Linear voting lets whales dominate</span>
          <span style={{ color: CYAN }}>Quadratic voting amplifies small holders</span>
        </div>
      </Section>

      {/* ============ 11. Treasury Snapshot ============ */}
      <Section index={8} title="DAO Treasury" subtitle="Protocol-controlled assets">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'JUL', value: '2.4M', sub: '$3.6M' },
            { label: 'ETH', value: '820', sub: '$2.1M' },
            { label: 'USDC', value: '1.8M', sub: '$1.8M' },
            { label: 'Total', value: '$7.5M', accent: true },
          ].map((a) => (
            <div key={a.label} className="text-center p-2 rounded-lg bg-black-900/40">
              <div className={`font-mono font-bold text-lg ${a.accent ? 'text-cyan-400' : 'text-white'}`}
                style={a.accent ? { textShadow: `0 0 20px ${CYAN}40` } : {}}>{a.value}</div>
              <div className="text-[10px] font-mono text-black-500">{a.label}</div>
              {a.sub && !a.accent && <div className="text-[9px] font-mono text-black-600">{a.sub}</div>}
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] font-mono text-black-500">
          Treasury is governed by multi-sig + 2-day timelock. All withdrawals require on-chain proposal approval.
        </div>
      </Section>

      {/* ============ Wallet CTA ============ */}
      {!isConnected && (
        <motion.div className="text-center mt-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          <div className="text-black-500 text-xs font-mono py-4 border-t border-black-800/50">
            Connect wallet to vote on proposals, delegate power, and participate in governance
          </div>
        </motion.div>
      )}
    </div>
  )
}

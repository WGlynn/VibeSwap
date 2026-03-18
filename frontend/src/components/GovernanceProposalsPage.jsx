import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============================================================
// Governance Proposals Page — All active and past proposals
// Listing, filtering, voting bars, quorum, delegation, sidebar.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Animation Variants ============
const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.1 / PHI, ease: 'easeOut' } }),
}
const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: i * 0.06 / PHI, ease: 'easeOut' } }),
}

// ============ Seeded PRNG (seed 1010) ============
function seededRandom(seed) {
  let s = seed
  return function next() {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}
const rng = seededRandom(1010)

// ============ Status Config ============
const STATUS_CONFIG = {
  Active:  { bg: 'bg-cyan-900/20', border: 'border-cyan-800/40', text: 'text-cyan-400' },
  Passed:  { bg: 'bg-green-900/20', border: 'border-green-800/40', text: 'text-green-400' },
  Failed:  { bg: 'bg-red-900/20', border: 'border-red-800/40', text: 'text-red-400' },
  Pending: { bg: 'bg-amber-900/20', border: 'border-amber-800/40', text: 'text-amber-400' },
}
const FILTER_TABS = ['All', 'Active', 'Passed', 'Failed', 'Pending']
const TOTAL_SUPPLY = 10_000_000
const QUORUM_THRESHOLD = 0.30

// ============ Category Config ============
const CATEGORIES = ['Protocol', 'Treasury', 'Emergency', 'Community']
const CATEGORY_COLORS = { Protocol: CYAN, Treasury: '#a78bfa', Emergency: '#ef4444', Community: '#34d399' }

// ============ Generate 12 Mock Proposals ============
function generateProposals() {
  const titles = [
    'Increase LP base fee to 0.35%', 'Deploy SOL/USDC cross-chain pool',
    'Fund Memehunter analytics module', 'Reduce commit phase to 6 seconds',
    'Add ARB/ETH gauge with 8% weight', 'Implement quadratic voting for treasury proposals',
    'Raise circuit breaker threshold to 10%', 'Allocate 100K VIBE to bug bounty program',
    'Enable cross-chain governance messaging', 'Lower slashing penalty from 50% to 35%',
    'Deploy OP/USDC concentrated liquidity vault', 'Integrate Chainlink CCIP as backup oracle',
  ]
  const statuses = ['Active','Active','Active','Pending','Passed','Passed','Passed','Passed','Failed','Active','Pending','Failed']
  const proposers = [
    '0x7a3F...c91E','0x3bE1...d4F2','0xf1C8...e3A0','0xaB92...1fD7',
    '0x9c0D...1e2F','0x5e6F...7a8B','0x1a2B...3c4D','0xdE4F...5a6B',
    '0x8c7D...9e0F','0x2b3C...4d5E','0x6f7A...8b9C','0x0a1B...2c3D',
  ]
  const cats = ['Protocol','Protocol','Treasury','Protocol','Protocol','Community','Protocol','Treasury','Protocol','Protocol','Protocol','Emergency']
  const times = ['2d 14h','5d 8h','3d 2h','7d 0h','Ended','Ended','Ended','Ended','Ended','1d 6h','6d 18h','Ended']
  const descs = [
    'Raise the base swap fee from 0.05% to 0.10% to increase LP yield. The additional 0.05% is split 60/40 between LPs and the DAO treasury.',
    'Deploy a new SOL/USDC liquidity pool via LayerZero cross-chain messaging. Initial emission gauge weight of 10%.',
    'Allocate 50,000 JUL from the DAO treasury to fund the Memehunter analytics module with a 90-day delivery window.',
    'Lower the commit-reveal auction commitment window from 8 seconds to 6 seconds based on reveal latency analysis.',
    'Add a new ARB/ETH gauge with 8% initial weight allocation from the total emissions schedule.',
    'Implement sqrt(tokens) voting weight for treasury-related proposals to prevent whale dominance.',
    'Increase the volume circuit breaker from 5% to 10% to reduce false triggers during high-volatility events.',
    'Create a dedicated 100K VIBE bug bounty pool managed by the security multisig with tiered payouts.',
    'Enable governance proposals to be submitted and voted on from any supported chain via LayerZero messaging.',
    'Reduce the invalid reveal penalty from 50% to 35% after community feedback on severity.',
    'Deploy a CL vault for OP/USDC with auto-rebalancing in the 0.98-1.02 range for stablecoin efficiency.',
    'Add Chainlink CCIP as a secondary oracle fallback in case the primary Kalman filter oracle goes offline.',
  ]
  return titles.map((title, i) => ({
    id: `VIP-${String(i + 7).padStart(3, '0')}`, title, status: statuses[i],
    category: cats[i], proposer: proposers[i],
    forVotes: Math.floor(rng() * 1_200_000 + 200_000),
    againstVotes: Math.floor(rng() * 400_000 + 50_000),
    abstainVotes: Math.floor(rng() * 100_000 + 10_000),
    timeRemaining: times[i], description: descs[i],
    createdAt: `${['Jan','Feb','Mar'][Math.floor(rng() * 3)]} ${Math.floor(rng() * 28 + 1)}, 2026`,
  }))
}
const PROPOSALS = generateProposals()

// ============ Recent Votes ============
const RECENT_VOTES = [
  { voter: '0x7a3F...c91E', proposal: 'VIP-007', choice: 'For', power: 12400, time: '2m ago' },
  { voter: '0xaB92...1fD7', proposal: 'VIP-008', choice: 'Against', power: 8700, time: '5m ago' },
  { voter: '0x3bE1...d4F2', proposal: 'VIP-007', choice: 'For', power: 23100, time: '8m ago' },
  { voter: '0xf1C8...e3A0', proposal: 'VIP-010', choice: 'For', power: 5600, time: '12m ago' },
  { voter: '0x9c0D...1e2F', proposal: 'VIP-007', choice: 'Abstain', power: 3200, time: '15m ago' },
  { voter: '0x5e6F...7a8B', proposal: 'VIP-008', choice: 'For', power: 41000, time: '22m ago' },
  { voter: '0x2b3C...4d5E', proposal: 'VIP-010', choice: 'Against', power: 9800, time: '31m ago' },
  { voter: '0xdE4F...5a6B', proposal: 'VIP-007', choice: 'For', power: 15600, time: '45m ago' },
]

// ============ Stats Computation ============
function computeStats() {
  const active = PROPOSALS.filter((p) => p.status === 'Active').length
  const totalVotes = PROPOSALS.reduce((sum, p) => sum + p.forVotes + p.againstVotes + p.abstainVotes, 0)
  const quorumRequired = TOTAL_SUPPLY * QUORUM_THRESHOLD
  const quorumMet = PROPOSALS.filter((p) => (p.forVotes + p.againstVotes + p.abstainVotes) >= quorumRequired).length
  const quorumRate = PROPOSALS.length > 0 ? ((quorumMet / PROPOSALS.length) * 100).toFixed(1) : '0.0'
  const participation = ((totalVotes / (TOTAL_SUPPLY * PROPOSALS.length)) * 100).toFixed(1)
  return { active, totalVotes, quorumRate, participation }
}

// ============ Vote Progress Bar ============
function VoteBar({ label, value, total, color, delay = 0 }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-mono text-black-500 w-14 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-black-900/80 rounded-full overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ background: color }}
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8 * PHI, delay, ease: 'easeOut' }} />
      </div>
      <span className="text-[10px] font-mono text-black-400 w-14 text-right">
        {(value / 1000).toFixed(0)}K ({pct.toFixed(1)}%)
      </span>
    </div>
  )
}

// ============ Quorum Progress ============
function QuorumProgress({ proposal }) {
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
        <motion.div className="h-full rounded-full"
          style={{ background: met ? 'linear-gradient(90deg, #34d39980, #34d399)' : 'linear-gradient(90deg, #f59e0b60, #f59e0b)' }}
          initial={{ width: 0 }} animate={{ width: `${quorumPct}%` }}
          transition={{ duration: 1.0 * PHI, ease: 'easeOut' }} />
      </div>
    </div>
  )
}

// ============ Status Badge ============
function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.Active
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      {status}
    </span>
  )
}

// ============ Proposal Card ============
function ProposalCard({ proposal, index, isExpanded, onToggle }) {
  const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes
  const catColor = CATEGORY_COLORS[proposal.category] || CYAN
  const isActive = proposal.status === 'Active'
  return (
    <motion.div custom={index} variants={cardVariants} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" hover className="p-4 mb-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-mono text-cyan-500/70 tracking-wider">{proposal.id}</span>
              <StatusBadge status={proposal.status} />
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border"
                style={{ color: catColor, borderColor: `${catColor}40`, background: `${catColor}10` }}>
                {proposal.category}
              </span>
            </div>
            <h3 className="text-white text-sm font-semibold cursor-pointer hover:text-cyan-300 transition-colors"
              onClick={onToggle}>
              {proposal.title}
              <span className="text-black-500 text-[10px] ml-2">{isExpanded ? '\u25B2' : '\u25BC'}</span>
            </h3>
          </div>
          <span className={`text-[10px] font-mono shrink-0 ml-3 ${isActive ? 'text-cyan-500/70' : 'text-black-600'}`}>
            {proposal.timeRemaining}
          </span>
        </div>
        <div className="text-[10px] font-mono text-black-500 mb-2">
          Proposed by {proposal.proposer} | {proposal.createdAt}
        </div>
        <div className="space-y-1.5 mb-2">
          <VoteBar label="For" value={proposal.forVotes} total={totalVotes}
            color={`linear-gradient(90deg, ${CYAN}80, ${CYAN})`} />
          <VoteBar label="Against" value={proposal.againstVotes} total={totalVotes}
            color="linear-gradient(90deg, #ef444480, #ef4444)" delay={0.1} />
          <VoteBar label="Abstain" value={proposal.abstainVotes} total={totalVotes}
            color="linear-gradient(90deg, #6b728080, #6b7280)" delay={0.2} />
        </div>
        <div className="text-[10px] font-mono text-black-500 mb-1">{totalVotes.toLocaleString()} total votes</div>
        {isActive && <QuorumProgress proposal={proposal} />}
        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
              <div className="border-t border-black-700/30 pt-3 mt-2">
                <p className="text-black-400 text-xs font-mono leading-relaxed pl-2 border-l-2 border-cyan-800/30">
                  {proposal.description}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Recent Votes Sidebar ============
function RecentVotesSidebar() {
  const choiceColors = { For: CYAN, Against: '#ef4444', Abstain: '#6b7280' }
  return (
    <GlassCard glowColor="terminal" hover={false} className="p-4">
      <h3 className="text-sm font-bold tracking-wider uppercase mb-3" style={{ color: CYAN }}>
        Recent Votes
      </h3>
      <div className="h-px mb-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
      <div className="space-y-2.5">
        {RECENT_VOTES.map((vote, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }} className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-mono text-white truncate">{vote.voter}</div>
              <div className="text-[9px] font-mono text-black-600">
                {vote.proposal} | {vote.power.toLocaleString()} power | {vote.time}
              </div>
            </div>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border shrink-0 ml-2"
              style={{ color: choiceColors[vote.choice], borderColor: `${choiceColors[vote.choice]}40` }}>
              {vote.choice}
            </span>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  )
}

// ============ Delegation Section ============
function DelegationSection({ isConnected }) {
  const [delegateAddr, setDelegateAddr] = useState('')
  const [currentDelegate, setCurrentDelegate] = useState(null)
  const handleDelegate = () => { if (delegateAddr) { setCurrentDelegate(delegateAddr); setDelegateAddr('') } }
  const handleUndelegate = () => { setCurrentDelegate(null) }

  return (
    <GlassCard glowColor="terminal" hover={false} className="p-4">
      <h3 className="text-sm font-bold tracking-wider uppercase mb-1" style={{ color: CYAN }}>
        Delegate Voting Power
      </h3>
      <p className="text-[10px] font-mono text-black-500 mb-3">Transfer your voting weight without moving tokens</p>
      <div className="h-px mb-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
      {isConnected ? (
        <div className="space-y-3">
          {currentDelegate && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              className="p-3 rounded-lg bg-cyan-900/10 border border-cyan-800/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-0.5">Currently Delegated To</div>
                  <div className="text-xs font-mono text-cyan-400">{currentDelegate}</div>
                </div>
                <button onClick={handleUndelegate}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold border border-red-800/40 text-red-400 hover:bg-red-900/20 transition-all">
                  Undelegate
                </button>
              </div>
            </motion.div>
          )}
          <div className="flex gap-2">
            <input type="text" value={delegateAddr} onChange={(e) => setDelegateAddr(e.target.value)}
              placeholder="0x... delegate address"
              className="flex-1 bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50" />
            <button onClick={handleDelegate} disabled={!delegateAddr}
              className="px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all"
              style={delegateAddr ? { background: CYAN, color: '#000', boxShadow: `0 0 16px ${CYAN}30` } : { background: '#333', color: '#666' }}>
              {currentDelegate ? 'Redelegate' : 'Delegate'}
            </button>
          </div>
          <div className="text-[10px] font-mono text-black-500">
            {currentDelegate
              ? 'Your voting power is delegated. Redelegate or undelegate to reclaim it.'
              : 'Delegating transfers your voting weight but not your tokens. Revoke at any time.'}
          </div>
        </div>
      ) : (
        <div className="text-sm font-mono text-black-500 text-center py-4">Connect wallet to delegate voting power</div>
      )}
    </GlassCard>
  )
}

// ============ Create Proposal CTA ============
function CreateProposalCTA({ isConnected }) {
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Protocol')
  const mockStaked = 12400

  return (
    <GlassCard glowColor="terminal" hover={false} className="p-4">
      <h3 className="text-sm font-bold tracking-wider uppercase mb-1" style={{ color: CYAN }}>Create Proposal</h3>
      <p className="text-[10px] font-mono text-black-500 mb-3">Requires minimum 10,000 VIBE staked</p>
      <div className="h-px mb-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
      {!isConnected ? (
        <div className="text-sm font-mono text-black-500 text-center py-4">Connect wallet to create proposals</div>
      ) : mockStaked < 10000 ? (
        <div className="text-center py-4">
          <div className="text-sm font-mono text-black-500 mb-1">Insufficient stake</div>
          <div className="text-[10px] font-mono text-black-600">
            You have {mockStaked.toLocaleString()} VIBE staked. Need 10,000 minimum.
          </div>
        </div>
      ) : !showForm ? (
        <div className="text-center">
          <div className="text-[10px] font-mono text-black-500 mb-3">
            Your stake: {mockStaked.toLocaleString()} VIBE (eligible)
          </div>
          <button onClick={() => setShowForm(true)}
            className="w-full py-3 rounded-lg text-sm font-mono font-semibold border transition-all hover:bg-cyan-900/20"
            style={{ color: CYAN, borderColor: `${CYAN}40` }}>
            + Draft New Proposal
          </button>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Proposal title"
            className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Full description and rationale..." rows={4}
            className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50 resize-none" />
          <div>
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1.5">Category</div>
            <div className="flex gap-2">
              {CATEGORIES.map((cat) => {
                const catColor = CATEGORY_COLORS[cat]
                const selected = category === cat
                return (
                  <button key={cat} onClick={() => setCategory(cat)}
                    className="flex-1 py-1.5 text-[11px] font-mono font-semibold rounded-lg border transition-all"
                    style={{ color: selected ? '#000' : catColor, background: selected ? catColor : 'transparent',
                      borderColor: selected ? catColor : `${catColor}40` }}>
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowForm(false); setTitle(''); setDescription(''); setCategory('Protocol') }}
              className="flex-1 py-2 rounded-lg text-xs font-mono text-black-400 border border-black-700/40 hover:bg-black-800/50">
              Cancel
            </button>
            <button disabled={!title || !description}
              className="flex-1 py-2 rounded-lg text-xs font-mono font-bold transition-all"
              style={title && description ? { background: CYAN, color: '#000' } : { background: '#333', color: '#666' }}>
              Submit Proposal
            </button>
          </div>
        </motion.div>
      )}
    </GlassCard>
  )
}

// ============ Main Component ============
export default function GovernanceProposalsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeFilter, setActiveFilter] = useState('All')
  const [expandedId, setExpandedId] = useState(null)

  const stats = useMemo(() => computeStats(), [])
  const filteredProposals = useMemo(() => {
    if (activeFilter === 'All') return PROPOSALS
    return PROPOSALS.filter((p) => p.status === activeFilter)
  }, [activeFilter])

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* ============ Page Hero ============ */}
      <PageHero title="Proposals"
        subtitle="View, filter, and vote on all governance proposals shaping VibeSwap protocol"
        category="community" badge="Live" badgeColor={CYAN} />

      {/* ============ Stats Row ============ */}
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible" className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Proposals', value: stats.active, accent: true },
            { label: 'Total Votes Cast', value: stats.totalVotes >= 1_000_000
                ? (stats.totalVotes / 1_000_000).toFixed(1) + 'M' : (stats.totalVotes / 1_000).toFixed(0) + 'K' },
            { label: 'Quorum Rate', value: stats.quorumRate + '%' },
            { label: 'Voter Participation', value: stats.participation + '%', accent: true },
          ].map((s) => (
            <GlassCard key={s.label} glowColor="none" hover className="p-3">
              <div className="text-center">
                <div className={`font-mono font-bold text-xl ${s.accent ? 'text-cyan-400' : 'text-white'}`}
                  style={s.accent ? { textShadow: `0 0 20px ${CYAN}40` } : {}}>
                  {s.value}
                </div>
                <div className="text-black-500 text-[10px] font-mono uppercase tracking-wider mt-1">{s.label}</div>
              </div>
            </GlassCard>
          ))}
        </div>
      </motion.div>

      {/* ============ Filter Tabs ============ */}
      <motion.div custom={1} variants={sectionVariants} initial="hidden" animate="visible" className="mb-4">
        <div className="flex gap-2 flex-wrap">
          {FILTER_TABS.map((tab) => {
            const active = activeFilter === tab
            const count = tab === 'All' ? PROPOSALS.length : PROPOSALS.filter((p) => p.status === tab).length
            return (
              <button key={tab} onClick={() => setActiveFilter(tab)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold transition-all border ${
                  active ? 'text-cyan-400 border-cyan-800/50 bg-cyan-900/20' : 'text-black-500 border-black-700/30 hover:text-black-300'
                }`}>
                {tab} <span className={`ml-1 ${active ? 'text-cyan-500/60' : 'text-black-600'}`}>({count})</span>
              </button>
            )
          })}
        </div>
      </motion.div>

      {/* ============ Main Content Grid ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ============ Proposals List (2 cols) ============ */}
        <div className="lg:col-span-2">
          {filteredProposals.length === 0 ? (
            <GlassCard glowColor="none" hover={false} className="p-8">
              <div className="text-center text-sm font-mono text-black-500">
                No {activeFilter.toLowerCase()} proposals found
              </div>
            </GlassCard>
          ) : (
            filteredProposals.map((proposal, i) => (
              <ProposalCard key={proposal.id} proposal={proposal} index={i}
                isExpanded={expandedId === proposal.id}
                onToggle={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)} />
            ))
          )}
        </div>

        {/* ============ Right Sidebar ============ */}
        <div className="space-y-4">
          <motion.div custom={2} variants={sectionVariants} initial="hidden" animate="visible">
            <RecentVotesSidebar />
          </motion.div>
          <motion.div custom={3} variants={sectionVariants} initial="hidden" animate="visible">
            <CreateProposalCTA isConnected={isConnected} />
          </motion.div>
          <motion.div custom={4} variants={sectionVariants} initial="hidden" animate="visible">
            <DelegationSection isConnected={isConnected} />
          </motion.div>
          {!isConnected && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 / PHI }}>
              <GlassCard glowColor="none" hover={false} className="p-4">
                <div className="text-center text-[11px] font-mono text-black-500">
                  Connect wallet to vote on proposals, delegate power, and submit new proposals
                </div>
              </GlassCard>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}

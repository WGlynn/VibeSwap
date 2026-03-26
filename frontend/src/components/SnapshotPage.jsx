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
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Animation Helpers ============

const ease = [0.25, 0.1, 1 / PHI, 1]

function fadeIn(delay = 0) {
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 1 / (PHI * PHI), delay, ease },
  }
}

function stagger(index) {
  return fadeIn(index * (1 / (PHI * PHI * PHI)))
}

// ============ Section Header ============

function SectionTag({ children }) {
  return (
    <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">
      {children}
    </span>
  )
}

// ============ Status Helpers ============

const STATUS_COLORS = {
  active: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20', dot: 'bg-green-400' },
  closed: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', dot: 'bg-red-400' },
  pending: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-400' },
  executed: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', dot: 'bg-cyan-400' },
  defeated: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', dot: 'bg-red-400' },
}

function StatusBadge({ status }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.pending
  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase ${colors.bg} ${colors.text} border ${colors.border}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${colors.dot} ${status === 'active' ? 'animate-pulse' : ''}`} />
      {status}
    </div>
  )
}

// ============ Mock Active Proposals ============

const rng = seededRandom(42)

const MOCK_PROPOSALS = [
  {
    id: 'VSP-001',
    title: 'Increase JUL staking rewards from 8% to 12% Rate',
    description: 'Proposal to raise base staking yields to attract more long-term holders and deepen protocol liquidity. The increased rewards would be funded from the treasury surplus accumulated in Q1 2026.',
    author: '0x7a3B...f91E',
    status: 'active',
    votesFor: 2_847_000,
    votesAgainst: 912_000,
    votesAbstain: 234_000,
    quorum: 5_000_000,
    totalVotes: 3_993_000,
    timeRemaining: '2d 14h',
    createdAt: '2026-03-11',
    snapshotBlock: 19_847_321,
  },
  {
    id: 'VSP-002',
    title: 'Deploy VibeSwap on Arbitrum via LayerZero',
    description: 'Expand cross-chain presence by deploying core contracts to Arbitrum. This includes CommitRevealAuction, VibeAMM, and CrossChainRouter with pre-configured peers.',
    author: '0x1eC4...28aD',
    status: 'active',
    votesFor: 4_120_000,
    votesAgainst: 380_000,
    votesAbstain: 156_000,
    quorum: 5_000_000,
    totalVotes: 4_656_000,
    timeRemaining: '4d 6h',
    createdAt: '2026-03-09',
    snapshotBlock: 19_841_288,
  },
  {
    id: 'VSP-003',
    title: 'Add TWAP oracle deviation threshold configuration',
    description: 'Allow governance to adjust the maximum TWAP deviation threshold (currently hardcoded at 5%) per-pool, enabling tighter controls for stablecoin pairs and wider bands for volatile assets.',
    author: '0xd9F2...5c7B',
    status: 'active',
    votesFor: 1_980_000,
    votesAgainst: 2_140_000,
    votesAbstain: 890_000,
    quorum: 5_000_000,
    totalVotes: 5_010_000,
    timeRemaining: '18h',
    createdAt: '2026-03-07',
    snapshotBlock: 19_835_190,
  },
  {
    id: 'VSP-004',
    title: 'Allocate 500K JUL to liquidity mining program',
    description: 'Fund a 90-day liquidity mining initiative targeting ETH/USDC, WBTC/ETH, and JUL/USDC pools with Shapley-weighted reward distribution.',
    author: '0x4bA1...9e3C',
    status: 'pending',
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    quorum: 5_000_000,
    totalVotes: 0,
    timeRemaining: 'Starts in 6h',
    createdAt: '2026-03-13',
    snapshotBlock: 19_852_100,
  },
  {
    id: 'VSP-005',
    title: 'Reduce commit phase from 8s to 6s for high-volume pairs',
    description: 'Optimize batch auction timing for pairs exceeding 1000 daily trades. Shorter commit phases increase throughput while maintaining MEV protection through the reveal mechanism.',
    author: '0x82eF...1dA0',
    status: 'active',
    votesFor: 3_210_000,
    votesAgainst: 1_540_000,
    votesAbstain: 310_000,
    quorum: 5_000_000,
    totalVotes: 5_060_000,
    timeRemaining: '1d 2h',
    createdAt: '2026-03-08',
    snapshotBlock: 19_838_445,
  },
  {
    id: 'VSP-006',
    title: 'Integrate Shapley-weighted insurance premium discounts',
    description: 'Users with high Shapley contribution scores receive proportionally lower insurance premiums, rewarding cooperative behavior and deepening the mutualized risk pool.',
    author: '0xaC71...6fE2',
    status: 'active',
    votesFor: 2_650_000,
    votesAgainst: 420_000,
    votesAbstain: 180_000,
    quorum: 5_000_000,
    totalVotes: 3_250_000,
    timeRemaining: '3d 8h',
    createdAt: '2026-03-10',
    snapshotBlock: 19_844_012,
  },
  {
    id: 'VSP-007',
    title: 'Enable flash loan protection bypass for whitelisted contracts',
    description: 'Allow governance-approved contracts (audited DEX aggregators) to interact with commit-reveal without the EOA-only restriction, expanding composability.',
    author: '0x3Ff9...b4C8',
    status: 'active',
    votesFor: 890_000,
    votesAgainst: 3_780_000,
    votesAbstain: 670_000,
    quorum: 5_000_000,
    totalVotes: 5_340_000,
    timeRemaining: '12h',
    createdAt: '2026-03-06',
    snapshotBlock: 19_832_776,
  },
]

// ============ Mock Past Results ============

const PAST_PROPOSALS = [
  {
    id: 'VSP-000',
    title: 'Genesis: Ratify VibeSwap Constitution & Lawson Constant',
    outcome: 'passed',
    participation: 78.4,
    votesFor: 6_200_000,
    votesAgainst: 340_000,
    executionStatus: 'executed',
    executedAt: '2026-02-15',
  },
  {
    id: 'VSP-P01',
    title: 'Set initial circuit breaker thresholds (volume, price, withdrawal)',
    outcome: 'passed',
    participation: 64.2,
    votesFor: 4_800_000,
    votesAgainst: 1_100_000,
    executionStatus: 'executed',
    executedAt: '2026-02-20',
  },
  {
    id: 'VSP-P02',
    title: 'Proposal to remove commit-reveal mechanism for gas savings',
    outcome: 'defeated',
    participation: 82.1,
    votesFor: 1_200_000,
    votesAgainst: 5_900_000,
    executionStatus: 'defeated',
    executedAt: '2026-02-22',
  },
  {
    id: 'VSP-P03',
    title: 'Establish treasury diversification strategy (60/20/20 split)',
    outcome: 'passed',
    participation: 55.8,
    votesFor: 3_900_000,
    votesAgainst: 820_000,
    executionStatus: 'executed',
    executedAt: '2026-03-01',
  },
  {
    id: 'VSP-P04',
    title: 'Add JUL/ERG liquidity pool with 0.15% swap fee',
    outcome: 'passed',
    participation: 48.3,
    votesFor: 3_100_000,
    votesAgainst: 600_000,
    executionStatus: 'pending',
    executedAt: '2026-03-05',
  },
]

// ============ Mock Voting Power ============

const MOCK_VOTING_POWER = {
  julBalance: 125_400,
  delegatedPower: 42_800,
  totalWeight: 168_200,
  recentVotes: [
    { proposal: 'VSP-001', choice: 'For', weight: 168_200, date: '2026-03-11' },
    { proposal: 'VSP-002', choice: 'For', weight: 168_200, date: '2026-03-09' },
    { proposal: 'VSP-003', choice: 'Against', weight: 168_200, date: '2026-03-07' },
    { proposal: 'VSP-007', choice: 'Against', weight: 168_200, date: '2026-03-06' },
  ],
}

// ============ Mock Delegation ============

const MOCK_DELEGATION = {
  delegatedTo: '0xFair...ness1',
  delegatedFrom: [
    { address: '0xa1B2...c3D4', power: 22_400 },
    { address: '0xe5F6...g7H8', power: 12_100 },
    { address: '0xi9J0...k1L2', power: 8_300 },
  ],
  totalReceived: 42_800,
}

// ============ Voting Period Options ============

const VOTING_PERIODS = [
  { label: '3 days', value: 3 },
  { label: '5 days', value: 5 },
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
]

// ============ Format Helpers ============

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function votePercentage(votes, total) {
  if (total === 0) return 0
  return ((votes / total) * 100).toFixed(1)
}

// ============ Vote Bar Component ============

function VoteBar({ votesFor, votesAgainst, votesAbstain, total }) {
  if (total === 0) {
    return (
      <div className="w-full h-2 rounded-full bg-black-800/60 overflow-hidden">
        <div className="h-full bg-black-700/40 rounded-full" style={{ width: '100%' }} />
      </div>
    )
  }
  const forPct = (votesFor / total) * 100
  const againstPct = (votesAgainst / total) * 100
  const abstainPct = (votesAbstain / total) * 100

  return (
    <div className="w-full h-2 rounded-full bg-black-800/60 overflow-hidden flex">
      <div
        className="h-full bg-green-500 transition-all duration-500"
        style={{ width: `${forPct}%` }}
      />
      <div
        className="h-full bg-red-500 transition-all duration-500"
        style={{ width: `${againstPct}%` }}
      />
      <div
        className="h-full bg-amber-500 transition-all duration-500"
        style={{ width: `${abstainPct}%` }}
      />
    </div>
  )
}

// ============ Quorum Progress ============

function QuorumBar({ totalVotes, quorum }) {
  const pct = Math.min((totalVotes / quorum) * 100, 100)
  const reached = totalVotes >= quorum

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-mono">
        <span className="text-black-400">Quorum</span>
        <span className={reached ? 'text-green-400' : 'text-amber-400'}>
          {formatNumber(totalVotes)} / {formatNumber(quorum)} {reached ? '(Reached)' : ''}
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-black-800/60 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${reached ? 'bg-green-500' : 'bg-amber-500/80'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ============ Proposal Card ============

function ProposalCard({ proposal, index, isConnected, onVote, userVote }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div {...stagger(index)} key={proposal.id}>
      <GlassCard
        glowColor={proposal.status === 'active' ? 'terminal' : 'none'}
        spotlight={proposal.status === 'active'}
        className="p-4"
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono text-cyan-400/60">{proposal.id}</span>
              <StatusBadge status={proposal.status} />
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-left w-full"
            >
              <h3 className="font-mono text-sm font-semibold text-white leading-snug hover:text-cyan-300 transition-colors">
                {proposal.title}
              </h3>
            </button>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] font-mono text-black-400">
              {proposal.status === 'pending' ? proposal.timeRemaining : `${proposal.timeRemaining} left`}
            </div>
            <div className="text-[10px] font-mono text-black-500 mt-0.5">
              Block #{proposal.snapshotBlock.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Expandable description */}
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.3, ease }}
            className="mb-3"
          >
            <p className="text-xs font-mono text-black-400 leading-relaxed">
              {proposal.description}
            </p>
            <div className="text-[10px] font-mono text-black-500 mt-2">
              Proposed by {proposal.author} on {proposal.createdAt}
            </div>
          </motion.div>
        )}

        {/* Vote bar */}
        <div className="mb-2">
          <VoteBar
            votesFor={proposal.votesFor}
            votesAgainst={proposal.votesAgainst}
            votesAbstain={proposal.votesAbstain}
            total={proposal.totalVotes}
          />
        </div>

        {/* Vote counts */}
        <div className="flex items-center gap-4 text-[10px] font-mono mb-2">
          <span className="text-green-400">
            For: {formatNumber(proposal.votesFor)} ({votePercentage(proposal.votesFor, proposal.totalVotes)}%)
          </span>
          <span className="text-red-400">
            Against: {formatNumber(proposal.votesAgainst)} ({votePercentage(proposal.votesAgainst, proposal.totalVotes)}%)
          </span>
          <span className="text-amber-400">
            Abstain: {formatNumber(proposal.votesAbstain)} ({votePercentage(proposal.votesAbstain, proposal.totalVotes)}%)
          </span>
        </div>

        {/* Quorum */}
        <QuorumBar totalVotes={proposal.totalVotes} quorum={proposal.quorum} />

        {/* Vote buttons */}
        {proposal.status === 'active' && isConnected && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-black-800/60">
            {userVote ? (
              <div className="text-[10px] font-mono text-black-400">
                You voted <span className={
                  userVote === 'For' ? 'text-green-400' :
                  userVote === 'Against' ? 'text-red-400' : 'text-amber-400'
                }>{userVote}</span>
              </div>
            ) : (
              <>
                <button
                  onClick={() => onVote(proposal.id, 'For')}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                >
                  For
                </button>
                <button
                  onClick={() => onVote(proposal.id, 'Against')}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                >
                  Against
                </button>
                <button
                  onClick={() => onVote(proposal.id, 'Abstain')}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                >
                  Abstain
                </button>
              </>
            )}
          </div>
        )}

        {/* Not connected prompt */}
        {proposal.status === 'active' && !isConnected && (
          <div className="mt-3 pt-3 border-t border-black-800/60">
            <p className="text-[10px] font-mono text-black-500 text-center">
              Connect wallet to vote
            </p>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Past Result Row ============

function PastResultRow({ result, index }) {
  const totalVotes = result.votesFor + result.votesAgainst
  const forPct = totalVotes > 0 ? ((result.votesFor / totalVotes) * 100).toFixed(1) : '0'
  const passed = result.outcome === 'passed'

  return (
    <motion.div {...stagger(index)} key={result.id}>
      <div className="flex items-center gap-3 py-3 border-b border-black-800/40 last:border-b-0">
        {/* Outcome indicator */}
        <div className={`w-1.5 h-8 rounded-full shrink-0 ${passed ? 'bg-green-500' : 'bg-red-500'}`} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-mono text-cyan-400/60">{result.id}</span>
            <StatusBadge status={result.executionStatus} />
          </div>
          <p className="text-xs font-mono text-white truncate">{result.title}</p>
        </div>

        {/* Stats */}
        <div className="text-right shrink-0">
          <div className="text-[10px] font-mono text-black-400">
            {result.participation.toFixed(1)}% participation
          </div>
          <div className={`text-[10px] font-mono ${passed ? 'text-green-400' : 'text-red-400'}`}>
            {forPct}% approval
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ============ Main Component ============

export default function SnapshotPage() {
  // ============ Dual Wallet ============
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ============ State ============
  const [filter, setFilter] = useState('all')
  const [votes, setVotes] = useState({})
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newProposal, setNewProposal] = useState({
    title: '',
    description: '',
    choices: ['For', 'Against', 'Abstain'],
    votingPeriod: 7,
    quorumThreshold: 5_000_000,
  })

  // ============ Derived Data ============
  const filteredProposals = useMemo(() => {
    if (filter === 'all') return MOCK_PROPOSALS
    return MOCK_PROPOSALS.filter((p) => p.status === filter)
  }, [filter])

  const activeCount = useMemo(() => MOCK_PROPOSALS.filter((p) => p.status === 'active').length, [])
  const pendingCount = useMemo(() => MOCK_PROPOSALS.filter((p) => p.status === 'pending').length, [])
  const totalVotingPower = MOCK_VOTING_POWER.totalWeight

  // ============ Handlers ============
  function handleVote(proposalId, choice) {
    setVotes((prev) => ({ ...prev, [proposalId]: choice }))
  }

  function handleAddChoice() {
    if (newProposal.choices.length >= 8) return
    setNewProposal((prev) => ({
      ...prev,
      choices: [...prev.choices, `Option ${prev.choices.length + 1}`],
    }))
  }

  function handleRemoveChoice(index) {
    if (newProposal.choices.length <= 2) return
    setNewProposal((prev) => ({
      ...prev,
      choices: prev.choices.filter((_, i) => i !== index),
    }))
  }

  function handleUpdateChoice(index, value) {
    setNewProposal((prev) => ({
      ...prev,
      choices: prev.choices.map((c, i) => (i === index ? value : c)),
    }))
  }

  // ============ Seeded Colors for Delegation ============
  const delegationRng = seededRandom(777)
  const delegationHues = MOCK_DELEGATION.delegatedFrom.map(() => Math.floor(delegationRng() * 360))

  // ============ Render ============
  return (
    <div className="min-h-screen font-mono">
      {/* ============ Hero ============ */}
      <PageHero
        title="Governance Snapshots"
        subtitle="Off-chain voting with on-chain execution"
        category="community"
        badge="Live"
        badgeColor={CYAN}
      >
        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-black-800/60 border border-black-700/50 text-green-400">
            {activeCount} Active
          </div>
          <div className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-black-800/60 border border-black-700/50 text-amber-400">
            {pendingCount} Pending
          </div>
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4 pb-16">
        {/* ============ Stats Overview ============ */}
        <motion.div {...fadeIn(0)} className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Total Proposals', value: (MOCK_PROPOSALS.length + PAST_PROPOSALS.length).toString(), color: CYAN },
            { label: 'Active Votes', value: activeCount.toString(), color: '#22c55e' },
            { label: 'Avg Participation', value: '65.8%', color: '#a855f7' },
            { label: 'Your Power', value: isConnected ? formatNumber(totalVotingPower) : '--', color: '#f59e0b' },
          ].map((stat, i) => (
            <motion.div {...stagger(i)} key={stat.label}>
              <GlassCard className="p-3" hover={false}>
                <div className="text-[10px] font-mono text-black-400 uppercase tracking-wider mb-1">
                  {stat.label}
                </div>
                <div className="text-lg font-mono font-bold" style={{ color: stat.color }}>
                  {stat.value}
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ============ Left Column: Proposals ============ */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filter Tabs */}
            <motion.div {...fadeIn(0.1)} className="flex items-center gap-2">
              <SectionTag>proposals</SectionTag>
              <div className="flex-1" />
              {['all', 'active', 'pending', 'closed'].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-mono uppercase transition-colors ${
                    filter === f
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                      : 'text-black-400 hover:text-black-300 border border-transparent'
                  }`}
                >
                  {f}
                </button>
              ))}
            </motion.div>

            {/* Active Proposals List */}
            <div className="space-y-3">
              {filteredProposals.length > 0 ? (
                filteredProposals.map((proposal, i) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    index={i}
                    isConnected={isConnected}
                    onVote={handleVote}
                    userVote={votes[proposal.id]}
                  />
                ))
              ) : (
                <motion.div {...fadeIn(0)}>
                  <GlassCard className="p-8 text-center" hover={false}>
                    <p className="text-sm font-mono text-black-400">
                      No {filter} proposals found
                    </p>
                  </GlassCard>
                </motion.div>
              )}
            </div>

            {/* ============ Past Results ============ */}
            <motion.div {...fadeIn(0.3)} className="mt-8">
              <SectionTag>past results</SectionTag>
              <GlassCard className="p-4 mt-2" glowColor="none">
                <div className="space-y-0">
                  {PAST_PROPOSALS.map((result, i) => (
                    <PastResultRow key={result.id} result={result} index={i} />
                  ))}
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ Create Proposal ============ */}
            <motion.div {...fadeIn(0.4)} className="mt-8">
              <div className="flex items-center justify-between mb-2">
                <SectionTag>create proposal</SectionTag>
                {isConnected && (
                  <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="px-3 py-1 rounded-lg text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                  >
                    {showCreateForm ? 'Cancel' : 'New Proposal'}
                  </button>
                )}
              </div>

              {!isConnected ? (
                <GlassCard className="p-6 text-center" hover={false}>
                  <p className="text-sm font-mono text-black-400 mb-1">
                    Connect your wallet to create proposals
                  </p>
                  <p className="text-[10px] font-mono text-black-500">
                    Minimum 10,000 VIBE required to submit a governance proposal
                  </p>
                </GlassCard>
              ) : showCreateForm ? (
                <GlassCard className="p-5" glowColor="terminal" spotlight>
                  <div className="space-y-4">
                    {/* Title */}
                    <div>
                      <label className="text-[10px] font-mono text-black-400 uppercase tracking-wider block mb-1">
                        Proposal Title
                      </label>
                      <input
                        type="text"
                        value={newProposal.title}
                        onChange={(e) =>
                          setNewProposal((prev) => ({ ...prev, title: e.target.value }))
                        }
                        placeholder="Enter a concise title for your proposal..."
                        className="w-full bg-black-900/60 border border-black-700/50 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder:text-black-600 focus:outline-none focus:border-cyan-500/40 transition-colors"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label className="text-[10px] font-mono text-black-400 uppercase tracking-wider block mb-1">
                        Description
                      </label>
                      <textarea
                        value={newProposal.description}
                        onChange={(e) =>
                          setNewProposal((prev) => ({ ...prev, description: e.target.value }))
                        }
                        placeholder="Describe the proposal, its rationale, and expected impact..."
                        rows={4}
                        className="w-full bg-black-900/60 border border-black-700/50 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder:text-black-600 focus:outline-none focus:border-cyan-500/40 transition-colors resize-none"
                      />
                    </div>

                    {/* Choices */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-mono text-black-400 uppercase tracking-wider">
                          Voting Choices
                        </label>
                        <button
                          onClick={handleAddChoice}
                          disabled={newProposal.choices.length >= 8}
                          className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors disabled:text-black-600 disabled:cursor-not-allowed"
                        >
                          + Add Choice
                        </button>
                      </div>
                      <div className="space-y-2">
                        {newProposal.choices.map((choice, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-black-500 w-5 shrink-0">
                              {i + 1}.
                            </span>
                            <input
                              type="text"
                              value={choice}
                              onChange={(e) => handleUpdateChoice(i, e.target.value)}
                              className="flex-1 bg-black-900/60 border border-black-700/50 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500/40 transition-colors"
                            />
                            {newProposal.choices.length > 2 && (
                              <button
                                onClick={() => handleRemoveChoice(i)}
                                className="text-[10px] font-mono text-red-400/60 hover:text-red-400 transition-colors shrink-0"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Voting Period & Quorum */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-mono text-black-400 uppercase tracking-wider block mb-1">
                          Voting Period
                        </label>
                        <div className="flex gap-1.5">
                          {VOTING_PERIODS.map((period) => (
                            <button
                              key={period.value}
                              onClick={() =>
                                setNewProposal((prev) => ({ ...prev, votingPeriod: period.value }))
                              }
                              className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-mono transition-colors ${
                                newProposal.votingPeriod === period.value
                                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                                  : 'bg-black-900/60 text-black-400 border border-black-700/50 hover:text-black-300'
                              }`}
                            >
                              {period.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-mono text-black-400 uppercase tracking-wider block mb-1">
                          Quorum Threshold
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={formatNumber(newProposal.quorumThreshold)}
                            readOnly
                            className="flex-1 bg-black-900/60 border border-black-700/50 rounded-lg px-3 py-1.5 text-xs font-mono text-white"
                          />
                          <span className="text-[10px] font-mono text-black-500">JUL</span>
                        </div>
                      </div>
                    </div>

                    {/* Submit */}
                    <div className="flex items-center justify-between pt-2 border-t border-black-800/60">
                      <p className="text-[10px] font-mono text-black-500">
                        Snapshot will be taken at current block
                      </p>
                      <button
                        disabled={!newProposal.title.trim() || !newProposal.description.trim()}
                        className="px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: 'rgba(6, 182, 212, 0.15)',
                          color: CYAN,
                          border: '1px solid rgba(6, 182, 212, 0.3)',
                        }}
                      >
                        Submit Proposal
                      </button>
                    </div>
                  </div>
                </GlassCard>
              ) : null}
            </motion.div>
          </div>

          {/* ============ Right Column: Sidebar ============ */}
          <div className="space-y-4">
            {/* ============ Voting Power ============ */}
            <motion.div {...fadeIn(0.15)}>
              <SectionTag>voting power</SectionTag>
              <GlassCard className="p-4 mt-2" glowColor={isConnected ? 'terminal' : 'none'}>
                {isConnected ? (
                  <div className="space-y-3">
                    {/* JUL Balance */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-black-400 uppercase">JUL Balance</span>
                      <span className="text-sm font-mono font-semibold text-white">
                        {formatNumber(MOCK_VOTING_POWER.julBalance)}
                      </span>
                    </div>

                    {/* Delegated Power */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-black-400 uppercase">Delegated Power</span>
                      <span className="text-sm font-mono font-semibold text-purple-400">
                        +{formatNumber(MOCK_VOTING_POWER.delegatedPower)}
                      </span>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-black-800/60" />

                    {/* Total Weight */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-black-400 uppercase">Total Weight</span>
                      <span className="text-sm font-mono font-bold" style={{ color: CYAN }}>
                        {formatNumber(MOCK_VOTING_POWER.totalWeight)}
                      </span>
                    </div>

                    {/* Power Bar Visual */}
                    <div className="relative h-2 rounded-full bg-black-800/60 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(MOCK_VOTING_POWER.julBalance / MOCK_VOTING_POWER.totalWeight) * 100}%`,
                          backgroundColor: CYAN,
                        }}
                      />
                      <div
                        className="h-full rounded-full absolute top-0 bg-purple-500/80"
                        style={{
                          left: `${(MOCK_VOTING_POWER.julBalance / MOCK_VOTING_POWER.totalWeight) * 100}%`,
                          width: `${(MOCK_VOTING_POWER.delegatedPower / MOCK_VOTING_POWER.totalWeight) * 100}%`,
                        }}
                      />
                    </div>

                    <div className="flex items-center gap-3 text-[10px] font-mono text-black-500">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CYAN }} />
                        Owned
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-purple-500" />
                        Delegated
                      </div>
                    </div>

                    {/* Recent Votes */}
                    <div className="border-t border-black-800/60 pt-3">
                      <div className="text-[10px] font-mono text-black-400 uppercase tracking-wider mb-2">
                        Recent Votes
                      </div>
                      <div className="space-y-1.5">
                        {MOCK_VOTING_POWER.recentVotes.map((vote, i) => (
                          <div key={i} className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-black-400">{vote.proposal}</span>
                            <span
                              className={
                                vote.choice === 'For'
                                  ? 'text-green-400'
                                  : vote.choice === 'Against'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                              }
                            >
                              {vote.choice}
                            </span>
                            <span className="text-black-500">{vote.date}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <div className="text-2xl mb-2 opacity-40">&#x2696;</div>
                    <p className="text-xs font-mono text-black-400 mb-1">
                      Connect wallet to view voting power
                    </p>
                    <p className="text-[10px] font-mono text-black-500">
                      Hold VIBE tokens to participate in governance
                    </p>
                  </div>
                )}
              </GlassCard>
            </motion.div>

            {/* ============ Delegation ============ */}
            <motion.div {...fadeIn(0.25)}>
              <div className="flex items-center justify-between mb-2">
                <SectionTag>delegation</SectionTag>
                <Link
                  to="/delegate"
                  className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  Manage &rarr;
                </Link>
              </div>
              <GlassCard className="p-4" glowColor={isConnected ? 'none' : 'none'}>
                {isConnected ? (
                  <div className="space-y-3">
                    {/* Delegated To */}
                    <div>
                      <div className="text-[10px] font-mono text-black-400 uppercase mb-1">
                        Delegating To
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold"
                          style={{ backgroundColor: 'rgba(6, 182, 212, 0.15)', color: CYAN }}
                        >
                          F
                        </div>
                        <span className="text-xs font-mono text-white">
                          {MOCK_DELEGATION.delegatedTo}
                        </span>
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-black-800/60" />

                    {/* Delegated From */}
                    <div>
                      <div className="text-[10px] font-mono text-black-400 uppercase mb-1.5">
                        Delegated From ({MOCK_DELEGATION.delegatedFrom.length})
                      </div>
                      <div className="space-y-1.5">
                        {MOCK_DELEGATION.delegatedFrom.map((d, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-mono font-bold text-white"
                                style={{
                                  backgroundColor: `hsla(${delegationHues[i]}, 60%, 50%, 0.2)`,
                                  color: `hsl(${delegationHues[i]}, 60%, 60%)`,
                                }}
                              >
                                {d.address.charAt(2).toUpperCase()}
                              </div>
                              <span className="text-[10px] font-mono text-black-300">{d.address}</span>
                            </div>
                            <span className="text-[10px] font-mono text-purple-400">
                              {formatNumber(d.power)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Total Received */}
                    <div className="border-t border-black-800/60 pt-2">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-black-400 uppercase">Total Received</span>
                        <span className="text-purple-400 font-semibold">
                          {formatNumber(MOCK_DELEGATION.totalReceived)} JUL
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-3">
                    <p className="text-[10px] font-mono text-black-500">
                      Connect wallet to manage delegation
                    </p>
                  </div>
                )}
              </GlassCard>
            </motion.div>

            {/* ============ Governance Stats ============ */}
            <motion.div {...fadeIn(0.35)}>
              <SectionTag>protocol governance</SectionTag>
              <GlassCard className="p-4 mt-2" hover={false}>
                <div className="space-y-2.5">
                  {[
                    { label: 'Total Proposals', value: '12', icon: '#' },
                    { label: 'Pass Rate', value: '80%', icon: '%' },
                    { label: 'Avg Quorum', value: '62.4%', icon: 'Q' },
                    { label: 'Unique Voters', value: '1,847', icon: 'U' },
                    { label: 'Total JUL Voted', value: '48.2M', icon: 'J' },
                    { label: 'Execution Rate', value: '100%', icon: 'E' },
                  ].map((stat, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-mono bg-black-800/60 text-cyan-400/60">
                          {stat.icon}
                        </div>
                        <span className="text-[10px] font-mono text-black-400">{stat.label}</span>
                      </div>
                      <span className="text-xs font-mono text-white font-semibold">{stat.value}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ How Voting Works ============ */}
            <motion.div {...fadeIn(0.45)}>
              <SectionTag>how it works</SectionTag>
              <GlassCard className="p-4 mt-2" hover={false}>
                <div className="space-y-3">
                  {[
                    {
                      step: '01',
                      title: 'Snapshot Block',
                      desc: 'Your VIBE balance at the snapshot block determines voting weight',
                    },
                    {
                      step: '02',
                      title: 'Off-Chain Voting',
                      desc: 'Sign your vote with your wallet — no gas fees required',
                    },
                    {
                      step: '03',
                      title: 'Quorum Check',
                      desc: 'Proposal must reach minimum participation threshold',
                    },
                    {
                      step: '04',
                      title: 'On-Chain Execution',
                      desc: 'Passed proposals are executed via VibeSwap governance contracts',
                    },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold shrink-0"
                        style={{
                          backgroundColor: 'rgba(6, 182, 212, 0.08)',
                          color: CYAN,
                          border: '1px solid rgba(6, 182, 212, 0.15)',
                        }}
                      >
                        {item.step}
                      </div>
                      <div>
                        <div className="text-xs font-mono text-white font-semibold mb-0.5">
                          {item.title}
                        </div>
                        <div className="text-[10px] font-mono text-black-400 leading-relaxed">
                          {item.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ Links ============ */}
            <motion.div {...fadeIn(0.5)}>
              <GlassCard className="p-3" hover={false}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-400/60" />
                    <span className="text-[10px] font-mono text-black-400">
                      Governance Forum
                    </span>
                  </div>
                  <Link
                    to="/forum"
                    className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    Discuss &rarr;
                  </Link>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-400/60" />
                    <span className="text-[10px] font-mono text-black-400">
                      Constitution
                    </span>
                  </div>
                  <Link
                    to="/covenant"
                    className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    Read &rarr;
                  </Link>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400/60" />
                    <span className="text-[10px] font-mono text-black-400">
                      Treasury
                    </span>
                  </div>
                  <Link
                    to="/tokenomics"
                    className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    View &rarr;
                  </Link>
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============================================================
// Proposal Detail Page — Deep view of a single governance proposal.
// Voting, discussion, timeline, technical execution details.
// Cooperative Capitalism: every voice matters. Fairness above all.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.1 / PHI, ease: 'easeOut' },
  }),
}

// ============ Mock Proposal Data ============

const PROPOSAL = {
  id: 'VIP-42',
  title: 'Increase Insurance Pool Allocation from 5% to 8%',
  proposer: '0x7a3F...c91E',
  status: 'Active',
  category: 'Protocol',
  createdAt: 'Mar 8, 2026',
  endTime: '3d 12h 47m',
  forVotes: 1_284_000,
  againstVotes: 312_000,
  abstainVotes: 89_400,
  quorumRequired: 3_000_000,
  description: [
    'This proposal seeks to increase the insurance pool allocation from the current 5% of protocol fees to 8%. The insurance pool serves as the first line of defense against impermanent loss for liquidity providers, and analysis of the past 90 days shows that the current allocation is insufficient to cover peak drawdown events. Raising the allocation to 8% would bring the pool reserves to approximately $2.1M, covering a 3-sigma tail event with 99.7% confidence.',
    'The additional 3% would be sourced from the treasury surplus, which currently exceeds the 18-month operating runway target by $1.4M. No LP yields or staking rewards would be reduced. The Shapley distributor weights remain unchanged — this is purely a reallocation of treasury surplus into the insurance backstop. Game-theoretic modeling shows that a stronger insurance pool increases LP participation by 12-18%, which in turn deepens liquidity and tightens spreads.',
    'If passed, the reallocation will be executed via a single call to TreasuryStabilizer.setInsuranceAllocation(800) after the 48-hour timelock expires. The change is reversible by future governance vote. This proposal aligns with P-000 (Fairness Above All) by strengthening protections for the participants who assume the most risk — liquidity providers.',
  ],
}

const TOTAL_SUPPLY = 10_000_000
const QUORUM_THRESHOLD = 0.30

// ============ Timeline Data ============

const TIMELINE_STEPS = [
  { label: 'Created', date: 'Mar 8, 2026', completed: true },
  { label: 'Discussion', date: 'Mar 8 - Mar 10', completed: true },
  { label: 'Voting', date: 'Mar 10 - Mar 17', completed: false, active: true },
  { label: 'Execution', date: 'After 48h timelock', completed: false },
]

// ============ Mock Voters ============

const VOTERS = [
  { address: '0xaB92...1fD7', direction: 'For', amount: 245_000, timestamp: '2h ago' },
  { address: '0x3bE1...d4F2', direction: 'For', amount: 189_500, timestamp: '3h ago' },
  { address: '0xf1C8...e3A0', direction: 'Against', amount: 142_000, timestamp: '4h ago' },
  { address: '0x91D4...7b2C', direction: 'For', amount: 118_200, timestamp: '5h ago' },
  { address: '0xc5F0...a8E3', direction: 'Abstain', amount: 89_400, timestamp: '6h ago' },
  { address: '0x2eA7...f1B9', direction: 'For', amount: 74_300, timestamp: '8h ago' },
  { address: '0xd8B3...c4D6', direction: 'Against', amount: 67_800, timestamp: '10h ago' },
  { address: '0x6fE2...9a1F', direction: 'For', amount: 52_100, timestamp: '14h ago' },
]

// ============ Technical Execution Details ============

const EXECUTION = {
  targetContract: '0x4E7c...TreasuryStabilizer',
  functionSignature: 'setInsuranceAllocation(uint256)',
  parameters: [
    { name: '_newAllocationBps', type: 'uint256', value: '800' },
  ],
  calldata: '0xa9059cbb0000000000000000000000000000000000000000000000000000000000000320',
  timelockDelay: '48 hours',
  estimatedGas: '84,200',
}

// ============ Mock Discussion Comments ============

const COMMENTS = [
  {
    author: '0xaB92...1fD7',
    timestamp: 'Mar 9, 2026 14:32',
    text: 'Strong support. The insurance pool has been underfunded relative to TVL growth. The 3-sigma coverage threshold is exactly the kind of conservative risk management we need. LPs deserve better protection — this is what cooperative capitalism looks like.',
    upvotes: 24,
  },
  {
    author: '0xf1C8...e3A0',
    timestamp: 'Mar 9, 2026 16:07',
    text: 'I agree with the intent but 8% feels aggressive. Has anyone modeled what happens if we go to 7% first? The treasury surplus buffer would be thinner and we have cross-chain expansion costs coming in Q2. Would prefer a staged approach — 7% now, review in 60 days.',
    upvotes: 11,
  },
  {
    author: '0x3bE1...d4F2',
    timestamp: 'Mar 10, 2026 09:15',
    text: 'Ran the Shapley model with 8% allocation. LP participation increases 15.2% in the simulation, which generates enough additional fee revenue to offset the treasury reallocation within 4 months. The math checks out. Voting For.',
    upvotes: 18,
  },
]

// ============ Status Badge ============

function StatusBadge({ status }) {
  const config = {
    Active: { color: CYAN, bg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.3)', glow: `0 0 12px ${CYAN}25` },
    Passed: { color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.3)', glow: '0 0 12px rgba(52,211,153,0.25)' },
    Failed: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', glow: '0 0 12px rgba(239,68,68,0.25)' },
  }
  const c = config[status] || config.Active
  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3 / PHI, ease: 'easeOut' }}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold border"
      style={{ color: c.color, background: c.bg, borderColor: c.border, boxShadow: c.glow }}
    >
      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: c.color }} />
      {status}
    </motion.span>
  )
}

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
      <div className="flex-1 h-3 bg-black-900/80 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8 * PHI, delay, ease: 'easeOut' }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-white w-16 text-right">
          {value.toLocaleString()}
        </span>
        <span className="text-[10px] font-mono text-black-400 w-12 text-right">
          {pct.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function ProposalDetailPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [voteChoice, setVoteChoice] = useState(null)
  const [voteAmount, setVoteAmount] = useState('')
  const [confirmingVote, setConfirmingVote] = useState(false)
  const [hasVoted, setHasVoted] = useState(false)
  const [commentUpvotes, setCommentUpvotes] = useState({})
  const [showAllVoters, setShowAllVoters] = useState(false)

  const totalVotes = PROPOSAL.forVotes + PROPOSAL.againstVotes + PROPOSAL.abstainVotes
  const quorumPct = Math.min((totalVotes / PROPOSAL.quorumRequired) * 100, 100)
  const quorumMet = totalVotes >= PROPOSAL.quorumRequired

  const handleVoteSelect = (choice) => {
    if (hasVoted) return
    setVoteChoice(choice)
    setConfirmingVote(false)
  }

  const handleCastVote = () => {
    if (confirmingVote) {
      setHasVoted(true)
      setConfirmingVote(false)
    } else {
      setConfirmingVote(true)
    }
  }

  const handleUpvote = (index) => {
    setCommentUpvotes((prev) => ({
      ...prev,
      [index]: prev[index] ? false : true,
    }))
  }

  const displayedVoters = showAllVoters ? VOTERS : VOTERS.slice(0, 5)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* ============ Page Hero ============ */}
      <PageHero
        title="Proposal Detail"
        subtitle="Review, discuss, and cast your vote"
        category="community"
        badge={PROPOSAL.status}
        badgeColor={CYAN}
      />

      {/* ============ 1. Proposal Header ============ */}
      <Section index={0} title="Proposal" subtitle={PROPOSAL.id}>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[11px] font-mono font-bold tracking-wider px-2 py-0.5 rounded"
                  style={{ color: CYAN, background: `${CYAN}15` }}
                >
                  {PROPOSAL.id}
                </span>
                <StatusBadge status={PROPOSAL.status} />
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border"
                  style={{ color: CYAN, borderColor: `${CYAN}40`, background: `${CYAN}10` }}
                >
                  {PROPOSAL.category}
                </span>
              </div>
              <h3 className="text-white text-lg font-bold leading-snug">
                {PROPOSAL.title}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-4 text-[10px] font-mono text-black-500">
            <div className="flex items-center gap-1.5">
              <span className="text-black-600">Proposed by</span>
              <span className="text-cyan-400/80">{PROPOSAL.proposer}</span>
            </div>
            <div className="w-px h-3 bg-black-700" />
            <span>{PROPOSAL.createdAt}</span>
            <div className="w-px h-3 bg-black-700" />
            <span className="text-cyan-500/70">Ends in {PROPOSAL.endTime}</span>
          </div>
        </div>
      </Section>

      {/* ============ 2. Voting Progress ============ */}
      <Section index={1} title="Voting Progress" subtitle={`${totalVotes.toLocaleString()} votes cast`}>
        <div className="space-y-3">
          <VoteProgressBar
            label="For"
            value={PROPOSAL.forVotes}
            total={totalVotes}
            color={`linear-gradient(90deg, ${CYAN}80, ${CYAN})`}
          />
          <VoteProgressBar
            label="Against"
            value={PROPOSAL.againstVotes}
            total={totalVotes}
            color="linear-gradient(90deg, #ef444480, #ef4444)"
            delay={0.1}
          />
          <VoteProgressBar
            label="Abstain"
            value={PROPOSAL.abstainVotes}
            total={totalVotes}
            color="linear-gradient(90deg, #6b728080, #6b7280)"
            delay={0.2}
          />

          {/* Quorum Progress */}
          <div className="mt-4 pt-3 border-t border-black-700/30">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
                Quorum Progress
              </span>
              <span
                className={`text-[10px] font-mono font-semibold ${quorumMet ? 'text-green-400' : 'text-amber-400'}`}
              >
                {quorumMet
                  ? 'Quorum Met'
                  : `${quorumPct.toFixed(1)}% of ${(QUORUM_THRESHOLD * 100).toFixed(0)}% required`}
              </span>
            </div>
            <div className="h-2 bg-black-900/80 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: quorumMet
                    ? 'linear-gradient(90deg, #34d39980, #34d399)'
                    : 'linear-gradient(90deg, #f59e0b60, #f59e0b)',
                }}
                initial={{ width: 0 }}
                animate={{ width: `${quorumPct}%` }}
                transition={{ duration: 1.0 * PHI, delay: 0.3, ease: 'easeOut' }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] font-mono text-black-600">
                {totalVotes.toLocaleString()} votes
              </span>
              <span className="text-[9px] font-mono text-black-600">
                {PROPOSAL.quorumRequired.toLocaleString()} needed
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* ============ 3. Cast Your Vote ============ */}
      <Section index={2} title="Cast Your Vote" subtitle={isConnected ? 'Select your position and amount' : 'Connect wallet to vote'}>
        {isConnected ? (
          hasVoted ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 / PHI }}
              className="text-center py-6"
            >
              <div
                className="text-lg font-mono font-bold mb-1"
                style={{ color: CYAN, textShadow: `0 0 24px ${CYAN}40` }}
              >
                Vote Cast Successfully
              </div>
              <div className="text-xs font-mono text-black-400">
                You voted <span className="text-white font-semibold">{voteChoice}</span>
                {voteAmount && (
                  <span> with <span className="text-cyan-400">{voteAmount} VIBE</span></span>
                )}
              </div>
            </motion.div>
          ) : (
            <div className="space-y-4">
              {/* Vote Direction Buttons */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { choice: 'For', color: '#06b6d4', hoverBg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.4)' },
                  { choice: 'Against', color: '#ef4444', hoverBg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.4)' },
                  { choice: 'Abstain', color: '#6b7280', hoverBg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.4)' },
                ].map(({ choice, color, hoverBg, border }) => {
                  const selected = voteChoice === choice
                  return (
                    <motion.button
                      key={choice}
                      onClick={() => handleVoteSelect(choice)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="py-3 rounded-xl text-sm font-mono font-bold border-2 transition-all"
                      style={{
                        color: selected ? '#000' : color,
                        background: selected ? color : hoverBg,
                        borderColor: selected ? color : border,
                        boxShadow: selected ? `0 0 20px ${color}30` : 'none',
                      }}
                    >
                      {choice}
                    </motion.button>
                  )
                })}
              </div>

              {/* VIBE Amount Input */}
              <div>
                <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1.5 block">
                  VIBE Amount (voting power)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={voteAmount}
                    onChange={(e) => setVoteAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-black-900/60 border border-black-700 rounded-lg px-3 py-2.5 text-sm font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50 transition-colors"
                  />
                  <button
                    onClick={() => setVoteAmount('17,460')}
                    className="px-3 py-2.5 rounded-lg text-[10px] font-mono font-semibold border border-black-700/50 text-black-400 hover:text-cyan-400 hover:border-cyan-800/40 transition-all"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Cast Vote Button */}
              <motion.button
                onClick={handleCastVote}
                disabled={!voteChoice}
                whileHover={voteChoice ? { scale: 1.01 } : undefined}
                whileTap={voteChoice ? { scale: 0.99 } : undefined}
                className="w-full py-3 rounded-xl text-sm font-mono font-bold transition-all"
                style={{
                  background: voteChoice
                    ? confirmingVote
                      ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                      : `linear-gradient(135deg, ${CYAN}, #0891b2)`
                    : '#252525',
                  color: voteChoice ? '#000' : '#555',
                  boxShadow: voteChoice ? `0 0 24px ${confirmingVote ? '#f59e0b' : CYAN}25` : 'none',
                }}
              >
                {!voteChoice
                  ? 'Select a vote direction'
                  : confirmingVote
                    ? `Confirm Vote: ${voteChoice}?`
                    : `Cast Vote: ${voteChoice}`}
              </motion.button>
            </div>
          )
        ) : (
          <div className="text-sm font-mono text-black-500 text-center py-6">
            Connect wallet to participate in governance voting
          </div>
        )}
      </Section>

      {/* ============ 4. Proposal Description ============ */}
      <Section index={3} title="Description" subtitle="Full proposal rationale">
        <div className="space-y-4">
          {PROPOSAL.description.map((paragraph, i) => (
            <motion.p
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: (i * 0.15) / PHI, ease: 'easeOut' }}
              className="text-xs font-mono text-black-300 leading-relaxed pl-3 border-l-2"
              style={{ borderColor: i === 0 ? `${CYAN}50` : 'rgba(55,55,55,0.5)' }}
            >
              {paragraph}
            </motion.p>
          ))}
        </div>
      </Section>

      {/* ============ 5. Proposal Timeline ============ */}
      <Section index={4} title="Timeline" subtitle="Governance lifecycle stages">
        <div className="relative">
          {/* Vertical connecting line */}
          <div
            className="absolute left-[11px] top-3 bottom-3 w-px"
            style={{ background: `linear-gradient(180deg, ${CYAN}60, ${CYAN}10)` }}
          />

          <div className="space-y-4">
            {TIMELINE_STEPS.map((step, i) => (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: i * 0.12 / PHI, ease: 'easeOut' }}
                className="flex items-start gap-4 relative"
              >
                {/* Node dot */}
                <div className="relative z-10 mt-0.5">
                  <motion.div
                    className="w-6 h-6 rounded-full border-2 flex items-center justify-center"
                    style={{
                      borderColor: step.completed || step.active ? CYAN : '#333',
                      background: step.completed ? CYAN : step.active ? `${CYAN}20` : 'transparent',
                      boxShadow: step.active ? `0 0 12px ${CYAN}40` : 'none',
                    }}
                    animate={step.active ? { boxShadow: [`0 0 12px ${CYAN}40`, `0 0 20px ${CYAN}60`, `0 0 12px ${CYAN}40`] } : {}}
                    transition={step.active ? { duration: 2 * PHI, repeat: Infinity, ease: 'easeInOut' } : {}}
                  >
                    {step.completed && (
                      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {step.active && (
                      <div className="w-2 h-2 rounded-full" style={{ background: CYAN }} />
                    )}
                  </motion.div>
                </div>

                {/* Step content */}
                <div className="flex-1 pb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-mono font-semibold ${step.completed || step.active ? 'text-white' : 'text-black-500'}`}
                    >
                      {step.label}
                    </span>
                    {step.active && (
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{ color: CYAN, background: `${CYAN}15`, border: `1px solid ${CYAN}30` }}
                      >
                        Current
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-black-500 mt-0.5 block">
                    {step.date}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ============ 6. Voter List ============ */}
      <Section index={5} title="Recent Voters" subtitle={`${VOTERS.length} votes recorded`}>
        <div className="space-y-2">
          {/* Table header */}
          <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] font-mono text-black-600 uppercase tracking-wider">
            <span className="flex-1">Address</span>
            <span className="w-16 text-center">Vote</span>
            <span className="w-20 text-right">Amount</span>
            <span className="w-16 text-right">Time</span>
          </div>

          {displayedVoters.map((voter, i) => {
            const dirColor =
              voter.direction === 'For' ? CYAN
                : voter.direction === 'Against' ? '#ef4444'
                  : '#6b7280'
            return (
              <motion.div
                key={voter.address}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 / PHI, duration: 0.3 }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-black-900/30 border border-black-800/30"
              >
                <span className="flex-1 text-[11px] font-mono text-cyan-400/70">
                  {voter.address}
                </span>
                <span
                  className="w-16 text-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border"
                  style={{ color: dirColor, borderColor: `${dirColor}40`, background: `${dirColor}10` }}
                >
                  {voter.direction}
                </span>
                <span className="w-20 text-right text-[11px] font-mono text-white">
                  {voter.amount.toLocaleString()}
                </span>
                <span className="w-16 text-right text-[10px] font-mono text-black-500">
                  {voter.timestamp}
                </span>
              </motion.div>
            )
          })}

          {VOTERS.length > 5 && (
            <button
              onClick={() => setShowAllVoters(!showAllVoters)}
              className="w-full py-2 text-[11px] font-mono text-black-400 hover:text-cyan-400 transition-colors"
            >
              {showAllVoters ? 'Show less' : `Show all ${VOTERS.length} voters`}
            </button>
          )}
        </div>
      </Section>

      {/* ============ 7. Technical Details ============ */}
      <Section index={6} title="Technical Execution" subtitle="On-chain action after timelock">
        <div className="space-y-3">
          {/* Contract + Function */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-black-900/50 border border-black-800/30">
              <div className="text-[9px] font-mono text-black-600 uppercase tracking-wider mb-1">
                Target Contract
              </div>
              <div className="text-[11px] font-mono text-cyan-400/80 break-all">
                {EXECUTION.targetContract}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-black-900/50 border border-black-800/30">
              <div className="text-[9px] font-mono text-black-600 uppercase tracking-wider mb-1">
                Function
              </div>
              <div className="text-[11px] font-mono text-white">
                {EXECUTION.functionSignature}
              </div>
            </div>
          </div>

          {/* Parameters */}
          <div className="p-3 rounded-lg bg-black-900/50 border border-black-800/30">
            <div className="text-[9px] font-mono text-black-600 uppercase tracking-wider mb-2">
              Parameters
            </div>
            <div className="space-y-1.5">
              {EXECUTION.parameters.map((param) => (
                <div key={param.name} className="flex items-center gap-3 text-[11px] font-mono">
                  <span className="text-cyan-500/60">{param.name}</span>
                  <span className="text-black-600">:</span>
                  <span className="text-black-500">{param.type}</span>
                  <span className="text-black-600">=</span>
                  <span
                    className="text-white font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: `${CYAN}10` }}
                  >
                    {param.value}
                  </span>
                  <span className="text-black-600 text-[9px]">(8.00%)</span>
                </div>
              ))}
            </div>
          </div>

          {/* Calldata */}
          <div className="p-3 rounded-lg bg-black-900/50 border border-black-800/30">
            <div className="text-[9px] font-mono text-black-600 uppercase tracking-wider mb-2">
              Encoded Calldata
            </div>
            <div
              className="text-[10px] font-mono text-black-400 break-all p-2 rounded bg-black-950/50 border border-black-800/20"
              style={{ fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace' }}
            >
              {EXECUTION.calldata}
            </div>
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-4 text-[10px] font-mono text-black-500">
            <div className="flex items-center gap-1.5">
              <span className="text-black-600">Timelock:</span>
              <span className="text-amber-400/80">{EXECUTION.timelockDelay}</span>
            </div>
            <div className="w-px h-3 bg-black-700" />
            <div className="flex items-center gap-1.5">
              <span className="text-black-600">Est. Gas:</span>
              <span className="text-white">{EXECUTION.estimatedGas}</span>
            </div>
          </div>
        </div>
      </Section>

      {/* ============ 8. Discussion ============ */}
      <Section index={7} title="Discussion" subtitle={`${COMMENTS.length} comments`}>
        <div className="space-y-3">
          {COMMENTS.map((comment, i) => {
            const upvoted = commentUpvotes[i]
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.1 / PHI, ease: 'easeOut' }}
                className="p-3 rounded-lg bg-black-900/30 border border-black-800/30"
              >
                {/* Comment header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-cyan-400/70">
                      {comment.author}
                    </span>
                    <span className="text-[9px] font-mono text-black-600">
                      {comment.timestamp}
                    </span>
                  </div>
                </div>

                {/* Comment body */}
                <p className="text-[11px] font-mono text-black-300 leading-relaxed mb-2.5">
                  {comment.text}
                </p>

                {/* Upvote button */}
                <div className="flex items-center gap-2">
                  <motion.button
                    onClick={() => handleUpvote(i)}
                    whileTap={{ scale: 0.9 }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold border transition-all"
                    style={{
                      color: upvoted ? CYAN : '#555',
                      borderColor: upvoted ? `${CYAN}40` : '#333',
                      background: upvoted ? `${CYAN}10` : 'transparent',
                    }}
                  >
                    <svg
                      className="w-3 h-3"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 9V3M6 3L3 6M6 3l3 3" />
                    </svg>
                    {comment.upvotes + (upvoted ? 1 : 0)}
                  </motion.button>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Add comment prompt */}
        {isConnected ? (
          <div className="mt-4 pt-3 border-t border-black-700/30">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add a comment..."
                className="flex-1 bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50 transition-colors"
              />
              <button
                className="px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all"
                style={{ background: CYAN, color: '#000', boxShadow: `0 0 16px ${CYAN}20` }}
              >
                Post
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 text-[10px] font-mono text-black-500 text-center pt-3 border-t border-black-700/30">
            Connect wallet to join the discussion
          </div>
        )}
      </Section>

      {/* ============ Wallet CTA ============ */}
      {!isConnected && (
        <motion.div
          className="text-center mt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 / PHI }}
        >
          <div className="text-black-500 text-xs font-mono py-4 border-t border-black-800/50">
            Connect wallet to vote, comment, and participate in governance
          </div>
        </motion.div>
      )}
    </div>
  )
}

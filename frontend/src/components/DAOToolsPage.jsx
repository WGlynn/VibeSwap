import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============================================================
// DAO Tools Page — Multi-sig management, treasury operations,
// payroll streams, voting modules, token gating, and analytics
// for decentralized organizations on VibeSwap.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Animation Variants ============
const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.1 / PHI, ease: 'easeOut' } }),
}

// ============ Tool Tab Definitions ============
const TOOL_TABS = [
  { key: 'multisig', label: 'Multi-Sig', icon: '\u{1F512}' },
  { key: 'treasury', label: 'Treasury', icon: '\u{1F3E6}' },
  { key: 'payroll', label: 'Payroll', icon: '\u{1F4B8}' },
  { key: 'voting', label: 'Voting', icon: '\u{1F5F3}' },
  { key: 'tokengating', label: 'Token Gating', icon: '\u{1F511}' },
  { key: 'analytics', label: 'Analytics', icon: '\u{1F4CA}' },
]

// ============ Mock Data: Multi-Sig ============
const MULTISIG_SIGNERS = [
  { address: '0x7a3F...c91E', label: 'Treasury Lead', confirmed: true },
  { address: '0xaB92...1fD7', label: 'Core Dev', confirmed: true },
  { address: '0x3bE1...d4F2', label: 'Security Officer', confirmed: true },
  { address: '0xf1C8...e3A0', label: 'Community Rep', confirmed: false },
  { address: '0x9dE4...b7A3', label: 'Advisor', confirmed: false },
]

const PENDING_TRANSACTIONS = [
  { id: 'TX-0042', description: 'Transfer 50,000 USDC to grant recipient GR-014', value: '$50,000', confirmations: 2, required: 3, created: '2h ago' },
  { id: 'TX-0041', description: 'Approve router upgrade to v2.3.1', value: 'Contract Call', confirmations: 1, required: 3, created: '8h ago' },
  { id: 'TX-0040', description: 'Add 0x5cF2...a8B1 as new signer (4-of-6)', value: 'Config Change', confirmations: 3, required: 3, created: '1d ago' },
]

// ============ Mock Data: Treasury ============
const TREASURY_ASSETS = [
  { token: 'ETH', balance: '820.4', usdValue: 2_106_000, allocation: 28.1, color: '#627eea' },
  { token: 'USDC', balance: '1,344,000', usdValue: 1_344_000, allocation: 18.0, color: '#2775ca' },
  { token: 'JUL', balance: '2,400,000', usdValue: 3_600_000, allocation: 38.0, color: CYAN },
  { token: 'WBTC', balance: '12.8', usdValue: 832_000, allocation: 11.1, color: '#f7931a' },
  { token: 'DAI', balance: '362,300', usdValue: 362_300, allocation: 4.8, color: '#f5ac37' },
]

const REBALANCING_SUGGESTIONS = [
  { action: 'Increase', token: 'ETH', reason: 'Below target allocation of 30%', urgency: 'medium' },
  { action: 'Reduce', token: 'JUL', reason: 'Concentration risk above 35% threshold', urgency: 'low' },
  { action: 'Increase', token: 'USDC', reason: 'Stablecoin reserves below 20% minimum', urgency: 'high' },
]

// ============ Mock Data: Payroll ============
const TEAM_MEMBERS = [
  { address: '0x7a3F...c91E', role: 'Lead Developer', monthly: 12_500, vesting: '4yr / 1yr cliff', startDate: 'Jan 2025', streamed: 162_500 },
  { address: '0xaB92...1fD7', role: 'Smart Contract Engineer', monthly: 10_000, vesting: '3yr / 6mo cliff', startDate: 'Mar 2025', streamed: 100_000 },
  { address: '0x3bE1...d4F2', role: 'Frontend Engineer', monthly: 9_500, vesting: '3yr / 6mo cliff', startDate: 'Apr 2025', streamed: 85_500 },
  { address: '0xf1C8...e3A0', role: 'Community Manager', monthly: 6_000, vesting: '2yr / 3mo cliff', startDate: 'Jun 2025', streamed: 48_000 },
]

// ============ Mock Data: Voting ============
const ACTIVE_VOTES = [
  {
    id: 'DAO-007',
    title: 'Increase developer compensation by 8%',
    description: 'Adjust base salaries for core contributors to match market rates following Q1 2026 compensation survey.',
    options: ['Approve', 'Reject', 'Defer to Q3'],
    votes: [1842, 634, 312],
    totalVoters: 2788,
    quorum: 3000,
    endsIn: '2d 6h',
    proposer: '0x7a3F...c91E',
  },
  {
    id: 'DAO-008',
    title: 'Allocate 100K USDC for security audit',
    description: 'Fund a comprehensive audit of CrossChainRouter v2 and the new batch settlement engine by Trail of Bits.',
    options: ['Approve', 'Reject'],
    votes: [2410, 187],
    totalVoters: 2597,
    quorum: 2500,
    endsIn: '4d 18h',
    proposer: '0xaB92...1fD7',
  },
]

// ============ Mock Data: Token Gating ============
const GATING_RULES = [
  { id: 'GATE-01', name: 'Core Contributors', type: 'Token Holding', requirement: 'Hold >= 10,000 JUL', access: 'Treasury Management', members: 23 },
  { id: 'GATE-02', name: 'Verified Members', type: 'NFT Ownership', requirement: 'VibePass NFT', access: 'Proposal Creation', members: 147 },
  { id: 'GATE-03', name: 'Security Council', type: 'DAO Role', requirement: 'SECURITY_ROLE assigned', access: 'Emergency Actions', members: 5 },
  { id: 'GATE-04', name: 'LP Providers', type: 'Token Holding', requirement: 'Hold any VIBE-LP token', access: 'Fee Distribution Voting', members: 892 },
]

// ============ Mock Data: Analytics ============
const DAO_ANALYTICS = {
  totalMembers: 3_847,
  proposalPassRate: 84.2,
  voterParticipation: 61.8,
  avgVotingPower: 4_720,
}

const TREASURY_GROWTH = (() => {
  const r = seededRandom(42)
  const months = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb']
  let base = 4_200_000
  return months.map((month) => {
    base += Math.floor(r() * 800_000) + 200_000
    return { month, value: base }
  })
})()

// ============ Mock Data: Activity Timeline ============
const ACTIVITY_TIMELINE = [
  { id: 1, action: 'Proposal DAO-008 created', actor: '0xaB92...1fD7', time: '2h ago', type: 'proposal' },
  { id: 2, action: 'Multi-sig TX-0042 submitted', actor: '0x7a3F...c91E', time: '3h ago', type: 'multisig' },
  { id: 3, action: 'Payroll stream started for 0xf1C8...e3A0', actor: '0x7a3F...c91E', time: '1d ago', type: 'payroll' },
  { id: 4, action: 'TX-0040 executed (3/3 confirmations)', actor: '0x3bE1...d4F2', time: '1d ago', type: 'multisig' },
  { id: 5, action: 'Token gate GATE-04 updated requirements', actor: '0xaB92...1fD7', time: '2d ago', type: 'gating' },
  { id: 6, action: 'Treasury rebalance: sold 50K JUL for USDC', actor: 'Stabilizer Bot', time: '3d ago', type: 'treasury' },
]

// ============ Top-Level Stats ============
const PLATFORM_STATS = [
  { label: 'DAOs Using', value: '142', accent: true },
  { label: 'TVL Managed', value: '$24.8M' },
  { label: 'Proposals Executed', value: '1,847' },
  { label: 'Active Members', value: '12,340', accent: true },
]

// ============ Quick Actions ============
const QUICK_ACTIONS = [
  { label: 'New Proposal', color: CYAN },
  { label: 'Send Payment', color: '#a78bfa' },
  { label: 'Add Signer', color: '#34d399' },
  { label: 'Create Bounty', color: '#f97316' },
]

// ============ Activity Type Colors ============
const ACTIVITY_COLORS = {
  proposal: '#a78bfa',
  multisig: CYAN,
  payroll: '#34d399',
  treasury: '#facc15',
  gating: '#f97316',
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

// ============ Animated Progress Bar ============
function ProgressBar({ value, max, color, delay = 0, height = 'h-2.5' }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className={`flex-1 ${height} bg-black-900/80 rounded-full overflow-hidden`}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8 * PHI, delay, ease: 'easeOut' }}
      />
    </div>
  )
}

// ============ Multi-Sig Panel ============
function MultiSigPanel({ isConnected }) {
  return (
    <div className="space-y-4">
      {/* Signer Setup */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
            Signer Configuration — 3 of 5 Required
          </span>
          <span className="text-[10px] font-mono text-cyan-400/70">Active</span>
        </div>
        <div className="space-y-1.5">
          {MULTISIG_SIGNERS.map((signer, i) => (
            <motion.div
              key={signer.address}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 / PHI, duration: 0.3 }}
              className="flex items-center justify-between p-2.5 rounded-lg bg-black-900/30 border border-black-800/30"
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: signer.confirmed ? '#34d399' : '#6b7280' }}
                />
                <div>
                  <span className="text-xs font-mono text-white">{signer.address}</span>
                  <span className="text-[10px] font-mono text-black-500 ml-2">{signer.label}</span>
                </div>
              </div>
              <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${
                signer.confirmed
                  ? 'text-green-400 border-green-800/40 bg-green-900/20'
                  : 'text-black-500 border-black-700/40'
              }`}>
                {signer.confirmed ? 'Confirmed' : 'Pending'}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Pending Transactions */}
      <div>
        <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
          Pending Transactions
        </div>
        <div className="space-y-2">
          {PENDING_TRANSACTIONS.map((tx, i) => (
            <motion.div
              key={tx.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.08, duration: 0.3 }}
              className="p-3 rounded-lg bg-black-900/40 border border-black-800/30"
            >
              <div className="flex items-start justify-between mb-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-cyan-500/70">{tx.id}</span>
                    <span className="text-[10px] font-mono text-black-600">{tx.created}</span>
                  </div>
                  <div className="text-xs font-mono text-white">{tx.description}</div>
                </div>
                <span className="text-[10px] font-mono text-black-400 shrink-0 ml-3">{tx.value}</span>
              </div>
              <div className="flex items-center gap-2">
                <ProgressBar
                  value={tx.confirmations}
                  max={tx.required}
                  color={tx.confirmations >= tx.required
                    ? 'linear-gradient(90deg, #34d39980, #34d399)'
                    : `linear-gradient(90deg, ${CYAN}80, ${CYAN})`}
                  height="h-1.5"
                />
                <span className={`text-[10px] font-mono shrink-0 ${
                  tx.confirmations >= tx.required ? 'text-green-400' : 'text-cyan-400/70'
                }`}>
                  {tx.confirmations}/{tx.required} sigs
                </span>
              </div>
              {isConnected && tx.confirmations < tx.required && (
                <button
                  className="mt-2 w-full py-1.5 rounded-lg text-[10px] font-mono font-semibold border transition-all hover:bg-cyan-900/20"
                  style={{ color: CYAN, borderColor: `${CYAN}40` }}
                >
                  Sign Transaction
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============ Treasury Panel ============
function TreasuryPanel() {
  const totalUsd = TREASURY_ASSETS.reduce((sum, a) => sum + a.usdValue, 0)

  return (
    <div className="space-y-4">
      {/* Asset Allocation */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
            Asset Allocation
          </span>
          <span className="text-xs font-mono text-cyan-400" style={{ textShadow: `0 0 20px ${CYAN}40` }}>
            ${(totalUsd / 1_000_000).toFixed(1)}M Total
          </span>
        </div>
        <div className="space-y-2">
          {TREASURY_ASSETS.map((asset, i) => (
            <motion.div
              key={asset.token}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 / PHI, duration: 0.3 }}
              className="flex items-center gap-3"
            >
              <div className="w-8 text-right">
                <span className="text-[11px] font-mono font-semibold" style={{ color: asset.color }}>
                  {asset.token}
                </span>
              </div>
              <ProgressBar
                value={asset.allocation}
                max={100}
                color={`linear-gradient(90deg, ${asset.color}80, ${asset.color})`}
                delay={i * 0.05}
              />
              <div className="w-24 text-right">
                <div className="text-[10px] font-mono text-white">${(asset.usdValue / 1_000).toFixed(0)}K</div>
                <div className="text-[9px] font-mono text-black-600">{asset.allocation}%</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Rebalancing Suggestions */}
      <div>
        <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
          Rebalancing Suggestions
        </div>
        <div className="space-y-1.5">
          {REBALANCING_SUGGESTIONS.map((suggestion, i) => {
            const urgencyColors = { high: '#ef4444', medium: '#f59e0b', low: '#34d399' }
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.06, duration: 0.3 }}
                className="flex items-center gap-2.5 p-2 rounded-lg bg-black-900/30 border border-black-800/30"
              >
                <div
                  className="w-1.5 h-8 rounded-full shrink-0"
                  style={{ background: urgencyColors[suggestion.urgency] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono text-white">
                    <span style={{ color: suggestion.action === 'Increase' ? '#34d399' : '#ef4444' }}>
                      {suggestion.action}
                    </span>{' '}
                    {suggestion.token}
                  </div>
                  <div className="text-[10px] font-mono text-black-500">{suggestion.reason}</div>
                </div>
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border shrink-0"
                  style={{
                    color: urgencyColors[suggestion.urgency],
                    borderColor: `${urgencyColors[suggestion.urgency]}40`,
                  }}
                >
                  {suggestion.urgency}
                </span>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============ Payroll Panel ============
function PayrollPanel() {
  const totalMonthly = TEAM_MEMBERS.reduce((sum, m) => sum + m.monthly, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
          Recurring Payment Streams
        </span>
        <span className="text-xs font-mono text-cyan-400">
          ${totalMonthly.toLocaleString()}/mo total
        </span>
      </div>
      <div className="space-y-2">
        {TEAM_MEMBERS.map((member, i) => {
          const vestingProgress = member.streamed / (member.monthly * 36) // approx vesting total
          return (
            <motion.div
              key={member.address}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 / PHI, duration: 0.3 }}
              className="p-3 rounded-lg bg-black-900/40 border border-black-800/30"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-xs font-mono text-white">{member.role}</div>
                  <div className="text-[10px] font-mono text-black-500">{member.address}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono text-cyan-400">
                    ${member.monthly.toLocaleString()}/mo
                  </div>
                  <div className="text-[9px] font-mono text-black-600">
                    since {member.startDate}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] font-mono text-black-500 w-14 shrink-0">Vesting</span>
                <ProgressBar
                  value={vestingProgress * 100}
                  max={100}
                  color={`linear-gradient(90deg, ${CYAN}80, ${CYAN})`}
                  delay={i * 0.05}
                  height="h-1.5"
                />
                <span className="text-[9px] font-mono text-black-400 w-20 text-right">
                  {member.vesting}
                </span>
              </div>
              <div className="text-[9px] font-mono text-black-600">
                Total streamed: ${member.streamed.toLocaleString()} USDC
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ============ Voting Panel ============
function VotingPanel({ isConnected }) {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [proposalTitle, setProposalTitle] = useState('')
  const [proposalDesc, setProposalDesc] = useState('')
  const [proposalQuorum, setProposalQuorum] = useState('3000')
  const [proposalPeriod, setProposalPeriod] = useState('7')

  return (
    <div className="space-y-4">
      {/* Active Votes */}
      <div>
        <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
          Active Votes
        </div>
        <div className="space-y-3">
          {ACTIVE_VOTES.map((vote, vi) => {
            const totalVotes = vote.votes.reduce((a, b) => a + b, 0)
            const quorumPct = Math.min((vote.totalVoters / vote.quorum) * 100, 100)
            const quorumMet = vote.totalVoters >= vote.quorum

            return (
              <motion.div
                key={vote.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: vi * 0.1, duration: 0.3 }}
                className="p-3 rounded-lg bg-black-900/40 border border-black-800/30"
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-mono text-cyan-500/70">{vote.id}</span>
                      <span className="text-[10px] font-mono text-black-600">by {vote.proposer}</span>
                    </div>
                    <div className="text-xs font-mono text-white font-semibold">{vote.title}</div>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-500/70 shrink-0 ml-3">
                    {vote.endsIn}
                  </span>
                </div>
                <p className="text-[10px] font-mono text-black-500 mb-2 leading-relaxed">
                  {vote.description}
                </p>
                {/* Vote option bars */}
                <div className="space-y-1.5 mb-2">
                  {vote.options.map((option, oi) => {
                    const optionColors = [
                      `linear-gradient(90deg, ${CYAN}80, ${CYAN})`,
                      'linear-gradient(90deg, #ef444480, #ef4444)',
                      'linear-gradient(90deg, #6b728080, #6b7280)',
                    ]
                    const pct = totalVotes > 0 ? (vote.votes[oi] / totalVotes) * 100 : 0
                    return (
                      <div key={option} className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-black-500 w-14 shrink-0 truncate">
                          {option}
                        </span>
                        <ProgressBar
                          value={vote.votes[oi]}
                          max={totalVotes}
                          color={optionColors[oi] || optionColors[2]}
                          delay={oi * 0.08}
                        />
                        <span className="text-[10px] font-mono text-black-400 w-12 text-right">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
                {/* Quorum */}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">
                    Quorum
                  </span>
                  <span className={`text-[9px] font-mono ${quorumMet ? 'text-green-400' : 'text-amber-400'}`}>
                    {quorumMet ? 'Met' : `${quorumPct.toFixed(1)}%`}
                  </span>
                </div>
                <div className="h-1.5 bg-black-900/80 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: quorumMet
                        ? 'linear-gradient(90deg, #34d39980, #34d399)'
                        : 'linear-gradient(90deg, #f59e0b60, #f59e0b)',
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${quorumPct}%` }}
                    transition={{ duration: 1.0 * PHI, ease: 'easeOut' }}
                  />
                </div>
                <div className="text-[9px] font-mono text-black-600 mt-1">
                  {vote.totalVoters.toLocaleString()} / {vote.quorum.toLocaleString()} voters
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Create Proposal Form */}
      <div>
        <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
          Create Proposal
        </div>
        {!showCreateForm ? (
          <button
            onClick={() => setShowCreateForm(true)}
            className="w-full py-2.5 rounded-lg text-xs font-mono font-semibold border transition-all hover:bg-cyan-900/20"
            style={{ color: CYAN, borderColor: `${CYAN}40` }}
          >
            + Draft New Proposal
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-2.5 overflow-hidden"
          >
            <input
              type="text"
              value={proposalTitle}
              onChange={(e) => setProposalTitle(e.target.value)}
              placeholder="Proposal title"
              className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50"
            />
            <textarea
              value={proposalDesc}
              onChange={(e) => setProposalDesc(e.target.value)}
              placeholder="Description and rationale..."
              rows={3}
              className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-black-600 outline-none focus:border-cyan-800/50 resize-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1 block">
                  Quorum (voters)
                </label>
                <input
                  type="number"
                  value={proposalQuorum}
                  onChange={(e) => setProposalQuorum(e.target.value)}
                  className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-1.5 text-xs font-mono text-white outline-none focus:border-cyan-800/50"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1 block">
                  Voting Period (days)
                </label>
                <input
                  type="number"
                  value={proposalPeriod}
                  onChange={(e) => setProposalPeriod(e.target.value)}
                  className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-1.5 text-xs font-mono text-white outline-none focus:border-cyan-800/50"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowCreateForm(false); setProposalTitle(''); setProposalDesc('') }}
                className="flex-1 py-2 rounded-lg text-xs font-mono text-black-400 border border-black-700/40 hover:bg-black-800/50"
              >
                Cancel
              </button>
              <button
                disabled={!proposalTitle || !proposalDesc}
                className="flex-1 py-2 rounded-lg text-xs font-mono font-bold transition-all"
                style={proposalTitle && proposalDesc
                  ? { background: CYAN, color: '#000', boxShadow: `0 0 16px ${CYAN}30` }
                  : { background: '#333', color: '#666' }}
              >
                Submit Proposal
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ============ Token Gating Panel ============
function TokenGatingPanel() {
  return (
    <div className="space-y-4">
      <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
        Access Control Rules
      </div>
      <div className="space-y-2">
        {GATING_RULES.map((rule, i) => {
          const typeColors = {
            'Token Holding': CYAN,
            'NFT Ownership': '#a78bfa',
            'DAO Role': '#34d399',
          }
          const color = typeColors[rule.type] || CYAN

          return (
            <motion.div
              key={rule.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07 / PHI, duration: 0.3 }}
              className="p-3 rounded-lg bg-black-900/40 border border-black-800/30"
            >
              <div className="flex items-start justify-between mb-1.5">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-white font-semibold">{rule.name}</span>
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border"
                      style={{ color, borderColor: `${color}40`, background: `${color}10` }}
                    >
                      {rule.type}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-black-500">{rule.requirement}</div>
                </div>
                <span className="text-[10px] font-mono text-black-400 shrink-0 ml-3">
                  {rule.members} members
                </span>
              </div>
              <div className="text-[10px] font-mono text-cyan-500/60">
                Grants access to: {rule.access}
              </div>
            </motion.div>
          )
        })}
      </div>
      <div className="p-2.5 rounded-lg bg-cyan-900/10 border border-cyan-800/20">
        <div className="text-[10px] font-mono text-cyan-500/80">
          Token gates are enforced on-chain via the AccessControl module. Rules can be combined with AND/OR logic for complex permission schemes.
        </div>
      </div>
    </div>
  )
}

// ============ Analytics Panel ============
function AnalyticsPanel() {
  const maxGrowth = Math.max(...TREASURY_GROWTH.map((d) => d.value))

  return (
    <div className="space-y-4">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Members', value: DAO_ANALYTICS.totalMembers.toLocaleString(), accent: true },
          { label: 'Pass Rate', value: `${DAO_ANALYTICS.proposalPassRate}%` },
          { label: 'Participation', value: `${DAO_ANALYTICS.voterParticipation}%` },
          { label: 'Avg Power', value: DAO_ANALYTICS.avgVotingPower.toLocaleString(), accent: true },
        ].map((metric) => (
          <div key={metric.label} className="text-center p-2 rounded-lg bg-black-900/40">
            <div
              className={`font-mono font-bold text-lg ${metric.accent ? 'text-cyan-400' : 'text-white'}`}
              style={metric.accent ? { textShadow: `0 0 20px ${CYAN}40` } : {}}
            >
              {metric.value}
            </div>
            <div className="text-black-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">
              {metric.label}
            </div>
          </div>
        ))}
      </div>

      {/* Treasury Growth Bar Chart */}
      <div>
        <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-3">
          Treasury Growth (6 Months)
        </div>
        <div className="flex items-end gap-2 h-32 px-2">
          {TREASURY_GROWTH.map((point, i) => {
            const barHeight = (point.value / maxGrowth) * 100
            return (
              <div key={point.month} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[8px] font-mono text-black-500">
                  ${(point.value / 1_000_000).toFixed(1)}M
                </span>
                <motion.div
                  className="w-full rounded-t-md"
                  style={{
                    background: `linear-gradient(180deg, ${CYAN}, ${CYAN}40)`,
                    minHeight: 4,
                  }}
                  initial={{ height: 0 }}
                  animate={{ height: `${barHeight}%` }}
                  transition={{ duration: 0.6 * PHI, delay: i * 0.08, ease: 'easeOut' }}
                />
                <span className="text-[9px] font-mono text-black-500">{point.month}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Participation Gauge */}
      <div>
        <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
          Voter Participation Rate
        </div>
        <div className="flex items-center gap-3">
          <ProgressBar
            value={DAO_ANALYTICS.voterParticipation}
            max={100}
            color={`linear-gradient(90deg, ${CYAN}80, ${CYAN})`}
          />
          <span className="text-xs font-mono text-cyan-400 shrink-0">
            {DAO_ANALYTICS.voterParticipation}%
          </span>
        </div>
        <div className="text-[9px] font-mono text-black-600 mt-1">
          Industry average: ~35%. VibeSwap DAOs show significantly higher engagement.
        </div>
      </div>
    </div>
  )
}

// ============ Main Component ============
export default function DAOToolsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeToolTab, setActiveToolTab] = useState('multisig')

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* ============ Hero ============ */}
      <PageHero
        title="DAO Tools"
        subtitle="Multi-sig management, treasury operations, and governance tooling for decentralized organizations"
        category="community"
      />

      {/* ============ Platform Stats ============ */}
      <Section index={0} title="Platform Overview" subtitle="VibeSwap DAO tooling ecosystem">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PLATFORM_STATS.map((stat) => (
            <div key={stat.label} className="text-center p-2 rounded-lg bg-black-900/40">
              <div
                className={`font-mono font-bold text-lg ${stat.accent ? 'text-cyan-400' : 'text-white'}`}
                style={stat.accent ? { textShadow: `0 0 20px ${CYAN}40` } : {}}
              >
                {stat.value}
              </div>
              <div className="text-black-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ============ Tool Category Tabs ============ */}
      <Section index={1} title="DAO Toolbox" subtitle="Select a tool category to manage your organization">
        {/* Tab Selector */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {TOOL_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveToolTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold transition-all border ${
                activeToolTab === tab.key
                  ? 'text-cyan-400 border-cyan-800/50 bg-cyan-900/20'
                  : 'text-black-500 border-black-700/30 hover:text-black-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Active Tool Panel */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeToolTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            {activeToolTab === 'multisig' && <MultiSigPanel isConnected={isConnected} />}
            {activeToolTab === 'treasury' && <TreasuryPanel />}
            {activeToolTab === 'payroll' && <PayrollPanel />}
            {activeToolTab === 'voting' && <VotingPanel isConnected={isConnected} />}
            {activeToolTab === 'tokengating' && <TokenGatingPanel />}
            {activeToolTab === 'analytics' && <AnalyticsPanel />}
          </motion.div>
        </AnimatePresence>
      </Section>

      {/* ============ Quick Actions ============ */}
      <Section index={2} title="Quick Actions" subtitle="Common DAO operations">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {QUICK_ACTIONS.map((action, i) => (
            <motion.button
              key={action.label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.06 / PHI, duration: 0.3 }}
              className="py-3 px-3 rounded-lg text-xs font-mono font-semibold border transition-all hover:scale-[1.02]"
              style={{
                color: action.color,
                borderColor: `${action.color}40`,
                background: `${action.color}08`,
              }}
              whileHover={{ y: -1, boxShadow: `0 4px 16px ${action.color}20` }}
            >
              {action.label}
            </motion.button>
          ))}
        </div>
        {!isConnected && (
          <div className="text-[10px] font-mono text-black-600 text-center mt-3">
            Connect wallet to perform actions
          </div>
        )}
      </Section>

      {/* ============ Activity Timeline ============ */}
      <Section index={3} title="Activity Timeline" subtitle="Recent DAO actions across all tools">
        <div className="space-y-2">
          {ACTIVITY_TIMELINE.map((event, i) => {
            const dotColor = ACTIVITY_COLORS[event.type] || CYAN
            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 / PHI, duration: 0.3 }}
                className="flex items-start gap-3"
              >
                {/* Timeline dot and line */}
                <div className="flex flex-col items-center shrink-0">
                  <motion.div
                    className="w-2.5 h-2.5 rounded-full mt-1"
                    style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}40` }}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: i * 0.08, duration: 0.3 }}
                  />
                  {i < ACTIVITY_TIMELINE.length - 1 && (
                    <div className="w-px flex-1 min-h-[24px] bg-black-800/50 mt-1" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-3 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono text-white">{event.action}</div>
                      <div className="text-[10px] font-mono text-black-500">{event.actor}</div>
                    </div>
                    <span className="text-[10px] font-mono text-black-600 shrink-0">{event.time}</span>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </Section>

      {/* ============ Wallet CTA ============ */}
      {!isConnected && (
        <motion.div
          className="text-center mt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <div className="text-black-500 text-xs font-mono py-4 border-t border-black-800/50">
            Connect wallet to manage your DAO, sign multi-sig transactions, and participate in governance
          </div>
        </motion.div>
      )}
    </div>
  )
}

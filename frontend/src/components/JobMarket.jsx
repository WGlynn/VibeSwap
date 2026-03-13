import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Job Market / Bounty Board ============
// Intent-driven bounties: describe WHAT you need, the network finds WHO can do it.
// Backed by VibeBountyBoard.sol + IdeaMarketplace.sol on-chain.

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Skill Categories ============

const SKILL_CATEGORIES = [
  { key: 'Solidity',   icon: 'S', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  { key: 'React',      icon: 'R', color: 'text-cyan-400',   bg: 'bg-cyan-500/10' },
  { key: 'Python',     icon: 'P', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  { key: 'Design',     icon: 'D', color: 'text-pink-400',   bg: 'bg-pink-500/10' },
  { key: 'Marketing',  icon: 'M', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  { key: 'Community',  icon: 'C', color: 'text-green-400',  bg: 'bg-green-500/10' },
]

const BOUNTY_TYPES = {
  SECURITY: { label: 'Security', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-700/50', icon: 'S', multiplier: '2x' },
  FEATURE: { label: 'Feature', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-700/50', icon: 'F', multiplier: '1x' },
  DOCS: { label: 'Docs', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-700/50', icon: 'D', multiplier: '1x' },
  COMMUNITY: { label: 'Community', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-700/50', icon: 'C', multiplier: '1x' },
  IDEA: { label: 'Idea', color: 'text-matrix-400', bg: 'bg-matrix-500/10', border: 'border-matrix-700/50', icon: 'I', multiplier: 'Shapley' },
}

const STATUSES = {
  OPEN: { label: 'Open', color: 'text-matrix-400', bg: 'bg-matrix-500/15' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-blue-400', bg: 'bg-blue-500/15' },
  SUBMITTED: { label: 'Review', color: 'text-amber-400', bg: 'bg-amber-500/15' },
  COMPLETED: { label: 'Completed', color: 'text-green-400', bg: 'bg-green-500/15' },
  DISPUTED: { label: 'Disputed', color: 'text-red-400', bg: 'bg-red-500/15' },
}

// ============ Mock Data ============

const MOCK_BOUNTIES = [
  {
    id: 1, title: 'Audit CommitRevealAuction for reentrancy vectors',
    type: 'SECURITY', status: 'OPEN', reward: 2.5, deadline: '2026-03-20',
    creator: '0x7a3f...8b2e',
    description: 'Full security audit of the commit-reveal batch auction mechanism. Focus on reentrancy, front-running, and oracle manipulation.',
    requirements: ['3+ years Solidity auditing', 'Familiarity with commit-reveal schemes', 'Prior DeFi audit portfolio'],
    deliverables: ['Detailed vulnerability report', 'Proof-of-concept exploits', 'Remediation suggestions with code patches'],
    skills: ['Solidity', 'Security', 'DeFi'], applicants: 3,
    intent: 'I need someone to find vulnerabilities in our auction contract before mainnet launch',
  },
  {
    id: 2, title: 'Build Kalman filter oracle dashboard',
    type: 'FEATURE', status: 'OPEN', reward: 1.0, deadline: '2026-03-25',
    creator: '0x3b1c...f9d1',
    description: 'React dashboard showing real-time Kalman filter price predictions vs actual prices. Charts, confidence intervals, deviation alerts.',
    requirements: ['React + charting libraries', 'Understanding of Kalman filters', 'WebSocket integration experience'],
    deliverables: ['Live price dashboard component', 'Confidence interval visualization', 'Alert system for deviation thresholds'],
    skills: ['React', 'Python', 'Data Viz'], applicants: 1,
    intent: 'I want to visualize how our oracle performs against real market data',
  },
  {
    id: 3, title: 'Write VibeSwap mechanism design explainer',
    type: 'DOCS', status: 'IN_PROGRESS', reward: 0.5, deadline: '2026-03-18',
    creator: '0x9e4d...2a7f',
    description: 'Non-technical explainer of commit-reveal batch auctions, Shapley distribution, and cooperative capitalism. Target audience: DeFi newcomers.',
    requirements: ['Strong technical writing skills', 'DeFi knowledge', 'Ability to simplify complex concepts'],
    deliverables: ['5,000-word explainer article', 'Diagrams for each mechanism', 'Glossary of terms'],
    skills: ['Technical Writing', 'DeFi', 'Marketing'], applicants: 2, hunter: '0x5c8a...1d3e',
    intent: 'Explain our DEX to people who have never used DeFi',
  },
  {
    id: 4, title: 'Design Nyx personality system prompts',
    type: 'COMMUNITY', status: 'OPEN', reward: 0.3, deadline: '2026-04-01',
    creator: '0x1f2e...6c8d',
    description: 'Create the personality framework for Nyx — creative AI agent in the Pantheon. Define voice, values, creative style, interaction patterns.',
    requirements: ['AI prompt engineering experience', 'Creative writing background', 'Understanding of brand voice design'],
    deliverables: ['System prompt document', 'Personality trait matrix', '10 sample interactions'],
    skills: ['Design', 'Community', 'AI'], applicants: 0,
    intent: 'We need someone to design the soul of our creative AI agent',
  },
  {
    id: 5, title: 'Idea: Cross-chain reputation aggregator',
    type: 'IDEA', status: 'OPEN', reward: 0.8, deadline: '2026-04-15',
    creator: '0x4d7a...9b2c',
    description: 'Aggregate reputation scores across chains (Base, Arbitrum, Optimism) into a single portable identity. Use SoulboundIdentity as the anchor.',
    requirements: ['Cross-chain messaging experience', 'Identity protocol knowledge', 'Solidity + LayerZero'],
    deliverables: ['Architecture proposal', 'Prototype smart contracts', 'Integration spec for SoulboundIdentity'],
    skills: ['Solidity', 'Community'], applicants: 5,
    intent: 'Your reputation should follow you across every chain',
    ideaScore: 82, feasibility: 28, impact: 30, novelty: 24,
  },
  {
    id: 6, title: 'Fuzz test ShapleyDistributor edge cases',
    type: 'SECURITY', status: 'SUBMITTED', reward: 1.5, deadline: '2026-03-15',
    creator: '0x2e9f...7d4a',
    description: 'Write comprehensive fuzz tests for the Shapley distributor. Target: overflow conditions, zero-division, extreme contribution ratios.',
    requirements: ['Foundry fuzz testing', 'Understanding of Shapley values', 'Gas optimization awareness'],
    deliverables: ['Fuzz test suite (50+ invariants)', 'Bug report for any findings', 'Gas profile analysis'],
    skills: ['Solidity', 'Security'], applicants: 1, hunter: '0x8b3c...4e2f',
    intent: 'Find the breaking points of our reward distribution',
  },
  {
    id: 7, title: 'Integrate ElevenLabs voices for Pantheon agents',
    type: 'FEATURE', status: 'COMPLETED', reward: 0.7, deadline: '2026-03-10',
    creator: '0x6a1b...3c5d',
    description: 'Each Pantheon agent (Jarvis, Nyx, Oracle, Sentinel) gets a unique ElevenLabs voice. Implement voice selection, caching, and fallback to browser TTS.',
    requirements: ['ElevenLabs API experience', 'Audio playback in React', 'Caching strategies'],
    deliverables: ['Voice integration module', 'Agent voice selector UI', 'Offline fallback system'],
    skills: ['React', 'Design'], applicants: 2, hunter: '0x1d4e...8f9a',
    intent: 'Give each AI agent a distinct voice personality',
  },
  {
    id: 8, title: 'Idea: Conviction-weighted bounty voting',
    type: 'IDEA', status: 'OPEN', reward: 0.4, deadline: '2026-04-10',
    creator: '0xab3e...7f21',
    description: 'Instead of first-come-first-serve bounty claiming, use conviction voting to select the best hunter. Longer you signal intent, stronger your claim.',
    requirements: ['Conviction voting mechanism knowledge', 'Solidity implementation skills', 'Game theory understanding'],
    deliverables: ['Mechanism design document', 'Solidity prototype', 'Simulation results'],
    skills: ['Solidity', 'Community', 'Marketing'], applicants: 2,
    intent: 'The best bounty hunter should win, not the fastest clicker',
    ideaScore: 71, feasibility: 22, impact: 26, novelty: 23,
  },
]

// Mock contributor profile
const MOCK_PROFILE = {
  address: '0x5c8a...1d3e',
  completedBounties: 7,
  totalEarned: 4.8,
  reputation: 89,
  skills: ['Solidity', 'React', 'Python'],
  badges: [
    { name: 'First Blood', desc: 'Completed first bounty', icon: '1' },
    { name: 'Auditor', desc: '3 security bounties', icon: 'A' },
    { name: 'Streak', desc: '5 bounties in a row', icon: 'S' },
  ],
  history: [
    { id: 101, title: 'Gas optimization for BatchMath', reward: 0.8, date: '2026-02-28', type: 'SECURITY' },
    { id: 102, title: 'React hook for TWAP display', reward: 0.5, date: '2026-02-20', type: 'FEATURE' },
    { id: 103, title: 'Cross-chain message decoder', reward: 1.2, date: '2026-02-10', type: 'FEATURE' },
    { id: 104, title: 'Write Shapley explainer thread', reward: 0.3, date: '2026-01-30', type: 'DOCS' },
    { id: 105, title: 'Fuzz CircuitBreaker thresholds', reward: 1.0, date: '2026-01-15', type: 'SECURITY' },
    { id: 106, title: 'Design token icon set', reward: 0.4, date: '2026-01-05', type: 'DOCS' },
    { id: 107, title: 'Community AMA moderation', reward: 0.6, date: '2025-12-20', type: 'COMMUNITY' },
  ],
}

// Mock leaderboard
const MOCK_LEADERBOARD = [
  { rank: 1, address: '0x8b3c...4e2f', completed: 14, earned: 12.3, reputation: 97, topSkill: 'Solidity' },
  { rank: 2, address: '0x5c8a...1d3e', completed: 7, earned: 4.8, reputation: 89, topSkill: 'React' },
  { rank: 3, address: '0x1d4e...8f9a', completed: 6, earned: 3.9, reputation: 85, topSkill: 'Design' },
  { rank: 4, address: '0x9e4d...2a7f', completed: 5, earned: 3.2, reputation: 78, topSkill: 'Python' },
  { rank: 5, address: '0xab3e...7f21', completed: 4, earned: 2.1, reputation: 72, topSkill: 'Marketing' },
]

// ============ Skill Count Helper ============

function getSkillCounts(bounties) {
  const counts = {}
  SKILL_CATEGORIES.forEach(s => { counts[s.key] = 0 })
  bounties.forEach(b => {
    b.skills.forEach(skill => {
      SKILL_CATEGORIES.forEach(cat => {
        if (skill.toLowerCase().includes(cat.key.toLowerCase())) counts[cat.key]++
      })
    })
  })
  return counts
}

// ============ Bounty Card ============

function BountyCard({ bounty, onSelect, isSelected }) {
  const type = BOUNTY_TYPES[bounty.type]
  const status = STATUSES[bounty.status]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onClick={() => onSelect(bounty)}
      className={`rounded-lg border p-4 cursor-pointer transition-all hover:border-matrix-700 ${
        isSelected ? 'border-matrix-600 bg-matrix-900/10 ring-1 ring-matrix-500/20' : 'border-black-700 bg-black/60'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold font-mono ${type.bg} ${type.color} border ${type.border}`}>
            {type.icon}
          </span>
          <h3 className="text-white font-mono text-sm font-semibold truncate">{bounty.title}</h3>
        </div>
        <span className={`shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
          {status.label}
        </span>
      </div>

      {/* Intent */}
      <p className="text-black-400 text-xs font-mono leading-relaxed mb-3 italic">
        "{bounty.intent}"
      </p>

      {/* Skills */}
      <div className="flex flex-wrap gap-1 mb-3">
        {bounty.skills.map(skill => (
          <span key={skill} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black-800 text-black-300 border border-black-700">
            {skill}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-matrix-400 font-mono text-sm font-bold">{bounty.reward} ETH</span>
          {type.multiplier !== '1x' && (
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${type.bg} ${type.color}`}>
              {type.multiplier}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-black-500">
          <span>{bounty.applicants} hunter{bounty.applicants !== 1 ? 's' : ''}</span>
          <span>{bounty.deadline}</span>
        </div>
      </div>

      {/* Idea scores */}
      {bounty.ideaScore && (
        <div className="mt-2 pt-2 border-t border-black-700/50 flex items-center gap-3">
          <span className="text-matrix-500 font-mono text-xs font-bold">{bounty.ideaScore}/100</span>
          <div className="flex gap-2 text-[9px] font-mono text-black-500">
            <span>F:{bounty.feasibility}</span>
            <span>I:{bounty.impact}</span>
            <span>N:{bounty.novelty}</span>
          </div>
        </div>
      )}
    </motion.div>
  )
}

// ============ Bounty Detail Modal ============

function BountyDetailModal({ bounty, onClose, onApply }) {
  if (!bounty) return null
  const type = BOUNTY_TYPES[bounty.type]
  const status = STATUSES[bounty.status]
  const timeLeft = useMemo(() => {
    const diff = new Date(bounty.deadline) - new Date()
    const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
    return `${days}d remaining`
  }, [bounty.deadline])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 1 / (PHI * PHI) }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto allow-scroll bg-black border border-black-600 rounded-lg"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-black-800 border-b border-black-700 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold font-mono ${type.bg} ${type.color} border ${type.border}`}>
              {type.icon}
            </span>
            <div>
              <span className={`text-[10px] font-mono ${type.color}`}>{type.label}</span>
              <span className={`ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${status.bg} ${status.color}`}>
                {status.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-black-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          <h2 className="text-white font-mono text-lg font-bold leading-snug">{bounty.title}</h2>

          {/* Intent */}
          <div className="bg-matrix-900/10 border border-matrix-800/30 rounded-lg px-4 py-3">
            <span className="text-matrix-600 text-[10px] font-mono block mb-1">INTENT</span>
            <p className="text-matrix-400 text-sm font-mono italic">"{bounty.intent}"</p>
          </div>

          {/* Description */}
          <div>
            <span className="text-black-500 text-[10px] font-mono block mb-1.5">DESCRIPTION</span>
            <p className="text-black-300 text-xs font-mono leading-relaxed">{bounty.description}</p>
          </div>

          {/* Requirements */}
          {bounty.requirements && (
            <div>
              <span className="text-black-500 text-[10px] font-mono block mb-1.5">REQUIREMENTS</span>
              <ul className="space-y-1">
                {bounty.requirements.map((req, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs font-mono text-black-300">
                    <span style={{ color: CYAN }} className="mt-0.5 shrink-0">*</span>
                    {req}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Deliverables */}
          {bounty.deliverables && (
            <div>
              <span className="text-black-500 text-[10px] font-mono block mb-1.5">DELIVERABLES</span>
              <ul className="space-y-1">
                {bounty.deliverables.map((del, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs font-mono text-black-300">
                    <span className="text-matrix-500 mt-0.5 shrink-0">{i + 1}.</span>
                    {del}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-black-800/50 rounded px-3 py-2">
              <span className="text-black-500 text-[10px] font-mono block">REWARD</span>
              <span className="text-matrix-400 font-mono text-lg font-bold">{bounty.reward} ETH</span>
              {type.multiplier !== '1x' && <span className={`ml-1 text-[10px] font-mono ${type.color}`}>{type.multiplier}</span>}
            </div>
            <div className="bg-black-800/50 rounded px-3 py-2">
              <span className="text-black-500 text-[10px] font-mono block">DEADLINE</span>
              <span className="text-white font-mono text-sm">{bounty.deadline}</span>
              <span className="block text-[10px] font-mono text-black-500">{timeLeft}</span>
            </div>
            <div className="bg-black-800/50 rounded px-3 py-2">
              <span className="text-black-500 text-[10px] font-mono block">CREATOR</span>
              <span className="text-terminal-400 font-mono text-sm">{bounty.creator}</span>
            </div>
            <div className="bg-black-800/50 rounded px-3 py-2">
              <span className="text-black-500 text-[10px] font-mono block">HUNTERS</span>
              <span className="text-white font-mono text-sm">{bounty.applicants} applied</span>
            </div>
          </div>

          {/* Skills */}
          <div>
            <span className="text-black-500 text-[10px] font-mono block mb-1.5">REQUIRED SKILLS</span>
            <div className="flex flex-wrap gap-1.5">
              {bounty.skills.map(skill => (
                <span key={skill} className="text-[11px] font-mono px-2 py-1 rounded bg-black-800 text-black-200 border border-black-600">
                  {skill}
                </span>
              ))}
            </div>
          </div>

          {/* Idea scores */}
          {bounty.ideaScore && (
            <div>
              <span className="text-black-500 text-[10px] font-mono block mb-1.5">IDEA SCORE</span>
              <div className="flex items-center gap-4">
                <div className="relative w-14 h-14">
                  <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="14" fill="none" stroke="#00ff41" strokeWidth="3"
                      strokeDasharray={`${bounty.ideaScore * 0.88} 100`} strokeLinecap="round" />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-mono font-bold text-matrix-400">
                    {bounty.ideaScore}
                  </span>
                </div>
                <div className="space-y-1 text-xs font-mono">
                  <div className="flex justify-between gap-4"><span className="text-black-500">Feasibility</span><span className="text-blue-400">{bounty.feasibility}/33</span></div>
                  <div className="flex justify-between gap-4"><span className="text-black-500">Impact</span><span className="text-amber-400">{bounty.impact}/33</span></div>
                  <div className="flex justify-between gap-4"><span className="text-black-500">Novelty</span><span className="text-purple-400">{bounty.novelty}/34</span></div>
                </div>
              </div>
            </div>
          )}

          {/* Reward breakdown */}
          <div>
            <span className="text-black-500 text-[10px] font-mono block mb-1.5">REWARD BREAKDOWN</span>
            <div className="space-y-1.5">
              {[
                { label: 'Hunter Payout', pct: 95, value: (bounty.reward * 0.95).toFixed(3) },
                { label: 'Platform Fee', pct: 2.5, value: (bounty.reward * 0.025).toFixed(4) },
                { label: 'Shapley Pool', pct: 2.5, value: (bounty.reward * 0.025).toFixed(4) },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between text-xs font-mono">
                  <span className="text-black-400">{row.label} ({row.pct}%)</span>
                  <span className="text-white">{row.value} ETH</span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {bounty.status === 'OPEN' && (
              <>
                <button
                  onClick={() => onApply(bounty)}
                  className="flex-1 font-mono text-xs font-bold py-2.5 rounded transition-colors"
                  style={{ background: CYAN, color: '#000' }}
                >
                  APPLY WITH PROPOSAL
                </button>
                <button className="px-4 bg-black-800 hover:bg-black-700 text-black-300 font-mono text-xs py-2.5 rounded border border-black-600 transition-colors">
                  SIGNAL INTENT
                </button>
              </>
            )}
            {bounty.status === 'IN_PROGRESS' && bounty.hunter && (
              <button className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-bold py-2.5 rounded transition-colors">
                SUBMIT WORK
              </button>
            )}
            {bounty.status === 'SUBMITTED' && (
              <button className="flex-1 bg-amber-600 hover:bg-amber-500 text-black-900 font-mono text-xs font-bold py-2.5 rounded transition-colors">
                REVIEW SUBMISSION
              </button>
            )}
          </div>

          {/* On-chain info */}
          <div className="text-[10px] font-mono text-black-600 pt-1 border-t border-black-800">
            Contract: VibeBountyBoard | 2.5% platform fee | Escrow-backed | Shapley-distributed
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ============ Application Flow Modal ============

function ApplicationModal({ bounty, isOpen, onClose }) {
  const [approach, setApproach] = useState('')
  const [estimatedDays, setEstimatedDays] = useState('')
  const [portfolioLinks, setPortfolioLinks] = useState('')
  const [submitted, setSubmitted] = useState(false)

  if (!isOpen || !bounty) return null

  const handleSubmit = () => {
    setSubmitted(true)
    setTimeout(() => { setSubmitted(false); onClose() }, PHI * 1000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 1 / (PHI * PHI) }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg mx-4 bg-black border border-black-600 rounded-lg overflow-hidden"
      >
        <div className="px-4 py-3 bg-black-800 border-b border-black-700 flex items-center justify-between">
          <div>
            <h2 className="font-mono text-sm font-bold" style={{ color: CYAN }}>SUBMIT PROPOSAL</h2>
            <p className="text-black-500 font-mono text-[10px] mt-0.5 truncate max-w-xs">{bounty.title}</p>
          </div>
          <button onClick={onClose} className="text-black-500 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {submitted ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8">
              <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}40` }}>
                <svg className="w-6 h-6" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-white font-mono text-sm font-bold">Proposal Submitted</p>
              <p className="text-black-500 font-mono text-[10px] mt-1">The bounty creator will review your application.</p>
            </motion.div>
          ) : (
            <>
              {/* Approach */}
              <div>
                <label className="text-black-400 font-mono text-[10px] block mb-1">YOUR APPROACH</label>
                <textarea
                  value={approach}
                  onChange={e => setApproach(e.target.value)}
                  placeholder="Describe how you would tackle this bounty..."
                  className="w-full bg-black-900 border border-black-700 rounded px-3 py-2 text-white font-mono text-sm outline-none focus:border-cyan-600 resize-none placeholder-black-600"
                  rows={4}
                />
              </div>

              {/* Estimated time */}
              <div>
                <label className="text-black-400 font-mono text-[10px] block mb-1">ESTIMATED TIME (days)</label>
                <input
                  type="number"
                  min="1"
                  value={estimatedDays}
                  onChange={e => setEstimatedDays(e.target.value)}
                  placeholder="7"
                  className="w-full bg-black-900 border border-black-700 rounded px-3 py-2 text-white font-mono text-sm outline-none focus:border-cyan-600 placeholder-black-600"
                />
              </div>

              {/* Portfolio */}
              <div>
                <label className="text-black-400 font-mono text-[10px] block mb-1">PORTFOLIO / RELEVANT LINKS</label>
                <textarea
                  value={portfolioLinks}
                  onChange={e => setPortfolioLinks(e.target.value)}
                  placeholder="GitHub, previous work, audit reports... (one per line)"
                  className="w-full bg-black-900 border border-black-700 rounded px-3 py-2 text-white font-mono text-sm outline-none focus:border-cyan-600 resize-none placeholder-black-600"
                  rows={3}
                />
              </div>

              {/* Reward preview */}
              <div className="bg-black-800/50 rounded px-3 py-2 flex items-center justify-between">
                <span className="text-black-500 font-mono text-[10px]">YOUR PAYOUT (95%)</span>
                <span className="text-matrix-400 font-mono text-sm font-bold">{(bounty.reward * 0.95).toFixed(3)} ETH</span>
              </div>

              {/* Submit */}
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={!approach.trim()}
                  className="flex-1 font-mono text-xs font-bold py-2.5 rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: approach.trim() ? CYAN : undefined, color: approach.trim() ? '#000' : undefined }}
                >
                  SUBMIT PROPOSAL
                </button>
                <button onClick={onClose} className="px-4 bg-black-800 hover:bg-black-700 text-black-400 font-mono text-xs py-2.5 rounded border border-black-700 transition-colors">
                  CANCEL
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ============ Create Bounty Modal ============

function CreateBountyModal({ isOpen, onClose }) {
  const [intent, setIntent] = useState('')
  const [type, setType] = useState('FEATURE')
  const [reward, setReward] = useState('')

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg mx-4 bg-black border border-black-600 rounded-lg overflow-hidden"
      >
        <div className="px-4 py-3 bg-black-800 border-b border-black-700">
          <h2 className="text-matrix-400 font-mono text-sm font-bold">POST A BOUNTY</h2>
          <p className="text-black-500 font-mono text-[10px] mt-0.5">Describe what you need. The network finds who can do it.</p>
        </div>

        <div className="p-4 space-y-4">
          {/* Intent */}
          <div>
            <label className="text-black-400 font-mono text-[10px] block mb-1">WHAT DO YOU NEED? (Intent)</label>
            <textarea
              value={intent}
              onChange={e => setIntent(e.target.value)}
              placeholder="Describe your bounty in plain language... e.g., 'I need someone to find security holes in our DEX before launch'"
              className="w-full bg-black-900 border border-black-700 rounded px-3 py-2 text-white font-mono text-sm outline-none focus:border-matrix-600 resize-none placeholder-black-600"
              rows={3}
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-black-400 font-mono text-[10px] block mb-1.5">TYPE</label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(BOUNTY_TYPES).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setType(key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border font-mono text-[11px] transition-all ${
                    type === key
                      ? `${val.bg} ${val.color} ${val.border}`
                      : 'border-black-700 text-black-500 hover:border-black-600'
                  }`}
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold ${val.bg} ${val.color}`}>
                    {val.icon}
                  </span>
                  {val.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reward */}
          <div>
            <label className="text-black-400 font-mono text-[10px] block mb-1">REWARD (ETH)</label>
            <input
              type="number"
              step="0.01"
              value={reward}
              onChange={e => setReward(e.target.value)}
              placeholder="0.5"
              className="w-full bg-black-900 border border-black-700 rounded px-3 py-2 text-white font-mono text-sm outline-none focus:border-matrix-600 placeholder-black-600"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button className="flex-1 bg-matrix-600 hover:bg-matrix-500 text-black-900 font-mono text-xs font-bold py-2.5 rounded transition-colors">
              POST BOUNTY (escrow {reward || '0'} ETH)
            </button>
            <button onClick={onClose} className="px-4 bg-black-800 hover:bg-black-700 text-black-400 font-mono text-xs py-2.5 rounded border border-black-700 transition-colors">
              CANCEL
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ============ Category Filters ============

function CategoryFilters({ activeSkill, onSkillChange, bounties }) {
  const counts = useMemo(() => getSkillCounts(bounties), [bounties])

  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      <button
        onClick={() => onSkillChange(null)}
        className={`px-2.5 py-1 rounded font-mono text-[11px] transition-colors ${
          !activeSkill
            ? 'text-white border border-white/20' : 'text-black-500 border border-black-700 hover:border-black-600'
        }`}
        style={!activeSkill ? { background: `${CYAN}15`, borderColor: `${CYAN}40`, color: CYAN } : undefined}
      >
        All Skills
      </button>
      {SKILL_CATEGORIES.map(cat => (
        <button
          key={cat.key}
          onClick={() => onSkillChange(activeSkill === cat.key ? null : cat.key)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-mono text-[11px] transition-colors border ${
            activeSkill === cat.key
              ? `${cat.bg} ${cat.color} border-current`
              : 'border-black-700 text-black-500 hover:border-black-600'
          }`}
        >
          <span className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold ${cat.bg} ${cat.color}`}>
            {cat.icon}
          </span>
          {cat.key}
          <span className={`ml-0.5 text-[9px] px-1 py-px rounded-full ${
            activeSkill === cat.key ? 'bg-white/10' : 'bg-black-800'
          }`}>
            {counts[cat.key]}
          </span>
        </button>
      ))}
    </div>
  )
}

// ============ Contributor Profile Panel ============

function ContributorProfile({ profile, isOpen, onClose }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 1 / (PHI * PHI) }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto allow-scroll bg-black border border-black-600 rounded-lg"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-black-800 border-b border-black-700 flex items-center justify-between sticky top-0 z-10">
          <h2 className="font-mono text-sm font-bold" style={{ color: CYAN }}>CONTRIBUTOR PROFILE</h2>
          <button onClick={onClose} className="text-black-500 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Identity + reputation score */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl flex items-center justify-center font-mono text-lg font-bold" style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}30`, color: CYAN }}>
              {profile.reputation}
            </div>
            <div>
              <p className="text-white font-mono text-sm font-bold">{profile.address}</p>
              <p className="text-black-500 font-mono text-[10px] mt-0.5">Reputation Score: {profile.reputation}/100</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-black-800/50 rounded px-3 py-2 text-center">
              <span className="text-black-500 text-[10px] font-mono block">COMPLETED</span>
              <span className="text-matrix-400 font-mono text-lg font-bold">{profile.completedBounties}</span>
            </div>
            <div className="bg-black-800/50 rounded px-3 py-2 text-center">
              <span className="text-black-500 text-[10px] font-mono block">EARNED</span>
              <span className="text-white font-mono text-lg font-bold">{profile.totalEarned} ETH</span>
            </div>
            <div className="bg-black-800/50 rounded px-3 py-2 text-center">
              <span className="text-black-500 text-[10px] font-mono block">REPUTATION</span>
              <span className="font-mono text-lg font-bold" style={{ color: CYAN }}>{profile.reputation}</span>
            </div>
          </div>

          {/* Skill badges */}
          <div>
            <span className="text-black-500 text-[10px] font-mono block mb-1.5">SKILLS</span>
            <div className="flex flex-wrap gap-1.5">
              {profile.skills.map(skill => {
                const cat = SKILL_CATEGORIES.find(c => c.key === skill)
                return (
                  <span key={skill} className={`text-[11px] font-mono px-2 py-1 rounded border ${cat ? `${cat.bg} ${cat.color} border-current` : 'bg-black-800 text-black-300 border-black-600'}`}>
                    {skill}
                  </span>
                )
              })}
            </div>
          </div>

          {/* Achievement badges */}
          <div>
            <span className="text-black-500 text-[10px] font-mono block mb-1.5">BADGES</span>
            <div className="flex flex-wrap gap-2">
              {profile.badges.map(badge => (
                <div key={badge.name} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black-800/60 border border-black-700">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono" style={{ background: `${CYAN}20`, color: CYAN }}>
                    {badge.icon}
                  </span>
                  <div>
                    <span className="text-white font-mono text-[11px] font-bold block">{badge.name}</span>
                    <span className="text-black-500 font-mono text-[9px]">{badge.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Completed bounty history */}
          <div>
            <span className="text-black-500 text-[10px] font-mono block mb-1.5">BOUNTY HISTORY</span>
            <div className="space-y-1.5">
              {profile.history.map(h => {
                const t = BOUNTY_TYPES[h.type]
                return (
                  <div key={h.id} className="flex items-center justify-between px-3 py-2 rounded bg-black-800/40 border border-black-800">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold font-mono ${t?.bg || ''} ${t?.color || ''}`}>
                        {t?.icon || '?'}
                      </span>
                      <span className="text-black-300 font-mono text-[11px] truncate">{h.title}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-matrix-400 font-mono text-[11px] font-bold">{h.reward} ETH</span>
                      <span className="text-black-600 font-mono text-[9px]">{h.date}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ============ Leaderboard Panel ============

function Leaderboard({ data, isVisible }) {
  if (!isVisible) return null

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 1 / (PHI * PHI) }}
      className="overflow-hidden mb-4"
    >
      <GlassCard glowColor="terminal" className="p-0">
        <div className="px-4 py-3 border-b border-black-700 flex items-center justify-between">
          <h3 className="font-mono text-sm font-bold" style={{ color: CYAN }}>TOP CONTRIBUTORS</h3>
          <span className="text-black-500 font-mono text-[10px]">Ranked by reputation</span>
        </div>
        <div className="divide-y divide-black-800">
          {data.map(entry => (
            <div key={entry.rank} className="flex items-center gap-3 px-4 py-2.5 hover:bg-black-800/30 transition-colors">
              {/* Rank */}
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${
                entry.rank === 1 ? 'bg-amber-500/20 text-amber-400' :
                entry.rank === 2 ? 'bg-gray-400/20 text-gray-300' :
                entry.rank === 3 ? 'bg-orange-600/20 text-orange-400' :
                'bg-black-800 text-black-500'
              }`}>
                {entry.rank}
              </span>
              {/* Address */}
              <span className="text-white font-mono text-xs flex-1 truncate">{entry.address}</span>
              {/* Top skill */}
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black-800 text-black-400 border border-black-700">
                {entry.topSkill}
              </span>
              {/* Stats */}
              <span className="text-matrix-400 font-mono text-[11px] font-bold w-16 text-right">{entry.earned} ETH</span>
              <span className="font-mono text-[11px] font-bold w-10 text-right" style={{ color: CYAN }}>{entry.reputation}</span>
              <span className="text-black-500 font-mono text-[10px] w-8 text-right">{entry.completed}</span>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-black-800 flex justify-between text-[9px] font-mono text-black-600">
          <span>ETH earned | Rep score | Bounties completed</span>
          <span>Updated every batch</span>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Stats Bar ============

function StatsBar({ bounties }) {
  const open = bounties.filter(b => b.status === 'OPEN').length
  const totalReward = bounties.reduce((sum, b) => sum + b.reward, 0)
  const completed = bounties.filter(b => b.status === 'COMPLETED').length

  return (
    <div className="flex items-center gap-4 sm:gap-6 px-4 py-2 bg-black/60 border border-black-700 rounded-lg mb-4 overflow-x-auto">
      <div className="shrink-0">
        <span className="text-black-500 font-mono text-[10px] block">OPEN</span>
        <span className="text-matrix-400 font-mono text-lg font-bold">{open}</span>
      </div>
      <div className="w-px h-8 bg-black-700 shrink-0" />
      <div className="shrink-0">
        <span className="text-black-500 font-mono text-[10px] block">TOTAL VALUE</span>
        <span className="text-white font-mono text-lg font-bold">{totalReward.toFixed(1)} ETH</span>
      </div>
      <div className="w-px h-8 bg-black-700 shrink-0" />
      <div className="shrink-0">
        <span className="text-black-500 font-mono text-[10px] block">COMPLETED</span>
        <span className="text-green-400 font-mono text-lg font-bold">{completed}</span>
      </div>
      <div className="w-px h-8 bg-black-700 shrink-0" />
      <div className="shrink-0">
        <span className="text-black-500 font-mono text-[10px] block">FEE</span>
        <span className="text-black-400 font-mono text-lg font-bold">2.5%</span>
      </div>
    </div>
  )
}

// ============ Main Page ============

function JobMarket() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [bounties] = useState(MOCK_BOUNTIES)
  const [selectedBounty, setSelectedBounty] = useState(null)
  const [filter, setFilter] = useState('ALL')
  const [skillFilter, setSkillFilter] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [showApply, setShowApply] = useState(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [searchIntent, setSearchIntent] = useState('')

  const filtered = useMemo(() => {
    let list = bounties
    if (filter !== 'ALL') {
      if (filter === 'OPEN') list = list.filter(b => b.status === 'OPEN')
      else list = list.filter(b => b.type === filter)
    }
    if (skillFilter) {
      list = list.filter(b =>
        b.skills.some(s => s.toLowerCase().includes(skillFilter.toLowerCase()))
      )
    }
    if (searchIntent.trim()) {
      const q = searchIntent.toLowerCase()
      list = list.filter(b =>
        b.intent.toLowerCase().includes(q) ||
        b.title.toLowerCase().includes(q) ||
        b.skills.some(s => s.toLowerCase().includes(q))
      )
    }
    return list
  }, [bounties, filter, skillFilter, searchIntent])

  const handleSelect = useCallback((bounty) => {
    setSelectedBounty(prev => prev?.id === bounty.id ? null : bounty)
  }, [])

  const handleCardClick = useCallback((bounty) => {
    setShowDetail(bounty)
  }, [])

  return (
    <div className="flex flex-col h-full max-w-7xl mx-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-wider text-matrix-400 font-mono">BOUNTY BOARD</h1>
          <p className="text-black-500 text-xs font-mono mt-0.5">Intent-driven bounties | Escrow-backed | Shapley rewards</p>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <button
              onClick={() => setShowProfile(true)}
              className="font-mono text-xs px-3 py-2 rounded border transition-colors"
              style={{ borderColor: `${CYAN}40`, color: CYAN }}
            >
              MY PROFILE
            </button>
          )}
          <button
            onClick={() => setShowLeaderboard(prev => !prev)}
            className={`font-mono text-xs px-3 py-2 rounded border transition-colors ${
              showLeaderboard ? 'bg-amber-500/10 text-amber-400 border-amber-700' : 'text-black-400 border-black-700 hover:border-black-600'
            }`}
          >
            LEADERBOARD
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-matrix-600 hover:bg-matrix-500 text-black-900 font-mono text-xs font-bold px-4 py-2 rounded transition-colors"
          >
            + POST BOUNTY
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatsBar bounties={bounties} />

      {/* Leaderboard (collapsible) */}
      <AnimatePresence>
        <Leaderboard data={MOCK_LEADERBOARD} isVisible={showLeaderboard} />
      </AnimatePresence>

      {/* Intent search */}
      <div className="mb-4">
        <div className="flex items-center bg-black/60 border border-black-700 rounded-lg px-3 py-2 focus-within:border-matrix-700 transition-colors">
          <svg className="w-4 h-4 text-black-500 shrink-0 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={searchIntent}
            onChange={e => setSearchIntent(e.target.value)}
            placeholder="Search by intent... e.g., 'security audit' or 'React dashboard'"
            className="flex-1 bg-transparent text-white font-mono text-sm outline-none placeholder-black-600"
          />
        </div>
      </div>

      {/* Skill category filters */}
      <CategoryFilters activeSkill={skillFilter} onSkillChange={setSkillFilter} bounties={bounties} />

      {/* Type filters */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {['ALL', 'OPEN', 'SECURITY', 'FEATURE', 'DOCS', 'COMMUNITY', 'IDEA'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded font-mono text-[11px] transition-colors ${
              filter === f
                ? 'bg-matrix-600/20 text-matrix-400 border border-matrix-700'
                : 'text-black-500 border border-black-700 hover:border-black-600 hover:text-black-400'
            }`}
          >
            {f === 'ALL' ? 'All' : f === 'OPEN' ? 'Open' : BOUNTY_TYPES[f]?.label || f}
          </button>
        ))}
      </div>

      {/* Content: List + Detail */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
        {/* Bounty list */}
        <div className="flex-1 lg:flex-[3] overflow-y-auto allow-scroll space-y-2 pb-4">
          <AnimatePresence mode="popLayout">
            {filtered.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12"
              >
                <p className="text-black-500 font-mono text-sm">No bounties match your intent.</p>
                <button
                  onClick={() => { setFilter('ALL'); setSkillFilter(null); setSearchIntent('') }}
                  className="text-matrix-500 font-mono text-xs mt-2 hover:underline"
                >
                  Clear filters
                </button>
              </motion.div>
            ) : (
              filtered.map(bounty => (
                <div key={bounty.id} onDoubleClick={() => handleCardClick(bounty)}>
                  <BountyCard
                    bounty={bounty}
                    onSelect={handleSelect}
                    isSelected={selectedBounty?.id === bounty.id}
                  />
                </div>
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Detail panel (sidebar) */}
        <div className="lg:flex-[2]">
          <AnimatePresence mode="wait">
            {selectedBounty ? (
              <motion.div
                key={selectedBounty.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="border border-black-700 rounded-lg bg-black/80 backdrop-blur-sm overflow-hidden"
              >
                {/* Header */}
                <div className="px-4 py-3 bg-black-800 border-b border-black-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold font-mono ${BOUNTY_TYPES[selectedBounty.type].bg} ${BOUNTY_TYPES[selectedBounty.type].color} border ${BOUNTY_TYPES[selectedBounty.type].border}`}>
                      {BOUNTY_TYPES[selectedBounty.type].icon}
                    </span>
                    <div>
                      <span className={`text-[10px] font-mono ${BOUNTY_TYPES[selectedBounty.type].color}`}>{BOUNTY_TYPES[selectedBounty.type].label}</span>
                      <span className={`ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${STATUSES[selectedBounty.status].bg} ${STATUSES[selectedBounty.status].color}`}>
                        {STATUSES[selectedBounty.status].label}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowDetail(selectedBounty)}
                      className="text-black-500 hover:text-white transition-colors p-1"
                      title="Expand"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                      </svg>
                    </button>
                    <button onClick={() => setSelectedBounty(null)} className="text-black-500 hover:text-white transition-colors p-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                  <h2 className="text-white font-mono text-base font-bold leading-snug">{selectedBounty.title}</h2>

                  <div className="bg-matrix-900/10 border border-matrix-800/30 rounded-lg px-3 py-2">
                    <span className="text-matrix-600 text-[10px] font-mono block mb-1">INTENT</span>
                    <p className="text-matrix-400 text-sm font-mono italic">"{selectedBounty.intent}"</p>
                  </div>

                  <p className="text-black-300 text-xs font-mono leading-relaxed">{selectedBounty.description}</p>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-black-800/50 rounded px-3 py-2">
                      <span className="text-black-500 text-[10px] font-mono block">REWARD</span>
                      <span className="text-matrix-400 font-mono text-lg font-bold">{selectedBounty.reward} ETH</span>
                    </div>
                    <div className="bg-black-800/50 rounded px-3 py-2">
                      <span className="text-black-500 text-[10px] font-mono block">DEADLINE</span>
                      <span className="text-white font-mono text-sm">{selectedBounty.deadline}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {selectedBounty.skills.map(skill => (
                      <span key={skill} className="text-[11px] font-mono px-2 py-1 rounded bg-black-800 text-black-200 border border-black-600">
                        {skill}
                      </span>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => setShowDetail(selectedBounty)}
                      className="flex-1 font-mono text-xs font-bold py-2.5 rounded transition-colors"
                      style={{ background: CYAN, color: '#000' }}
                    >
                      VIEW FULL DETAILS
                    </button>
                    {selectedBounty.status === 'OPEN' && (
                      <button
                        onClick={() => setShowApply(selectedBounty)}
                        className="flex-1 bg-matrix-600 hover:bg-matrix-500 text-black-900 font-mono text-xs font-bold py-2.5 rounded transition-colors"
                      >
                        APPLY
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border border-black-700/50 border-dashed rounded-lg p-8 text-center"
              >
                <p className="text-black-600 font-mono text-xs">Select a bounty to view details</p>
                <p className="text-black-700 font-mono text-[10px] mt-1">or post a new one</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 px-1 shrink-0">
        <span className="text-black-600 font-mono text-[10px]">
          VibeBountyBoard.sol | IdeaMarketplace.sol | Escrow + Shapley
        </span>
        <span className="text-black-600 font-mono text-[10px]">
          {filtered.length} bounties shown
        </span>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showCreate && <CreateBountyModal isOpen={showCreate} onClose={() => setShowCreate(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showDetail && (
          <BountyDetailModal
            bounty={showDetail}
            onClose={() => setShowDetail(null)}
            onApply={(b) => { setShowDetail(null); setShowApply(b) }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showApply && <ApplicationModal bounty={showApply} isOpen={!!showApply} onClose={() => setShowApply(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showProfile && <ContributorProfile profile={MOCK_PROFILE} isOpen={showProfile} onClose={() => setShowProfile(false)} />}
      </AnimatePresence>
    </div>
  )
}

export default JobMarket

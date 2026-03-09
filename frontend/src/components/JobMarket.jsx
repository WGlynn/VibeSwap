import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============ Job Market / Bounty Board ============
// Intent-driven bounties: describe WHAT you need, the network finds WHO can do it.
// Backed by VibeBountyBoard.sol + IdeaMarketplace.sol on-chain.

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

// Simulated bounties — will be replaced by on-chain data
const MOCK_BOUNTIES = [
  {
    id: 1, title: 'Audit CommitRevealAuction for reentrancy vectors',
    type: 'SECURITY', status: 'OPEN', reward: 2.5, deadline: '2026-03-20',
    creator: '0x7a3f...8b2e', description: 'Full security audit of the commit-reveal batch auction mechanism. Focus on reentrancy, front-running, and oracle manipulation.',
    skills: ['Solidity', 'Security', 'DeFi'], applicants: 3, intent: 'I need someone to find vulnerabilities in our auction contract before mainnet launch',
  },
  {
    id: 2, title: 'Build Kalman filter oracle dashboard',
    type: 'FEATURE', status: 'OPEN', reward: 1.0, deadline: '2026-03-25',
    creator: '0x3b1c...f9d1', description: 'React dashboard showing real-time Kalman filter price predictions vs actual prices. Charts, confidence intervals, deviation alerts.',
    skills: ['React', 'Python', 'Data Viz'], applicants: 1, intent: 'I want to visualize how our oracle performs against real market data',
  },
  {
    id: 3, title: 'Write VibeSwap mechanism design explainer',
    type: 'DOCS', status: 'IN_PROGRESS', reward: 0.5, deadline: '2026-03-18',
    creator: '0x9e4d...2a7f', description: 'Non-technical explainer of commit-reveal batch auctions, Shapley distribution, and cooperative capitalism. Target audience: DeFi newcomers.',
    skills: ['Technical Writing', 'DeFi'], applicants: 2, hunter: '0x5c8a...1d3e', intent: 'Explain our DEX to people who have never used DeFi',
  },
  {
    id: 4, title: 'Design Nyx personality system prompts',
    type: 'COMMUNITY', status: 'OPEN', reward: 0.3, deadline: '2026-04-01',
    creator: '0x1f2e...6c8d', description: 'Create the personality framework for Nyx — creative AI agent in the Pantheon. Define voice, values, creative style, interaction patterns.',
    skills: ['AI', 'Creative Writing', 'UX'], applicants: 0, intent: 'We need someone to design the soul of our creative AI agent',
  },
  {
    id: 5, title: 'Idea: Cross-chain reputation aggregator',
    type: 'IDEA', status: 'OPEN', reward: 0.8, deadline: '2026-04-15',
    creator: '0x4d7a...9b2c', description: 'Aggregate reputation scores across chains (Base, Arbitrum, Optimism) into a single portable identity. Use SoulboundIdentity as the anchor.',
    skills: ['Smart Contracts', 'Cross-chain', 'Identity'], applicants: 5, intent: 'Your reputation should follow you across every chain',
    ideaScore: 82, feasibility: 28, impact: 30, novelty: 24,
  },
  {
    id: 6, title: 'Fuzz test ShapleyDistributor edge cases',
    type: 'SECURITY', status: 'SUBMITTED', reward: 1.5, deadline: '2026-03-15',
    creator: '0x2e9f...7d4a', description: 'Write comprehensive fuzz tests for the Shapley distributor. Target: overflow conditions, zero-division, extreme contribution ratios.',
    skills: ['Solidity', 'Foundry', 'Testing'], applicants: 1, hunter: '0x8b3c...4e2f', intent: 'Find the breaking points of our reward distribution',
  },
  {
    id: 7, title: 'Integrate ElevenLabs voices for Pantheon agents',
    type: 'FEATURE', status: 'COMPLETED', reward: 0.7, deadline: '2026-03-10',
    creator: '0x6a1b...3c5d', description: 'Each Pantheon agent (Jarvis, Nyx, Oracle, Sentinel) gets a unique ElevenLabs voice. Implement voice selection, caching, and fallback to browser TTS.',
    skills: ['JavaScript', 'API Integration', 'Audio'], applicants: 2, hunter: '0x1d4e...8f9a', intent: 'Give each AI agent a distinct voice personality',
  },
  {
    id: 8, title: 'Idea: Conviction-weighted bounty voting',
    type: 'IDEA', status: 'OPEN', reward: 0.4, deadline: '2026-04-10',
    creator: '0xab3e...7f21', description: 'Instead of first-come-first-serve bounty claiming, use conviction voting to select the best hunter. Longer you signal intent, stronger your claim.',
    skills: ['Mechanism Design', 'Governance'], applicants: 2, intent: 'The best bounty hunter should win, not the fastest clicker',
    ideaScore: 71, feasibility: 22, impact: 26, novelty: 23,
  },
]

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

      {/* Intent — the "what" in natural language */}
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

// ============ Bounty Detail Panel ============

function BountyDetail({ bounty, onClose }) {
  if (!bounty) return null
  const type = BOUNTY_TYPES[bounty.type]
  const status = STATUSES[bounty.status]

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="border border-black-700 rounded-lg bg-black/80 backdrop-blur-sm overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-black-800 border-b border-black-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold font-mono ${type.bg} ${type.color} border ${type.border}`}>
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
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        <h2 className="text-white font-mono text-base font-bold leading-snug">{bounty.title}</h2>

        {/* Intent */}
        <div className="bg-matrix-900/10 border border-matrix-800/30 rounded-lg px-3 py-2">
          <span className="text-matrix-600 text-[10px] font-mono block mb-1">INTENT</span>
          <p className="text-matrix-400 text-sm font-mono italic">"{bounty.intent}"</p>
        </div>

        {/* Description */}
        <p className="text-black-300 text-xs font-mono leading-relaxed">{bounty.description}</p>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-black-800/50 rounded px-3 py-2">
            <span className="text-black-500 text-[10px] font-mono block">REWARD</span>
            <span className="text-matrix-400 font-mono text-lg font-bold">{bounty.reward} ETH</span>
            {type.multiplier !== '1x' && <span className={`ml-1 text-[10px] font-mono ${type.color}`}>{type.multiplier}</span>}
          </div>
          <div className="bg-black-800/50 rounded px-3 py-2">
            <span className="text-black-500 text-[10px] font-mono block">DEADLINE</span>
            <span className="text-white font-mono text-sm">{bounty.deadline}</span>
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

        {/* Idea scores if applicable */}
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

        {/* Action buttons */}
        <div className="flex gap-2 pt-2">
          {bounty.status === 'OPEN' && (
            <>
              <button className="flex-1 bg-matrix-600 hover:bg-matrix-500 text-black-900 font-mono text-xs font-bold py-2.5 rounded transition-colors">
                CLAIM BOUNTY
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
          Contract: VibeBountyBoard | 2.5% platform fee | Escrow-backed
        </div>
      </div>
    </motion.div>
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
          {/* Intent — the key innovation */}
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
  const [bounties] = useState(MOCK_BOUNTIES)
  const [selectedBounty, setSelectedBounty] = useState(null)
  const [filter, setFilter] = useState('ALL')
  const [showCreate, setShowCreate] = useState(false)
  const [searchIntent, setSearchIntent] = useState('')

  const filtered = useMemo(() => {
    let list = bounties
    if (filter !== 'ALL') {
      if (filter === 'OPEN') list = list.filter(b => b.status === 'OPEN')
      else list = list.filter(b => b.type === filter)
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
  }, [bounties, filter, searchIntent])

  const handleSelect = useCallback((bounty) => {
    setSelectedBounty(prev => prev?.id === bounty.id ? null : bounty)
  }, [])

  return (
    <div className="flex flex-col h-full max-w-7xl mx-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-wider text-matrix-400 font-mono">BOUNTY BOARD</h1>
          <p className="text-black-500 text-xs font-mono mt-0.5">Intent-driven bounties | Escrow-backed | Shapley rewards</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-matrix-600 hover:bg-matrix-500 text-black-900 font-mono text-xs font-bold px-4 py-2 rounded transition-colors"
        >
          + POST BOUNTY
        </button>
      </div>

      {/* Stats */}
      <StatsBar bounties={bounties} />

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

      {/* Filters */}
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
                  onClick={() => { setFilter('ALL'); setSearchIntent('') }}
                  className="text-matrix-500 font-mono text-xs mt-2 hover:underline"
                >
                  Clear filters
                </button>
              </motion.div>
            ) : (
              filtered.map(bounty => (
                <BountyCard
                  key={bounty.id}
                  bounty={bounty}
                  onSelect={handleSelect}
                  isSelected={selectedBounty?.id === bounty.id}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Detail panel */}
        <div className="lg:flex-[2]">
          <AnimatePresence mode="wait">
            {selectedBounty ? (
              <BountyDetail
                key={selectedBounty.id}
                bounty={selectedBounty}
                onClose={() => setSelectedBounty(null)}
              />
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

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && <CreateBountyModal isOpen={showCreate} onClose={() => setShowCreate(false)} />}
      </AnimatePresence>
    </div>
  )
}

export default JobMarket

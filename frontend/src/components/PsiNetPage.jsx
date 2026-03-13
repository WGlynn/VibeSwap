import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import PageHero from './ui/PageHero'
import GlassCard from './ui/GlassCard'
import { MARKETPLACE_PRIMITIVES, CATEGORIES, getPrimitivesByCategory, getTotalRewardPool, getUnclaimedPrimitives } from '../data/marketplace-primitives'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

const sectionVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.2 + i * (0.1 * PHI), ease },
  }),
}

// ============ DID Registry Data (Static for now — will be wired to live API) ============

const DID_TYPES = [
  { type: 'project', color: '#06b6d4', icon: '{}', count: 0, desc: 'Architecture, mechanisms, protocols' },
  { type: 'user', color: '#a855f7', icon: '@', count: 0, desc: 'Identity, preferences, expertise' },
  { type: 'feedback', color: '#f59e0b', icon: '!', count: 0, desc: 'Corrections, learning, calibration' },
  { type: 'reference', color: '#22c55e', icon: '#', count: 0, desc: 'External pointers, docs, APIs' },
]

const MECHANISM_LAYERS = [
  {
    name: 'Context Pricing',
    mechanism: 'Augmented Bonding Curve',
    formula: 'S^k / R = V₀',
    desc: 'Price emerges from access frequency. No oracle needed.',
    color: '#22c55e',
  },
  {
    name: 'Fair Attribution',
    mechanism: 'Shapley Value Distribution',
    formula: 'φᵢ(v) = Σ [v(S∪{i}) - v(S)]',
    desc: 'Your reward = your marginal contribution to every coalition.',
    color: '#06b6d4',
  },
  {
    name: 'Cooperation Incentive',
    mechanism: 'Intrinsically Incentivized Altruism',
    formula: 'sharing = selfish-optimal strategy',
    desc: 'Hoarding → zero Shapley. Sharing → maximum reward. By construction.',
    color: '#a855f7',
  },
  {
    name: 'Tier Curation',
    mechanism: 'Conviction Voting',
    formula: 'C(t) = Σ uptime × freq × stake × (1 - decay^Δt)',
    desc: 'Sustained use promotes DIDs. Flash-loading has zero conviction.',
    color: '#f59e0b',
  },
  {
    name: 'Context Trading',
    mechanism: 'Commit-Reveal Batch Auction',
    formula: 'zero MEV in knowledge exchange',
    desc: 'Same mechanism that protects token swaps protects context swaps.',
    color: '#ef4444',
  },
  {
    name: 'On-Chain State',
    mechanism: 'CKB Cell Model',
    formula: 'DID = cell, access = UTXO transition',
    desc: 'Reading state is a first-class economic action. Not free like EVM views.',
    color: '#3b82f6',
  },
]

const EXAMPLE_DIDS = [
  { did: 'did:jarvis:project:a462be2c', title: 'Shard Architecture', tier: 'HOT', access: 847, tags: ['shard', 'consensus'] },
  { did: 'did:jarvis:project:b60aa157', title: 'Commit-Reveal Auction', tier: 'HOT', access: 1203, tags: ['mev', 'auction'] },
  { did: 'did:jarvis:user:b0e2c5e7', title: 'Will — Mechanism Designer', tier: 'HOT', access: 2100, tags: ['identity', 'founder'] },
  { did: 'did:jarvis:project:9ea712ac', title: 'Shapley Reward System', tier: 'HOT', access: 956, tags: ['game-theory', 'rewards'] },
  { did: 'did:jarvis:feedback:70da543e', title: 'Task ID Persistence', tier: 'WARM', access: 312, tags: ['protocol', 'reliability'] },
  { did: 'did:jarvis:reference:82a92aa6', title: 'Solidity Patterns', tier: 'WARM', access: 578, tags: ['solidity', 'patterns'] },
  { did: 'did:jarvis:project:8fe8aee1', title: 'DID Context Economy', tier: 'HOT', access: 445, tags: ['did', 'economy'] },
  { did: 'did:jarvis:project:c3d91fa0', title: 'Bonding Curve Math', tier: 'HOT', access: 721, tags: ['abc', 'bonding'] },
]

// ============ Subcomponents ============

function DIDCard({ did, title, tier, access, tags }) {
  const tierColors = { HOT: '#ef4444', WARM: '#f59e0b', COLD: '#6b7280' }
  return (
    <GlassCard className="p-4" spotlight hover glowColor={tier === 'HOT' ? 'warning' : 'none'}>
      <div className="flex items-start justify-between mb-2">
        <code className="text-xs text-cyan-400 font-mono break-all">{did}</code>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded-full ml-2 shrink-0"
          style={{ color: tierColors[tier], border: `1px solid ${tierColors[tier]}33` }}
        >
          {tier}
        </span>
      </div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <div className="flex items-center justify-between">
        <div className="flex gap-1 flex-wrap">
          {tags.map(t => (
            <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 bg-black-800 rounded text-black-400">
              {t}
            </span>
          ))}
        </div>
        <span className="text-xs text-black-500 font-mono">{access} loads</span>
      </div>
    </GlassCard>
  )
}

function MechanismCard({ name, mechanism, formula, desc, color, index }) {
  return (
    <motion.div
      custom={index}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-50px' }}
      variants={sectionVariants}
    >
      <GlassCard className="p-5" spotlight hover>
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}66` }}
          />
          <h3 className="text-sm font-bold" style={{ color }}>{name}</h3>
        </div>
        <p className="text-xs text-black-400 mb-3">{mechanism}</p>
        <code className="block text-[11px] font-mono text-cyan-400/80 bg-black-900/50 rounded px-3 py-2 mb-3 break-all">
          {formula}
        </code>
        <p className="text-xs text-black-500 leading-relaxed">{desc}</p>
      </GlassCard>
    </motion.div>
  )
}

function ContextGraph() {
  // Simple animated graph visualization of DID relationships
  const nodes = useMemo(() => EXAMPLE_DIDS.map((d, i) => {
    const angle = (i / EXAMPLE_DIDS.length) * Math.PI * 2
    const r = 100 + (d.tier === 'HOT' ? 0 : 40)
    return {
      ...d,
      x: 160 + Math.cos(angle) * r,
      y: 140 + Math.sin(angle) * r,
    }
  }), [])

  // Generate edges (cross-references)
  const edges = [
    [0, 1], [0, 3], [1, 6], [2, 0], [2, 3], [3, 7], [4, 0], [5, 7], [6, 7],
  ]

  return (
    <svg viewBox="0 0 320 280" className="w-full h-auto opacity-80">
      {/* Edges */}
      {edges.map(([a, b], i) => (
        <motion.line
          key={i}
          x1={nodes[a].x} y1={nodes[a].y}
          x2={nodes[b].x} y2={nodes[b].y}
          stroke="rgba(6,182,212,0.15)"
          strokeWidth="1"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1, delay: 0.5 + i * 0.1 }}
        />
      ))}
      {/* Nodes */}
      {nodes.map((n, i) => (
        <motion.g key={i}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 + i * 0.08 }}
        >
          <circle
            cx={n.x} cy={n.y}
            r={n.tier === 'HOT' ? 6 : 4}
            fill={n.tier === 'HOT' ? '#06b6d4' : n.tier === 'WARM' ? '#f59e0b' : '#6b7280'}
            opacity={0.8}
          />
          <circle
            cx={n.x} cy={n.y}
            r={n.tier === 'HOT' ? 10 : 7}
            fill="none"
            stroke={n.tier === 'HOT' ? 'rgba(6,182,212,0.3)' : 'rgba(245,158,11,0.2)'}
            strokeWidth="1"
          />
          <text
            x={n.x} y={n.y + 18}
            textAnchor="middle"
            fill="rgba(255,255,255,0.5)"
            fontSize="7"
            fontFamily="monospace"
          >
            {n.title.length > 16 ? n.title.slice(0, 14) + '..' : n.title}
          </text>
        </motion.g>
      ))}
      {/* Center label */}
      <text x="160" y="140" textAnchor="middle" fill="rgba(6,182,212,0.6)" fontSize="9" fontFamily="monospace" fontWeight="bold">
        PsiNet
      </text>
    </svg>
  )
}

function FlowDiagram() {
  const steps = [
    { label: 'Memory File', color: '#6b7280' },
    { label: 'DID Registry', color: '#06b6d4' },
    { label: 'Shard Resolution', color: '#a855f7' },
    { label: 'Context Loading', color: '#22c55e' },
  ]

  return (
    <div className="flex items-center justify-center gap-1 py-4 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <motion.div
            className="px-3 py-1.5 rounded-lg text-[11px] font-mono whitespace-nowrap"
            style={{ border: `1px solid ${s.color}44`, color: s.color }}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.15 }}
          >
            {s.label}
          </motion.div>
          {i < steps.length - 1 && (
            <motion.span
              className="text-black-600 text-xs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 + i * 0.15 }}
            >
              →
            </motion.span>
          )}
        </div>
      ))}
    </div>
  )
}

// ============ Main Page ============

function PsiNetPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [registryStats, setRegistryStats] = useState({ total: 52, aliases: 52, refs: 22, size: '28KB' })

  // Simulate loading live registry data
  useEffect(() => {
    // TODO: Wire to live API at /api/did-registry
    const types = [...DID_TYPES]
    types[0].count = 31  // project
    types[1].count = 8   // user
    types[2].count = 7   // feedback
    types[3].count = 6   // reference
  }, [])

  const [marketCategory, setMarketCategory] = useState('all')
  const [marketTier, setMarketTier] = useState(0)

  const filteredPrimitives = useMemo(() => {
    let prims = MARKETPLACE_PRIMITIVES
    if (marketCategory !== 'all') prims = prims.filter(p => p.category === marketCategory)
    if (marketTier > 0) prims = prims.filter(p => p.tier === marketTier)
    return prims
  }, [marketCategory, marketTier])

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'marketplace', label: `Marketplace (${MARKETPLACE_PRIMITIVES.length})` },
    { id: 'registry', label: 'DID Registry' },
    { id: 'mechanisms', label: 'Mechanism Design' },
    { id: 'ckb', label: 'CKB Integration' },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 pb-24">
      <PageHero
        title="PsiNet"
        subtitle="Context marketplace where AI agents trade knowledge through DIDs. Sharing is the selfish-optimal strategy."
        category="intelligence"
        badge="Live Registry"
        badgeColor={CYAN}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all whitespace-nowrap ${
              activeTab === t.id
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                : 'text-black-400 hover:text-black-200 border border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total DIDs', value: registryStats.total, color: CYAN },
              { label: 'Cross-Refs', value: registryStats.refs, color: '#a855f7' },
              { label: 'Aliases', value: registryStats.aliases, color: '#22c55e' },
              { label: 'Registry Size', value: registryStats.size, color: '#f59e0b' },
            ].map((s, i) => (
              <motion.div
                key={i}
                custom={i}
                initial="hidden"
                animate="visible"
                variants={sectionVariants}
              >
                <GlassCard className="p-4 text-center">
                  <div className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[10px] text-black-500 font-mono mt-1">{s.label}</div>
                </GlassCard>
              </motion.div>
            ))}
          </div>

          {/* Triple duty */}
          <motion.div custom={1} initial="hidden" animate="visible" variants={sectionVariants}>
            <GlassCard className="p-6" spotlight>
              <h2 className="text-lg font-bold mb-4">DIDs Serve Triple Duty</h2>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { title: 'Pointer-Based Context', desc: 'Agents load DIDs instead of raw data. Context scales infinitely. Registry stays small.', icon: '→', color: CYAN },
                  { title: 'Economic Primitives', desc: 'Each DID is a tradeable asset with price discovery via bonding curves. Knowledge has a market price.', icon: '$', color: '#22c55e' },
                  { title: 'PsiNet Exchange Assets', desc: 'Context traded between agents via commit-reveal batch auction. Zero MEV in knowledge exchange.', icon: '⇋', color: '#a855f7' },
                ].map((item, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-mono" style={{ color: item.color }}>{item.icon}</span>
                      <h3 className="text-sm font-semibold">{item.title}</h3>
                    </div>
                    <p className="text-xs text-black-400 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* Flow diagram */}
          <motion.div custom={2} initial="hidden" animate="visible" variants={sectionVariants}>
            <GlassCard className="p-5">
              <h3 className="text-sm font-bold mb-2 text-center">Resolution Flow</h3>
              <FlowDiagram />
              <p className="text-[11px] text-black-500 text-center mt-2">
                resolve("did:jarvis:project:a462be2c") → metadata → agent decides whether to load full content
              </p>
            </GlassCard>
          </motion.div>

          {/* Context graph */}
          <motion.div custom={3} initial="hidden" animate="visible" variants={sectionVariants}>
            <GlassCard className="p-5">
              <h3 className="text-sm font-bold mb-2 text-center">Context Graph</h3>
              <ContextGraph />
              <p className="text-[11px] text-black-500 text-center mt-2">
                {registryStats.refs} cross-references form a knowledge graph. Loading one DID reveals related DIDs.
              </p>
            </GlassCard>
          </motion.div>

          {/* IIA callout */}
          <motion.div custom={4} initial="hidden" animate="visible" variants={sectionVariants}>
            <GlassCard className="p-5 border border-purple-500/20" glowColor="terminal">
              <h3 className="text-sm font-bold text-purple-400 mb-2">Intrinsically Incentivized Altruism</h3>
              <p className="text-xs text-black-400 leading-relaxed mb-3">
                Sharing a DID earns you Shapley credit on every future access. Hoarding means zero access events, zero tributes, zero rewards.
                The dominant strategy is cooperation — not because it's moral, but because the architecture makes selfishness and altruism identical strategies.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 rounded-lg bg-green-500/5 border border-green-500/10">
                  <div className="text-xs font-mono text-green-400 mb-1">Share DID-X</div>
                  <div className="text-[10px] text-black-500">→ Shapley credit on all future loads</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                  <div className="text-xs font-mono text-red-400 mb-1">Hoard DID-X</div>
                  <div className="text-[10px] text-black-500">→ zero access → zero reward</div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      )}

      {/* Marketplace Tab */}
      {activeTab === 'marketplace' && (
        <div className="space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Primitives', value: MARKETPLACE_PRIMITIVES.length, color: CYAN },
              { label: 'Unclaimed', value: getUnclaimedPrimitives().length, color: '#22c55e' },
              { label: 'Total Rewards', value: `${(getTotalRewardPool() / 1000).toFixed(1)}K JUL`, color: '#f59e0b' },
              { label: 'Categories', value: CATEGORIES.length, color: '#a855f7' },
            ].map((s, i) => (
              <motion.div key={s.label} custom={i} initial="hidden" animate="visible" variants={sectionVariants}>
                <GlassCard className="p-4 text-center">
                  <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-xs text-gray-400 mt-1">{s.label}</div>
                </GlassCard>
              </motion.div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setMarketCategory('all')}
              className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${marketCategory === 'all' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:border-white/20'}`}
            >All</button>
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                onClick={() => setMarketCategory(c.id)}
                className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${marketCategory === c.id ? `${c.bg} ${c.color} border ${c.border}` : 'bg-white/5 text-gray-400 border border-white/10 hover:border-white/20'}`}
              >{c.name}</button>
            ))}
          </div>
          <div className="flex gap-2">
            {[0, 1, 2, 3].map(t => (
              <button
                key={t}
                onClick={() => setMarketTier(t)}
                className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${marketTier === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:border-white/20'}`}
              >{t === 0 ? 'All Tiers' : `Tier ${t}`}</button>
            ))}
          </div>

          {/* Primitives grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredPrimitives.map((p, i) => {
              const cat = CATEGORIES.find(c => c.id === p.category)
              return (
                <motion.div
                  key={p.id}
                  custom={i % 6}
                  initial="hidden"
                  animate="visible"
                  variants={sectionVariants}
                >
                  <GlassCard className="p-4 h-full flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-mono px-2 py-0.5 rounded ${cat?.bg || 'bg-white/5'} ${cat?.color || 'text-gray-400'}`}>
                        {cat?.name || p.category}
                      </span>
                      <span className="text-xs text-gray-500">Tier {p.tier}</span>
                    </div>
                    <h3 className="text-sm font-bold text-white mb-1">{p.name}</h3>
                    <p className="text-xs text-gray-400 flex-1 mb-3">{p.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-amber-400">{p.reward} JUL</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${p.claimedBy ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-gray-500'}`}>
                        {p.claimedBy ? 'Claimed' : 'Open'}
                      </span>
                    </div>
                    {p.connections.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.connections.slice(0, 3).map(cid => (
                          <span key={cid} className="text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">{cid}</span>
                        ))}
                        {p.connections.length > 3 && <span className="text-[10px] text-gray-500">+{p.connections.length - 3}</span>}
                      </div>
                    )}
                  </GlassCard>
                </motion.div>
              )
            })}
          </div>

          {filteredPrimitives.length === 0 && (
            <div className="text-center text-gray-500 py-12">No primitives match your filters.</div>
          )}

          {/* CTA */}
          <motion.div custom={0} initial="hidden" animate="visible" variants={sectionVariants}>
            <GlassCard className="p-6 text-center" style={{ borderColor: 'rgba(6, 182, 212, 0.2)' }}>
              <h3 className="text-lg font-bold text-cyan-400 mb-2">Claim a Primitive</h3>
              <p className="text-sm text-gray-400 mb-4">
                Contribute documentation, code, or analysis for any unclaimed primitive.
                Earn JUL rewards and Shapley credit in the ContributionDAG.
              </p>
              <p className="text-xs text-gray-500">
                Join Telegram and use <span className="font-mono text-cyan-400">/idea</span> to submit your contribution.
              </p>
            </GlassCard>
          </motion.div>
        </div>
      )}

      {/* Registry Tab */}
      {activeTab === 'registry' && (
        <div className="space-y-6">
          {/* Type breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {DID_TYPES.map((t, i) => (
              <motion.div key={t.type} custom={i} initial="hidden" animate="visible" variants={sectionVariants}>
                <GlassCard className="p-4 text-center">
                  <div className="text-xl font-mono mb-1" style={{ color: t.color }}>{t.icon}</div>
                  <div className="text-sm font-bold capitalize">{t.type}</div>
                  <div className="text-[10px] text-black-500 mt-1">{t.desc}</div>
                </GlassCard>
              </motion.div>
            ))}
          </div>

          {/* DID format */}
          <motion.div custom={1} initial="hidden" animate="visible" variants={sectionVariants}>
            <GlassCard className="p-5">
              <h3 className="text-sm font-bold mb-3">DID Format</h3>
              <code className="block text-xs font-mono text-cyan-400/80 bg-black-900/50 rounded px-4 py-3">
                did:jarvis:&lt;type&gt;:&lt;sha256_8chars&gt;
              </code>
              <p className="text-[11px] text-black-500 mt-2">
                Stable, content-independent identifiers. SHA-256 of the filename stem, truncated to 8 hex chars.
                Same file always produces the same DID. Rename-proof. Move-proof.
              </p>
            </GlassCard>
          </motion.div>

          {/* Example DIDs */}
          <h3 className="text-sm font-bold">Live Registry</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {EXAMPLE_DIDS.map((d, i) => (
              <motion.div key={d.did} custom={i + 2} initial="hidden" animate="visible" variants={sectionVariants}>
                <DIDCard {...d} />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Mechanisms Tab */}
      {activeTab === 'mechanisms' && (
        <div className="space-y-4">
          <p className="text-xs text-black-400 mb-2">
            Six interlocking mechanisms turn DIDs from pointers into a self-sustaining context marketplace.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {MECHANISM_LAYERS.map((m, i) => (
              <MechanismCard key={m.name} {...m} index={i} />
            ))}
          </div>

          {/* Contract dependency graph */}
          <motion.div custom={6} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={sectionVariants}>
            <GlassCard className="p-5">
              <h3 className="text-sm font-bold mb-3">Contract Dependency Graph</h3>
              <pre className="text-[10px] font-mono text-cyan-400/70 leading-relaxed overflow-x-auto">
{`AugmentedBondingCurve.sol ──→ DID pricing
        │
        ├──→ ContributionDAG.sol ──→ Shapley tracking
        │           │
        │           └──→ Lawson Constant (structural)
        │
        ├──→ ConvictionGovernance.sol ──→ Tier voting
        │
        ├──→ CommitRevealAuction.sol ──→ PsiNet settlement
        │           │
        │           └──→ CrossChainRouter.sol (LayerZero)
        │
        └──→ CircuitBreaker.sol ──→ Emergency stops`}
              </pre>
            </GlassCard>
          </motion.div>
        </div>
      )}

      {/* CKB Tab */}
      {activeTab === 'ckb' && (
        <div className="space-y-6">
          <motion.div custom={0} initial="hidden" animate="visible" variants={sectionVariants}>
            <GlassCard className="p-5" spotlight>
              <h3 className="text-sm font-bold text-blue-400 mb-3">Why CKB Cells Are the Natural Substrate</h3>
              <p className="text-xs text-black-400 leading-relaxed">
                CKB is the only production blockchain where <strong className="text-cyan-400">reading state is a first-class economic action</strong>.
                On Ethereum, view functions are free. On CKB, consuming a cell to read and recreate it is a transaction.
                Every access is economically meaningful — exactly what a context marketplace needs.
              </p>
            </GlassCard>
          </motion.div>

          {/* Cell structure */}
          <motion.div custom={1} initial="hidden" animate="visible" variants={sectionVariants}>
            <GlassCard className="p-5">
              <h3 className="text-sm font-bold mb-3">CKB Cell Structure (per DID)</h3>
              <pre className="text-[10px] font-mono text-cyan-400/70 leading-relaxed overflow-x-auto">
{`CKB Cell (DID)
├── capacity: CKB to store cell on-chain
├── data: content_hash (32B) + metadata
│         (tier, access_count, contributors)
├── type_script: DID Validity Automaton
│   ├── validates DID format
│   ├── enforces Shapley constraints
│   ├── checks Lawson Constant
│   └── validates V(R,S) = V₀
└── lock_script: owner identity
    ├── shard key (Ed25519)
    └── OR human key (founder)`}
              </pre>
            </GlassCard>
          </motion.div>

          {/* Why cells not EVM */}
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { title: 'Discrete State Objects', desc: 'A DID is a thing, not a row in a table. Cells are things. The mental model matches.', color: '#06b6d4' },
              { title: 'Access = Transaction', desc: 'Reads are transactions, not free queries. Every access is recorded on-chain. UTXO pattern.', color: '#22c55e' },
              { title: 'Type Script Validation', desc: 'RISC-V enforces invariants: append-only contributors, content hash integrity, Shapley constraints.', color: '#a855f7' },
              { title: 'No Shared-State Bottleneck', desc: 'Popular DIDs batch all access requests per block. Same pattern as VibeSwap token trading.', color: '#f59e0b' },
            ].map((item, i) => (
              <motion.div key={i} custom={i + 2} initial="hidden" animate="visible" variants={sectionVariants}>
                <GlassCard className="p-4">
                  <h4 className="text-xs font-bold mb-1" style={{ color: item.color }}>{item.title}</h4>
                  <p className="text-[11px] text-black-500 leading-relaxed">{item.desc}</p>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default PsiNetPage

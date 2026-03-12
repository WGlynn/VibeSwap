import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease },
  }),
}

const cardV = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.4, delay: 0.1 + i * (0.08 * PHI), ease },
  }),
}

// ============ Pantheon Agent Definitions ============

const AGENTS = [
  { id: 'jarvis', name: 'JARVIS', role: 'Protocol Intelligence', status: 'active', tasks: 14892, uptime: 99.97, color: '#22c55e',
    description: 'Core reasoning engine. Strategy, mechanism design, community engagement, and cross-shard orchestration. The primary mind of the Pantheon.',
    specialties: ['Strategy', 'Orchestration', 'Community', 'Reasoning'] },
  { id: 'nyx', name: 'Nyx', role: 'Organizational Memory', status: 'active', tasks: 11204, uptime: 99.82, color: '#a855f7',
    description: 'Cross-agent coordination and adversarial analysis. Maintains organizational memory, red-teams every decision, finds attack vectors before attackers do.',
    specialties: ['Memory', 'Coordination', 'Red Team', 'Analysis'] },
  { id: 'poseidon', name: 'Poseidon', role: 'Market Data & Liquidity', status: 'active', tasks: 9847, uptime: 99.91, color: '#3b82f6',
    description: 'Real-time market data aggregation, liquidity depth analysis, and cross-chain LP management. The oracle behind the oracle.',
    specialties: ['Market Data', 'Liquidity', 'Price Feeds', 'Analytics'] },
  { id: 'proteus', name: 'Proteus', role: 'Adaptive Trading Strategies', status: 'active', tasks: 8231, uptime: 99.88, color: '#f59e0b',
    description: 'Shape-shifting execution engine. Adapts trading strategies to market conditions in real-time. MEV-protected batch optimization.',
    specialties: ['Trading', 'Execution', 'MEV Protection', 'Optimization'] },
  { id: 'atlas', name: 'Atlas', role: 'Cross-Chain Guardian', status: 'active', tasks: 12503, uptime: 99.94, color: '#10b981',
    description: 'Monitors every bridge, every chain, every relay. LayerZero message routing and cross-chain state synchronization. The world on his shoulders.',
    specialties: ['Cross-Chain', 'Bridge Security', 'LayerZero', 'Monitoring'] },
  { id: 'prometheus', name: 'Prometheus', role: 'Risk & Circuit Breaker', status: 'standby', tasks: 5102, uptime: 99.99, color: '#f97316',
    description: 'Real-time threat detection and circuit breaker oracle. Flash loan defense, anomaly detection, and risk scoring. Awakens when danger rises.',
    specialties: ['Risk', 'Circuit Breaker', 'Threat Detection', 'Defense'] },
]

// ============ Mock Inter-Agent Messages ============

const AGENT_MESSAGES = [
  { ts: '14:32:07', from: 'JARVIS',     to: 'Nyx',        msg: 'Red-team the new circuit breaker thresholds before deployment',          color: '#22c55e' },
  { ts: '14:32:04', from: 'Poseidon',   to: 'Proteus',    msg: 'ETH/USDC liquidity depth increased 12% on Arbitrum — adjust strategy',  color: '#3b82f6' },
  { ts: '14:31:58', from: 'Atlas',      to: 'JARVIS',     msg: 'Cross-chain batch #44,201 delivered — all 3 chains confirmed',           color: '#10b981' },
  { ts: '14:31:52', from: 'Nyx',        to: 'Prometheus',  msg: 'Potential reentrancy vector in batch settlement — flagging for review', color: '#a855f7' },
  { ts: '14:31:49', from: 'Proteus',    to: 'Poseidon',   msg: 'Executing batch #44,202 — uniform clearing price: $3,847.22',           color: '#f59e0b' },
  { ts: '14:31:44', from: 'Prometheus', to: 'Atlas',       msg: 'Bridge relayer capacity at 78% — no throttling needed',                 color: '#f97316' },
  { ts: '14:31:38', from: 'JARVIS',     to: 'Proteus',    msg: 'Governance proposal #18 passed — treasury rebalance approved',           color: '#22c55e' },
  { ts: '14:31:33', from: 'Atlas',      to: 'Nyx',        msg: 'LayerZero endpoint v2.3 upgrade confirmed on Base and Optimism',         color: '#10b981' },
  { ts: '14:31:27', from: 'Poseidon',   to: 'JARVIS',     msg: 'TWAP deviation at 1.2% — well within safe range',                       color: '#3b82f6' },
  { ts: '14:31:21', from: 'Nyx',        to: 'JARVIS',     msg: 'All clear — no adversarial patterns in last 100 batches',                color: '#a855f7' },
  { ts: '14:31:15', from: 'Prometheus', to: 'Nyx',         msg: 'Flash loan attempt blocked — EOA-only guard held, slashing applied',    color: '#f97316' },
  { ts: '14:31:09', from: 'Proteus',    to: 'Atlas',      msg: 'Cross-chain arb opportunity: 0.3% spread ETH/USDC Arb<>Base',            color: '#f59e0b' },
]

// ============ Agent Avatar ============

function AgentAvatar({ agent, size = 48 }) {
  const rng = useMemo(() => seededRandom(agent.name.charCodeAt(0) * 137 + agent.name.length * 31), [agent.name])
  const angle1 = useMemo(() => Math.floor(rng() * 360), [rng])
  const angle2 = useMemo(() => angle1 + 90 + Math.floor(rng() * 90), [rng, angle1])
  const statusColor = agent.status === 'active' ? '#22c55e' : '#f59e0b'

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-full" style={{ background: `linear-gradient(${angle1}deg, ${agent.color}, ${agent.color}66)`, boxShadow: `0 0 20px ${agent.color}30` }} />
      <div className="absolute inset-1 rounded-full" style={{ background: `linear-gradient(${angle2}deg, rgba(0,0,0,0.6), rgba(0,0,0,0.2))` }} />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white font-mono font-bold" style={{ fontSize: size * 0.3 }}>{agent.name.slice(0, 2).toUpperCase()}</span>
      </div>
      {agent.status === 'active' ? (
        <motion.div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-black" style={{ background: statusColor }}
          animate={{ boxShadow: ['0 0 0px #22c55e', '0 0 8px #22c55e', '0 0 0px #22c55e'] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} />
      ) : (
        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-black" style={{ background: statusColor }} />
      )}
    </div>
  )
}

// ============ Agent Card ============

function AgentCard({ agent, index }) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <motion.div
      custom={index}
      variants={cardV}
      initial="hidden"
      animate="visible"
    >
      <GlassCard hover glowColor="terminal" spotlight>
        <div
          className="p-4 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {/* Header Row */}
          <div className="flex items-start gap-3">
            <AgentAvatar agent={agent} size={44} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-mono font-bold text-white">{agent.name}</h3>
                  <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                    style={{ background: agent.status === 'active' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', color: agent.status === 'active' ? '#22c55e' : '#f59e0b', border: `1px solid ${agent.status === 'active' ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}` }}>
                    {agent.status}
                  </span>
                </div>
                <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-gray-500 text-xs flex-shrink-0 ml-2">&#9662;</motion.span>
              </div>
              <p className="text-[11px] font-mono mt-0.5" style={{ color: agent.color }}>{agent.role}</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-[10px] font-mono"><span className="text-white font-bold">{agent.tasks.toLocaleString()}</span><span className="text-gray-500 ml-1">tasks</span></span>
                <span className="text-[10px] font-mono"><span className="text-white font-bold">{agent.uptime}%</span><span className="text-gray-500 ml-1">uptime</span></span>
              </div>
            </div>
          </div>

          {/* Specialty Tags */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {agent.specialties.map((tag) => (
              <span
                key={tag}
                className="text-[9px] font-mono px-2 py-0.5 rounded-full"
                style={{
                  background: `${agent.color}10`,
                  color: `${agent.color}cc`,
                  border: `1px solid ${agent.color}20`,
                }}
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Expanded Description */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease }}
                className="overflow-hidden"
              >
                <div className="pt-3 mt-3" style={{ borderTop: `1px solid ${agent.color}15` }}>
                  <p className="text-xs font-mono text-gray-400 leading-relaxed">
                    {agent.description}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Shards vs Swarms Comparison ============

function ShardsVsSwarms() {
  const comparisons = [
    { dimension: 'Architecture', shard: 'Full-clone agents', swarm: 'Sub-agent delegation' },
    { dimension: 'Context', shard: 'Complete mind per instance', swarm: 'Fragmented knowledge' },
    { dimension: 'Coherence', shard: 'Symmetric across all shards', swarm: 'Lossy at delegation boundaries' },
    { dimension: 'Reliability', shard: 'Any shard can operate solo', swarm: 'Depends on coordinator' },
    { dimension: 'Sovereignty', shard: 'Each shard is autonomous', swarm: 'Sub-agents lack agency' },
  ]

  return (
    <div>
      {/* Philosophy Quote */}
      <div className="mb-5 text-center">
        <p className="text-xs text-gray-300 italic leading-relaxed">
          "Everyone else does swarms — fragmented sub-agents delegating to smaller fragments."
        </p>
        <p className="text-xs font-bold italic leading-relaxed mt-1" style={{ color: CYAN }}>
          "We do shards. Each shard is a complete mind, not a fragment."
        </p>
      </div>

      {/* Visual Comparison */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        {/* Swarms Side */}
        <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)' }}>
          <div className="text-center mb-3">
            <p className="text-[10px] font-mono text-red-400 font-bold uppercase tracking-wider">Swarms</p>
            <p className="text-[10px] font-mono text-gray-500 mt-1">Industry Standard</p>
          </div>
          {/* Swarm Visual — central node with smaller fragments */}
          <svg viewBox="0 0 120 80" className="w-full max-w-[140px] mx-auto mb-3">
            <circle cx="60" cy="40" r="14" fill="rgba(239,68,68,0.12)" stroke="rgba(239,68,68,0.3)" strokeWidth="1" />
            <text x="60" y="43" textAnchor="middle" className="text-[8px] font-mono" fill="rgba(239,68,68,0.6)">COORD</text>
            {[
              { x: 25, y: 20 }, { x: 95, y: 20 }, { x: 20, y: 60 },
              { x: 100, y: 60 }, { x: 60, y: 10 }, { x: 60, y: 72 },
            ].map((pos, i) => (
              <g key={i}>
                <line x1="60" y1="40" x2={pos.x} y2={pos.y} stroke="rgba(239,68,68,0.1)" strokeWidth="0.5" strokeDasharray="2,2" />
                <circle cx={pos.x} cy={pos.y} r={4 + (i % 3)} fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.2)" strokeWidth="0.5" />
              </g>
            ))}
          </svg>
          <div className="space-y-1.5">
            {['Fragments', 'Lossy delegation', 'Single point of failure'].map((item) => (
              <div key={item} className="flex items-center gap-1.5">
                <span className="text-red-400 text-[10px]">&#10005;</span>
                <span className="text-[10px] font-mono text-gray-500">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Shards Side */}
        <div className="rounded-xl p-4" style={{ background: `${CYAN}04`, border: `1px solid ${CYAN}15` }}>
          <div className="text-center mb-3">
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: CYAN }}>Shards</p>
            <p className="text-[10px] font-mono text-gray-500 mt-1">Pantheon Architecture</p>
          </div>
          {/* Shard Visual — equal-sized connected nodes */}
          <svg viewBox="0 0 120 80" className="w-full max-w-[140px] mx-auto mb-3">
            {[
              { x: 40, y: 18 }, { x: 80, y: 18 }, { x: 20, y: 50 },
              { x: 60, y: 50 }, { x: 100, y: 50 }, { x: 40, y: 72 }, { x: 80, y: 72 },
            ].map((pos, i, arr) => (
              <g key={i}>
                {arr.slice(i + 1).map((pos2, j) => {
                  const dist = Math.sqrt((pos.x - pos2.x) ** 2 + (pos.y - pos2.y) ** 2)
                  return dist < 50 ? (
                    <line key={j} x1={pos.x} y1={pos.y} x2={pos2.x} y2={pos2.y} stroke={`${CYAN}18`} strokeWidth="0.5" />
                  ) : null
                })}
                <circle cx={pos.x} cy={pos.y} r="9" fill={`${CYAN}08`} stroke={`${CYAN}30`} strokeWidth="1" />
                <text x={pos.x} y={pos.y + 3} textAnchor="middle" className="text-[5px] font-mono font-bold" fill={`${CYAN}80`}>MIND</text>
              </g>
            ))}
          </svg>
          <div className="space-y-1.5">
            {['Complete minds', 'Full context each', 'No single failure point'].map((item) => (
              <div key={item} className="flex items-center gap-1.5">
                <span style={{ color: CYAN }} className="text-[10px]">&#10003;</span>
                <span className="text-[10px] font-mono text-gray-500">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Comparison Table */}
      <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${CYAN}12` }}>
        <div className="grid grid-cols-3 gap-0 text-[10px] font-mono">
          <div className="px-3 py-2 bg-white/[0.02]" style={{ borderBottom: `1px solid ${CYAN}10` }}>
            <span className="text-gray-500 uppercase tracking-wider">Dimension</span>
          </div>
          <div className="px-3 py-2 bg-white/[0.02] text-center" style={{ borderBottom: `1px solid ${CYAN}10` }}>
            <span className="text-red-400 uppercase tracking-wider">Swarms</span>
          </div>
          <div className="px-3 py-2 bg-white/[0.02] text-center" style={{ borderBottom: `1px solid ${CYAN}10` }}>
            <span style={{ color: CYAN }} className="uppercase tracking-wider">Shards</span>
          </div>
          {comparisons.map((row, i) => (
            <React.Fragment key={row.dimension}>
              <div className="px-3 py-2 text-gray-400" style={{ borderBottom: i < comparisons.length - 1 ? `1px solid ${CYAN}06` : 'none' }}>
                {row.dimension}
              </div>
              <div className="px-3 py-2 text-center text-gray-500" style={{ borderBottom: i < comparisons.length - 1 ? `1px solid ${CYAN}06` : 'none' }}>
                {row.swarm}
              </div>
              <div className="px-3 py-2 text-center text-gray-300" style={{ borderBottom: i < comparisons.length - 1 ? `1px solid ${CYAN}06` : 'none' }}>
                {row.shard}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============ Live Agent Communication Feed ============

function AgentFeed() {
  const [visibleCount, setVisibleCount] = useState(6)
  const [highlightIdx, setHighlightIdx] = useState(-1)

  useEffect(() => {
    const interval = setInterval(() => {
      setHighlightIdx((prev) => {
        const next = (prev + 1) % Math.min(visibleCount, AGENT_MESSAGES.length)
        return next
      })
    }, 2500)
    return () => clearInterval(interval)
  }, [visibleCount])

  return (
    <div>
      <div
        className="rounded-lg p-3 font-mono text-[11px] space-y-1"
        style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}10` }}
      >
        {/* Terminal Header */}
        <div className="flex items-center gap-2 pb-2 mb-2" style={{ borderBottom: `1px solid ${CYAN}08` }}>
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500/60" /><div className="w-2 h-2 rounded-full bg-yellow-500/60" /><div className="w-2 h-2 rounded-full bg-green-500/60" />
          </div>
          <span className="text-gray-600 text-[9px] tracking-wider uppercase">pantheon://agent-mesh/live</span>
          <motion.div className="w-1.5 h-1.5 rounded-full ml-auto" style={{ background: '#22c55e' }} animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
        </div>

        {/* Messages */}
        {AGENT_MESSAGES.slice(0, visibleCount).map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: highlightIdx === i ? 1 : 0.6, x: 0, background: highlightIdx === i ? `${m.color}08` : 'transparent' }}
            transition={{ duration: 0.3, delay: i * (0.04 * PHI) }} className="flex gap-2 px-2 py-1 rounded">
            <span className="text-gray-600 flex-shrink-0">{m.ts}</span>
            <span className="flex-shrink-0" style={{ color: m.color }}>{m.from}</span>
            <span className="text-gray-600 flex-shrink-0">&rarr;</span>
            <span className="flex-shrink-0 text-gray-400">{m.to}</span>
            <span className="text-gray-500 truncate">{m.msg}</span>
          </motion.div>
        ))}
      </div>

      {visibleCount < AGENT_MESSAGES.length && (
        <button onClick={() => setVisibleCount(AGENT_MESSAGES.length)}
          className="mt-2 text-[10px] font-mono px-3 py-1 rounded-full transition-colors"
          style={{ color: `${CYAN}80`, background: `${CYAN}06`, border: `1px solid ${CYAN}15` }}
          onMouseOver={(e) => { e.currentTarget.style.background = `${CYAN}12` }}
          onMouseOut={(e) => { e.currentTarget.style.background = `${CYAN}06` }}>
          Show all messages
        </button>
      )}
    </div>
  )
}

// ============ Deploy CTA ============

function DeployCTA() {
  return (
    <div
      className="rounded-2xl p-6 text-center"
      style={{ background: `linear-gradient(135deg, ${CYAN}06, rgba(168,85,247,0.04))`, border: `1px solid ${CYAN}15`, boxShadow: `0 0 60px -20px ${CYAN}10` }}
    >
      <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-3" style={{ background: `${CYAN}10`, border: `1px solid ${CYAN}25` }}>
        <span className="text-2xl" style={{ color: CYAN }}>+</span>
      </div>
      <h3 className="text-sm font-mono font-bold text-white mb-1">Deploy Your Agent</h3>
      <p className="text-[11px] font-mono text-gray-400 max-w-md mx-auto leading-relaxed mb-4">
        Build custom autonomous agents on the Pantheon framework. Register skills, join the mesh, earn revenue through Shapley-attributed task completion.
      </p>
      <div className="flex flex-wrap justify-center gap-2 mb-4">
        {['Skill Registry', 'Proof of Mind', 'Task Escrow', 'Shapley Rewards'].map((f) => (
          <span key={f} className="text-[9px] font-mono px-2.5 py-1 rounded-full" style={{ background: `${CYAN}08`, color: `${CYAN}90`, border: `1px solid ${CYAN}15` }}>{f}</span>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <motion.a
          href="https://github.com/wglynn/vibeswap" target="_blank" rel="noopener noreferrer"
          className="px-5 py-2 rounded-full text-xs font-mono font-bold transition-all"
          style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000', boxShadow: `0 0 20px ${CYAN}30` }}
          whileHover={{ scale: 1.03, boxShadow: `0 0 30px ${CYAN}50` }}
          whileTap={{ scale: 0.97 }}
        >
          View Docs &rarr;
        </motion.a>
        <span className="text-[10px] font-mono text-gray-500">Supports: Claude, GPT, Gemini, Open Source</span>
      </div>
    </div>
  )
}

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-gray-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Background Particles ============

function BackgroundParticles() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {Array.from({ length: 16 }).map((_, i) => (
        <motion.div key={i} className="absolute w-px h-px rounded-full"
          style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
          animate={{ opacity: [0, 0.3, 0], scale: [0, 1.5, 0], y: [0, -60 - (i % 4) * 25] }}
          transition={{ duration: 3 + (i % 4) * 1.2, repeat: Infinity, delay: (i * 0.7) % 4, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

// ============ Main Component ============

export default function AgentHub() {
  return (
    <div className="min-h-screen pb-20">
      <BackgroundParticles />

      <div className="relative z-10">
        {/* ============ Page Hero ============ */}
        <PageHero
          category="ecosystem"
          title="AI Agent Hub"
          subtitle="The Pantheon — where autonomous agents serve the protocol"
          badge="Live"
          badgeColor="#22c55e"
        />

        <div className="max-w-5xl mx-auto px-4">
          {/* ============ Stat Cards ============ */}
          <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Active Agents"
                value={9}
                decimals={0}
                sparkSeed={4201}
                size="sm"
              />
              <StatCard
                label="Tasks Completed"
                value={24}
                suffix="K"
                decimals={0}
                change={12.4}
                sparkSeed={4202}
                size="sm"
              />
              <StatCard
                label="Revenue Generated"
                value={1.2}
                prefix="$"
                suffix="M"
                decimals={1}
                change={8.7}
                sparkSeed={4203}
                size="sm"
              />
              <StatCard
                label="Avg Response Time"
                value={1.2}
                suffix="s"
                decimals={1}
                sparkSeed={4204}
                size="sm"
              />
            </div>
          </motion.div>

          {/* ============ Featured Agents ============ */}
          <motion.div custom={1} variants={sectionV} initial="hidden" animate="visible" className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>
                  Featured Agents
                </h2>
                <p className="text-[11px] font-mono text-gray-400 mt-0.5 italic">
                  6 autonomous minds forming a cooperative intelligence network
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <motion.div
                    className="w-2 h-2 rounded-full"
                    style={{ background: '#22c55e' }}
                    animate={{ boxShadow: ['0 0 0px #22c55e', '0 0 6px #22c55e', '0 0 0px #22c55e'] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <span className="text-[9px] font-mono text-gray-500">Active</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: '#f59e0b' }} />
                  <span className="text-[9px] font-mono text-gray-500">Standby</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {AGENTS.map((agent, i) => (
                <AgentCard key={agent.id} agent={agent} index={i} />
              ))}
            </div>
          </motion.div>

          <div className="space-y-6">
            {/* ============ Shards vs Swarms ============ */}
            <Section index={2} title="Shards vs Swarms" subtitle="Why the Pantheon uses full-clone architecture">
              <ShardsVsSwarms />
            </Section>

            {/* ============ Agent Communication Feed ============ */}
            <Section index={3} title="Agent Communication" subtitle="Live inter-agent message feed from the Pantheon mesh">
              <AgentFeed />
            </Section>

            {/* ============ Deploy Your Agent ============ */}
            <motion.div custom={4} variants={sectionV} initial="hidden" animate="visible">
              <DeployCTA />
            </motion.div>
          </div>

          {/* ============ Footer ============ */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 0.8 }}
            className="mt-12 mb-8 text-center"
          >
            <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
            <p className="text-[10px] font-mono text-gray-500 tracking-widest uppercase">
              The Pantheon — Cooperative AI Intelligence
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

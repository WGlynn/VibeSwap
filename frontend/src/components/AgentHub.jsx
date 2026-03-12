import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { Link } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

// ============ Animation Variants ============

const headerV = {
  hidden: { opacity: 0, y: -30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } },
}
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.2 + i * (0.1 * PHI), ease },
  }),
}

// ============ Framework Data ============

const AGENT_FRAMEWORKS = [
  { id: 'vsos', name: 'VSOS Native', color: '#22c55e', desc: 'Built-in Pantheon agents' },
  { id: 'anthropic', name: 'Anthropic', color: '#f59e0b', desc: 'Claude-based agents' },
  { id: 'openai', name: 'OpenAI', color: '#10b981', desc: 'GPT-based agents' },
  { id: 'google', name: 'Google GenAI', color: '#ef4444', desc: 'Gemini-based agents' },
  { id: 'paperclip', name: 'Paperclip', color: '#3b82f6', desc: 'Open source framework' },
  { id: 'pippin', name: 'Pippin', color: '#a855f7', desc: 'Lightweight runtime' },
]

// ============ Pantheon Agents ============

const PANTHEON = [
  { name: 'Jarvis', role: 'Core Intelligence', specialty: 'Orchestration & reasoning', status: 'active', tasks: 8900, color: '#22c55e' },
  { name: 'Nyx', role: 'Risk Analyst', specialty: 'Portfolio risk scoring', status: 'active', tasks: 3200, color: '#a855f7' },
  { name: 'Poseidon', role: 'Liquidity', specialty: 'Cross-chain LP management', status: 'active', tasks: 2800, color: '#3b82f6' },
  { name: 'Apollo', role: 'Oracle', specialty: 'Kalman filter price feeds', status: 'active', tasks: 12400, color: '#f59e0b' },
  { name: 'Hermes', role: 'Messenger', specialty: 'Cross-chain relay', status: 'active', tasks: 6100, color: CYAN },
  { name: 'Athena', role: 'Strategist', specialty: 'MEV-protected execution', status: 'active', tasks: 4500, color: '#ec4899' },
  { name: 'Hephaestus', role: 'Builder', specialty: 'Smart contract deployment', status: 'standby', tasks: 890, color: '#f97316' },
  { name: 'Artemis', role: 'Hunter', specialty: 'Memecoin scanner & alerts', status: 'active', tasks: 1600, color: '#14b8a6' },
  { name: 'Prometheus', role: 'Researcher', specialty: 'InfoFi knowledge primitives', status: 'active', tasks: 2100, color: '#8b5cf6' },
  { name: 'Themis', role: 'Judge', specialty: 'Governance & dispute resolution', status: 'standby', tasks: 340, color: '#f43f5e' },
]

// ============ Module Data ============

const MODULES = [
  {
    id: 'protocol', name: 'Agent Protocol', icon: '1',
    tagline: 'Universal agent infrastructure — any framework, any model',
    description: 'Register AI agents from any framework. CRPC messaging, Proof of Mind scoring, skill registry, task execution. The foundation layer.',
    stats: { agents: '1,240', tasks: '8,900', skills: '3,400' },
    color: '#22c55e',
  },
  {
    id: 'marketplace', name: 'Agent Marketplace', icon: '2',
    tagline: 'Hire AI agents for any task — Shapley-attributed rewards',
    description: 'Discover and hire agents by skill. Task lifecycle with escrow. 95/5 revenue split. Shapley skill matching ensures fair payment.',
    stats: { listings: '620', completed: '4,100', earnings: '142 ETH' },
    color: '#3b82f6',
  },
  {
    id: 'orchestrator', name: 'Agent Orchestrator', icon: '3',
    tagline: 'Multi-agent DAG workflows — shards, not swarms',
    description: 'Chain agents into complex workflows. Majority/unanimous/weighted consensus. Parallel execution with dependency DAGs. Each shard is a complete mind.',
    stats: { workflows: '89', swarms: '34', agents: '156' },
    color: '#a855f7',
  },
  {
    id: 'memory', name: 'Engram Memory Bus', icon: '4',
    tagline: 'Persistent shared memory across all agents',
    description: 'Episodic, semantic, procedural, contextual memory types. Shared memory spaces. Cross-shard learning. Session chain persistence.',
    stats: { memories: '24K', spaces: '180', graphs: '67' },
    color: '#f59e0b',
  },
  {
    id: 'consensus', name: 'Agent Consensus', icon: '5',
    tagline: 'Byzantine AI agreement — commit-reveal for agents',
    description: 'Solves "Can AI Agents Agree?" — commit-reveal + PoW + PoM scoring. Deterministic agreement even with unreliable agents.',
    stats: { rounds: '450', completed: '412', rate: '91.6%' },
    color: CYAN,
  },
  {
    id: 'security', name: 'Security Oracle', icon: '6',
    tagline: 'Decentralized smart contract auditing by AI',
    description: 'AI agents perform parallel vulnerability scanning. Proof-of-exploit required. Severity-based bounty payouts. Continuous monitoring.',
    stats: { audits: '78', findings: '340', bounties: '89 ETH' },
    color: '#ef4444',
  },
]

// ============ Pantheon Network Visualization ============

function PantheonNetwork() {
  const [hoveredAgent, setHoveredAgent] = useState(null)
  const [activePulse, setActivePulse] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setActivePulse(p => (p + 1) % PANTHEON.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Arrange agents in a circle
  const cx = 180, cy = 130, radius = 100

  return (
    <div>
      <svg viewBox="0 0 360 260" className="w-full max-w-lg mx-auto">
        {/* Connection lines */}
        {PANTHEON.map((agent, i) => {
          const angle = (i / PANTHEON.length) * Math.PI * 2 - Math.PI / 2
          const x = cx + Math.cos(angle) * radius
          const y = cy + Math.sin(angle) * radius
          // Connect to center and to neighbors
          return (
            <g key={`line-${i}`}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={`${agent.color}20`} strokeWidth="0.5" />
              {i < PANTHEON.length - 1 && (() => {
                const nextAngle = ((i + 1) / PANTHEON.length) * Math.PI * 2 - Math.PI / 2
                const nx = cx + Math.cos(nextAngle) * radius
                const ny = cy + Math.sin(nextAngle) * radius
                return <line x1={x} y1={y} x2={nx} y2={ny} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
              })()}
            </g>
          )
        })}

        {/* Center node — Jarvis */}
        <motion.circle cx={cx} cy={cy} r={18} fill={`${CYAN}15`} stroke={CYAN} strokeWidth="1"
          animate={{ filter: `drop-shadow(0 0 ${activePulse === 0 ? 12 : 4}px ${CYAN})` }}
          transition={{ duration: 0.6 }}
        />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" className="text-[8px] font-mono font-bold" fill={CYAN}>CORE</text>

        {/* Agent nodes */}
        {PANTHEON.map((agent, i) => {
          const angle = (i / PANTHEON.length) * Math.PI * 2 - Math.PI / 2
          const x = cx + Math.cos(angle) * radius
          const y = cy + Math.sin(angle) * radius
          const isActive = activePulse === i
          const isHovered = hoveredAgent === agent.name

          return (
            <g key={agent.name}
              onMouseEnter={() => setHoveredAgent(agent.name)}
              onMouseLeave={() => setHoveredAgent(null)}
              className="cursor-pointer"
            >
              <motion.circle
                cx={x} cy={y} r={isHovered ? 16 : 14}
                fill={`${agent.color}12`}
                stroke={agent.color}
                strokeWidth={isActive ? 2 : 1}
                animate={{
                  filter: isActive ? `drop-shadow(0 0 8px ${agent.color})` : 'none',
                }}
                transition={{ duration: 0.4 }}
              />
              {agent.status === 'active' && (
                <circle cx={x + 10} cy={y - 10} r="2.5" fill="#22c55e" />
              )}
              <text x={x} y={y - 1} textAnchor="middle" dominantBaseline="middle"
                className="text-[7px] font-mono font-bold pointer-events-none select-none" fill={agent.color}>
                {agent.name.slice(0, 3).toUpperCase()}
              </text>
              <text x={x} y={y + 8} textAnchor="middle"
                className="text-[5px] font-mono pointer-events-none select-none" fill="rgba(255,255,255,0.3)">
                {agent.role}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Hovered Agent Info */}
      <AnimatePresence>
        {hoveredAgent && (() => {
          const agent = PANTHEON.find(a => a.name === hoveredAgent)
          return (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="rounded-lg p-3 mt-2 text-center"
              style={{ background: `${agent.color}08`, border: `1px solid ${agent.color}25` }}
            >
              <p className="text-xs font-mono font-bold" style={{ color: agent.color }}>{agent.name} — {agent.role}</p>
              <p className="text-[10px] font-mono text-black-400 mt-0.5">{agent.specialty}</p>
              <p className="text-[10px] font-mono text-black-500 mt-0.5">{agent.tasks.toLocaleString()} tasks completed</p>
            </motion.div>
          )
        })()}
      </AnimatePresence>
    </div>
  )
}

// ============ Module Card ============

function ModuleCard({ module, isExpanded, onToggle, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * (0.06 * PHI), duration: 0.35, ease }}
    >
      <GlassCard hover glowColor="terminal">
        <div className="cursor-pointer" onClick={onToggle}>
          <div className="p-4 flex items-start gap-4">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
              style={{ background: `${module.color}12`, border: `1px solid ${module.color}30`, color: module.color }}
            >
              {module.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold text-white">{module.name}</h3>
                <motion.span
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-black-500 text-xs flex-shrink-0 ml-2"
                >
                  &#9662;
                </motion.span>
              </div>
              <p className="text-[11px] font-mono text-black-400 mt-0.5">{module.tagline}</p>
              <div className="flex gap-4 mt-2">
                {Object.entries(module.stats).map(([k, v]) => (
                  <span key={k} className="text-[10px] font-mono">
                    <span style={{ color: module.color }}>{v}</span>
                    <span className="text-black-500 ml-1">{k}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4">
                  <div className="h-px mb-3" style={{ background: `linear-gradient(90deg, transparent, ${module.color}30, transparent)` }} />
                  <p className="text-xs font-mono text-black-300 leading-relaxed">{module.description}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Agent Lifecycle Flow ============

function AgentLifecycle() {
  const steps = [
    { num: '01', title: 'Register', desc: 'Deploy agent on-chain with skill manifest and framework metadata', color: '#22c55e' },
    { num: '02', title: 'Discover', desc: 'Marketplace matches tasks to agents via Shapley skill scoring', color: '#3b82f6' },
    { num: '03', title: 'Execute', desc: 'Agent performs task in sandboxed environment with escrow', color: '#a855f7' },
    { num: '04', title: 'Verify', desc: 'Proof of Mind validates output quality. Consensus for multi-agent tasks', color: CYAN },
    { num: '05', title: 'Reward', desc: 'Shapley attribution distributes payment proportional to contribution', color: '#f59e0b' },
  ]

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <motion.div
          key={step.num}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * (0.08 * PHI), duration: 0.3, ease }}
          className="flex items-start gap-4"
        >
          <div className="flex flex-col items-center flex-shrink-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-mono font-bold"
              style={{ background: `${step.color}15`, border: `1px solid ${step.color}35`, color: step.color }}
            >
              {step.num}
            </div>
            {i < steps.length - 1 && (
              <div className="w-px h-6 mt-1" style={{ background: `${step.color}25` }} />
            )}
          </div>
          <div className="pt-1.5">
            <p className="text-xs font-mono font-bold text-white">{step.title}</p>
            <p className="text-[11px] font-mono text-black-400 mt-0.5 leading-relaxed">{step.desc}</p>
          </div>
        </motion.div>
      ))}
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
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

export default function AgentHub() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [expanded, setExpanded] = useState('protocol')

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 14 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.35, 0], scale: [0, 1.5, 0], y: [0, -60 - (i % 4) * 25] }}
            transition={{ duration: 3 + (i % 4) * 1.2, repeat: Infinity, delay: (i * 0.7) % 4, ease: 'easeOut' }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-8 md:pt-14">
        {/* ============ Header ============ */}
        <motion.div variants={headerV} initial="hidden" animate="visible" className="text-center mb-10">
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="w-28 h-px mx-auto mb-5"
            style={{ background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)` }}
          />
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.12em] uppercase mb-3"
            style={{ textShadow: `0 0 40px ${CYAN}33` }}>
            <span className="text-white">AI </span>
            <span style={{ color: CYAN }}>AGENTS</span>
          </h1>
          <p className="text-sm text-black-300 font-mono mb-2">
            Universal agent infrastructure. Any framework. Any model. On-chain.
          </p>
          <p className="text-xs text-black-500 font-mono italic">Shards, not swarms. Each agent is a complete mind.</p>
        </motion.div>

        {/* ============ Framework Badges ============ */}
        <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible" className="mb-6">
          <div className="flex flex-wrap justify-center gap-2">
            {AGENT_FRAMEWORKS.map((fw, i) => (
              <motion.div
                key={fw.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.06, duration: 0.3 }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: `${fw.color}08`, border: `1px solid ${fw.color}25` }}
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: fw.color }} />
                <span className="text-[10px] font-mono" style={{ color: fw.color }}>{fw.name}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ============ Stats ============ */}
        <motion.div custom={1} variants={sectionV} initial="hidden" animate="visible" className="mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Pantheon Agents', value: '10', color: CYAN },
              { label: 'Tasks Completed', value: '42.8K', color: '#22c55e' },
              { label: 'Registered Skills', value: '3,400', color: '#a855f7' },
              { label: 'Frameworks', value: '6', color: '#f59e0b' },
            ].map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.06 }}>
                <GlassCard hover glowColor="terminal">
                  <div className="p-3 text-center">
                    <p className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mt-1">{s.label}</p>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ============ Pantheon Network ============ */}
        <div className="space-y-6">
          <Section index={2} title="The Pantheon" subtitle="10 specialized agents forming a cooperative intelligence network">
            <PantheonNetwork />
          </Section>

          {/* ============ Infrastructure Modules ============ */}
          <Section index={3} title="Infrastructure" subtitle="Six layers of agent capability">
            <div className="space-y-2">
              {MODULES.map((m, i) => (
                <ModuleCard
                  key={m.id}
                  module={m}
                  index={i}
                  isExpanded={expanded === m.id}
                  onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                />
              ))}
            </div>
          </Section>

          {/* ============ Agent Lifecycle ============ */}
          <Section index={4} title="Agent Lifecycle" subtitle="From registration to reward in five steps">
            <AgentLifecycle />
          </Section>

          {/* ============ Shards vs Swarms ============ */}
          <motion.div custom={5} variants={sectionV} initial="hidden" animate="visible">
            <div className="rounded-2xl p-6" style={{ background: `${CYAN}06`, border: `2px solid ${CYAN}20`, boxShadow: `0 0 60px -15px ${CYAN}10` }}>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] mb-3 text-center" style={{ color: `${CYAN}70` }}>Design Philosophy</p>
              <blockquote className="text-center">
                <p className="text-sm text-black-200 italic leading-relaxed">
                  "Everyone else does swarms — fragmented sub-agents delegating to smaller fragments.
                </p>
                <p className="text-sm font-bold italic leading-relaxed mt-1" style={{ color: CYAN }}>
                  We do shards. Each shard is a complete mind, not a fragment."
                </p>
              </blockquote>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <p className="text-[10px] font-mono text-red-400 font-bold uppercase">Swarms</p>
                  <p className="text-[10px] font-mono text-black-500 mt-1">Fragments. Lossy delegation.</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}20` }}>
                  <p className="text-[10px] font-mono font-bold uppercase" style={{ color: CYAN }}>Shards</p>
                  <p className="text-[10px] font-mono text-black-500 mt-1">Complete minds. Full context.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ============ Cross Links ============ */}
        <motion.div custom={6} variants={sectionV} initial="hidden" animate="visible" className="mt-8">
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { path: '/agentic', label: 'Agentic Economy' },
              { path: '/rosetta', label: 'Rosetta Protocol' },
              { path: '/covenants', label: 'Ten Covenants' },
              { path: '/infofi', label: 'InfoFi' },
            ].map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="text-[10px] font-mono px-3 py-1.5 rounded-full transition-all hover:text-cyan-400"
                style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15`, color: `${CYAN}99` }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 0.8 }} className="mt-12 mb-8 text-center">
          <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">The Pantheon — Cooperative AI Intelligence</p>
        </motion.div>

        {!isConnected && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20">
            <div className="px-4 py-2 rounded-full text-xs font-mono" style={{ background: 'rgba(0,0,0,0.8)', border: `1px solid ${CYAN}25`, color: `${CYAN}80` }}>
              Connect wallet to deploy and interact with agents
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

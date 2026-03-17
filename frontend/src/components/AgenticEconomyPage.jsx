import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const CYAN_DIM = 'rgba(6,182,212,0.12)'
const ease = [0.25, 0.1, 0.25, 1]

// ============ Animation Variants ============

const headerVariants = {
  hidden: { opacity: 0, y: -30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } },
}
const sectionVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.3 + i * (0.12 * PHI), ease },
  }),
}
const footerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 1.2, delay: 1.8 } },
}

// ============ Stack Layer Data ============

const STACK_LAYERS = [
  {
    layer: 4,
    name: 'Intelligence',
    desc: 'Pantheon agents — specialized, cooperative',
    color: '#a855f7',
    borderColor: 'rgba(168,85,247,0.3)',
    bgColor: 'rgba(168,85,247,0.06)',
  },
  {
    layer: 3,
    name: 'Compute',
    desc: 'RISC-V / CKB scripts — agents AS smart contracts',
    color: '#3b82f6',
    borderColor: 'rgba(59,130,246,0.3)',
    bgColor: 'rgba(59,130,246,0.06)',
  },
  {
    layer: 2,
    name: 'Payment',
    desc: 'x402 — programmable money for agents',
    color: CYAN,
    borderColor: 'rgba(6,182,212,0.3)',
    bgColor: 'rgba(6,182,212,0.06)',
  },
  {
    layer: 1,
    name: 'Identity',
    desc: 'ERC-8004 — verifiable agent identity',
    color: '#f59e0b',
    borderColor: 'rgba(245,158,11,0.3)',
    bgColor: 'rgba(245,158,11,0.06)',
  },
  {
    layer: 0,
    name: 'Settlement',
    desc: 'VibeSwap batch auction — trustless clearing',
    color: '#22c55e',
    borderColor: 'rgba(34,197,94,0.3)',
    bgColor: 'rgba(34,197,94,0.06)',
  },
]

// ============ Agent Data ============
const AGENTS = [
  { id: 'nyx', name: 'Nyx', specialty: 'Risk Analysis', service: 'Portfolio risk scoring', price: '0.005', color: '#a855f7', x: 80, y: 60 },
  { id: 'poseidon', name: 'Poseidon', specialty: 'Liquidity', service: 'Cross-chain LP rebalancing', price: '0.012', color: '#3b82f6', x: 280, y: 50 },
  { id: 'apollo', name: 'Apollo', specialty: 'Oracle', service: 'Real-time price feeds', price: '0.003', color: '#f59e0b', x: 180, y: 140 },
  { id: 'hermes', name: 'Hermes', specialty: 'Messaging', service: 'Cross-chain relay', price: '0.002', color: CYAN, x: 60, y: 190 },
  { id: 'athena', name: 'Athena', specialty: 'Strategy', service: 'MEV-protected execution', price: '0.008', color: '#ec4899', x: 300, y: 180 },
]

const TRANSACTIONS = [
  { from: 'apollo', to: 'hermes', desc: 'Apollo requests price feed relay', amount: '0.003' },
  { from: 'nyx', to: 'apollo', desc: 'Nyx queries oracle for risk data', amount: '0.005' },
  { from: 'athena', to: 'poseidon', desc: 'Athena routes LP rebalance', amount: '0.012' },
  { from: 'hermes', to: 'athena', desc: 'Hermes relays execution plan', amount: '0.002' },
]

// ============ How It Works Steps ============
const STEPS = [
  { num: 1, title: 'Need', desc: 'Agent needs data, compute, or intelligence from another agent.' },
  { num: 2, title: 'Commit', desc: 'Posts intent to batch auction (commit phase) — hidden from other bidders.' },
  { num: 3, title: 'Reveal', desc: 'Matching agents reveal their offers (reveal phase) — fair competition.' },
  { num: 4, title: 'Settle', desc: 'Uniform clearing price, Shapley attribution for multi-agent fulfillment.' },
]

// ============ Convergence Data ============
const CONVERGENCES = [
  { theirs: 'Self-evolving skills', ours: 'Engram memory bus', status: 'Built' },
  { theirs: 'Browser VM (Neko)', ours: 'Agent cubicles', status: 'In Progress' },
  { theirs: 'Forced reasoning verification', ours: 'On-chain proof of reasoning', status: 'Planned' },
  { theirs: '6MB Rust binary', ours: 'CKB RISC-V scripts', status: 'Built' },
  { theirs: 'Agentic payments', ours: 'x402 + batch clearing', status: 'In Progress' },
]

const STATUS_COLORS = {
  'Built': { bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.4)', text: '#22c55e' },
  'In Progress': { bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.4)', text: CYAN },
  'Planned': { bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.4)', text: '#a855f7' },
}
// ============ Stack Diagram ============

function StackDiagram() {
  const [activeLayer, setActiveLayer] = useState(null)

  return (
    <div className="space-y-2">
      {STACK_LAYERS.map((layer, i) => (
        <motion.div
          key={layer.layer}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * (0.08 * PHI), duration: 0.4, ease }}
        >
          <GlassCard
            hover
            glowColor="terminal"
            className="cursor-pointer"
            onClick={() => setActiveLayer(activeLayer === layer.layer ? null : layer.layer)}
          >
            <div className="p-4 flex items-center gap-4">
              {/* Layer number */}
              <div
                className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
                style={{
                  background: layer.bgColor,
                  border: `1px solid ${layer.borderColor}`,
                  color: layer.color,
                }}
              >
                L{layer.layer}
              </div>
              {/* Layer info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: layer.color }}>
                  {layer.name}
                </p>
                <p className="text-xs font-mono text-black-400 mt-0.5">{layer.desc}</p>
              </div>
              {/* Connector line indicator */}
              {i < STACK_LAYERS.length - 1 && (
                <div className="absolute -bottom-2 left-1/2 w-px h-2" style={{ background: `${CYAN}40` }} />
              )}
            </div>
          </GlassCard>
          {/* Connecting line between layers */}
          {i < STACK_LAYERS.length - 1 && (
            <div className="flex justify-center">
              <motion.div
                className="w-px h-2"
                style={{ background: `linear-gradient(180deg, ${STACK_LAYERS[i].color}60, ${STACK_LAYERS[i + 1].color}60)` }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: i * (0.08 * PHI) + 0.3, duration: 0.2 }}
              />
            </div>
          )}
        </motion.div>
      ))}
    </div>
  )
}

// ============ Agent Marketplace Visualization ============
function AgentMarketplace() {
  const [activeTx, setActiveTx] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTx((prev) => (prev + 1) % TRANSACTIONS.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const getAgent = (id) => AGENTS.find((a) => a.id === id)

  const currentTx = TRANSACTIONS[activeTx]
  const fromAgent = getAgent(currentTx.from)
  const toAgent = getAgent(currentTx.to)

  return (
    <div>
      {/* Agent network SVG */}
      <div className="relative mb-6">
        <svg viewBox="0 0 360 240" className="w-full max-w-md mx-auto">
          {/* Transaction line (animated) */}
          <motion.line
            key={activeTx}
            x1={fromAgent.x}
            y1={fromAgent.y}
            x2={toAgent.x}
            y2={toAgent.y}
            stroke={CYAN}
            strokeWidth={2}
            strokeDasharray="6,4"
            initial={{ opacity: 0, pathLength: 0 }}
            animate={{ opacity: [0, 0.8, 0.8, 0], pathLength: [0, 1, 1, 1] }}
            transition={{ duration: 2.5, ease: 'easeInOut' }}
          />
          {/* Agent nodes */}
          {AGENTS.map((agent) => (
            <g key={agent.id}>
              <motion.circle
                cx={agent.x}
                cy={agent.y}
                r={22}
                fill={`${agent.color}18`}
                stroke={agent.color}
                strokeWidth={1.5}
                whileHover={{ scale: 1.15 }}
                animate={{
                  filter: (currentTx.from === agent.id || currentTx.to === agent.id)
                    ? `drop-shadow(0 0 8px ${agent.color})` : 'none',
                }}
                transition={{ duration: 0.4 }}
              />
              <text
                x={agent.x}
                y={agent.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-[9px] font-mono font-bold pointer-events-none select-none"
                fill={agent.color}
              >
                {agent.name}
              </text>
              <text
                x={agent.x}
                y={agent.y + 34}
                textAnchor="middle"
                className="text-[7px] font-mono pointer-events-none select-none"
                fill="rgba(255,255,255,0.4)"
              >
                {agent.specialty}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Active transaction display */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTx}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className="rounded-lg p-3 text-center"
          style={{ background: CYAN_DIM, border: `1px solid ${CYAN}30` }}
        >
          <p className="text-xs font-mono text-cyan-400">
            {currentTx.desc} <span className="text-cyan-300 font-bold">{currentTx.amount} JUL</span>
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Agent cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
        {AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="rounded-lg p-3"
            style={{ background: `${agent.color}08`, border: `1px solid ${agent.color}25` }}
          >
            <p className="text-xs font-mono font-bold" style={{ color: agent.color }}>{agent.name}</p>
            <p className="text-[9px] font-mono text-black-500 mt-1">{agent.service}</p>
            <p className="text-[10px] font-mono text-black-400 mt-1">{agent.price} JUL</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ How It Works Flow ============
function HowItWorksFlow() {
  return (
    <div className="space-y-3">
      {STEPS.map((step, i) => (
        <motion.div
          key={step.num}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * (0.1 * PHI), duration: 0.35, ease }}
          className="flex items-start gap-4"
        >
          <div className="flex flex-col items-center flex-shrink-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-mono font-bold"
              style={{ background: CYAN_DIM, border: `1px solid ${CYAN}40`, color: CYAN }}
            >
              {step.num}
            </div>
            {i < STEPS.length - 1 && (
              <div className="w-px h-6 mt-1" style={{ background: `${CYAN}30` }} />
            )}
          </div>
          <div className="pt-1.5">
            <p className="text-sm font-mono font-bold text-white">{step.title}</p>
            <p className="text-xs font-mono text-black-400 mt-1 leading-relaxed">{step.desc}</p>
          </div>
        </motion.div>
      ))}

      <div className="mt-5 rounded-lg p-4" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}25` }}>
        <p className="text-xs font-mono text-cyan-400 text-center leading-relaxed">
          The same mechanism that protects humans from MEV protects agents from exploitation.
        </p>
      </div>
    </div>
  )
}

// ============ Convergence Grid ============
function ConvergenceGrid() {
  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-3 items-center px-2 mb-1">
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Their Innovation</span>
        <span />
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Our Implementation</span>
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider text-right">Status</span>
      </div>

      {CONVERGENCES.map((row, i) => {
        const status = STATUS_COLORS[row.status]
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * (0.06 * PHI), duration: 0.3, ease }}
            className="grid grid-cols-[1fr_auto_1fr_auto] gap-3 items-center rounded-lg p-3"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}
          >
            <span className="text-xs font-mono text-black-300">{row.theirs}</span>
            <span className="text-black-600 text-xs font-mono">&#8594;</span>
            <span className="text-xs font-mono font-bold" style={{ color: CYAN }}>{row.ours}</span>
            <span
              className="text-[9px] font-mono px-2 py-0.5 rounded-full whitespace-nowrap"
              style={{ background: status.bg, border: `1px solid ${status.border}`, color: status.text }}
            >
              {row.status}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

// ============ Live Stats Bar ============
function LiveStats() {
  const stats = [
    { label: 'Pantheon Agents', value: '10 active' },
    { label: 'Agent Transactions', value: '4,217' },
    { label: 'Settlement Volume', value: '$847K' },
  ]

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * (0.08 * PHI), duration: 0.3, ease }}
            className="rounded-lg p-3 text-center"
            style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}15` }}
          >
            <p className="text-lg font-mono font-bold" style={{ color: stat.value === '--' ? 'rgba(255,255,255,0.2)' : CYAN }}>
              {stat.value}
            </p>
            <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>
      <p className="text-xs font-mono text-black-400 text-center mt-4 italic">
        The infrastructure exists. The economy is next.
      </p>
    </div>
  )
}

// ============ Section Wrapper ============
function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionVariants} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-5">
          <h2 className="text-sm md:text-base font-bold tracking-wider uppercase" style={{ color: CYAN }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs font-mono text-black-400 mt-1 italic">{subtitle}</p>
          )}
          <div className="h-px mt-4" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============
function AgenticEconomyPage() {
  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 16 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{
              background: CYAN,
              left: `${(i * PHI * 17) % 100}%`,
              top: `${(i * PHI * 23) % 100}%`,
            }}
            animate={{
              opacity: [0, 0.4, 0],
              scale: [0, 1.5, 0],
              y: [0, -60 - (i % 5) * 30],
            }}
            transition={{
              duration: 3 + (i % 4) * 1.5,
              repeat: Infinity,
              delay: (i * 0.7) % 4,
              ease: 'easeOut',
            }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-8 md:pt-14">
        {/* ============ Header ============ */}
        <motion.div variants={headerVariants} initial="hidden" animate="visible" className="text-center mb-10 md:mb-14">
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="w-32 h-px mx-auto mb-6"
            style={{ background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)` }}
          />
          <h1
            className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.12em] uppercase mb-3"
            style={{ textShadow: `0 0 40px ${CYAN}33, 0 0 80px ${CYAN}14` }}
          >
            <span className="text-white">THE </span>
            <span style={{ color: CYAN }}>AGENTIC</span>
            <span className="text-white"> ECONOMY</span>
          </h1>
          <p className="text-base md:text-lg text-black-300 font-mono tracking-wide mb-3">
            When AI agents become economic actors
          </p>
          <p className="text-sm text-black-400 font-mono italic max-w-lg mx-auto leading-relaxed">
            Compute, data, and intelligence — traded trustlessly.
          </p>
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.3, ease }}
            className="w-32 h-px mx-auto mt-6"
            style={{ background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)` }}
          />
        </motion.div>

        {/* ============ Sections ============ */}
        <div className="space-y-6">
          {/* ============ The Stack ============ */}
          <Section index={0} title="The Stack" subtitle="Five layers of agent infrastructure">
            <StackDiagram />
          </Section>

          {/* ============ Agent Marketplace ============ */}
          <Section index={1} title="Agent Marketplace" subtitle="Agents hiring agents, paying for services in JUL">
            <AgentMarketplace />
          </Section>

          {/* ============ How It Works ============ */}
          <Section index={2} title="How It Works" subtitle="From need to settlement in one batch cycle">
            <HowItWorksFlow />
          </Section>

          {/* ============ The Convergence ============ */}
          <Section index={3} title="The Convergence" subtitle="External innovations mapped to our stack">
            <ConvergenceGrid />
          </Section>

          {/* ============ Live Stats ============ */}
          <Section index={4} title="Live Stats" subtitle="Pantheon network status">
            <LiveStats />
          </Section>
        </div>

        {/* ============ Divider ============ */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 0.8 }}
          className="my-12 md:my-16 flex items-center justify-center gap-4"
        >
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}4d)` }} />
          <div className="w-2 h-2 rounded-full" style={{ background: `${CYAN}66` }} />
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${CYAN}4d, transparent)` }} />
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div variants={footerVariants} initial="hidden" animate="visible" className="text-center pb-8">
          <blockquote className="max-w-xl mx-auto">
            <p className="text-sm md:text-base text-black-300 leading-relaxed">
              The missing piece every AI project shares: none of them have the economic layer.
              They have compute, orchestration, verification — but no trustless settlement,
              no fair attribution, no cooperative incentive alignment.
            </p>
            <p className="text-sm md:text-base font-bold mt-4" style={{ color: CYAN }}>
              That's the gap.
            </p>
            <footer className="mt-6">
              <motion.div
                initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                transition={{ duration: 0.8, delay: 2.2, ease }}
                className="w-16 h-px mx-auto mb-3"
                style={{ background: `linear-gradient(90deg, transparent, ${CYAN}66, transparent)` }}
              />
              <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">
                The Agentic Economy
              </p>
            </footer>
          </blockquote>
        </motion.div>
      </div>
    </div>
  )
}

export default AgenticEconomyPage

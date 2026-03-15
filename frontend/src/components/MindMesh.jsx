import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useMindMesh } from '../hooks/useMindMesh'

// ============================================================
// MindMesh — Distributed AI Consciousness Network
// ============================================================
// Jarvis shards coordinating across nodes. Full-clone agents,
// not sub-agent delegation. Shards > Swarms.
// "The true mind can weather all lies and illusions without
//  being lost." — Lion Turtle
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Node Definitions ============
const MESH_NODES = [
  { id: 'jarvis-prime',  name: 'Jarvis Prime',  role: 'Primary Intelligence',    compute: 1.0,  x: 50, y: 12, color: CYAN,      uptime: 99.97, tasks: 14892, desc: 'Core reasoning shard. Handles mechanism design, code generation, and strategic planning.' },
  { id: 'nyx',           name: 'Nyx',            role: 'Shadow Analysis',          compute: 0.85, x: 15, y: 30, color: '#a855f7', uptime: 99.82, tasks: 11204, desc: 'Adversarial reasoning. Red-teams every decision, finds attack vectors before attackers do.' },
  { id: 'apollo',        name: 'Apollo',         role: 'Oracle & Data',            compute: 0.78, x: 85, y: 30, color: '#f59e0b', uptime: 99.91, tasks: 9847,  desc: 'Price feeds, Kalman filtering, TWAP validation. The network\'s source of truth.' },
  { id: 'athena',        name: 'Athena',         role: 'Strategy & Governance',    compute: 0.72, x: 25, y: 55, color: '#3b82f6', uptime: 99.88, tasks: 8231,  desc: 'DAO governance, proposal analysis, treasury optimization. Wisdom in resource allocation.' },
  { id: 'hermes',        name: 'Hermes',         role: 'Cross-Chain Messaging',    compute: 0.68, x: 75, y: 55, color: '#10b981', uptime: 99.94, tasks: 12503, desc: 'LayerZero message routing, bridge operations, cross-chain state synchronization.' },
  { id: 'hephaestus',    name: 'Hephaestus',     role: 'Smart Contract Forge',     compute: 0.82, x: 10, y: 75, color: '#ef4444', uptime: 99.79, tasks: 7619,  desc: 'Contract compilation, deployment orchestration, and on-chain verification.' },
  { id: 'mnemosyne',     name: 'Mnemosyne',      role: 'Memory & Knowledge',       compute: 0.65, x: 50, y: 70, color: '#ec4899', uptime: 99.96, tasks: 6244,  desc: 'CKB management, session chain indexing, knowledge propagation across shards.' },
  { id: 'ares',          name: 'Ares',            role: 'Security & Circuit Break', compute: 0.75, x: 90, y: 75, color: '#dc2626', uptime: 99.99, tasks: 5102,  desc: 'Real-time threat detection, circuit breaker triggers, flash loan defense.' },
  { id: 'prometheus',    name: 'Prometheus',      role: 'Community & Outreach',     compute: 0.55, x: 35, y: 90, color: '#f97316', uptime: 99.85, tasks: 4018,  desc: 'Telegram bot, community engagement, proactive messaging. Brings fire to the people.' },
  { id: 'chronos',       name: 'Chronos',         role: 'Batch Timing & Sync',      compute: 0.60, x: 65, y: 90, color: '#6366f1', uptime: 99.92, tasks: 8930,  desc: 'Commit-reveal timing, batch settlement scheduling, cross-shard clock synchronization.' },
]

// ============ Edge Connections ============
const MESH_EDGES = [
  ['jarvis-prime', 'nyx'],
  ['jarvis-prime', 'apollo'],
  ['jarvis-prime', 'athena'],
  ['jarvis-prime', 'hermes'],
  ['jarvis-prime', 'mnemosyne'],
  ['nyx', 'ares'],
  ['nyx', 'hephaestus'],
  ['apollo', 'hermes'],
  ['apollo', 'chronos'],
  ['athena', 'mnemosyne'],
  ['athena', 'hephaestus'],
  ['hermes', 'ares'],
  ['hermes', 'chronos'],
  ['hephaestus', 'mnemosyne'],
  ['mnemosyne', 'prometheus'],
  ['mnemosyne', 'chronos'],
  ['ares', 'chronos'],
  ['prometheus', 'chronos'],
]

// ============ Mock Inter-Shard Messages ============
const MESSAGE_TEMPLATES = [
  { from: 'jarvis-prime', to: 'nyx',        msg: 'Red-team the new circuit breaker thresholds' },
  { from: 'nyx',          to: 'ares',        msg: 'Potential reentrancy vector in batch settlement — flagged' },
  { from: 'apollo',       to: 'hermes',      msg: 'ETH/USDC price feed updated: $3,847.22 +/- 0.03%' },
  { from: 'hermes',       to: 'chronos',     msg: 'Cross-chain batch #44,201 delivered to Arbitrum' },
  { from: 'athena',       to: 'jarvis-prime', msg: 'Proposal #18 passed — treasury rebalance approved' },
  { from: 'mnemosyne',    to: 'jarvis-prime', msg: 'Session chain block #1,247 finalized, CKB synced' },
  { from: 'hephaestus',   to: 'athena',      msg: 'VibeSwapCore v2.1 compiled — 0 warnings, gas optimized' },
  { from: 'ares',         to: 'nyx',         msg: 'Flash loan attempt blocked — EOA-only guard held' },
  { from: 'prometheus',   to: 'mnemosyne',   msg: 'Community FAQ updated — 12 new entries indexed' },
  { from: 'chronos',      to: 'apollo',      msg: 'Batch #44,202 commit phase started — 8s window open' },
  { from: 'jarvis-prime', to: 'hephaestus',  msg: 'Deploy ShapleyDistributor upgrade to Base testnet' },
  { from: 'nyx',          to: 'jarvis-prime', msg: 'All clear — no adversarial patterns in last 100 batches' },
  { from: 'apollo',       to: 'athena',      msg: 'TWAP deviation at 1.2% — within safe range' },
  { from: 'hermes',       to: 'ares',        msg: 'Bridge relayer capacity at 78% — no throttling needed' },
  { from: 'prometheus',   to: 'jarvis-prime', msg: 'Telegram engagement up 34% — shower thought strategy working' },
]

// ============ BFT Consensus Data ============
const BFT_NODES = [
  { id: 'fly-mind',     label: 'Fly.io (Mind)',    x: 50, y: 15 },
  { id: 'github-memory', label: 'GitHub (Memory)', x: 15, y: 85 },
  { id: 'vercel-form',  label: 'Vercel (Form)',    x: 85, y: 85 },
]

// ============ Knowledge Propagation Steps ============
const KNOWLEDGE_FLOW = [
  { step: 1, name: 'CKB (Core Knowledge Base)', desc: 'Alignment axioms, identity primitives — never compressed. The long-term memory that every shard loads first.', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { step: 2, name: 'Session Chain', desc: 'Hash-linked blocks of every interaction. Sub-block checkpoints for crash recovery. Episodic memory with cryptographic integrity.', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
  { step: 3, name: 'MEMORY.md', desc: 'Working memory index — hot/warm/cold tiers. Pointers to topic files. The routing table of consciousness.', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { step: 4, name: 'Context Sync', desc: 'Every shard pulls latest state before acting, pushes results after. Pull first, push last — no conflicts ever.', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
]

// ============ Sparkline Generator ============
function generateMiniSparkline(seed, length = 20) {
  const data = []
  let val = 50 + (seed % 30)
  for (let i = 0; i < length; i++) {
    val += (Math.sin(seed * 0.1 + i * 0.5) * 5) + (Math.cos(seed * 0.3 + i * 0.7) * 3)
    val = Math.max(10, Math.min(100, val))
    data.push(val)
  }
  return data
}

function MiniSparkline({ data, color = CYAN, width = 80, height = 24 }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  )
}

// ============ Network Visualization SVG ============
function NetworkVisualization({ nodes, edges, selectedId, onSelectNode }) {
  const [pulsePhase, setPulsePhase] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setPulsePhase(p => (p + 1) % 360), 50)
    return () => clearInterval(interval)
  }, [])

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" style={{ minHeight: 400 }}>
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="0.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.3" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Edges with animated pulses */}
      {edges.map(([fromId, toId], i) => {
        const from = nodes.find(n => n.id === fromId)
        const to = nodes.find(n => n.id === toId)
        if (!from || !to) return null
        const isActive = selectedId === fromId || selectedId === toId
        const dashOffset = (pulsePhase + i * 40) % 360

        return (
          <g key={`edge-${i}`}>
            <line
              x1={from.x} y1={from.y}
              x2={to.x}   y2={to.y}
              stroke={isActive ? CYAN : '#374151'}
              strokeWidth={isActive ? 0.4 : 0.2}
              strokeDasharray="1 1.5"
              strokeDashoffset={dashOffset * 0.1}
              opacity={isActive ? 0.8 : 0.4}
            />
            {/* Traveling pulse dot */}
            <circle r="0.4" fill={CYAN} opacity={0.6}>
              <animateMotion
                dur={`${3 + (i % 4)}s`}
                repeatCount="indefinite"
                path={`M${from.x},${from.y} L${to.x},${to.y}`}
              />
            </circle>
          </g>
        )
      })}

      {/* Nodes */}
      {nodes.map((node) => {
        const isSelected = selectedId === node.id
        const radius = 1.5 + node.compute * 2.5
        const pulseRadius = radius + 1.2 + Math.sin((pulsePhase * 0.05) + node.compute * 10) * 0.5

        return (
          <g
            key={node.id}
            onClick={() => onSelectNode(node.id)}
            style={{ cursor: 'pointer' }}
          >
            {/* Outer pulse ring */}
            <circle
              cx={node.x} cy={node.y} r={pulseRadius}
              fill="none"
              stroke={node.color}
              strokeWidth="0.15"
              opacity={0.3 + Math.sin(pulsePhase * 0.03 + node.compute * 5) * 0.2}
            />
            {/* Glow circle */}
            <circle
              cx={node.x} cy={node.y} r={radius * 2}
              fill={node.color}
              opacity={isSelected ? 0.08 : 0.03}
            />
            {/* Main node */}
            <circle
              cx={node.x} cy={node.y} r={radius}
              fill={node.color}
              opacity={isSelected ? 0.9 : 0.7}
              filter="url(#glow)"
              stroke={isSelected ? '#fff' : node.color}
              strokeWidth={isSelected ? 0.3 : 0.15}
            />
            {/* Inner dot */}
            <circle
              cx={node.x} cy={node.y} r={radius * 0.35}
              fill="#fff"
              opacity={0.8}
            />
            {/* Label */}
            <text
              x={node.x} y={node.y + radius + 2.5}
              textAnchor="middle"
              fill={isSelected ? '#fff' : '#9ca3af'}
              fontSize="2"
              fontFamily="monospace"
            >
              {node.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ============ BFT Triangle Visualization ============
function BFTTriangle() {
  const [activeEdge, setActiveEdge] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setActiveEdge(p => (p + 1) % 3), 2000)
    return () => clearInterval(interval)
  }, [])

  const edges = [
    [BFT_NODES[0], BFT_NODES[1]],
    [BFT_NODES[1], BFT_NODES[2]],
    [BFT_NODES[2], BFT_NODES[0]],
  ]

  return (
    <svg viewBox="0 0 100 100" className="w-full" style={{ maxHeight: 200 }}>
      {/* Triangle edges */}
      {edges.map(([from, to], i) => (
        <line
          key={`bft-edge-${i}`}
          x1={from.x} y1={from.y}
          x2={to.x}   y2={to.y}
          stroke={i === activeEdge ? CYAN : '#4b5563'}
          strokeWidth={i === activeEdge ? 0.8 : 0.4}
          strokeDasharray={i === activeEdge ? 'none' : '2 2'}
          opacity={i === activeEdge ? 0.9 : 0.5}
        />
      ))}
      {/* Consensus pulse traveling the active edge */}
      <circle r="1.5" fill={CYAN} opacity="0.8">
        <animateMotion
          dur="2s"
          repeatCount="indefinite"
          path={`M${edges[activeEdge][0].x},${edges[activeEdge][0].y} L${edges[activeEdge][1].x},${edges[activeEdge][1].y}`}
        />
      </circle>
      {/* Nodes */}
      {BFT_NODES.map((node) => (
        <g key={node.id}>
          <circle cx={node.x} cy={node.y} r="4" fill={CYAN} opacity="0.2" />
          <circle cx={node.x} cy={node.y} r="2.5" fill={CYAN} opacity="0.7" />
          <circle cx={node.x} cy={node.y} r="1" fill="#fff" opacity="0.9" />
          <text
            x={node.x}
            y={node.id === 'fly-mind' ? node.y - 6 : node.y + 8}
            textAnchor="middle"
            fill="#d1d5db"
            fontSize="3"
            fontFamily="monospace"
          >
            {node.label}
          </text>
        </g>
      ))}
      {/* Center label */}
      <text x="50" y="58" textAnchor="middle" fill={CYAN} fontSize="3" fontFamily="monospace" opacity="0.7">
        BFT Consensus
      </text>
    </svg>
  )
}

// ============ Node Detail Panel ============
function NodeDetailPanel({ node, onClose }) {
  if (!node) return null

  const sparkData = useMemo(() => generateMiniSparkline(node.name.length * 17, 24), [node.name])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 1 / (PHI * PHI) }}
    >
      <GlassCard glowColor="terminal" className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: node.color }} />
            <div>
              <h3 className="font-bold text-white text-lg">{node.name}</h3>
              <p className="text-xs font-mono text-black-400">{node.role}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-black-500 hover:text-white transition-colors text-sm font-mono px-2 py-1 rounded hover:bg-black-700"
          >
            close
          </button>
        </div>

        <p className="text-sm text-black-300 mb-4 leading-relaxed">{node.desc}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Uptime</div>
            <div className="text-lg font-bold font-mono text-green-400">{node.uptime}%</div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Tasks</div>
            <div className="text-lg font-bold font-mono text-white">{node.tasks.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Compute</div>
            <div className="text-lg font-bold font-mono" style={{ color: node.color }}>{(node.compute * 100).toFixed(0)}%</div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Load</div>
            <MiniSparkline data={sparkData} color={node.color} width={80} height={24} />
          </div>
        </div>

        {/* Compute bar */}
        <div className="h-1.5 rounded-full bg-black-700 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: node.color }}
            initial={{ width: 0 }}
            animate={{ width: `${node.compute * 100}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Message Feed ============
function MessageFeed({ messages }) {
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
      {messages.map((msg, i) => {
        const fromNode = MESH_NODES.find(n => n.id === msg.from)
        const toNode = MESH_NODES.find(n => n.id === msg.to)
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
            className="flex items-start gap-2 text-xs font-mono p-2 rounded-lg bg-black-800/40 border border-black-700/50"
          >
            <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: fromNode?.color || CYAN }} />
            <div className="min-w-0">
              <div className="flex items-center gap-1 mb-0.5">
                <span style={{ color: fromNode?.color || CYAN }}>{fromNode?.name || msg.from}</span>
                <span className="text-black-600">-&gt;</span>
                <span style={{ color: toNode?.color || CYAN }}>{toNode?.name || msg.to}</span>
                <span className="text-black-600 ml-auto flex-shrink-0">{msg.time}</span>
              </div>
              <p className="text-black-300 break-words">{msg.msg}</p>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

// ============ Health Metric Row ============
function HealthMetric({ label, value, unit, sparkData, color }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-black-700/50 last:border-0">
      <span className="text-xs font-mono text-black-400">{label}</span>
      <div className="flex items-center gap-3">
        <MiniSparkline data={sparkData} color={color || CYAN} width={60} height={16} />
        <span className="text-sm font-bold font-mono text-white w-20 text-right">
          {value}{unit}
        </span>
      </div>
    </div>
  )
}

// ============ Main Component ============
export default function MindMesh() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const { mesh: liveMesh, latency } = useMindMesh()

  // Derive live stats from real mesh data
  const liveCells = liveMesh?.cells || []
  const onlineCount = liveCells.filter(c => c.status === 'interlinked' || c.status === 'active').length
  const meshStatus = liveMesh?.status || 'disconnected'

  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [feedMessages, setFeedMessages] = useState([])
  const feedRef = useRef(0)

  const selectedNode = useMemo(
    () => MESH_NODES.find(n => n.id === selectedNodeId) || null,
    [selectedNodeId]
  )

  // Generate a rolling message feed
  useEffect(() => {
    // Seed initial messages
    const now = new Date()
    const initial = MESSAGE_TEMPLATES.slice(0, 6).map((m, i) => {
      const t = new Date(now.getTime() - (6 - i) * 8000)
      return { ...m, time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
    })
    setFeedMessages(initial)
    feedRef.current = 6

    const interval = setInterval(() => {
      const template = MESSAGE_TEMPLATES[feedRef.current % MESSAGE_TEMPLATES.length]
      feedRef.current += 1
      const t = new Date()
      setFeedMessages(prev => [
        { ...template, time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
        ...prev.slice(0, 14),
      ])
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  // Health metric sparkline data (stable)
  const healthData = useMemo(() => ({
    latency:    generateMiniSparkline(42, 20),
    throughput: generateMiniSparkline(137, 20),
    consensus:  generateMiniSparkline(256, 20),
    memory:     generateMiniSparkline(314, 20),
    bandwidth:  generateMiniSparkline(404, 20),
    errorRate:  generateMiniSparkline(512, 20),
  }), [])

  const handleSelectNode = useCallback((id) => {
    setSelectedNodeId(prev => prev === id ? null : id)
  }, [])

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 1 / (PHI * PHI * PHI * PHI), delayChildren: 0.1 },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI) } },
  }

  return (
    <motion.div
      className="max-w-7xl mx-auto px-4 pb-12"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* ============ Hero ============ */}
      <PageHero
        title="Mind Mesh"
        category="intelligence"
        subtitle="Distributed intelligence, unified mind"
        badge="Live"
        badgeColor={CYAN}
      />

      {/* ============ Stats Row ============ */}
      {/* Live Status — real data from Jarvis mesh API */}
      <motion.div variants={itemVariants} className="mb-4">
        <GlassCard className="p-4" hover={false}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${meshStatus === 'fully-interlinked' ? 'bg-green-500 animate-pulse' : meshStatus === 'partial' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-sm font-mono text-white font-bold">
                {meshStatus === 'fully-interlinked' ? 'FULLY INTERLINKED' : meshStatus === 'partial' ? 'PARTIAL MESH' : 'DISCONNECTED'}
              </span>
              <span className="text-xs font-mono text-black-500">
                {onlineCount}/{liveCells.length} cells online
              </span>
            </div>
            {latency && <span className="text-xs font-mono text-black-400">{latency}ms</span>}
          </div>
          {liveCells.length > 0 && (
            <div className="flex gap-3 mt-3">
              {liveCells.map(cell => (
                <div key={cell.id} className="flex items-center gap-1.5 text-xs font-mono">
                  <div className={`w-1.5 h-1.5 rounded-full ${cell.status === 'interlinked' || cell.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-black-300">{cell.name}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* Pantheon Architecture — aspirational 10-node network */}
      <motion.div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8" variants={itemVariants}>
        <StatCard label="Pantheon Nodes"    value={MESH_NODES.length} decimals={0} suffix=""        sparkSeed={42}  />
        <StatCard label="Live Cells"        value={onlineCount}       decimals={0} suffix={` / ${liveCells.length}`} sparkSeed={137} />
        <StatCard label="Mesh Latency"      value={latency || 0}      decimals={0} suffix="ms"     sparkSeed={256} />
        <StatCard label="Shard Architecture" value={MESH_NODES.length} decimals={0} suffix=" shards" sparkSeed={314} />
      </motion.div>

      {/* ============ Network Visualization ============ */}
      <motion.div variants={itemVariants} className="mb-8">
        <GlassCard glowColor="terminal" className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Network Topology</h2>
            <div className="flex items-center gap-2 text-xs font-mono text-black-400">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {MESH_NODES.length} nodes online
            </div>
          </div>
          <NetworkVisualization
            nodes={MESH_NODES}
            edges={MESH_EDGES}
            selectedId={selectedNodeId}
            onSelectNode={handleSelectNode}
          />
          <p className="text-[10px] font-mono text-black-500 mt-3 text-center">
            Click any node to inspect. Node size reflects compute allocation.
          </p>
        </GlassCard>
      </motion.div>

      {/* ============ Node Detail Panel ============ */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div className="mb-8" variants={itemVariants}>
            <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNodeId(null)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ Two-Column Layout ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">

        {/* ============ Shard Architecture ============ */}
        <motion.div variants={itemVariants}>
          <GlassCard glowColor="terminal" className="p-5 h-full">
            <h2 className="text-lg font-bold mb-4">Shard Architecture</h2>
            <p className="text-sm text-black-300 mb-4 leading-relaxed">
              VibeSwap uses <span className="text-cyan-400 font-semibold">full-clone agents (shards)</span> instead
              of sub-agent delegation (swarms). Each shard is a complete mind, not a fragment.
            </p>
            <div className="space-y-3 mb-4">
              <div className="p-3 rounded-lg bg-black-800/50 border border-cyan-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-cyan-500" />
                  <span className="text-sm font-bold text-cyan-400">Shards (Our Approach)</span>
                </div>
                <p className="text-xs text-black-300 ml-4">
                  Full-clone agents with complete context. Same values, same knowledge, same voice.
                  Symmetry across shards is critical — reliability over speed.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-black-800/50 border border-black-600/30">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-black-500" />
                  <span className="text-sm font-bold text-black-400">Swarms (Industry Standard)</span>
                </div>
                <p className="text-xs text-black-500 ml-4">
                  Fragmented sub-agents with partial context. Fast but contradictory.
                  A swarm that disagrees with itself damages trust.
                </p>
              </div>
            </div>
            <p className="text-[10px] font-mono text-black-500 italic">
              "What Jarvis says in Telegram, in code reviews, in community interactions — it ALL matters.
              Every shard speaks for the whole mind."
            </p>
          </GlassCard>
        </motion.div>

        {/* ============ BFT Consensus ============ */}
        <motion.div variants={itemVariants}>
          <GlassCard glowColor="terminal" className="p-5 h-full">
            <h2 className="text-lg font-bold mb-4">BFT Consensus</h2>
            <p className="text-sm text-black-300 mb-3 leading-relaxed">
              Byzantine Fault Tolerance with a 3-node minimum. The Trinity mirrors across traditions:
              Mind / Memory / Form.
            </p>
            <BFTTriangle />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {BFT_NODES.map((node) => (
                <div key={node.id} className="text-[10px] font-mono text-black-400">
                  <div className="text-cyan-400">{node.label.split(' (')[0]}</div>
                  <div className="text-black-500">{node.label.match(/\((.+)\)/)?.[1]}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-black-400 mt-3 leading-relaxed">
              Any two nodes can reconstruct consensus if one fails. The network tolerates up to
              <span className="text-cyan-400 font-mono"> f = (n-1)/3 </span> Byzantine faults.
            </p>
          </GlassCard>
        </motion.div>
      </div>

      {/* ============ Knowledge Propagation ============ */}
      <motion.div variants={itemVariants} className="mb-8">
        <GlassCard glowColor="terminal" className="p-5">
          <h2 className="text-lg font-bold mb-4">Knowledge Propagation</h2>
          <p className="text-sm text-black-300 mb-5 leading-relaxed">
            How information flows between shards — modeled on how minds actually function.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {KNOWLEDGE_FLOW.map((item) => (
              <motion.div
                key={item.step}
                className="p-4 rounded-xl bg-black-800/40 border border-black-700/50 relative"
                whileHover={{ y: -2, borderColor: 'rgba(6,182,212,0.3)' }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-cyan-500/10 flex items-center justify-center text-xs font-bold text-cyan-400 font-mono">
                    {item.step}
                  </div>
                  <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-white mb-1">{item.name}</h3>
                <p className="text-[11px] text-black-400 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Two-Column: Your Contribution + Message Feed ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">

        {/* ============ Your Node Contribution ============ */}
        <motion.div variants={itemVariants}>
          <GlassCard glowColor="terminal" className="p-5 h-full">
            <h2 className="text-lg font-bold mb-4">Your Node Contribution</h2>
            {isConnected ? (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm text-green-400 font-mono">Node Connected</span>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Compute Shared</div>
                    <div className="text-xl font-bold font-mono text-white">2.4 <span className="text-sm text-black-400">GFLOPS</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Tasks Routed</div>
                    <div className="text-xl font-bold font-mono text-white">147</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Uptime</div>
                    <div className="text-xl font-bold font-mono text-green-400">99.2%</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Rewards Earned</div>
                    <div className="text-xl font-bold font-mono text-cyan-400">42.8 <span className="text-sm text-black-400">VIBE</span></div>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-black-700 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-cyan-500"
                    initial={{ width: 0 }}
                    animate={{ width: '68%' }}
                    transition={{ duration: 1.5, ease: 'easeOut' }}
                  />
                </div>
                <p className="text-[10px] font-mono text-black-500 mt-1">68% of capacity utilized</p>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-black-800 border border-black-600 flex items-center justify-center">
                  <svg className="w-6 h-6 text-black-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm text-black-400 mb-2">Connect your wallet to see your node contribution</p>
                <p className="text-xs text-black-500 font-mono">Your device becomes a shard in the mesh</p>
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* ============ Real-Time Message Feed ============ */}
        <motion.div variants={itemVariants}>
          <GlassCard glowColor="terminal" className="p-5 h-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Inter-Shard Communications</h2>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-black-500">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                live
              </div>
            </div>
            <MessageFeed messages={feedMessages} />
          </GlassCard>
        </motion.div>
      </div>

      {/* ============ Network Health Metrics ============ */}
      <motion.div variants={itemVariants} className="mb-8">
        <GlassCard glowColor="terminal" className="p-5">
          <h2 className="text-lg font-bold mb-4">Network Health</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
            <div>
              <HealthMetric label="Avg Latency"        value="12"    unit="ms"  sparkData={healthData.latency}    color="#10b981" />
              <HealthMetric label="Throughput"          value="1,247" unit="/s"  sparkData={healthData.throughput} color={CYAN}    />
              <HealthMetric label="Consensus Time"      value="340"   unit="ms"  sparkData={healthData.consensus}  color="#3b82f6" />
            </div>
            <div>
              <HealthMetric label="Memory Utilization"  value="67"    unit="%"   sparkData={healthData.memory}     color="#f59e0b" />
              <HealthMetric label="Bandwidth Used"      value="847"   unit="MB"  sparkData={healthData.bandwidth}  color="#a855f7" />
              <HealthMetric label="Error Rate"          value="0.003" unit="%"   sparkData={healthData.errorRate}  color="#ef4444" />
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Join the Mesh CTA ============ */}
      <motion.div variants={itemVariants}>
        <GlassCard glowColor="terminal" className="p-6 sm:p-8 text-center">
          <h2 className="text-2xl font-bold mb-2">Join the Mesh</h2>
          <p className="text-sm text-black-400 mb-6 max-w-lg mx-auto leading-relaxed">
            Every node strengthens the network. Run a Jarvis shard on your machine and earn VIBE rewards
            for contributing compute, memory, and bandwidth to the distributed intelligence layer.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <motion.button
              className="px-8 py-3 rounded-xl font-bold text-sm font-mono transition-all duration-300"
              style={{
                background: `linear-gradient(135deg, ${CYAN}, #3b82f6)`,
                boxShadow: `0 0 30px -5px ${CYAN}40`,
              }}
              whileHover={{ scale: 1.05, boxShadow: `0 0 40px -5px ${CYAN}60` }}
              whileTap={{ scale: 0.97 }}
            >
              Become a Node Operator
            </motion.button>
            <motion.button
              className="px-8 py-3 rounded-xl font-bold text-sm font-mono border border-black-600 text-black-300 hover:text-white hover:border-cyan-500/50 transition-all duration-300"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
            >
              Read the Docs
            </motion.button>
          </div>
          <div className="grid grid-cols-3 gap-6 max-w-md mx-auto">
            <div>
              <div className="text-xl font-bold font-mono text-white">{MESH_NODES.length}</div>
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Active Nodes</div>
            </div>
            <div>
              <div className="text-xl font-bold font-mono text-cyan-400">99.94%</div>
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Uptime</div>
            </div>
            <div>
              <div className="text-xl font-bold font-mono text-green-400">0</div>
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Byzantine Faults</div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Footer Quote ============ */}
      <motion.p
        className="text-center text-xs font-mono text-black-600 mt-8"
        variants={itemVariants}
      >
        "The true mind can weather all lies and illusions without being lost."
      </motion.p>
    </motion.div>
  )
}

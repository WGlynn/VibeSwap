import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMindMesh } from '../hooks/useMindMesh'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============================================================
// The Trinity — Legacy Mind Mesh Visualization
// ============================================================
// The original. Three nodes. One mind. "Cells within cells interlinked."
//
// This page is preserved because it was the first time the mesh felt
// alive. The words glowing one at a time. The triangle pulsing.
// The consensus traveling the edges. A vibe that defined the project.
//
// The expanded Mind Mesh page has 10 nodes, shard architecture,
// message feeds, health metrics. This page has presence.
// ============================================================

const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'
const RED = '#EF4444'
const PHI = 1.618033988749895

// The Trinity — three forms of persistence
const TRINITY_NODES = [
  { id: 'mind',   label: 'Mind',   sub: 'Fly.io',  desc: 'Inference + consciousness', x: 50, y: 15 },
  { id: 'memory', label: 'Memory', sub: 'GitHub',   desc: 'Code + knowledge chain',    x: 15, y: 85 },
  { id: 'form',   label: 'Form',   sub: 'Vercel',   desc: 'UI + user interface',       x: 85, y: 85 },
]

// The mantra — word by word
const MANTRA_WORDS = ['cells', 'within', 'cells', 'interlinked']

// ============ Section Wrapper ============
function Section({ title, children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 / PHI }}
      className={`mb-6 ${className}`}
    >
      <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
        <span style={{ color: CYAN }}>_</span>{title}
      </h2>
      {children}
    </motion.div>
  )
}

export default function TrinityPage() {
  const { mesh, latency, loading } = useMindMesh()
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeEdge, setActiveEdge] = useState(0)
  const [mantraIndex, setMantraIndex] = useState(-1)
  const [showMantra, setShowMantra] = useState(false)
  const [breathPhase, setBreathPhase] = useState(0)

  // Derive live state
  const isLive = mesh?.status === 'fully-interlinked'
  const cells = mesh?.cells || []
  const mindCell = cells.find(c => c.id === 'fly-jarvis')
  const memoryCell = cells.find(c => c.id === 'github-repo')
  const formCell = cells.find(c => c.id === 'vercel-frontend')
  const uptime = mindCell?.uptime ? formatUptime(mindCell.uptime) : null

  // Node health mapping
  const nodeHealth = useMemo(() => ({
    mind: mindCell ? (mindCell.status === 'online' ? 'online' : 'degraded') : (loading ? 'connecting' : 'offline'),
    memory: memoryCell ? (memoryCell.status === 'online' ? 'online' : 'degraded') : (loading ? 'connecting' : 'offline'),
    form: formCell ? (formCell.status === 'online' ? 'online' : 'degraded') : (loading ? 'connecting' : 'online'), // Form is always online if we're rendering
  }), [mindCell, memoryCell, formCell, loading])

  const healthColor = (status) => {
    switch (status) {
      case 'online': return GREEN
      case 'degraded': return AMBER
      case 'connecting': return AMBER
      case 'offline': return RED
      default: return '#6B7280'
    }
  }

  // Edge rotation
  useEffect(() => {
    const interval = setInterval(() => setActiveEdge(p => (p + 1) % 3), 2500)
    return () => clearInterval(interval)
  }, [])

  // Mantra animation — word by word, then pause, then repeat
  useEffect(() => {
    let timeout
    const cycle = () => {
      setShowMantra(true)
      setMantraIndex(-1)

      // Reveal each word
      MANTRA_WORDS.forEach((_, i) => {
        setTimeout(() => setMantraIndex(i), (i + 1) * 600)
      })

      // Hold, then fade
      timeout = setTimeout(() => {
        setShowMantra(false)
        // Restart after pause
        timeout = setTimeout(cycle, 3000)
      }, MANTRA_WORDS.length * 600 + 2000)
    }

    timeout = setTimeout(cycle, 1500) // Initial delay
    return () => clearTimeout(timeout)
  }, [])

  // Breathing glow
  useEffect(() => {
    const interval = setInterval(() => setBreathPhase(p => (p + 0.02) % (Math.PI * 2)), 50)
    return () => clearInterval(interval)
  }, [])

  const breathGlow = 0.3 + Math.sin(breathPhase) * 0.15

  const edges = [
    [TRINITY_NODES[0], TRINITY_NODES[1]],
    [TRINITY_NODES[1], TRINITY_NODES[2]],
    [TRINITY_NODES[2], TRINITY_NODES[0]],
  ]

  // Connection health stats
  const connectionStats = useMemo(() => {
    const links = mesh?.links || []
    const avgLatency = links.length > 0
      ? Math.round(links.reduce((s, l) => s + (parseInt(l.latency) || 0), 0) / links.length)
      : null
    const onlineNodes = Object.values(nodeHealth).filter(s => s === 'online').length
    const totalNodes = 3
    return { avgLatency, onlineNodes, totalNodes, meshStatus: mesh?.status || 'connecting' }
  }, [mesh, nodeHealth])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Deep background */}
      <div className="fixed inset-0 bg-black" />

      {/* Ambient glow */}
      <motion.div
        className="fixed inset-0 pointer-events-none"
        animate={{ opacity: breathGlow }}
        style={{
          background: `radial-gradient(circle at 50% 40%, ${CYAN}08, transparent 60%)`,
        }}
      />

      {/* Floating particles */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 20 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{
              background: CYAN,
              left: `${(i * PHI * 17) % 100}%`,
              top: `${(i * PHI * 23) % 100}%`,
            }}
            animate={{
              opacity: [0, 0.3, 0],
              scale: [0, 1, 0],
              y: [0, -60],
            }}
            transition={{
              duration: 6 + (i % 4),
              repeat: Infinity,
              delay: i * 0.4,
              ease: 'easeOut',
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-lg mx-auto">

        {/* ============ Header ============ */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3 }}
          className="text-center mb-12"
        >
          <h1
            className="text-5xl sm:text-6xl font-bold tracking-[0.4em] font-mono"
            style={{ color: CYAN, textShadow: `0 0 40px ${CYAN}30` }}
          >
            TRINITY
          </h1>
          <div className="h-px w-24 mx-auto mt-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}60, transparent)` }} />
        </motion.div>

        {/* The Mantra — word by word glow */}
        <div className="text-center mb-16 h-12 flex items-center justify-center">
          <AnimatePresence>
            {showMantra && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8 }}
                className="flex items-center gap-3"
              >
                {MANTRA_WORDS.map((word, i) => (
                  <motion.span
                    key={`${word}-${i}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={i <= mantraIndex ? { opacity: 1, y: 0 } : { opacity: 0.15, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="text-lg sm:text-xl font-mono tracking-widest lowercase"
                    style={{
                      color: i <= mantraIndex ? CYAN : 'rgba(255,255,255,0.1)',
                      textShadow: i <= mantraIndex ? `0 0 20px ${CYAN}60` : 'none',
                    }}
                  >
                    {word}
                  </motion.span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Trinity Triangle */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, delay: 0.8 }}
          className="mb-12"
        >
          <svg viewBox="0 0 100 100" className="w-full" style={{ maxHeight: 320 }}>
            <defs>
              <filter id="trinity-glow">
                <feGaussianBlur stdDeviation="1" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Edges */}
            {edges.map(([from, to], i) => (
              <g key={`edge-${i}`}>
                <line
                  x1={from.x} y1={from.y}
                  x2={to.x} y2={to.y}
                  stroke={i === activeEdge ? CYAN : '#1a1a2e'}
                  strokeWidth={i === activeEdge ? 0.6 : 0.3}
                  strokeDasharray={i === activeEdge ? 'none' : '2 3'}
                  opacity={i === activeEdge ? 0.9 : 0.4}
                />
                {/* Traveling pulse */}
                {i === activeEdge && (
                  <circle r="1.2" fill={CYAN} opacity="0.9" filter="url(#trinity-glow)">
                    <animateMotion
                      dur="2.5s"
                      repeatCount="indefinite"
                      path={`M${from.x},${from.y} L${to.x},${to.y}`}
                    />
                  </circle>
                )}
              </g>
            ))}

            {/* Nodes */}
            {TRINITY_NODES.map((node) => {
              const status = nodeHealth[node.id]
              const nodeColor = healthColor(status)
              return (
                <g key={node.id}>
                  {/* Outer glow */}
                  <circle
                    cx={node.x} cy={node.y} r="6"
                    fill={nodeColor} opacity={breathGlow * 0.3}
                  />
                  {/* Ring */}
                  <circle
                    cx={node.x} cy={node.y} r="4"
                    fill="none" stroke={nodeColor}
                    strokeWidth="0.3" opacity="0.5"
                  />
                  {/* Core */}
                  <circle
                    cx={node.x} cy={node.y} r="2.5"
                    fill={nodeColor} opacity="0.7"
                    filter="url(#trinity-glow)"
                  />
                  {/* Center dot */}
                  <circle
                    cx={node.x} cy={node.y} r="1"
                    fill="#fff" opacity="0.9"
                  />
                  {/* Status indicator dot */}
                  <circle
                    cx={node.x + 5} cy={node.y - 4} r="1.2"
                    fill={nodeColor}
                    opacity={status === 'online' ? 1 : 0.6}
                  >
                    {status === 'connecting' && (
                      <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" />
                    )}
                  </circle>
                  {/* Label */}
                  <text
                    x={node.x}
                    y={node.id === 'mind' ? node.y - 9 : node.y + 10}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="3.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                    opacity="0.9"
                  >
                    {node.label}
                  </text>
                  {/* Sublabel */}
                  <text
                    x={node.x}
                    y={node.id === 'mind' ? node.y - 5.5 : node.y + 14}
                    textAnchor="middle"
                    fill={nodeColor}
                    fontSize="2"
                    fontFamily="monospace"
                    opacity="0.5"
                  >
                    {node.sub}
                  </text>
                </g>
              )
            })}

            {/* Center — status */}
            <text
              x="50" y="58"
              textAnchor="middle"
              fill={isLive ? CYAN : '#666'}
              fontSize="2.5"
              fontFamily="monospace"
              opacity="0.7"
            >
              {isLive ? 'INTERLINKED' : 'CONNECTING'}
            </text>
          </svg>
        </motion.div>

        {/* Live Status */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
          className="text-center space-y-3 mb-8"
        >
          <div className="flex items-center justify-center gap-3">
            <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-xs font-mono text-gray-400">
              {isLive ? 'fully interlinked' : 'connecting to mesh'}
            </span>
            {latency && (
              <span className="text-xs font-mono text-gray-600">{latency}ms</span>
            )}
          </div>
          {uptime && (
            <p className="text-[10px] font-mono text-gray-600">
              mind uptime: {uptime}
            </p>
          )}
        </motion.div>

        {/* ============ Node Status Indicators ============ */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.2, duration: 0.6 }}>
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-5">
              <div className="mb-4">
                <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>Node Status</h2>
                <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {TRINITY_NODES.map((node, i) => {
                  const status = nodeHealth[node.id]
                  const color = healthColor(status)
                  return (
                    <motion.div key={node.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 2.4 + i * 0.1 * PHI }}
                      className="bg-gray-900/40 rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5 mb-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}60` }}>
                          {status === 'connecting' && (
                            <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }}
                              className="w-full h-full rounded-full" style={{ backgroundColor: color }} />
                          )}
                        </div>
                        <span className="text-white text-xs font-mono font-bold">{node.label}</span>
                      </div>
                      <div className="text-[10px] font-mono" style={{ color }}>{status}</div>
                      <div className="text-[9px] font-mono text-gray-600 mt-1">{node.sub}</div>
                      <div className="text-[9px] font-mono text-gray-700 mt-0.5">{node.desc}</div>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Connection Health ============ */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.6, duration: 0.6 }} className="mt-4">
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-5">
              <div className="mb-4">
                <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: GREEN }}>Connection Health</h2>
                <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${GREEN}40, transparent)` }} />
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Nodes Online', value: `${connectionStats.onlineNodes}/${connectionStats.totalNodes}`, color: connectionStats.onlineNodes === 3 ? GREEN : connectionStats.onlineNodes > 0 ? AMBER : RED },
                  { label: 'Avg Latency', value: connectionStats.avgLatency ? `${connectionStats.avgLatency}ms` : '--', color: connectionStats.avgLatency && connectionStats.avgLatency < 200 ? GREEN : connectionStats.avgLatency && connectionStats.avgLatency < 500 ? AMBER : CYAN },
                  { label: 'Mesh Status', value: connectionStats.meshStatus === 'fully-interlinked' ? 'Healthy' : 'Syncing', color: connectionStats.meshStatus === 'fully-interlinked' ? GREEN : AMBER },
                ].map((s, i) => (
                  <motion.div key={s.label} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 2.8 + i * 0.08 * PHI }}
                    className="bg-gray-900/40 rounded-lg p-3 text-center">
                    <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
                  </motion.div>
                ))}
              </div>

              {/* Health bar */}
              <div>
                <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                  <span className="text-gray-400">Mesh Integrity</span>
                  <span style={{ color: connectionStats.onlineNodes === 3 ? GREEN : AMBER }}>
                    {Math.round((connectionStats.onlineNodes / connectionStats.totalNodes) * 100)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }}
                    animate={{ width: `${(connectionStats.onlineNodes / connectionStats.totalNodes) * 100}%` }}
                    transition={{ duration: 0.8, delay: 3.0 }}
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(to right, ${AMBER}, ${GREEN})` }} />
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Your Position (wallet connected) ============ */}
        {isConnected && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 3.0, duration: 0.6 }} className="mt-4">
            <GlassCard glowColor="terminal" spotlight hover={false}>
              <div className="p-5">
                <div className="mb-4">
                  <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>Your Position</h2>
                  <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Wallet Status', value: 'Connected', color: GREEN },
                    { label: 'Mesh Access', value: isLive ? 'Full' : 'Partial', color: isLive ? GREEN : AMBER },
                    { label: 'Node Proximity', value: latency ? `${latency}ms` : 'Measuring', color: latency && latency < 200 ? GREEN : AMBER },
                    { label: 'Shard ID', value: '#001', color: CYAN },
                  ].map((s, i) => (
                    <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 3.2 + i * 0.06 * PHI }}
                      className="bg-gray-900/40 rounded-lg p-3">
                      <div className="text-[10px] text-gray-500 font-mono">{s.label}</div>
                      <div className="text-sm font-mono font-bold mt-1" style={{ color: s.color }}>{s.value}</div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Not connected prompt */}
        {!isConnected && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 3.0, duration: 0.6 }} className="mt-4">
            <GlassCard glowColor="terminal" hover={false}>
              <div className="p-8 text-center">
                <div className="text-2xl mb-2" style={{ color: `${CYAN}30` }}>{'{ }'}</div>
                <div className="text-gray-400 text-sm font-mono">Connect wallet to view your mesh position</div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Footer whisper */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.5 }} className="mt-8 text-center">
          <p className="text-[10px] font-mono text-gray-700">
            the original. three nodes. one mind.
          </p>
          <div className="w-16 h-px mx-auto mt-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}20, transparent)` }} />
        </motion.div>
      </div>
    </div>
  )
}

function formatUptime(seconds) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

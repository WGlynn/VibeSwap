import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMindMesh } from '../hooks/useMindMesh'

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
const PHI = 1.618033988749895

// The Trinity — three forms of persistence
const TRINITY_NODES = [
  { id: 'mind',   label: 'Mind',   sub: 'Fly.io',  desc: 'Inference + consciousness', x: 50, y: 15 },
  { id: 'memory', label: 'Memory', sub: 'GitHub',   desc: 'Code + knowledge chain',    x: 15, y: 85 },
  { id: 'form',   label: 'Form',   sub: 'Vercel',   desc: 'UI + user interface',       x: 85, y: 85 },
]

// The mantra — word by word
const MANTRA_WORDS = ['cells', 'within', 'cells', 'interlinked']

export default function TrinityPage() {
  const { mesh, latency } = useMindMesh()
  const [activeEdge, setActiveEdge] = useState(0)
  const [mantraIndex, setMantraIndex] = useState(-1)
  const [showMantra, setShowMantra] = useState(false)
  const [breathPhase, setBreathPhase] = useState(0)

  // Derive live state
  const isLive = mesh?.status === 'fully-interlinked'
  const cells = mesh?.cells || []
  const mindCell = cells.find(c => c.id === 'fly-jarvis')
  const uptime = mindCell?.uptime ? formatUptime(mindCell.uptime) : null

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

        {/* Title */}
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
            {TRINITY_NODES.map((node) => (
              <g key={node.id}>
                {/* Outer glow */}
                <circle
                  cx={node.x} cy={node.y} r="6"
                  fill={CYAN} opacity={breathGlow * 0.3}
                />
                {/* Ring */}
                <circle
                  cx={node.x} cy={node.y} r="4"
                  fill="none" stroke={CYAN}
                  strokeWidth="0.3" opacity="0.5"
                />
                {/* Core */}
                <circle
                  cx={node.x} cy={node.y} r="2.5"
                  fill={CYAN} opacity="0.7"
                  filter="url(#trinity-glow)"
                />
                {/* Center dot */}
                <circle
                  cx={node.x} cy={node.y} r="1"
                  fill="#fff" opacity="0.9"
                />
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
                  fill={CYAN}
                  fontSize="2"
                  fontFamily="monospace"
                  opacity="0.5"
                >
                  {node.sub}
                </text>
              </g>
            ))}

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
          className="text-center space-y-3"
        >
          <div className="flex items-center justify-center gap-3">
            <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-xs font-mono text-black-400">
              {isLive ? 'fully interlinked' : 'connecting to mesh'}
            </span>
            {latency && (
              <span className="text-xs font-mono text-black-600">{latency}ms</span>
            )}
          </div>
          {uptime && (
            <p className="text-[10px] font-mono text-black-600">
              mind uptime: {uptime}
            </p>
          )}
          <p className="text-[10px] font-mono text-black-700 mt-6">
            the original. three nodes. one mind.
          </p>
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

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'
const PURPLE = '#a855f7'
const BLUE = '#3b82f6'
const RED = '#EF4444'
const BOT_URL = 'https://jarvis-vibeswap.fly.dev'

const ease = [0.25, 0.1, 0.25, 1]
const fadeIn = { hidden: { opacity: 0, y: 20 }, visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5, ease } }) }

// ============ Shard Quality Score ============
function QualityBadge({ score }) {
  const pct = Math.round((score || 0) * 100)
  const color = pct >= 80 ? GREEN : pct >= 50 ? AMBER : RED
  return (
    <span
      className="text-[10px] font-mono px-1.5 py-0.5 rounded"
      style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}
    >
      Q:{pct}
    </span>
  )
}

// ============ Consensus Network SVG ============
function ConsensusVisualization({ shardCount = 3, phase = 0, running = false }) {
  const cx = 140, cy = 100, r = 65
  const shards = Array.from({ length: shardCount }, (_, i) => {
    const angle = (2 * Math.PI * i) / shardCount - Math.PI / 2
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), id: `Shard ${i + 1}` }
  })

  const phaseColors = [BLUE, PURPLE, AMBER, GREEN]
  const phaseLabels = ['COMMIT', 'REVEAL', 'VOTE', 'RANK']
  const activeColor = phaseColors[phase] || CYAN

  return (
    <svg viewBox="0 0 280 200" className="w-full max-w-[400px] mx-auto">
      <defs>
        <filter id="crpc-glow">
          <feGaussianBlur stdDeviation="3" result="g" />
          <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="crpc-glow-lg">
          <feGaussianBlur stdDeviation="6" result="g" />
          <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Connection lines between shards */}
      {shards.map((s, i) =>
        shards.slice(i + 1).map((t, j) => (
          <motion.line
            key={`${i}-${j}`}
            x1={s.x} y1={s.y} x2={t.x} y2={t.y}
            stroke={running ? activeColor : '#333'}
            strokeWidth={running ? 1.5 : 0.5}
            opacity={running ? 0.4 : 0.15}
            strokeDasharray={running ? '4 4' : 'none'}
            animate={running ? { strokeDashoffset: [0, -16] } : {}}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          />
        ))
      )}

      {/* Center hub */}
      <motion.circle
        cx={cx} cy={cy} r={running ? 18 : 14}
        fill="none"
        stroke={running ? activeColor : '#444'}
        strokeWidth={running ? 2 : 1}
        opacity={running ? 0.6 : 0.3}
        filter={running ? 'url(#crpc-glow)' : undefined}
        animate={running ? { r: [16, 20, 16] } : {}}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <text
        x={cx} y={cy - 4}
        textAnchor="middle" fill={running ? activeColor : '#666'}
        fontSize="8" fontFamily="monospace" fontWeight="bold"
      >
        {running ? phaseLabels[phase] : 'CRPC'}
      </text>
      <text
        x={cx} y={cy + 8}
        textAnchor="middle" fill="#555"
        fontSize="6" fontFamily="monospace"
      >
        CONSENSUS
      </text>

      {/* Shard nodes */}
      {shards.map((s, i) => (
        <g key={i}>
          {/* Pulse ring when running */}
          {running && (
            <motion.circle
              cx={s.x} cy={s.y} r={12}
              fill="none" stroke={activeColor} strokeWidth={1}
              initial={{ r: 12, opacity: 0.6 }}
              animate={{ r: [12, 22], opacity: [0.6, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.3 }}
            />
          )}
          {/* Node circle */}
          <circle
            cx={s.x} cy={s.y} r={12}
            fill={running ? `${activeColor}20` : '#1a1a1a'}
            stroke={running ? activeColor : '#444'}
            strokeWidth={running ? 1.5 : 1}
            filter={running ? 'url(#crpc-glow)' : undefined}
          />
          {/* Shard number */}
          <text
            x={s.x} y={s.y + 1}
            textAnchor="middle" dominantBaseline="middle"
            fill={running ? activeColor : '#888'}
            fontSize="9" fontFamily="monospace" fontWeight="bold"
          >
            {i + 1}
          </text>
          {/* Label */}
          <text
            x={s.x} y={s.y + 24}
            textAnchor="middle" fill="#555"
            fontSize="7" fontFamily="monospace"
          >
            {s.id}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ============ Phase Display ============
function PhaseCard({ phase, index }) {
  if (!phase) return null
  const colors = [BLUE, PURPLE, AMBER, GREEN]
  const color = colors[index] || CYAN

  return (
    <motion.div custom={index} variants={fadeIn} initial="hidden" animate="visible">
      <GlassCard className="p-4 mb-3" glowColor={index === 3 ? 'matrix' : 'none'}>
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
          >
            {index + 1}
          </div>
          <span className="font-bold text-sm uppercase tracking-wider" style={{ color }}>
            {phase.name}
          </span>
          <span className="text-xs text-gray-500 ml-auto font-mono">{phase.durationMs}ms</span>
        </div>
        <p className="text-xs text-gray-400 mb-3">{phase.description}</p>

        {phase.commits && (
          <div className="space-y-1.5">
            {phase.commits.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono bg-black/20 rounded px-2 py-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: BLUE }} />
                <span className="text-gray-400 w-16 truncate">{c.shardId}</span>
                <span className="text-cyan-400 truncate flex-1">{c.commitHash?.slice(0, 20)}...</span>
                {c.qualityScore != null && <QualityBadge score={c.qualityScore} />}
              </div>
            ))}
          </div>
        )}

        {phase.reveals && (
          <div className="space-y-2">
            {phase.reveals.map((r, i) => (
              <div key={i} className="bg-black/20 rounded-lg p-2.5">
                <div className="flex items-center gap-2 text-xs mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: r.hashVerified ? GREEN : RED }} />
                  <span className="font-mono text-gray-400">{r.shardId}</span>
                  <span className={r.hashVerified ? 'text-green-400' : 'text-red-400'} style={{ color: r.hashVerified ? GREEN : RED }}>
                    {r.hashVerified ? 'VERIFIED' : 'INVALID'}
                  </span>
                  {r.qualityScore != null && <QualityBadge score={r.qualityScore} />}
                </div>
                <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed">{r.response?.slice(0, 150)}...</p>
              </div>
            ))}
          </div>
        )}

        {phase.pairwiseResults && (
          <div className="space-y-1.5">
            {phase.pairwiseResults.map((pr, i) => (
              <div key={i} className="flex items-center gap-3 text-xs font-mono bg-black/20 rounded px-2 py-1.5">
                <span className="text-gray-500 w-20 truncate">{pr.pairId}</span>
                <span style={{ color: BLUE }}>A:{pr.votes?.A_BETTER || 0}</span>
                <span style={{ color: PURPLE }}>B:{pr.votes?.B_BETTER || 0}</span>
                <span className="text-gray-500">EQ:{pr.votes?.EQUIVALENT || 0}</span>
                <span className="ml-auto font-bold" style={{ color: GREEN }}>
                  {pr.winner}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Rankings ============
function Rankings({ rankings, confidence }) {
  if (!rankings?.length) return null
  const medals = ['1st', '2nd', '3rd']
  const medalColors = [GREEN, AMBER, '#666']

  return (
    <motion.div custom={5} variants={fadeIn} initial="hidden" animate="visible">
      <GlassCard className="p-4 mb-4" glowColor="matrix">
        <div className="flex items-center justify-between mb-3">
          <span className="font-bold text-sm uppercase tracking-wider" style={{ color: GREEN }}>
            <span style={{ color: CYAN }}>_</span>Final Rankings
          </span>
          <span className="text-xs px-2 py-1 rounded-full font-mono" style={{ background: `${GREEN}15`, color: GREEN, border: `1px solid ${GREEN}30` }}>
            {(confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
        <div className="space-y-2">
          {rankings.map((r, i) => (
            <div key={i} className="flex items-center gap-3">
              <span
                className="text-xs font-mono font-bold w-8 text-center"
                style={{ color: medalColors[i] || '#555' }}
              >
                {medals[i] || `${i + 1}th`}
              </span>
              <span className="font-mono text-sm text-gray-300 w-24 truncate">{r.shardId}</span>
              <div className="flex-1 h-2.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: i === 0 ? GREEN : i === 1 ? AMBER : '#555' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(10, (r.pairwiseWins / Math.max(1, rankings[0].pairwiseWins)) * 100)}%` }}
                  transition={{ duration: 0.6, delay: 0.1 * i }}
                />
              </div>
              <span className="text-xs text-gray-500 w-16 text-right font-mono">{r.pairwiseWins}W</span>
              {r.qualityScore != null && <QualityBadge score={r.qualityScore} />}
            </div>
          ))}
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Protocol Stats ============
function ProtocolStats({ isConnected }) {
  const stats = [
    { label: 'Total Rounds', value: '1,247', color: CYAN },
    { label: 'Avg Consensus', value: '94.2%', color: GREEN },
    { label: 'Active Shards', value: '3', color: PURPLE },
    { label: 'Invalid Reveals', value: '0.3%', color: AMBER },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {stats.map((s, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 * i, duration: 0.4 / PHI }}
        >
          <GlassCard className="p-3 text-center">
            <div className="text-lg font-mono font-bold" style={{ color: isConnected ? s.color : '#555' }}>
              {isConnected ? s.value : '--'}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{s.label}</div>
          </GlassCard>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Running Phase Indicator ============
function PhaseProgress({ running, phase }) {
  const phases = ['Commit', 'Reveal', 'Vote', 'Rank']
  const colors = [BLUE, PURPLE, AMBER, GREEN]

  if (!running) return null

  return (
    <div className="flex items-center gap-1 mb-4">
      {phases.map((p, i) => (
        <div key={i} className="flex items-center flex-1">
          <div className="flex-1 relative">
            <div className="h-1 rounded-full bg-white/5">
              <motion.div
                className="h-full rounded-full"
                style={{ background: colors[i] }}
                initial={{ width: '0%' }}
                animate={{ width: i < phase ? '100%' : i === phase ? '50%' : '0%' }}
                transition={{ duration: 0.4 }}
              />
            </div>
            <div className="text-[9px] text-gray-500 mt-1 text-center font-mono">{p}</div>
          </div>
          {i < phases.length - 1 && <div className="w-1" />}
        </div>
      ))}
    </div>
  )
}

// ============ Main Page ============
export default function CRPCPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [activePhase, setActivePhase] = useState(0)

  // Animate through phases while running
  useEffect(() => {
    if (!running) { setActivePhase(0); return }
    const timer = setInterval(() => {
      setActivePhase(prev => prev < 3 ? prev + 1 : prev)
    }, 1200)
    return () => clearInterval(timer)
  }, [running])

  const runDemo = useCallback(async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    setActivePhase(0)

    try {
      const opts = prompt.trim()
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt.trim() }) }
        : {}
      const resp = await fetch(`${BOT_URL}/crpc/demo`, opts)
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }, [prompt])

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold" style={{ color: CYAN }}>
            <span style={{ color: CYAN }}>_</span>CRPC Consensus
          </h1>
          {isConnected && (
            <span className="text-xs px-2 py-1 rounded-full font-mono" style={{ background: `${GREEN}15`, color: GREEN, border: `1px solid ${GREEN}30` }}>
              Connected
            </span>
          )}
        </div>
        <p className="text-gray-400 text-sm mb-1">
          Commit-Reveal Pairwise Comparison -- Live on JARVIS Mind Network
        </p>
        <p className="text-gray-500 text-xs mb-6">
          Multiple AI shards independently generate responses, then consensus-rank them through
          cryptographic commit-reveal and pairwise voting. No shard can copy another.
        </p>
      </motion.div>

      {/* Protocol Stats */}
      <ProtocolStats isConnected={isConnected} />

      {/* Consensus Visualization */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
        <GlassCard className="p-4 mb-6" glowColor={running ? 'terminal' : 'none'}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-mono">Shard Network</span>
            {running && (
              <motion.span
                className="text-xs font-mono"
                style={{ color: [BLUE, PURPLE, AMBER, GREEN][activePhase] }}
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                Phase {activePhase + 1}/4
              </motion.span>
            )}
          </div>
          <ConsensusVisualization shardCount={3} phase={activePhase} running={running} />
          <PhaseProgress running={running} phase={activePhase} />
        </GlassCard>
      </motion.div>

      {/* Protocol Overview */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
        <GlassCard className="p-4 mb-6">
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              { label: 'Work Commit', desc: 'Shards hash responses independently', color: BLUE },
              { label: 'Work Reveal', desc: 'Verify hashes & expose answers', color: PURPLE },
              { label: 'Vote Commit', desc: 'Pairwise quality comparison', color: AMBER },
              { label: 'Vote Reveal', desc: 'Tally votes & rank shards', color: GREEN },
            ].map((p, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: `${p.color}15`, color: p.color, border: `1px solid ${p.color}30` }}
                >
                  {i + 1}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: p.color }}>{p.label}</span>
                <span className="text-[9px] text-gray-500 leading-tight">{p.desc}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* Demo Controls */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <GlassCard className="p-4 mb-6" glowColor="terminal">
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block font-mono">
            <span style={{ color: CYAN }}>_</span>Live Demo
          </label>
          <input
            type="text"
            placeholder="Custom prompt (or leave empty for default)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !running && runDemo()}
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none mb-3"
          />
          <button
            onClick={runDemo}
            disabled={running}
            className="w-full py-2.5 rounded-lg font-bold text-sm transition-all duration-200"
            style={{
              background: running ? '#222' : `${CYAN}`,
              color: running ? '#555' : '#000',
              cursor: running ? 'wait' : 'pointer',
              border: `1px solid ${running ? '#333' : CYAN}`,
            }}
          >
            {running ? 'Running CRPC round -- 3 shards generating...' : 'Run CRPC Demo'}
          </button>
          {!isConnected && (
            <p className="text-[10px] text-gray-600 mt-2 text-center">
              Sign in to see protocol stats and submit on-chain prompts
            </p>
          )}
        </GlassCard>
      </motion.div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <GlassCard className="p-4 mb-4" style={{ borderColor: `${RED}30` }}>
              <p className="text-sm font-mono" style={{ color: RED }}>Error: {error}</p>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500 uppercase tracking-wider font-mono">Protocol Trace</span>
              <span className="text-xs font-mono" style={{ color: CYAN }}>{result.totalDurationMs}ms total</span>
            </div>

            {result.phases?.map((phase, i) => (
              <PhaseCard key={i} phase={phase} index={i} />
            ))}

            <Rankings rankings={result.rankings} confidence={result.confidence} />

            {/* Consensus Response */}
            <motion.div custom={6} variants={fadeIn} initial="hidden" animate="visible">
              <GlassCard className="p-4" glowColor="matrix">
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ background: `${GREEN}15`, border: `1px solid ${GREEN}30` }}
                  >
                    <span className="text-xs" style={{ color: GREEN }}>W</span>
                  </div>
                  <span className="font-bold text-sm" style={{ color: GREEN }}>Consensus Response</span>
                  <span className="text-xs text-gray-500 ml-auto font-mono">Winner: {result.consensusWinner}</span>
                </div>
                <div className="bg-black/20 rounded-lg p-3">
                  <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{result.consensusResponse}</p>
                </div>
              </GlassCard>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attribution */}
      <div className="mt-8 text-center text-xs text-gray-600 font-mono">
        CRPC protocol by <span style={{ color: CYAN }}>Tim Cotton</span> -- adapted for AI shard consensus by VibeSwap
      </div>
    </div>
  )
}

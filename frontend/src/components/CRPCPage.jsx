import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'

const CYAN = '#06b6d4'
const GREEN = '#22c55e'
const YELLOW = '#f59e0b'
const PURPLE = '#a855f7'
const BLUE = '#3b82f6'
const BOT_URL = 'https://jarvis-vibeswap.fly.dev'

const ease = [0.25, 0.1, 0.25, 1]
const fadeIn = { hidden: { opacity: 0, y: 20 }, visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5, ease } }) }

// ============ Phase Display ============

function PhaseCard({ phase, index }) {
  if (!phase) return null
  const colors = [BLUE, PURPLE, YELLOW, GREEN]
  const icons = ['🔒', '🔓', '⚖️', '🏆']
  const color = colors[index] || CYAN

  return (
    <motion.div custom={index} variants={fadeIn} initial="hidden" animate="visible">
      <GlassCard className="p-4 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{icons[index]}</span>
          <span className="font-bold text-sm uppercase tracking-wider" style={{ color }}>
            Phase {phase.phase}: {phase.name}
          </span>
          <span className="text-xs text-gray-500 ml-auto">{phase.durationMs}ms</span>
        </div>
        <p className="text-xs text-gray-400 mb-2">{phase.description}</p>

        {phase.commits && (
          <div className="space-y-1">
            {phase.commits.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <span className="text-gray-500">{c.shardId}</span>
                <span className="text-cyan-400 truncate">{c.commitHash?.slice(0, 24)}...</span>
              </div>
            ))}
          </div>
        )}

        {phase.reveals && (
          <div className="space-y-2">
            {phase.reveals.map((r, i) => (
              <div key={i} className="bg-black/20 rounded p-2">
                <div className="flex items-center gap-2 text-xs mb-1">
                  <span className="font-mono text-gray-500">{r.shardId}</span>
                  <span className={r.hashVerified ? 'text-green-400' : 'text-red-400'}>
                    {r.hashVerified ? '✓ verified' : '✗ invalid'}
                  </span>
                </div>
                <p className="text-xs text-gray-300 line-clamp-2">{r.response?.slice(0, 150)}...</p>
              </div>
            ))}
          </div>
        )}

        {phase.pairwiseResults && (
          <div className="space-y-1">
            {phase.pairwiseResults.map((pr, i) => (
              <div key={i} className="flex items-center gap-3 text-xs font-mono">
                <span className="text-gray-500 w-20 truncate">{pr.pairId}</span>
                <span className="text-blue-400">A:{pr.votes?.A_BETTER || 0}</span>
                <span className="text-purple-400">B:{pr.votes?.B_BETTER || 0}</span>
                <span className="text-gray-400">EQ:{pr.votes?.EQUIVALENT || 0}</span>
                <span className="ml-auto font-bold" style={{ color: GREEN }}>→ {pr.winner}</span>
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
  const medals = ['🥇', '🥈', '🥉']

  return (
    <motion.div custom={5} variants={fadeIn} initial="hidden" animate="visible">
      <GlassCard className="p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-bold text-sm uppercase tracking-wider" style={{ color: GREEN }}>Rankings</span>
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: `${GREEN}20`, color: GREEN }}>
            {(confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
        <div className="space-y-2">
          {rankings.map((r, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-lg w-8">{medals[i] || '  '}</span>
              <span className="font-mono text-sm text-gray-300">{r.shardId}</span>
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: i === 0 ? GREEN : i === 1 ? YELLOW : '#666' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(10, (r.pairwiseWins / Math.max(1, rankings[0].pairwiseWins)) * 100)}%` }}
                  transition={{ duration: 0.6, delay: 0.1 * i }}
                />
              </div>
              <span className="text-xs text-gray-500 w-16 text-right">{r.pairwiseWins} wins</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Page ============

export default function CRPCPage() {
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const runDemo = useCallback(async () => {
    setRunning(true)
    setError(null)
    setResult(null)

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
        <h1 className="text-2xl font-bold mb-1" style={{ color: CYAN }}>
          CRPC Consensus
        </h1>
        <p className="text-gray-400 text-sm mb-1">
          Tim Cotton's Commit-Reveal Pairwise Comparison — Live on JARVIS Mind Network
        </p>
        <p className="text-gray-500 text-xs mb-6">
          Multiple AI shards independently generate responses, then consensus-rank them through
          cryptographic commit-reveal and pairwise voting. No shard can copy another.
        </p>
      </motion.div>

      {/* Protocol Overview */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
        <GlassCard className="p-4 mb-6">
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              { icon: '🔒', label: 'Work Commit', desc: 'Shards hash responses', color: BLUE },
              { icon: '🔓', label: 'Work Reveal', desc: 'Verify & expose', color: PURPLE },
              { icon: '⚖️', label: 'Vote Commit', desc: 'Pairwise comparison', color: YELLOW },
              { icon: '🏆', label: 'Vote Reveal', desc: 'Tally & rank', color: GREEN },
            ].map((p, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className="text-2xl">{p.icon}</span>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: p.color }}>{p.label}</span>
                <span className="text-[10px] text-gray-500">{p.desc}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* Demo Controls */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <GlassCard className="p-4 mb-6">
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Live Demo</label>
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
              background: running ? '#333' : CYAN,
              color: running ? '#666' : '#000',
              cursor: running ? 'wait' : 'pointer',
            }}
          >
            {running ? '⚡ Running CRPC round — 3 shards generating...' : 'Run CRPC Demo'}
          </button>
        </GlassCard>
      </motion.div>

      {/* Error */}
      {error && (
        <GlassCard className="p-4 mb-4 border-red-500/30">
          <p className="text-red-400 text-sm">Error: {error}</p>
        </GlassCard>
      )}

      {/* Results */}
      {result && (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Protocol Trace</span>
            <span className="text-xs text-gray-500">{result.totalDurationMs}ms total</span>
          </div>

          {result.phases?.map((phase, i) => (
            <PhaseCard key={i} phase={phase} index={i} />
          ))}

          <Rankings rankings={result.rankings} confidence={result.confidence} />

          {/* Consensus Response */}
          <motion.div custom={6} variants={fadeIn} initial="hidden" animate="visible">
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">💬</span>
                <span className="font-bold text-sm" style={{ color: GREEN }}>Consensus Response</span>
                <span className="text-xs text-gray-500 ml-auto">Winner: {result.consensusWinner}</span>
              </div>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{result.consensusResponse}</p>
            </GlassCard>
          </motion.div>
        </>
      )}

      {/* Attribution */}
      <div className="mt-8 text-center text-xs text-gray-600">
        CRPC protocol by <span style={{ color: CYAN }}>Tim Cotton</span> — adapted for AI shard consensus by VibeSwap
      </div>
    </div>
  )
}

import { useState } from 'react'
import { api } from '../api'

const PHASE_LABELS = {
  idle: { label: 'Ready', color: 'text-gray-400', bg: 'bg-gray-800' },
  running: { label: 'Running...', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  done: { label: 'Complete', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
  error: { label: 'Error', color: 'text-red-400', bg: 'bg-red-500/20' },
}

const CRED_TIER_COLORS = {
  DIAMOND: 'text-amber-300',
  GOLD: 'text-amber-400',
  SILVER: 'text-gray-300',
  BRONZE: 'text-orange-400',
  NEWCOMER: 'text-gray-500',
  FLAGGED: 'text-red-400',
}

export default function DemoPipeline() {
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function runDemo() {
    setStatus('running')
    setResult(null)
    setError(null)
    try {
      const data = await api.runDemo()
      setResult(data)
      setStatus('done')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const phase = PHASE_LABELS[status]

  return (
    <div className="space-y-6">
      {/* Control */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 text-center">
        <h2 className="text-xl font-semibold text-white mb-2">Full Pipeline Demo</h2>
        <p className="text-gray-400 text-sm mb-6">
          Runs the complete CogProof lifecycle: compress &rarr; commit &rarr; reveal &rarr; settle &rarr; Shapley &rarr; reputation.
          Three simulated miners (alice, bob, charlie) participate in a single batch.
        </p>
        <button
          onClick={runDemo}
          disabled={status === 'running'}
          className={`px-8 py-3 rounded-lg font-medium text-sm transition-all ${
            status === 'running'
              ? 'bg-gray-700 text-gray-400 cursor-wait'
              : 'bg-amber-500 text-black hover:bg-amber-400 cursor-pointer'
          }`}
        >
          {status === 'running' ? 'Running...' : 'Run Demo'}
        </button>
        <div className="mt-3">
          <span className={`inline-flex items-center gap-2 text-xs ${phase.color}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${phase.bg}`} />
            {phase.label}
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Batch ID */}
          <div className="text-center text-sm text-gray-500">
            Batch #{result.batchId}
          </div>

          {/* Phase 1: Commit */}
          <PhaseCard title="1. Commit" subtitle="Miners submit hash(compressed || secret). No information leaked.">
            <div className="space-y-2">
              {result.phases.commit.map(c => (
                <div key={c.miner} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300 font-medium">{c.miner}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 font-mono text-xs">{c.commitHash}</span>
                    <span className="text-emerald-400 text-xs">{(c.ratio * 100).toFixed(1)}% compression</span>
                  </div>
                </div>
              ))}
            </div>
          </PhaseCard>

          {/* Phase 2: Reveal */}
          <PhaseCard title="2. Reveal" subtitle="Miners reveal compressed output + secret. Hash must match commit.">
            <div className="space-y-2">
              {result.phases.reveal.map(r => (
                <div key={r.miner} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300 font-medium">{r.miner}</span>
                  <span className={r.valid ? 'text-emerald-400' : 'text-red-400'}>
                    {r.valid ? 'Valid' : 'SLASHED'}
                  </span>
                </div>
              ))}
            </div>
          </PhaseCard>

          {/* Phase 3: Settle */}
          <PhaseCard title="3. Settle" subtitle="XOR all secrets + block entropy -> Fisher-Yates shuffle. Unpredictable, deterministic.">
            <div className="text-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-gray-500">Shuffle seed:</span>
                <span className="font-mono text-gray-300">{result.phases.settle.shuffleSeed}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Execution order:</span>
                <div className="flex gap-2">
                  {result.phases.settle.executionOrder.map((id, i) => (
                    <span key={id} className="px-2 py-1 bg-gray-800 rounded text-gray-300 font-mono text-xs">
                      {i + 1}. {id}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </PhaseCard>

          {/* Phase 4: Shapley */}
          <PhaseCard title="4. Shapley Distribution" subtitle="Game-theory optimal rewards. Lawson floor guarantees minimum 5%.">
            <div className="space-y-3">
              {result.phases.shapley.map(p => {
                const barWidth = Math.max(p.adjustedShare * 100 * 2, 2)
                return (
                  <div key={p.id}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-300 font-medium">{p.id}</span>
                      <span className="text-gray-400">
                        {(p.adjustedShare * 100).toFixed(1)}% &rarr; {p.payout.toFixed(1)} COG
                      </span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </PhaseCard>

          {/* Phase 5: Reputation */}
          <PhaseCard title="5. Reputation" subtitle="Behavioral credentials accumulated from protocol participation.">
            <div className="grid grid-cols-3 gap-4">
              {result.phases.reputation.map(r => (
                <div key={r.miner} className="text-center p-3 bg-gray-800/50 rounded-lg">
                  <p className="text-gray-300 font-medium text-sm">{r.miner}</p>
                  <p className={`text-2xl font-bold font-mono mt-1 ${CRED_TIER_COLORS[r.tier]}`}>
                    {r.score}
                  </p>
                  <p className={`text-xs mt-1 ${CRED_TIER_COLORS[r.tier]}`}>{r.tier}</p>
                </div>
              ))}
            </div>
          </PhaseCard>
        </div>
      )}
    </div>
  )
}

function PhaseCard({ title, subtitle, children }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-5">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-amber-400">{title}</h3>
        <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

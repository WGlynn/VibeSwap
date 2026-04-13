import { useState, useEffect } from 'react'
import { api } from '../api'

export default function Batches() {
  const [batches, setBatches] = useState([])
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadBatches()
  }, [])

  async function loadBatches() {
    try {
      const data = await api.listBatches(50)
      setBatches(data)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  async function selectBatch(id) {
    setSelected(id)
    try {
      const data = await api.getBatch(id)
      setDetail(data)
    } catch (err) {
      setDetail({ error: err.message })
    }
  }

  if (loading) return <p className="text-center py-20 text-gray-500">Loading...</p>

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400">{error}</p>
        <button onClick={loadBatches} className="mt-4 px-4 py-2 bg-gray-800 text-gray-300 rounded text-sm">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Batch Explorer
          </h3>
          <button onClick={loadBatches} className="text-xs text-gray-500 hover:text-gray-300">
            Refresh
          </button>
        </div>

        {batches.length === 0 ? (
          <p className="text-gray-500 text-sm">No batches yet. Run the demo to generate data.</p>
        ) : (
          <div className="space-y-1">
            {batches.map(b => (
              <button
                key={b.id}
                onClick={() => selectBatch(b.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors ${
                  selected === b.id
                    ? 'bg-amber-500/10 border border-amber-500/30'
                    : 'hover:bg-gray-800 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 font-mono">#{b.id}</span>
                  <PhaseIndicator phase={b.phase} />
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{b.commits} commits</span>
                  <span>{b.reveals} reveals</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Batch Detail */}
      {detail && !detail.error && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-amber-400">Batch #{detail.id}</h3>
            <PhaseIndicator phase={detail.phase} />
          </div>

          {/* Phase Timeline */}
          <div className="flex items-center gap-0">
            <PhaseStep label="COMMIT" active={detail.phase === 'COMMIT'} done={detail.phase !== 'COMMIT'} />
            <PhaseConnector done={detail.phase === 'REVEAL' || detail.phase === 'SETTLED'} />
            <PhaseStep label="REVEAL" active={detail.phase === 'REVEAL'} done={detail.phase === 'SETTLED'} />
            <PhaseConnector done={detail.phase === 'SETTLED'} />
            <PhaseStep label="SETTLED" active={detail.phase === 'SETTLED'} done={false} />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-gray-800/50 rounded">
              <p className="text-2xl font-bold text-white font-mono">{detail.commits}</p>
              <p className="text-xs text-gray-500">Commits</p>
            </div>
            <div className="text-center p-3 bg-gray-800/50 rounded">
              <p className="text-2xl font-bold text-white font-mono">{detail.reveals}</p>
              <p className="text-xs text-gray-500">Reveals</p>
            </div>
            <div className="text-center p-3 bg-gray-800/50 rounded">
              <p className={`text-2xl font-bold font-mono ${detail.commits - detail.reveals > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {detail.commits - detail.reveals}
              </p>
              <p className="text-xs text-gray-500">Slashed</p>
            </div>
          </div>

          {/* Settlement */}
          {detail.shuffleSeed && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Shuffle Seed</p>
                <p className="font-mono text-xs text-gray-400 break-all bg-gray-800 p-2 rounded">
                  {detail.shuffleSeed}
                </p>
              </div>
              {detail.executionOrder && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Execution Order</p>
                  <div className="flex gap-2 flex-wrap">
                    {detail.executionOrder.map((id, i) => (
                      <div key={id} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg">
                        <span className="text-amber-400 font-mono text-xs font-bold">{i + 1}</span>
                        <span className="text-gray-300 text-sm">{id}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {detail?.error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {detail.error}
        </div>
      )}
    </div>
  )
}

function PhaseIndicator({ phase }) {
  const styles = {
    COMMIT: 'bg-blue-500/20 text-blue-400',
    REVEAL: 'bg-purple-500/20 text-purple-400',
    SETTLED: 'bg-emerald-500/20 text-emerald-400',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[phase] || 'bg-gray-700 text-gray-400'}`}>
      {phase}
    </span>
  )
}

function PhaseStep({ label, active, done }) {
  return (
    <div className={`px-3 py-1.5 rounded text-xs font-medium ${
      active ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/50' :
      done ? 'bg-emerald-500/10 text-emerald-400' :
      'bg-gray-800 text-gray-600'
    }`}>
      {done && !active ? '\u2713 ' : ''}{label}
    </div>
  )
}

function PhaseConnector({ done }) {
  return (
    <div className={`w-8 h-px ${done ? 'bg-emerald-500/50' : 'bg-gray-700'}`} />
  )
}

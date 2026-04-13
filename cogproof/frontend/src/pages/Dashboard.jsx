import { useState, useEffect } from 'react'
import { api } from '../api'

const TIER_COLORS = {
  TRUSTED: 'text-emerald-400',
  NORMAL: 'text-blue-400',
  CAUTIOUS: 'text-yellow-400',
  SUSPICIOUS: 'text-orange-400',
  FLAGGED: 'text-red-400',
  UNKNOWN: 'text-gray-500',
}

const SEVERITY_COLORS = {
  CRITICAL: 'bg-red-500/20 text-red-400',
  HIGH: 'bg-orange-500/20 text-orange-400',
  WARNING: 'bg-yellow-500/20 text-yellow-400',
  INFO: 'bg-gray-500/20 text-gray-400',
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [trustReport, setTrustReport] = useState(null)
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10000)
    return () => clearInterval(interval)
  }, [])

  async function loadData() {
    try {
      const [s, h, t] = await Promise.all([
        api.stats(),
        api.health(),
        api.getTrustReport().catch(() => []),
      ])
      setStats(s)
      setHealth(h)
      setTrustReport(t)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 text-lg">API unreachable</p>
        <p className="text-gray-500 text-sm mt-2">{error}</p>
        <button onClick={loadData} className="mt-4 px-4 py-2 bg-gray-800 text-gray-300 rounded text-sm hover:bg-gray-700">
          Retry
        </button>
      </div>
    )
  }

  if (!stats) {
    return <p className="text-center py-20 text-gray-500">Loading...</p>
  }

  // Count trust tiers
  const tierCounts = { TRUSTED: 0, NORMAL: 0, CAUTIOUS: 0, SUSPICIOUS: 0, FLAGGED: 0 }
  if (trustReport) {
    for (const u of trustReport) {
      if (tierCounts[u.trust] !== undefined) tierCounts[u.trust]++
    }
  }

  return (
    <div className="space-y-6">
      {/* System Status */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Batches" value={stats.batches} />
        <StatCard label="Credentials" value={stats.credentials} />
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Flags" value={stats.flags} accent={stats.flags > 0 ? 'text-orange-400' : undefined} />
      </div>

      {/* Indexer State */}
      {stats.indexer && (
        <Card title="Bitcoin Indexer">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Block Height</span>
              <p className="text-white font-mono">{stats.indexer.blockHeight}</p>
            </div>
            <div>
              <span className="text-gray-500">Commits</span>
              <p className="text-white font-mono">{stats.indexer.commits}</p>
            </div>
            <div>
              <span className="text-gray-500">Reveals</span>
              <p className="text-white font-mono">{stats.indexer.reveals}</p>
            </div>
            <div>
              <span className="text-gray-500">Unrevealed</span>
              <p className="text-amber-400 font-mono">{stats.indexer.unrevealed}</p>
            </div>
            <div>
              <span className="text-gray-500">Credentials</span>
              <p className="text-white font-mono">{stats.indexer.credentials}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Trust Distribution */}
      {trustReport && trustReport.length > 0 && (
        <Card title="Trust Distribution">
          <div className="flex gap-4 flex-wrap">
            {Object.entries(tierCounts).map(([tier, count]) => (
              <div key={tier} className="text-center">
                <p className={`text-2xl font-bold font-mono ${TIER_COLORS[tier]}`}>{count}</p>
                <p className="text-xs text-gray-500 uppercase">{tier}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 h-3 rounded-full bg-gray-800 flex overflow-hidden">
            {Object.entries(tierCounts).map(([tier, count]) => {
              if (count === 0) return null
              const pct = (count / trustReport.length) * 100
              const colors = {
                TRUSTED: 'bg-emerald-500',
                NORMAL: 'bg-blue-500',
                CAUTIOUS: 'bg-yellow-500',
                SUSPICIOUS: 'bg-orange-500',
                FLAGGED: 'bg-red-500',
              }
              return <div key={tier} className={`${colors[tier]}`} style={{ width: `${pct}%` }} />
            })}
          </div>
        </Card>
      )}

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Batches */}
        <Card title="Recent Batches">
          {stats.recentBatches.length === 0 ? (
            <p className="text-gray-500 text-sm">No batches yet. Run the demo to generate data.</p>
          ) : (
            <div className="space-y-2">
              {stats.recentBatches.map(b => (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 font-mono">Batch #{b.id}</span>
                  <PhaseTag phase={b.phase} />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent Flags */}
        <Card title="Recent Flags">
          {stats.recentFlags.length === 0 ? (
            <p className="text-gray-500 text-sm">No flags raised. System is clean.</p>
          ) : (
            <div className="space-y-2">
              {stats.recentFlags.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[f.severity]}`}>
                      {f.severity}
                    </span>
                    <span className="text-gray-300">{f.userId}</span>
                  </div>
                  <span className="text-gray-500 text-xs">{f.type}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* System Info */}
      <div className="text-center text-xs text-gray-600 pt-4">
        CogProof v{health?.version} | Uptime: {formatUptime(stats.uptime)} | SQLite (WAL)
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
      <p className="text-gray-500 text-xs uppercase tracking-wider">{label}</p>
      <p className={`text-3xl font-bold font-mono mt-1 ${accent || 'text-white'}`}>{value}</p>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-5">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  )
}

function PhaseTag({ phase }) {
  const colors = {
    COMMIT: 'bg-blue-500/20 text-blue-400',
    REVEAL: 'bg-purple-500/20 text-purple-400',
    SETTLED: 'bg-emerald-500/20 text-emerald-400',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[phase] || 'bg-gray-700 text-gray-400'}`}>
      {phase}
    </span>
  )
}

function formatUptime(seconds) {
  if (!seconds) return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

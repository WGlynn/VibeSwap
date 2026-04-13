import { useState, useEffect } from 'react'
import { api } from '../api'

const TIER_STYLES = {
  DIAMOND: { color: 'text-amber-300', bg: 'bg-amber-500/20', border: 'border-amber-500/30' },
  GOLD: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  SILVER: { color: 'text-gray-300', bg: 'bg-gray-500/10', border: 'border-gray-500/20' },
  BRONZE: { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  NEWCOMER: { color: 'text-gray-500', bg: 'bg-gray-800', border: 'border-gray-700' },
  FLAGGED: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  UNKNOWN: { color: 'text-gray-600', bg: 'bg-gray-800', border: 'border-gray-700' },
}

const TRUST_STYLES = {
  TRUSTED: { color: 'text-emerald-400', label: 'Trusted' },
  NORMAL: { color: 'text-blue-400', label: 'Normal' },
  CAUTIOUS: { color: 'text-yellow-400', label: 'Cautious' },
  SUSPICIOUS: { color: 'text-orange-400', label: 'Suspicious' },
  FLAGGED: { color: 'text-red-400', label: 'Flagged' },
  UNKNOWN: { color: 'text-gray-500', label: 'Unknown' },
}

export default function Reputation() {
  const [userId, setUserId] = useState('')
  const [searchId, setSearchId] = useState('')
  const [rep, setRep] = useState(null)
  const [trust, setTrust] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [allUsers, setAllUsers] = useState([])

  useEffect(() => {
    api.getTrustReport().then(report => {
      setAllUsers(report.map(r => r.userId))
    }).catch(() => {})
  }, [])

  async function lookup(id) {
    const lookupId = id || searchId
    if (!lookupId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const [r, t] = await Promise.all([
        api.getReputation(lookupId),
        api.getTrust(lookupId),
      ])
      setRep(r)
      setTrust(t)
      setUserId(lookupId)
    } catch (err) {
      setError(err.message)
      setRep(null)
      setTrust(null)
    } finally {
      setLoading(false)
    }
  }

  const tier = TIER_STYLES[rep?.tier] || TIER_STYLES.UNKNOWN
  const trustTier = TRUST_STYLES[trust?.trust] || TRUST_STYLES.UNKNOWN

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-5">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
          Reputation Lookup
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchId}
            onChange={e => setSearchId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup()}
            placeholder="Enter user ID (e.g. alice, bob, charlie)"
            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500/50"
          />
          <button
            onClick={() => lookup()}
            disabled={loading}
            className="px-6 py-2 bg-amber-500 text-black rounded-lg text-sm font-medium hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? '...' : 'Lookup'}
          </button>
        </div>
        {allUsers.length > 0 && (
          <div className="mt-3 flex gap-2 flex-wrap">
            <span className="text-xs text-gray-500 py-1">Known users:</span>
            {allUsers.map(u => (
              <button
                key={u}
                onClick={() => { setSearchId(u); lookup(u) }}
                className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded hover:text-white hover:bg-gray-700"
              >
                {u}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {rep && (
        <div className="space-y-6">
          {/* Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Credential Score */}
            <div className={`${tier.bg} border ${tier.border} rounded-lg p-6 text-center`}>
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Credential Score</p>
              <p className={`text-5xl font-bold font-mono ${tier.color}`}>{rep.score}</p>
              <p className={`text-lg font-medium mt-2 ${tier.color}`}>{rep.tier}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-gray-500">Total</p>
                  <p className="text-white font-mono">{rep.totalCredentials}</p>
                </div>
                <div>
                  <p className="text-gray-500">Positive</p>
                  <p className="text-emerald-400 font-mono">{rep.positiveSignals}</p>
                </div>
                <div>
                  <p className="text-gray-500">Negative</p>
                  <p className="text-red-400 font-mono">{rep.negativeSignals}</p>
                </div>
              </div>
            </div>

            {/* Trust Score */}
            {trust && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 text-center">
                <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Trust Score</p>
                <p className={`text-5xl font-bold font-mono ${trustTier.color}`}>{trust.score}</p>
                <p className={`text-lg font-medium mt-2 ${trustTier.color}`}>{trust.trust}</p>
                {trust.stats && (
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-gray-500">Actions</p>
                      <p className="text-white font-mono">{trust.stats.totalActions}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Reveal Rate</p>
                      <p className="text-white font-mono">{trust.stats.revealRate}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Burns</p>
                      <p className="text-white font-mono">{trust.stats.burns}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Trust Gauge */}
          {trust && (
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-5">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Trust Gauge</h3>
              <div className="relative h-4 bg-gray-800 rounded-full overflow-hidden">
                <div className="absolute inset-0 flex">
                  <div className="w-1/5 bg-red-500/30" />
                  <div className="w-1/5 bg-orange-500/30" />
                  <div className="w-1/5 bg-yellow-500/30" />
                  <div className="w-1/5 bg-blue-500/30" />
                  <div className="w-1/5 bg-emerald-500/30" />
                </div>
                <div
                  className="absolute top-0 bottom-0 w-1 bg-white rounded shadow-lg shadow-white/30"
                  style={{ left: `${trust.score}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-600">
                <span>FLAGGED</span>
                <span>SUSPICIOUS</span>
                <span>CAUTIOUS</span>
                <span>NORMAL</span>
                <span>TRUSTED</span>
              </div>
            </div>
          )}

          {/* Flags */}
          {trust?.flags?.length > 0 && (
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-5">
              <h3 className="text-sm font-medium text-red-400 uppercase tracking-wider mb-4">
                Flags ({trust.flags.length})
              </h3>
              <div className="space-y-3">
                {trust.flags.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                      f.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400' :
                      f.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
                      f.severity === 'WARNING' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {f.severity}
                    </span>
                    <div>
                      <p className="text-gray-300">{f.message}</p>
                      {f.detail && <p className="text-gray-500 text-xs mt-1">{f.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Credential History */}
          {rep.credentials?.length > 0 && (
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-5">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
                Credential History ({rep.credentials.length})
              </h3>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {rep.credentials.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-gray-800 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={c.credentialSubject?.signal === 'negative' ? 'text-red-400' : 'text-emerald-400'}>
                        {c.credentialSubject?.signal === 'negative' ? '-' : '+'}
                      </span>
                      <span className="text-gray-300">{c.credentialSubject?.name}</span>
                    </div>
                    <span className="text-gray-500 text-xs">{c.credentialSubject?.credential}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

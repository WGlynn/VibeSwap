import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const TIERS = [
  {
    name: 'FREE',
    price: '0',
    color: 'text-matrix-500',
    border: 'border-matrix-500/20',
    bg: 'bg-matrix-500/5',
    endpoints: [
      'Health status',
      'Covenants & governance rules',
      'Rosetta lexicon',
      'Token supply & mining target',
    ],
  },
  {
    name: 'LOW',
    price: '100 wei',
    color: 'text-terminal-400',
    border: 'border-terminal-500/20',
    bg: 'bg-terminal-500/5',
    endpoints: [
      'Mind network state',
      'Mesh topology',
      'Mining stats & leaderboard',
      'Predictions marketplace',
      'Rosetta translation',
      'Intelligence metrics',
      'InfoFi knowledge search',
    ],
  },
  {
    name: 'MEDIUM',
    price: '1,000 wei',
    color: 'text-amber-400',
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/5',
    endpoints: [
      'Chat with JARVIS',
      'Text-to-speech synthesis',
      'Submit intelligence reports',
      'Create predictions',
      'Place prediction bets',
    ],
  },
  {
    name: 'HIGH',
    price: '10,000 wei',
    color: 'text-red-400',
    border: 'border-red-500/20',
    bg: 'bg-red-500/5',
    endpoints: [
      'Streaming chat (real-time)',
      'CRPC demo (full protocol)',
    ],
  },
]

export default function X402Page() {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch('/jarvis-api/x402/stats')
      .then(r => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-full px-4 py-8 max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-matrix-500/10 border border-matrix-500/20 flex items-center justify-center">
              <span className="text-lg font-mono font-bold text-matrix-500">402</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">x402 Payment Protocol</h1>
              <p className="text-sm text-black-400">HTTP 402 — the forgotten status code, finally fulfilled.</p>
            </div>
          </div>
          <p className="text-black-300 text-sm leading-relaxed max-w-2xl">
            Machine-to-machine micropayments for API access. AI agents pay per-call with
            cryptographic proof of payment. No subscriptions, no API keys — just VIBE tokens
            and math.
          </p>
        </div>

        {/* How it works */}
        <div className="mb-8 p-4 rounded-xl bg-black-800/50 border border-black-700/50">
          <h2 className="text-sm font-semibold text-black-200 mb-3">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {[
              { step: '1', label: 'Request', desc: 'Call any premium endpoint' },
              { step: '2', label: '402 Response', desc: 'Server returns payment instructions' },
              { step: '3', label: 'Pay on-chain', desc: 'Send VIBE to treasury address' },
              { step: '4', label: 'Retry + Proof', desc: 'Include tx hash in X-Payment-Proof header' },
            ].map((s) => (
              <div key={s.step} className="text-center p-3 rounded-lg bg-black-700/30">
                <div className="text-matrix-500 text-lg font-mono mb-1">{s.step}</div>
                <div className="text-xs font-medium text-black-200">{s.label}</div>
                <div className="text-[10px] text-black-500 mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing tiers */}
        <h2 className="text-lg font-semibold mb-4">Pricing Tiers</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`p-4 rounded-xl border ${tier.border} ${tier.bg}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`text-sm font-bold ${tier.color}`}>{tier.name}</span>
                <span className="text-xs font-mono text-black-400">{tier.price}</span>
              </div>
              <ul className="space-y-1.5">
                {tier.endpoints.map((ep) => (
                  <li key={ep} className="flex items-center gap-2 text-xs text-black-300">
                    <span className={`w-1 h-1 rounded-full ${tier.color.replace('text-', 'bg-')}`} />
                    {ep}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Technical details */}
        <div className="mb-8 p-4 rounded-xl bg-black-800/50 border border-black-700/50">
          <h2 className="text-sm font-semibold text-black-200 mb-3">Verification Stack</h2>
          <div className="space-y-2 text-xs text-black-300">
            <div className="flex items-center gap-2">
              <span className="text-matrix-500 font-mono text-[10px]">L1</span>
              <span>Signed receipts — HMAC-SHA256, zero I/O, fastest path</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-terminal-400 font-mono text-[10px]">L2</span>
              <span>Bloom filter — O(1) lookup for previously verified tx hashes</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-mono text-[10px]">L3</span>
              <span>On-chain verification — full RPC validation, issues receipt for future use</span>
            </div>
          </div>
        </div>

        {/* Accepted tokens */}
        <div className="p-4 rounded-xl bg-black-800/50 border border-black-700/50">
          <h2 className="text-sm font-semibold text-black-200 mb-3">Accepted Tokens</h2>
          <div className="flex flex-wrap gap-2">
            {['VIBE', 'ETH', 'USDC'].map((token) => (
              <span key={token} className="px-3 py-1.5 rounded-lg bg-black-700/50 text-xs font-mono text-black-200 border border-black-600/30">
                {token}
              </span>
            ))}
            <span className="px-3 py-1.5 rounded-lg bg-black-700/30 text-xs font-mono text-black-500 border border-black-700/30">
              + any ERC20 via config
            </span>
          </div>
        </div>

        {/* Live stats */}
        {stats && (
          <div className="mt-6 p-4 rounded-xl bg-matrix-500/5 border border-matrix-500/20">
            <h2 className="text-sm font-semibold text-matrix-400 mb-2">Live System Status</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-mono text-white">{stats.activeSessions || 0}</div>
                <div className="text-[10px] text-black-500">Active Sessions</div>
              </div>
              <div>
                <div className="text-lg font-mono text-white">{stats.routeCount || 0}</div>
                <div className="text-[10px] text-black-500">Priced Routes</div>
              </div>
              <div>
                <div className="text-lg font-mono text-white">{stats.cachedProofs || 0}</div>
                <div className="text-[10px] text-black-500">Cached Proofs</div>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}

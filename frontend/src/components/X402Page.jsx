import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'

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

// ============ API Playground ============
const EXAMPLE_ENDPOINTS = [
  { method: 'GET', path: '/x402/health', tier: 'FREE', desc: 'System health check', response: '{"status":"ok","uptime":847293,"providers":13}' },
  { method: 'GET', path: '/x402/mind-network', tier: 'LOW', desc: 'Mind network state', response: '{"nodes":3,"consensus":"active","rootHash":"9704a2..."}' },
  { method: 'POST', path: '/x402/chat', tier: 'MEDIUM', desc: 'Chat with JARVIS', response: '{"response":"Market conditions favor...","tokens":142}' },
  { method: 'POST', path: '/x402/chat/stream', tier: 'HIGH', desc: 'Streaming chat', response: 'data: {"delta":"The","index":0}\\ndata: {"delta":" current","index":1}...' },
  { method: 'GET', path: '/x402/predictions', tier: 'LOW', desc: 'Active predictions', response: '{"predictions":[{"id":1,"topic":"ETH>$4k by Q2","confidence":0.72}]}' },
  { method: 'POST', path: '/x402/translate', tier: 'LOW', desc: 'Rosetta translation', response: '{"from":"trading","to":"defi","result":"liquidity_provision"}' },
]

export default function X402Page() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [stats, setStats] = useState(null)
  const [selectedEndpoint, setSelectedEndpoint] = useState(0)
  const [playgroundResult, setPlaygroundResult] = useState(null)
  const [isRequesting, setIsRequesting] = useState(false)

  useEffect(() => {
    fetch('/jarvis-api/x402/stats')
      .then(r => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => {})
  }, [])

  const simulateRequest = () => {
    setIsRequesting(true)
    setPlaygroundResult(null)
    const ep = EXAMPLE_ENDPOINTS[selectedEndpoint]
    setTimeout(() => {
      const tier = TIERS.find(t => t.name === ep.tier)
      setPlaygroundResult({
        status: ep.tier === 'FREE' ? 200 : 402,
        tier: ep.tier,
        price: tier?.price || '0',
        response: ep.response,
        headers: ep.tier === 'FREE'
          ? { 'Content-Type': 'application/json' }
          : { 'X-Payment-Required': 'true', 'X-Payment-Amount': tier?.price || '0', 'X-Payment-Token': 'VIBE', 'X-Payment-Address': '0x7a2F...3e8B' },
      })
      setIsRequesting(false)
    }, 800)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display">
          x<span style={{ color: GREEN }}>402</span> PROTOCOL
        </h1>
        <p className="text-gray-400 text-sm mt-2 font-mono">
          HTTP 402 — the forgotten status code, finally fulfilled.
        </p>
        <p className="text-gray-500 text-xs mt-1 font-mono">
          Machine-to-machine micropayments. AI agents pay per-call with cryptographic proof.
        </p>
        <div className="mx-auto mt-3 h-px w-32" style={{ background: `linear-gradient(to right, transparent, ${GREEN}, transparent)` }} />
      </motion.div>

      {/* How it works */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>How It Works
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { step: '1', label: 'Request', desc: 'Agent calls premium endpoint', color: CYAN },
            { step: '2', label: '402 Response', desc: 'Server returns payment instructions', color: AMBER },
            { step: '3', label: 'Pay On-Chain', desc: 'VIBE tokens to treasury address', color: GREEN },
            { step: '4', label: 'Retry + Proof', desc: 'X-Payment-Proof header with tx hash', color: '#a855f7' },
          ].map((s, i) => (
            <GlassCard key={s.step} glowColor="terminal" hover>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 * PHI }} className="p-3 text-center">
                <div className="text-lg font-mono font-bold mb-1" style={{ color: s.color }}>{s.step}</div>
                <div className="text-xs font-bold text-white">{s.label}</div>
                <div className="text-[9px] text-gray-500 mt-1">{s.desc}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
        {/* Flow diagram */}
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-4 mt-3">
            <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3 overflow-x-auto">
              <code className="text-[10px] font-mono whitespace-pre" style={{ color: GREEN }}>
{`Agent                    VibeSwap API              Base L2
  |                          |                        |
  |--- GET /x402/chat ------>|                        |
  |<--- 402 Payment Required |                        |
  |    X-Payment-Amount: 1000 wei                     |
  |    X-Payment-Token: VIBE                          |
  |                          |                        |
  |--- Transfer 1000 VIBE ---|----------------------->|
  |<--- tx: 0xabc123...  ----|                        |
  |                          |                        |
  |--- GET /x402/chat ------>|                        |
  |    X-Payment-Proof: 0xabc|--- verify on-chain --->|
  |<--- 200 OK + response ---|<--- confirmed ---------|`}
              </code>
            </div>
            <div className="text-[9px] text-gray-600 font-mono mt-2 text-center">
              Sequence integration: route agentic flows to VibeSwap when execution quality matters more than latency
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Pricing tiers */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>Pricing Tiers
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TIERS.map((tier, i) => {
            const colors = [GREEN, CYAN, AMBER, '#EF4444']
            const c = colors[i] || CYAN
            return (
              <GlassCard key={tier.name} glowColor="terminal" hover>
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 * PHI }} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold" style={{ color: c }}>{tier.name}</span>
                    <span className="text-[10px] font-mono text-gray-500">{tier.price}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {tier.endpoints.map((ep) => (
                      <li key={ep} className="flex items-center gap-2 text-[10px] text-gray-400">
                        <span className="w-1 h-1 rounded-full" style={{ backgroundColor: c }} />
                        {ep}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </GlassCard>
            )
          })}
        </div>
      </div>

      {/* API Playground */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>API Playground
        </h2>
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            <div className="text-xs text-gray-500 font-mono mb-2">Select endpoint:</div>
            <div className="space-y-1 mb-4">
              {EXAMPLE_ENDPOINTS.map((ep, i) => (
                <button key={i} onClick={() => { setSelectedEndpoint(i); setPlaygroundResult(null) }}
                  className={`w-full text-left p-2 rounded-lg text-xs font-mono flex items-center gap-2 transition-all ${selectedEndpoint === i ? 'bg-gray-800 border border-gray-700' : 'hover:bg-gray-900/50'}`}>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${ep.method === 'GET' ? 'text-green-400 bg-green-400/10' : 'text-amber-400 bg-amber-400/10'}`}>{ep.method}</span>
                  <span className="text-white flex-1">{ep.path}</span>
                  <span className="text-gray-600">{ep.tier}</span>
                </button>
              ))}
            </div>
            <button onClick={simulateRequest} disabled={isRequesting}
              className="w-full py-2.5 rounded-lg font-bold font-mono text-sm transition-all disabled:opacity-50"
              style={{ backgroundColor: GREEN, color: '#0a0a0a' }}>
              {isRequesting ? 'Requesting...' : `Send ${EXAMPLE_ENDPOINTS[selectedEndpoint].method} Request`}
            </button>
            <AnimatePresence>
              {playgroundResult && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="mt-3 bg-gray-900/80 border border-gray-700 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                    <span className="text-xs font-mono font-bold" style={{ color: playgroundResult.status === 200 ? GREEN : AMBER }}>
                      HTTP {playgroundResult.status} {playgroundResult.status === 200 ? 'OK' : 'Payment Required'}
                    </span>
                    <span className="text-[9px] font-mono text-gray-600">{playgroundResult.tier} tier</span>
                  </div>
                  {/* Headers */}
                  <div className="px-3 py-2 border-b border-gray-800/50">
                    {Object.entries(playgroundResult.headers).map(([k, v]) => (
                      <div key={k} className="text-[10px] font-mono">
                        <span className="text-gray-500">{k}: </span>
                        <span style={{ color: k.startsWith('X-Payment') ? AMBER : '#9CA3AF' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  {/* Body */}
                  <div className="px-3 py-2">
                    <code className="text-[10px] font-mono text-gray-300 whitespace-pre-wrap break-all">
                      {playgroundResult.response}
                    </code>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </GlassCard>
      </div>

      {/* Verification Stack */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>Verification Stack
        </h2>
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5 space-y-3">
            {[
              { level: 'L1', label: 'Signed Receipts', desc: 'HMAC-SHA256, zero I/O, fastest path (~0.1ms)', color: GREEN },
              { level: 'L2', label: 'Bloom Filter', desc: 'O(1) lookup for previously verified tx hashes (~1ms)', color: CYAN },
              { level: 'L3', label: 'On-Chain Verify', desc: 'Full RPC validation, issues receipt for future use (~2s)', color: AMBER },
            ].map((v, i) => (
              <motion.div key={v.level} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 * PHI }}
                className="flex items-center gap-3 bg-gray-900/40 rounded-lg p-3">
                <span className="text-sm font-mono font-bold w-8" style={{ color: v.color }}>{v.level}</span>
                <div className="flex-1">
                  <div className="text-xs font-bold text-white">{v.label}</div>
                  <div className="text-[9px] text-gray-500 font-mono">{v.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Accepted Tokens + Wallet */}
      <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
            <span style={{ color: CYAN }}>_</span>Accepted Tokens
          </h2>
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-4 flex flex-wrap gap-2">
              {['VIBE', 'ETH', 'USDC'].map((token) => (
                <span key={token} className="px-3 py-2 rounded-lg bg-gray-900/40 text-xs font-mono font-bold text-white border border-gray-700">
                  {token}
                </span>
              ))}
              <span className="px-3 py-2 rounded-lg bg-gray-900/20 text-xs font-mono text-gray-500 border border-gray-800">
                + any ERC20
              </span>
            </div>
          </GlassCard>
        </div>
        <div>
          <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
            <span style={{ color: CYAN }}>_</span>Your Usage
          </h2>
          {!isConnected ? (
            <GlassCard glowColor="terminal" hover={false}>
              <div className="p-4 text-center">
                <div className="text-gray-500 text-xs font-mono">Sign in to view API usage</div>
              </div>
            </GlassCard>
          ) : (
            <GlassCard glowColor="terminal" hover={false}>
              <div className="p-4 space-y-2">
                {[
                  { label: 'Calls Today', value: '247', color: CYAN },
                  { label: 'VIBE Spent', value: '0.84', color: GREEN },
                  { label: 'Cached Proofs', value: '12', color: AMBER },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 font-mono">{s.label}</span>
                    <span className="text-sm font-mono font-bold" style={{ color: s.color }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      </div>

      {/* Live stats */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>Network Stats
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Active Sessions', value: stats?.activeSessions?.toString() || '47', color: CYAN },
            { label: 'Priced Routes', value: stats?.routeCount?.toString() || '24', color: GREEN },
            { label: 'Cached Proofs', value: stats?.cachedProofs?.toString() || '1,293', color: AMBER },
          ].map((s, i) => (
            <GlassCard key={s.label} glowColor="terminal" hover>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 * PHI }} className="p-4 text-center">
                <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* MCP Integration callout */}
      <div className="mb-8">
        <GlassCard glowColor="terminal" hover={false} spotlight>
          <div className="p-5" style={{ borderLeft: `3px solid ${GREEN}` }}>
            <div className="text-sm font-bold text-white mb-2">MCP Integration Ready</div>
            <p className="text-xs text-gray-400 font-mono leading-relaxed">
              x402 is designed for AI agent-to-protocol communication. Your MCP server routes
              agent requests, VibeSwap settles payments on-chain. No API keys, no subscriptions —
              just cryptographic proof of payment per call. Agents that trade through your
              execution router can access batch auction data, clearing prices, and submit
              commitments programmatically.
            </p>
          </div>
        </GlassCard>
      </div>

      {/* Footer */}
      <div className="text-center pb-4">
        <div className="text-gray-600 text-[10px] font-mono">
          "HTTP 402 Payment Required — reserved for future use." The future is now.
        </div>
      </div>
    </div>
  )
}

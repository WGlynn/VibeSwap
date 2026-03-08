import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// InfoFi Page — CKB-native Information Finance
// ============================================================

const PRIMITIVE_TYPES = ['All', 'Insight', 'Discovery', 'Synthesis', 'Proof', 'Data', 'Model', 'Framework']

const KNOWLEDGE_PRIMITIVES = [
  { id: 1, title: 'Cooperative Capitalism mechanism design', type: 'Framework', author: 'will.vibe', citations: 34, price: '0.12 ETH', shapley: '0.042 ETH' },
  { id: 2, title: 'Kalman filter true price discovery', type: 'Model', author: 'jarvis.ai', citations: 28, price: '0.08 ETH', shapley: '0.031 ETH' },
  { id: 3, title: 'Commit-reveal eliminates MEV in batch auctions', type: 'Proof', author: 'will.vibe', citations: 45, price: '0.15 ETH', shapley: '0.058 ETH' },
  { id: 4, title: 'Byzantine AI agents cannot reach consensus alone', type: 'Discovery', author: 'berdoz.eth', citations: 12, price: '0.05 ETH', shapley: '0.018 ETH' },
  { id: 5, title: 'Shapley attribution for multi-author knowledge', type: 'Insight', author: 'will.vibe', citations: 22, price: '0.09 ETH', shapley: '0.035 ETH' },
  { id: 6, title: 'Homomorphic encryption on medical records', type: 'Data', author: 'medic.dao', citations: 8, price: '0.04 ETH', shapley: '0.014 ETH' },
  { id: 7, title: 'DePIN device attestation via TEE/SE', type: 'Synthesis', author: 'jarvis.ai', citations: 15, price: '0.06 ETH', shapley: '0.022 ETH' },
]

export default function InfoFiPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [filter, setFilter] = useState('All')

  const filtered = filter === 'All'
    ? KNOWLEDGE_PRIMITIVES
    : KNOWLEDGE_PRIMITIVES.filter(p => p.type === filter)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          Info<span className="text-matrix-500">Fi</span>
        </h1>
        <p className="text-black-400 text-sm mt-2 max-w-lg mx-auto">
          Information Finance. Knowledge primitives as economic assets.
          Shapley attribution ensures every contributor gets paid fairly.
        </p>
        <p className="text-black-600 text-[10px] font-mono mt-1">
          The original CKB — not the derivative.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Primitives', value: '71' },
          { label: 'Citations', value: '1,240' },
          { label: 'Total Value', value: '89 ETH' },
          { label: 'Contributors', value: '34' },
        ].map((s) => (
          <div key={s.label} className="text-center p-2 bg-black-800/40 border border-black-700/50 rounded-lg">
            <div className="text-white font-mono font-bold text-sm">{s.value}</div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div className="mb-6 p-4 bg-black-800/30 border border-matrix-800/20 rounded-xl">
        <h3 className="text-sm font-bold text-matrix-400 mb-2">How InfoFi Works</h3>
        <div className="space-y-1 text-xs text-black-400">
          <p>+ Knowledge primitives are registered on-chain with citation dependencies</p>
          <p>+ Bonding curve pricing: more citations = higher value = higher price</p>
          <p>+ Shapley attribution: 60% to direct creator, 40% split among cited dependencies</p>
          <p>+ Every primitive is an economic asset that generates revenue from citations</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-1 mb-4">
        {PRIMITIVE_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`text-[10px] font-mono px-3 py-1 rounded-full transition-colors ${
              filter === t
                ? 'bg-matrix-600 text-black-900 font-bold'
                : 'bg-black-800/60 text-black-400 border border-black-700 hover:border-black-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Primitives list */}
      <div className="space-y-3">
        {filtered.map((p) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-black-800/60 border border-black-700 rounded-xl p-4 hover:border-black-600 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-white text-sm font-medium">{p.title}</h3>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] font-mono text-black-500">{p.author}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black-900/60 text-black-400">{p.type}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-matrix-400 font-mono font-bold text-sm">{p.price}</div>
                <div className="text-[10px] font-mono text-black-500">Price</div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-black-800">
              <span className="text-[10px] font-mono text-black-500">{p.citations} citations</span>
              <span className="text-[10px] font-mono text-matrix-500">Shapley: {p.shapley}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {!isConnected && (
        <div className="mt-6 text-center text-black-500 text-xs font-mono">
          Connect wallet to register knowledge primitives and earn Shapley rewards
        </div>
      )}
    </div>
  )
}

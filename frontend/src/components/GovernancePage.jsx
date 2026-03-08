import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// Governance Page — veVIBE voting, proposals, gauges
// ============================================================

const PROPOSALS = [
  { id: 7, title: 'Increase insurance pool allocation to 15%', status: 'ACTIVE', forPct: 72, votes: 1240, endDate: 'Mar 15' },
  { id: 6, title: 'Add JUL/USDC gauge for liquidity mining', status: 'ACTIVE', forPct: 88, votes: 890, endDate: 'Mar 12' },
  { id: 5, title: 'Reduce swap fee from 30bps to 25bps', status: 'SUCCEEDED', forPct: 65, votes: 2100, endDate: 'Mar 5' },
  { id: 4, title: 'Enable cross-chain governance relay', status: 'EXECUTED', forPct: 91, votes: 1800, endDate: 'Feb 28' },
  { id: 3, title: 'Fund security audit bounty pool (50 ETH)', status: 'EXECUTED', forPct: 95, votes: 2400, endDate: 'Feb 20' },
]

const GAUGES = [
  { pool: 'ETH/USDC', weight: '28%', votes: '340K veVIBE', emissions: '12,000 JUL/wk' },
  { pool: 'ETH/JUL',  weight: '22%', votes: '270K veVIBE', emissions: '9,400 JUL/wk' },
  { pool: 'WBTC/ETH', weight: '18%', votes: '220K veVIBE', emissions: '7,700 JUL/wk' },
  { pool: 'DAI/USDC', weight: '14%', votes: '170K veVIBE', emissions: '6,000 JUL/wk' },
  { pool: 'JUL/USDC', weight: '10%', votes: '120K veVIBE', emissions: '4,300 JUL/wk' },
]

const STATUS_COLORS = {
  ACTIVE: 'text-matrix-400 bg-matrix-900/20 border-matrix-800/30',
  SUCCEEDED: 'text-blue-400 bg-blue-900/20 border-blue-800/30',
  EXECUTED: 'text-black-400 bg-black-800/40 border-black-700',
  DEFEATED: 'text-red-400 bg-red-900/20 border-red-800/30',
  VETOED: 'text-amber-400 bg-amber-900/20 border-amber-800/30',
}

export default function GovernancePage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [tab, setTab] = useState('proposals')

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          <span className="text-matrix-500">Govern</span>ance
        </h1>
        <p className="text-black-400 text-sm mt-2">
          veVIBE voting. Propose changes. Direct emissions. Shape the protocol.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'veVIBE Locked', value: '1.2M' },
          { label: 'Proposals', value: '7' },
          { label: 'Voters', value: '2,400' },
          { label: 'Gauges', value: '5' },
        ].map((s) => (
          <div key={s.label} className="text-center p-2 bg-black-800/40 border border-black-700/50 rounded-lg">
            <div className="text-white font-mono font-bold text-sm">{s.value}</div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-black-800/50 rounded-lg">
        {['proposals', 'gauges', 'veVIBE'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-mono rounded-md transition-colors ${
              tab === t ? 'bg-matrix-600 text-black-900 font-bold' : 'text-black-400 hover:text-white'
            }`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Proposals tab */}
      {tab === 'proposals' && (
        <div className="space-y-3">
          {PROPOSALS.map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-black-800/60 border border-black-700 rounded-xl p-4"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <span className="text-[10px] font-mono text-black-500">VIP-{p.id}</span>
                  <h3 className="text-white text-sm font-medium">{p.title}</h3>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${STATUS_COLORS[p.status]}`}>
                  {p.status}
                </span>
              </div>
              {/* Vote bar */}
              <div className="h-2 bg-black-900 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-matrix-600 rounded-full" style={{ width: `${p.forPct}%` }} />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-black-500">
                <span>{p.forPct}% FOR</span>
                <span>{p.votes} votes</span>
                <span>{p.status === 'ACTIVE' ? `Ends ${p.endDate}` : p.endDate}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Gauges tab */}
      {tab === 'gauges' && (
        <div className="space-y-3">
          <div className="text-xs text-black-400 mb-2">
            Epoch: 7 days. Vote to direct JUL emissions to liquidity pools. Max 35% per gauge.
          </div>
          {GAUGES.map((g) => (
            <motion.div
              key={g.pool}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-black-800/60 border border-black-700 rounded-xl p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-bold text-sm">{g.pool}</div>
                  <div className="text-[10px] font-mono text-black-500">{g.votes}</div>
                </div>
                <div className="text-right">
                  <div className="text-matrix-400 font-mono font-bold">{g.weight}</div>
                  <div className="text-[10px] font-mono text-black-500">{g.emissions}</div>
                </div>
              </div>
              <div className="h-1.5 bg-black-900 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-matrix-600/60 rounded-full" style={{ width: g.weight }} />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* veVIBE tab */}
      {tab === 'veVIBE' && (
        <div className="bg-black-800/60 border border-black-700 rounded-xl p-5">
          <h2 className="text-white font-bold mb-3">Lock ETH for veVIBE</h2>
          <p className="text-black-400 text-sm mb-4">
            Lock ETH to get vote-escrowed VIBE. Longer lock = more voting power.
            Max lock 4 years = max boost (2.5x).
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { period: '6 months', power: '0.125x' },
                { period: '1 year', power: '0.25x' },
                { period: '2 years', power: '0.5x' },
                { period: '4 years', power: '1.0x' },
              ].map((opt) => (
                <div key={opt.period} className="p-3 bg-black-900/40 border border-black-700 rounded-lg text-center">
                  <div className="text-white font-bold text-sm">{opt.period}</div>
                  <div className="text-matrix-400 font-mono text-xs">{opt.power} voting power</div>
                </div>
              ))}
            </div>
            <div className="text-[10px] font-mono text-amber-500/60">
              Early exit penalty: 50% of locked amount
            </div>
          </div>
        </div>
      )}

      {!isConnected && (
        <div className="mt-6 text-center text-black-500 text-xs font-mono">
          Connect wallet to vote and participate in governance
        </div>
      )}
    </div>
  )
}

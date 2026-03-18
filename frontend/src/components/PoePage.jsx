import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'

const EXAMPLE_PROPOSALS = [
  {
    id: 0,
    contributor: 'Early MEV Researcher',
    description: 'Published commit-reveal batch auction design 2 years before VibeSwap launched',
    requestedBps: 500,
    totalStaked: '18,500 VIBE',
    threshold: '21,000 VIBE',
    progress: 88,
    state: 'PROPOSED',
    daysLeft: 73,
  },
  {
    id: 1,
    contributor: 'Cooperative Game Theory Author',
    description: 'Shapley value distribution framework adapted by VibeSwap for LP rewards',
    requestedBps: 300,
    totalStaked: '24,100 VIBE',
    threshold: '21,000 VIBE',
    progress: 100,
    state: 'EXECUTABLE',
    convictionDays: 4,
    daysUntilExecutable: 3,
  },
]

const STATES = {
  PROPOSED: { color: 'text-terminal-400', bg: 'bg-terminal-500/10', border: 'border-terminal-500/20' },
  EXECUTABLE: { color: 'text-matrix-500', bg: 'bg-matrix-500/10', border: 'border-matrix-500/20' },
  EXECUTED: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  REJECTED: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
}

export default function PoePage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [tab, setTab] = useState('active')
  const [stakeModal, setStakeModal] = useState(null)
  const [stakeAmount, setStakeAmount] = useState('')

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display">
          POE <span style={{ color: CYAN }}>REVALUATION</span>
        </h1>
        <p className="text-gray-400 text-sm mt-2 font-mono italic">
          Posthumous/Overlooked Evidence — named after Edgar Allan Poe
        </p>
        <p className="text-gray-500 text-xs mt-1 font-mono">
          Retroactive recognition for contributions whose value was only understood later.
        </p>
        <div className="mx-auto mt-3 h-px w-32" style={{ background: `linear-gradient(to right, transparent, ${CYAN}, transparent)` }} />
      </motion.div>

        {/* Mechanism */}
        <div className="mb-8 p-4 rounded-xl bg-black-800/50 border border-black-700/50">
          <h2 className="text-sm font-semibold text-black-200 mb-3">How POE Works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {[
              { step: '1', label: 'Propose', desc: 'Anyone submits evidence' },
              { step: '2', label: 'Stake', desc: 'Community backs with VIBE' },
              { step: '3', label: 'Threshold', desc: '0.1% of supply staked' },
              { step: '4', label: 'Wait', desc: '7-day conviction period' },
              { step: '5', label: 'Execute', desc: 'New Shapley game created' },
            ].map((s) => (
              <div key={s.step} className="text-center p-2.5 rounded-lg bg-black-700/30">
                <div className="text-matrix-500 text-sm font-mono mb-0.5">{s.step}</div>
                <div className="text-[11px] font-medium text-black-200">{s.label}</div>
                <div className="text-[9px] text-black-500 mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Safeguards */}
        <div className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Conviction Period', value: '7 days' },
            { label: 'Max Per Proposal', value: '10% of pool' },
            { label: 'Contributor Cooldown', value: '30 days' },
            { label: 'Proposal Expiry', value: '90 days' },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-xl bg-black-800/50 border border-black-700/50 text-center">
              <div className="text-sm font-mono text-white">{s.value}</div>
              <div className="text-[10px] text-black-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {['active', 'executed', 'rejected'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === t
                  ? 'bg-matrix-500/20 text-matrix-400 border border-matrix-500/30'
                  : 'text-black-400 hover:text-white'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Proposals */}
        <div className="space-y-3">
          {tab === 'active' && EXAMPLE_PROPOSALS.map((p) => {
            const style = STATES[p.state] || STATES.PROPOSED
            return (
              <GlassCard key={p.id}>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-white">{p.contributor}</span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${style.bg} ${style.color} ${style.border} border`}>
                      {p.state}
                    </span>
                  </div>
                  <p className="text-xs text-black-300 mb-3">{p.description}</p>
                  <div className="flex items-center gap-4 text-[10px] text-black-500 mb-2">
                    <span>Requesting: {p.requestedBps / 100}% of Shapley pool</span>
                    <span>Staked: {p.totalStaked} / {p.threshold}</span>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full h-1.5 rounded-full bg-black-700">
                    <div
                      className="h-full rounded-full bg-matrix-500 transition-all"
                      style={{ width: `${Math.min(p.progress, 100)}%` }}
                    />
                  </div>
                  {p.state === 'EXECUTABLE' && (
                    <div className="mt-2 text-[10px] text-matrix-400">
                      Conviction met. {p.daysUntilExecutable} days until executable.
                    </div>
                  )}
                  {/* Action buttons */}
                  <div className="flex gap-2 mt-3">
                    {p.state === 'PROPOSED' && (
                      <button onClick={() => setStakeModal(p.id)}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold border transition-all hover:brightness-125"
                        style={{ color: CYAN, borderColor: `${CYAN}40`, backgroundColor: `${CYAN}10` }}>
                        {isConnected ? 'Stake VIBE' : 'Connect to Stake'}
                      </button>
                    )}
                    {p.state === 'EXECUTABLE' && (
                      <button className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold border transition-all hover:brightness-125"
                        style={{ color: GREEN, borderColor: `${GREEN}40`, backgroundColor: `${GREEN}10` }}>
                        Execute Proposal
                      </button>
                    )}
                    <button className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold text-gray-500 border border-gray-700 hover:text-white transition-all">
                      View Evidence
                    </button>
                  </div>
                </div>
              </GlassCard>
            )
          })}
          {tab !== 'active' && (
            <div className="text-center py-12 text-black-500 text-sm font-mono">
              No {tab} proposals yet.
            </div>
          )}
        </div>

        {/* Your Governance Position */}
        <div className="mt-8 mb-8">
          <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
            <span style={{ color: CYAN }}>_</span>Your Governance
          </h2>
          {!isConnected ? (
            <GlassCard glowColor="terminal" hover={false}>
              <div className="p-6 text-center">
                <div className="text-gray-400 text-sm font-mono">Connect wallet to participate in governance</div>
              </div>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Staked VIBE', value: '2,400', color: CYAN },
                { label: 'Active Proposals', value: '2', color: GREEN },
                { label: 'Conviction Power', value: '1.4x', color: AMBER },
              ].map((s, i) => (
                <GlassCard key={s.label} glowColor="terminal" hover>
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 * PHI }} className="p-3 text-center">
                    <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
                  </motion.div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>

        {/* Stake Modal */}
        <AnimatePresence>
          {stakeModal !== null && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setStakeModal(null)}>
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-bold font-mono text-sm">Stake on Proposal #{stakeModal}</h3>
                  <button onClick={() => setStakeModal(null)} className="text-gray-500 hover:text-white text-lg">&times;</button>
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4 mb-4">
                  <div className="text-xs text-gray-400 font-mono mb-2">Amount (VIBE)</div>
                  <input type="number" placeholder="0" value={stakeAmount} onChange={e => setStakeAmount(e.target.value)}
                    className="w-full bg-transparent text-white text-xl font-mono font-bold outline-none placeholder-gray-700" />
                </div>
                <div className="text-[10px] text-gray-500 font-mono mb-4">
                  Staked tokens are locked until the proposal resolves. Conviction power increases with time staked.
                </div>
                <button className="w-full py-3 rounded-xl font-bold font-mono text-sm text-gray-900 transition-all"
                  style={{ backgroundColor: CYAN }}>
                  Stake VIBE
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quote */}
        <div className="text-center pb-4">
          <div className="text-gray-600 text-[10px] font-mono italic">
            "To be seen. To be valued. Even if it takes the world decades to catch up."
          </div>
        </div>
    </div>
  )
}

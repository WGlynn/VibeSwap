import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'

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
  const [tab, setTab] = useState('active')

  return (
    <div className="min-h-full px-4 py-8 max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">POE Revaluation</h1>
          <p className="text-sm text-black-400 italic mb-3">
            Posthumous/Overlooked Evidence — named after Edgar Allan Poe,
            who died penniless while his work became priceless.
          </p>
          <p className="text-black-300 text-sm leading-relaxed max-w-2xl">
            Contributions whose value was only recognized after their original
            Shapley game settled can be retroactively revalued. The protocol remembers.
          </p>
        </div>

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
                </div>
              </GlassCard>
            )
          })}
          {tab !== 'active' && (
            <div className="text-center py-12 text-black-500 text-sm">
              No {tab} proposals yet.
            </div>
          )}
        </div>

        {/* Quote */}
        <div className="mt-8 text-center">
          <p className="text-[11px] text-black-600 italic">
            "To be seen. To be valued. Even if it takes the world decades to catch up."
          </p>
        </div>
      </motion.div>
    </div>
  )
}

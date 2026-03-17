import { motion } from 'framer-motion'

const AXIOMS = [
  { name: 'Efficiency', desc: 'All value is distributed — no hidden extraction', icon: '=' },
  { name: 'Symmetry', desc: 'Equal contributors receive equal rewards', icon: '⇔' },
  { name: 'Null Player', desc: 'No contribution = no reward', icon: '∅' },
  { name: 'Proportionality', desc: 'Reward ratios match contribution ratios for any pair', icon: '∝' },
  { name: 'Time Neutrality', desc: 'Same work earns same reward regardless of when', icon: '⏱' },
]

const WEIGHTS = [
  { name: 'Direct', pct: 40, color: 'bg-matrix-500', desc: 'Liquidity provided' },
  { name: 'Enabling', pct: 30, color: 'bg-terminal-500', desc: 'Time in pool (log scale)' },
  { name: 'Scarcity', pct: 20, color: 'bg-amber-400', desc: 'Provided the scarce side' },
  { name: 'Stability', pct: 10, color: 'bg-red-400', desc: 'Stayed during volatility' },
]

export default function ShapleyPage() {
  return (
    <div className="min-h-full px-4 py-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Shapley Value Distribution</h1>
          <p className="text-sm text-black-400 mb-3">
            Cooperative game theory applied to reward distribution. Every economic event
            is a game. Your reward = your marginal contribution.
          </p>
          <p className="text-black-300 text-sm leading-relaxed max-w-2xl">
            Named after Lloyd Shapley (Nobel Prize, 2012). The only reward function that
            simultaneously satisfies efficiency, symmetry, and proportionality. VibeSwap
            is the first DEX to implement it on-chain with public verification.
          </p>
        </div>

        {/* Five Axioms */}
        <h2 className="text-lg font-semibold mb-3">Five Axioms (all verifiable on-chain)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 mb-8">
          {AXIOMS.map((a) => (
            <div key={a.name} className="p-3 rounded-xl bg-black-800/50 border border-black-700/50 text-center">
              <div className="text-xl mb-1 font-mono text-matrix-500">{a.icon}</div>
              <div className="text-xs font-semibold text-black-200">{a.name}</div>
              <div className="text-[10px] text-black-500 mt-0.5">{a.desc}</div>
            </div>
          ))}
        </div>

        {/* Contribution Weights */}
        <h2 className="text-lg font-semibold mb-3">Contribution Weights</h2>
        <div className="space-y-2 mb-8">
          {WEIGHTS.map((w) => (
            <div key={w.name} className="flex items-center gap-3">
              <div className="w-20 text-xs font-medium text-black-300">{w.name}</div>
              <div className="flex-1 h-6 rounded-full bg-black-800 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${w.pct}%` }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                  className={`h-full ${w.color} rounded-full flex items-center justify-end pr-2`}
                >
                  <span className="text-[10px] font-mono text-black-900 font-bold">{w.pct}%</span>
                </motion.div>
              </div>
              <div className="w-40 text-[10px] text-black-500">{w.desc}</div>
            </div>
          ))}
        </div>

        {/* Time Scoring */}
        <div className="mb-8 p-4 rounded-xl bg-black-800/50 border border-black-700/50">
          <h2 className="text-sm font-semibold text-black-200 mb-3">Logarithmic Time Scoring</h2>
          <p className="text-xs text-black-400 mb-3">
            Time in pool follows diminishing returns. Loyalty is rewarded, but the first
            month matters more than the twelfth.
          </p>
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              { time: '1 day', mult: '1.0x' },
              { time: '7 days', mult: '1.9x' },
              { time: '30 days', mult: '2.7x' },
              { time: '1 year', mult: '4.2x' },
            ].map((t) => (
              <div key={t.time} className="p-2 rounded-lg bg-black-700/30">
                <div className="text-sm font-mono text-matrix-500">{t.mult}</div>
                <div className="text-[10px] text-black-500">{t.time}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Lawson Fairness Floor */}
        <div className="mb-8 p-4 rounded-xl bg-matrix-500/5 border border-matrix-500/20">
          <h2 className="text-sm font-semibold text-matrix-400 mb-2">Lawson Fairness Floor</h2>
          <p className="text-xs text-black-300">
            Minimum 1% reward share for any participant who contributed honestly.
            Nobody who showed up and acted in good faith walks away with zero.
            Named after Jayme Lawson, whose embodiment of cooperative fairness
            inspired VibeSwap's design philosophy.
          </p>
        </div>

        {/* Verify */}
        <div className="p-4 rounded-xl bg-black-800/50 border border-black-700/50">
          <h2 className="text-sm font-semibold text-black-200 mb-2">Public Fairness Audit</h2>
          <p className="text-xs text-black-400 mb-2">
            Anyone can verify fairness on-chain — no trust required:
          </p>
          <code className="block text-[11px] font-mono text-terminal-400 bg-black-900 p-3 rounded-lg">
            verifyPairwiseFairness(gameId, address1, address2)
          </code>
          <p className="text-[10px] text-black-500 mt-2">
            Returns whether reward_A / reward_B ≈ weight_A / weight_B within tolerance.
            Built-in market surveillance that anyone can run.
          </p>
        </div>
      </motion.div>
    </div>
  )
}

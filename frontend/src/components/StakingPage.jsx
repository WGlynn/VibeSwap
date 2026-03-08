import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// Staking Page — Multi-pool with lock tiers
// ============================================================

const LOCK_TIERS = [
  { days: 30,  multiplier: '1.0x', apy: '8%',  label: '30 Days' },
  { days: 90,  multiplier: '1.5x', apy: '12%', label: '90 Days' },
  { days: 180, multiplier: '2.0x', apy: '16%', label: '180 Days' },
  { days: 365, multiplier: '3.0x', apy: '24%', label: '1 Year' },
]

const POOLS = [
  { name: 'ETH Staking', token: 'ETH', tvl: '4,200 ETH', stakers: 890, baseAPY: '8%' },
  { name: 'JUL Staking', token: 'JUL', tvl: '2.1M JUL', stakers: 1240, baseAPY: '12%' },
  { name: 'LP Staking', token: 'LP-NFT', tvl: '680 LP', stakers: 340, baseAPY: '18%' },
]

export default function StakingPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [selectedTier, setSelectedTier] = useState(1)
  const [amount, setAmount] = useState('')

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          <span className="text-matrix-500">Stake</span> & Earn
        </h1>
        <p className="text-black-400 text-sm mt-2">
          Lock tokens to earn rewards. Longer locks = higher multipliers.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total Staked', value: '$18.2M' },
          { label: 'Stakers', value: '2,470' },
          { label: 'Rewards Paid', value: '$1.4M' },
        ].map((s) => (
          <div key={s.label} className="text-center p-3 bg-black-800/40 border border-black-700/50 rounded-lg">
            <div className="text-white font-mono font-bold">{s.value}</div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Lock tier selector */}
      <div className="bg-black-800/60 border border-black-700 rounded-xl p-5 mb-6">
        <h2 className="text-white font-bold mb-3">Choose Lock Duration</h2>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {LOCK_TIERS.map((tier, i) => (
            <button
              key={tier.days}
              onClick={() => setSelectedTier(i)}
              className={`p-3 rounded-lg border text-center transition-all ${
                selectedTier === i
                  ? 'border-matrix-600 bg-matrix-900/20'
                  : 'border-black-700 hover:border-black-600'
              }`}
            >
              <div className="text-white font-bold text-sm">{tier.label}</div>
              <div className="text-matrix-400 font-mono text-xs mt-1">{tier.multiplier}</div>
              <div className="text-black-500 text-[10px] font-mono">{tier.apy} APY</div>
            </button>
          ))}
        </div>

        {/* Stake input */}
        <div className="flex gap-3">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount to stake"
            className="flex-1 bg-black-900/60 border border-black-700 rounded-lg px-4 py-3 text-white font-mono placeholder-black-500 focus:border-matrix-600 focus:outline-none"
          />
          <button
            disabled={!isConnected || !amount}
            className="px-6 py-3 bg-matrix-600 hover:bg-matrix-500 disabled:bg-black-700 disabled:text-black-500 text-black-900 font-bold rounded-lg transition-colors"
          >
            Stake
          </button>
        </div>

        {amount && (
          <div className="mt-3 text-xs font-mono text-black-400">
            Estimated reward: <span className="text-matrix-400">{(parseFloat(amount || 0) * parseFloat(LOCK_TIERS[selectedTier].apy) / 100).toFixed(4)}</span> tokens/year
            {' '}at {LOCK_TIERS[selectedTier].multiplier} multiplier
          </div>
        )}

        <div className="mt-2 text-[10px] font-mono text-amber-500/60">
          Early unstake penalty: 50% of staked amount
        </div>
      </div>

      {/* Active pools */}
      <h2 className="text-white font-bold mb-3">Active Pools</h2>
      <div className="space-y-3">
        {POOLS.map((pool) => (
          <motion.div
            key={pool.name}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-black-800/60 border border-black-700 rounded-xl p-4 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-full bg-matrix-900/30 border border-matrix-800/30 flex items-center justify-center text-matrix-400 font-bold font-mono">
              {pool.token[0]}
            </div>
            <div className="flex-1">
              <div className="text-white font-bold text-sm">{pool.name}</div>
              <div className="text-black-500 text-[10px] font-mono">{pool.stakers} stakers</div>
            </div>
            <div className="text-right">
              <div className="text-matrix-400 font-mono font-bold">{pool.baseAPY}</div>
              <div className="text-black-500 text-[10px] font-mono">{pool.tvl} TVL</div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

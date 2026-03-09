import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// Rewards are not just numbers. They're acknowledgment.
// They're recognition. They're a reason to come back.

function RewardsWidget() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // Real rewards start at 0 — populated from on-chain ShapleyDistributor
  const [claimable, setClaimable] = useState(0)
  const [isGlowing, setIsGlowing] = useState(false)

  // No mock accrual — rewards only change via on-chain contract reads
  // When ShapleyDistributor is deployed, this will poll the contract

  const rewards = [
    {
      name: 'Trading Rewards',
      amount: 0,
      icon: '💎',
      description: 'From your swap volume',
      color: '#00d4ff'
    },
    {
      name: 'LP Rewards',
      amount: 0,
      icon: '🌊',
      description: 'From providing liquidity',
      color: '#ff1ee8'
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong rounded-2xl border border-void-600/30 overflow-hidden relative"
    >
      {/* Animated glow when rewards accrue */}
      <motion.div
        animate={{
          opacity: isGlowing ? 0.3 : 0,
          scale: isGlowing ? 1.05 : 1
        }}
        className="absolute inset-0 bg-gradient-to-r from-vibe-500/20 to-cyber-500/20 rounded-2xl pointer-events-none"
      />

      {/* Header */}
      <div className="relative p-4 border-b border-void-600/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <motion.span
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="text-lg"
            >
              🎁
            </motion.span>
            <h3 className="font-display font-bold text-sm">YOUR REWARDS</h3>
          </div>
          <div className="flex items-center space-x-1 text-xs text-void-400">
            <div className="w-1.5 h-1.5 rounded-full bg-glow-500 animate-pulse" />
            <span>Accruing</span>
          </div>
        </div>
      </div>

      {/* Total Claimable */}
      <div className="relative p-5 bg-gradient-to-br from-vibe-500/5 via-transparent to-cyber-500/5">
        <div className="text-center">
          <div className="text-xs text-void-400 mb-1">Total Claimable</div>
          <motion.div
            key={Math.floor(claimable)}
            initial={{ scale: 1.05 }}
            animate={{ scale: 1 }}
            className="flex items-baseline justify-center space-x-1"
          >
            <span className="text-3xl font-display font-bold gradient-text-static">
              {claimable.toFixed(2)}
            </span>
            <span className="text-lg text-void-400">VIBE</span>
          </motion.div>
          <div className="text-sm text-void-500 mt-1">{claimable > 0 ? `≈ $${(claimable * 1.85).toFixed(2)}` : ''}</div>
        </div>

        {/* Progress ring */}
        <div className="flex justify-center mt-4">
          <div className="relative w-16 h-16">
            <svg className="w-full h-full -rotate-90">
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="4"
              />
              <motion.circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke="url(#rewardGradient)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={175.9}
                animate={{ strokeDashoffset: 175.9 * 0.25 }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
              <defs>
                <linearGradient id="rewardGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ff1ee8" />
                  <stop offset="100%" stopColor="#00d4ff" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-void-300">0%</span>
            </div>
          </div>
        </div>
        <div className="text-center text-xs text-void-500 mt-2">
          to next multiplier tier
        </div>
      </div>

      {/* Rewards Breakdown */}
      <div className="p-4 space-y-3">
        {rewards.map((reward, index) => (
          <motion.div
            key={reward.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="flex items-center justify-between p-3 rounded-xl bg-void-800/30 border border-void-700/30"
          >
            <div className="flex items-center space-x-3">
              <span className="text-lg">{reward.icon}</span>
              <div>
                <div className="text-sm font-medium">{reward.name}</div>
                <div className="text-xs text-void-500">{reward.description}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono font-medium" style={{ color: reward.color }}>
                +{reward.amount.toFixed(2)}
              </div>
              <div className="text-xs text-void-500">VIBE</div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Claim Button */}
      <div className="p-4 pt-0">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-vibe-500 to-cyber-500 text-white font-bold text-sm relative overflow-hidden group"
        >
          {/* Shimmer effect */}
          <motion.div
            animate={{ x: ['100%', '-100%'] }}
            transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          />
          <span className="relative z-10 flex items-center justify-center space-x-2">
            <span>Claim All Rewards</span>
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </span>
        </motion.button>
      </div>

      {/* Streak Indicator — only show when user has real streak data */}
      {/* TODO: Wire to real loyalty contract data */}
    </motion.div>
  )
}

export default RewardsWidget

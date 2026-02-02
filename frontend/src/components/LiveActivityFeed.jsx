import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// This is what makes the app feel ALIVE
// Every swap, every trade - you see it happening in real-time
// It's social proof. It's energy. It's the heartbeat of the market.

const MOCK_ACTIVITIES = [
  { type: 'swap', from: 'ETH', to: 'USDC', amount: '2.5', value: '$5,000', wallet: '0x1a2b...3c4d', time: '2s ago' },
  { type: 'swap', from: 'WBTC', to: 'ETH', amount: '0.15', value: '$6,300', wallet: '0x5e6f...7g8h', time: '5s ago' },
  { type: 'add', pool: 'ETH/USDC', amount: '$12,500', wallet: '0x9i0j...1k2l', time: '12s ago' },
  { type: 'swap', from: 'ARB', to: 'USDC', amount: '5,000', value: '$6,000', wallet: '0x3m4n...5o6p', time: '18s ago' },
  { type: 'swap', from: 'USDC', to: 'OP', amount: '2,000', value: '$2,000', wallet: '0x7q8r...9s0t', time: '24s ago' },
  { type: 'remove', pool: 'WBTC/ETH', amount: '$8,200', wallet: '0x1u2v...3w4x', time: '31s ago' },
  { type: 'swap', from: 'ETH', to: 'ARB', amount: '1.2', value: '$2,400', wallet: '0x5y6z...7a8b', time: '45s ago' },
]

const TOKEN_COLORS = {
  ETH: '#627EEA',
  USDC: '#2775CA',
  WBTC: '#F7931A',
  ARB: '#28A0F0',
  OP: '#FF0420',
}

function LiveActivityFeed() {
  const [activities, setActivities] = useState(MOCK_ACTIVITIES.slice(0, 5))
  const [isExpanded, setIsExpanded] = useState(false)

  // Simulate live activity
  useEffect(() => {
    const interval = setInterval(() => {
      const randomActivity = MOCK_ACTIVITIES[Math.floor(Math.random() * MOCK_ACTIVITIES.length)]
      const newActivity = {
        ...randomActivity,
        time: 'just now',
        id: Date.now(),
      }

      setActivities(prev => [newActivity, ...prev.slice(0, 9)])
    }, 4000)

    return () => clearInterval(interval)
  }, [])

  return (
    <motion.div
      layout
      className="glass-strong rounded-2xl border border-void-600/30 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-void-600/30">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-glow-500" />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-glow-500 animate-ping" />
          </div>
          <h3 className="font-display font-bold text-sm">LIVE ACTIVITY</h3>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-void-400 hover:text-vibe-400 transition-colors"
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </motion.button>
      </div>

      {/* Activity List */}
      <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-96' : 'max-h-48'}`}>
        <AnimatePresence initial={false}>
          {activities.map((activity, index) => (
            <motion.div
              key={activity.id || index}
              initial={{ opacity: 0, x: -20, height: 0 }}
              animate={{ opacity: 1, x: 0, height: 'auto' }}
              exit={{ opacity: 0, x: 20, height: 0 }}
              transition={{ duration: 0.3 }}
              className="px-4 py-3 border-b border-void-700/30 last:border-b-0 hover:bg-void-800/30 transition-colors"
            >
              {activity.type === 'swap' ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {/* Swap visual */}
                    <div className="flex items-center -space-x-1">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 border-void-900 z-10"
                        style={{ backgroundColor: `${TOKEN_COLORS[activity.from]}30`, color: TOKEN_COLORS[activity.from] }}
                      >
                        {activity.from[0]}
                      </div>
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 border-void-900"
                        style={{ backgroundColor: `${TOKEN_COLORS[activity.to]}30`, color: TOKEN_COLORS[activity.to] }}
                      >
                        {activity.to[0]}
                      </div>
                    </div>

                    <div>
                      <div className="text-sm">
                        <span className="text-void-300">Swapped</span>
                        <span className="font-medium text-white"> {activity.amount} {activity.from}</span>
                        <span className="text-void-300"> → </span>
                        <span className="font-medium text-white">{activity.to}</span>
                      </div>
                      <div className="text-xs text-void-500 font-mono">{activity.wallet}</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-medium text-glow-500">{activity.value}</div>
                    <div className="text-xs text-void-500">{activity.time}</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      activity.type === 'add' ? 'bg-glow-500/20 text-glow-500' : 'bg-vibe-500/20 text-vibe-400'
                    }`}>
                      {activity.type === 'add' ? '+' : '-'}
                    </div>
                    <div>
                      <div className="text-sm">
                        <span className="text-void-300">{activity.type === 'add' ? 'Added to' : 'Removed from'}</span>
                        <span className="font-medium text-white"> {activity.pool}</span>
                      </div>
                      <div className="text-xs text-void-500 font-mono">{activity.wallet}</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`text-sm font-medium ${activity.type === 'add' ? 'text-glow-500' : 'text-vibe-400'}`}>
                      {activity.type === 'add' ? '+' : '-'}{activity.amount}
                    </div>
                    <div className="text-xs text-void-500">{activity.time}</div>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Footer stats */}
      <div className="p-3 bg-void-800/30 border-t border-void-600/30">
        <div className="flex items-center justify-between text-xs">
          <span className="text-void-400">24h Volume</span>
          <span className="font-mono font-medium text-white">$12.4M</span>
        </div>
      </div>
    </motion.div>
  )
}

export default LiveActivityFeed

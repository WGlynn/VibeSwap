import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const MOCK_ACTIVITIES = [
  { type: 'swap', from: 'ETH', to: 'USDC', amount: '2.5', value: '$5,000', wallet: '0x1a2b...3c4d', time: '2s ago' },
  { type: 'swap', from: 'WBTC', to: 'ETH', amount: '0.15', value: '$6,300', wallet: '0x5e6f...7g8h', time: '5s ago' },
  { type: 'add', pool: 'ETH/USDC', amount: '$12,500', wallet: '0x9i0j...1k2l', time: '12s ago' },
  { type: 'swap', from: 'ARB', to: 'USDC', amount: '5,000', value: '$6,000', wallet: '0x3m4n...5o6p', time: '18s ago' },
  { type: 'swap', from: 'USDC', to: 'OP', amount: '2,000', value: '$2,000', wallet: '0x7q8r...9s0t', time: '24s ago' },
  { type: 'remove', pool: 'WBTC/ETH', amount: '$8,200', wallet: '0x1u2v...3w4x', time: '31s ago' },
  { type: 'swap', from: 'ETH', to: 'ARB', amount: '1.2', value: '$2,400', wallet: '0x5y6z...7a8b', time: '45s ago' },
]

function LiveActivityFeed() {
  const [activities, setActivities] = useState(MOCK_ACTIVITIES.slice(0, 5))
  const [isExpanded, setIsExpanded] = useState(false)

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
    <div className="rounded-lg bg-black-800 border border-black-500 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-black-600">
        <div className="flex items-center space-x-2">
          <div className="relative">
            <div className="w-2 h-2 rounded-full bg-matrix-500" />
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-matrix-500 animate-ping opacity-75" />
          </div>
          <h3 className="font-bold text-xs uppercase tracking-wider text-black-200">live activity</h3>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-[10px] text-black-400 hover:text-matrix-500 transition-colors uppercase tracking-wider"
        >
          {isExpanded ? 'less' : 'more'}
        </button>
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
              transition={{ duration: 0.2 }}
              className="px-3 py-2.5 border-b border-black-700 last:border-b-0 hover:bg-black-700/50 transition-colors"
            >
              {activity.type === 'swap' ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {/* Swap indicator */}
                    <div className="flex items-center text-xs text-black-400">
                      <span className="font-mono text-white">{activity.from}</span>
                      <span className="mx-1">→</span>
                      <span className="font-mono text-white">{activity.to}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <span className="font-mono text-xs text-matrix-500">{activity.value}</span>
                    <span className="text-[10px] text-black-500 font-mono">{activity.wallet}</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className={`text-xs ${activity.type === 'add' ? 'text-matrix-500' : 'text-warning'}`}>
                      {activity.type === 'add' ? '+' : '-'}
                    </span>
                    <span className="text-xs text-black-400">
                      {activity.type === 'add' ? 'added to' : 'removed from'}
                    </span>
                    <span className="font-mono text-xs text-white">{activity.pool}</span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <span className={`font-mono text-xs ${activity.type === 'add' ? 'text-matrix-500' : 'text-warning'}`}>
                      {activity.type === 'add' ? '+' : '-'}{activity.amount}
                    </span>
                    <span className="text-[10px] text-black-500 font-mono">{activity.wallet}</span>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Footer stats */}
      <div className="p-3 bg-black-900 border-t border-black-600">
        <div className="flex items-center justify-between text-xs">
          <span className="text-black-500">24h volume</span>
          <span className="font-mono font-medium text-white">$12.4M</span>
        </div>
      </div>
    </div>
  )
}

export default LiveActivityFeed

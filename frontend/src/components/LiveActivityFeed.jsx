import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Activity feed populated from on-chain events when contracts are live
// No fake activity — users see real transactions or empty state

function LiveActivityFeed() {
  const [activities, setActivities] = useState([])
  const [isExpanded, setIsExpanded] = useState(false)

  // TODO: Subscribe to on-chain swap/LP events via WebSocket when contracts deployed
  // For now, show waiting state

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
        {activities.length === 0 && (
          <div className="px-3 py-6 text-center">
            <div className="text-black-500 text-xs">Waiting for on-chain activity...</div>
            <div className="text-black-600 text-[10px] mt-1">Transactions will appear here when contracts go live</div>
          </div>
        )}
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
          <span className="font-mono font-medium text-white">--</span>
        </div>
      </div>
    </div>
  )
}

export default LiveActivityFeed

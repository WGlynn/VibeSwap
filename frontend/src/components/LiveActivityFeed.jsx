import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Activity feed populated from on-chain events when contracts are live.
// Simulates batch auction settlement events for demo purposes.

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

const DEMO_PAIRS = [
  { from: 'ETH', to: 'USDC' }, { from: 'USDC', to: 'ETH' },
  { from: 'ARB', to: 'ETH' }, { from: 'BTC', to: 'USDC' },
  { from: 'OP', to: 'ETH' }, { from: 'USDC', to: 'JUL' },
]

const WALLETS = ['0x7a2F', '0xbC91', '0x4eF2', '0xdA63', '0x91c8', '0xf3B7', '0x28aE', '0x5c1D']

function generateActivity(rng, id) {
  const isSwap = rng() > 0.3
  const pair = DEMO_PAIRS[Math.floor(rng() * DEMO_PAIRS.length)]
  const wallet = WALLETS[Math.floor(rng() * WALLETS.length)]
  const secsAgo = Math.floor(rng() * 600)
  const time = secsAgo < 60 ? `${secsAgo}s ago` : `${Math.floor(secsAgo / 60)}m ago`

  if (isSwap) {
    const value = (0.01 + rng() * 50).toFixed(rng() > 0.5 ? 2 : 4)
    return { id, type: 'swap', from: pair.from, to: pair.to, value: `${value} ${pair.from}`, wallet: `${wallet}...`, time }
  }
  const pool = `${pair.from}/${pair.to}`
  const amount = `$${(100 + rng() * 50000).toFixed(0)}`
  return { id, type: rng() > 0.3 ? 'add' : 'remove', pool, amount, wallet: `${wallet}...`, time }
}

function LiveActivityFeed() {
  const [activities, setActivities] = useState(() => {
    const rng = seededRandom(42)
    return Array.from({ length: 12 }, (_, i) => generateActivity(rng, i))
  })
  const [isExpanded, setIsExpanded] = useState(false)

  // Simulate new activity arriving every 8-15 seconds (batch auction rhythm)
  useEffect(() => {
    let counter = 100
    const interval = setInterval(() => {
      const rng = seededRandom(Date.now())
      const newActivity = generateActivity(rng, counter++)
      setActivities(prev => [newActivity, ...prev.slice(0, 19)])
    }, 8000 + Math.random() * 7000)
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
          <div className="flex items-center gap-4">
            <div>
              <span className="text-black-500">24h volume </span>
              <span className="font-mono font-medium text-white">$2.4M</span>
            </div>
            <div>
              <span className="text-black-500">batches </span>
              <span className="font-mono font-medium text-white">8,640</span>
            </div>
          </div>
          <div>
            <span className="text-black-500">MEV extracted: </span>
            <span className="font-mono font-bold text-matrix-500">$0.00</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LiveActivityFeed

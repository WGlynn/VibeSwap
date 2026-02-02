import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Gas is the heartbeat of the blockchain.
// Show it with the respect it deserves.

const GAS_LEVELS = [
  { label: 'Slow', multiplier: 0.8, time: '~5 min', color: '#a3ff00' },
  { label: 'Normal', multiplier: 1.0, time: '~2 min', color: '#00d4ff' },
  { label: 'Fast', multiplier: 1.2, time: '~30 sec', color: '#ff1ee8' },
  { label: 'Instant', multiplier: 1.5, time: '~15 sec', color: '#ff6b35' },
]

function GasTracker({ onSelect }) {
  const [baseGas, setBaseGas] = useState(12)
  const [selectedLevel, setSelectedLevel] = useState(1) // Normal
  const [isAnimating, setIsAnimating] = useState(false)

  // Simulate gas price fluctuations
  useEffect(() => {
    const interval = setInterval(() => {
      setBaseGas(prev => {
        const change = (Math.random() - 0.5) * 2
        return Math.max(5, Math.min(50, prev + change))
      })
      setIsAnimating(true)
      setTimeout(() => setIsAnimating(false), 300)
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const handleSelect = (index) => {
    setSelectedLevel(index)
    onSelect?.(Math.round(baseGas * GAS_LEVELS[index].multiplier))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong rounded-2xl border border-void-600/30 overflow-hidden"
    >
      {/* Header */}
      <div className="p-4 border-b border-void-600/30 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <motion.div
            animate={{
              scale: isAnimating ? [1, 1.2, 1] : 1,
              rotate: isAnimating ? [0, 5, -5, 0] : 0
            }}
            className="text-lg"
          >
            ⛽
          </motion.div>
          <h3 className="font-display font-bold text-sm">GAS TRACKER</h3>
        </div>
        <div className="flex items-center space-x-2">
          <motion.div
            animate={{ scale: isAnimating ? 1.1 : 1 }}
            className="w-2 h-2 rounded-full bg-glow-500"
          />
          <span className="text-xs text-void-400">Live</span>
        </div>
      </div>

      {/* Current Gas Display */}
      <div className="p-4 bg-gradient-to-br from-void-800/50 to-void-900/50">
        <div className="flex items-center justify-center space-x-3">
          <motion.span
            key={baseGas}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-display font-bold"
            style={{ color: GAS_LEVELS[selectedLevel].color }}
          >
            {Math.round(baseGas * GAS_LEVELS[selectedLevel].multiplier)}
          </motion.span>
          <div className="text-left">
            <div className="text-sm text-void-400">gwei</div>
            <div className="text-xs text-void-500">
              ~${((baseGas * GAS_LEVELS[selectedLevel].multiplier * 21000 * 2000) / 1e9).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Gas meter visualization */}
        <div className="mt-4 relative">
          <div className="h-2 rounded-full bg-void-700 overflow-hidden">
            <motion.div
              animate={{ width: `${Math.min(100, (baseGas / 50) * 100)}%` }}
              className="h-full rounded-full"
              style={{
                background: `linear-gradient(90deg, ${GAS_LEVELS[0].color}, ${GAS_LEVELS[1].color}, ${GAS_LEVELS[2].color}, ${GAS_LEVELS[3].color})`
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-void-500">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
      </div>

      {/* Speed Options */}
      <div className="p-3 grid grid-cols-4 gap-2">
        {GAS_LEVELS.map((level, index) => (
          <motion.button
            key={level.label}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleSelect(index)}
            className={`p-2 rounded-xl text-center transition-all ${
              selectedLevel === index
                ? 'bg-void-700/80 border-2'
                : 'bg-void-800/30 border border-void-600/30 hover:border-void-500/50'
            }`}
            style={{
              borderColor: selectedLevel === index ? level.color : undefined
            }}
          >
            <div
              className="text-xs font-semibold mb-0.5"
              style={{ color: selectedLevel === index ? level.color : '#9ca3af' }}
            >
              {level.label}
            </div>
            <div className="text-[10px] text-void-500">{level.time}</div>
          </motion.button>
        ))}
      </div>

      {/* Trend indicator */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-void-400">30m Trend</span>
          <div className="flex items-center space-x-1 text-glow-500">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span>Decreasing</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default GasTracker

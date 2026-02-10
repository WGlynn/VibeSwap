import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const GAS_LEVELS = [
  { label: 'slow', multiplier: 0.8, time: '~5 min' },
  { label: 'normal', multiplier: 1.0, time: '~2 min' },
  { label: 'fast', multiplier: 1.2, time: '~30 sec' },
  { label: 'instant', multiplier: 1.5, time: '~15 sec' },
]

function GasTracker({ onSelect }) {
  const [baseGas, setBaseGas] = useState(12)
  const [selectedLevel, setSelectedLevel] = useState(1)

  useEffect(() => {
    const interval = setInterval(() => {
      setBaseGas(prev => {
        const change = (Math.random() - 0.5) * 2
        return Math.max(5, Math.min(50, prev + change))
      })
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const handleSelect = (index) => {
    setSelectedLevel(index)
    onSelect?.(Math.round(baseGas * GAS_LEVELS[index].multiplier))
  }

  const currentGas = Math.round(baseGas * GAS_LEVELS[selectedLevel].multiplier)

  return (
    <div className="rounded-lg bg-black-800 border border-black-500 overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-black-600 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm">⛽</span>
          <h3 className="font-bold text-xs uppercase tracking-wider text-black-200">gas</h3>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-1.5 h-1.5 rounded-full bg-matrix-500" />
          <span className="text-[10px] text-black-400 uppercase">live</span>
        </div>
      </div>

      {/* Current Gas Display */}
      <div className="p-4 bg-black-900">
        <div className="flex items-center justify-center space-x-2">
          <motion.span
            key={currentGas}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            className="text-3xl font-bold font-mono text-matrix-500"
          >
            {currentGas}
          </motion.span>
          <div className="text-left">
            <div className="text-xs text-black-400">gwei</div>
            <div className="text-[10px] text-black-500 font-mono">
              ~${((currentGas * 21000 * 2000) / 1e9).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Gas meter */}
        <div className="mt-3">
          <div className="h-1 rounded-full bg-black-700 overflow-hidden">
            <motion.div
              animate={{ width: `${Math.min(100, (baseGas / 50) * 100)}%` }}
              className="h-full rounded-full bg-matrix-500"
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-black-500">
            <span>low</span>
            <span>high</span>
          </div>
        </div>
      </div>

      {/* Speed Options */}
      <div className="p-3 grid grid-cols-4 gap-1.5">
        {GAS_LEVELS.map((level, index) => (
          <button
            key={level.label}
            onClick={() => handleSelect(index)}
            className={`p-2 rounded-lg text-center transition-colors ${
              selectedLevel === index
                ? 'bg-black-700 border border-matrix-500/50'
                : 'bg-black-900 border border-black-600 hover:border-black-500'
            }`}
          >
            <div
              className={`text-[10px] font-semibold mb-0.5 ${
                selectedLevel === index ? 'text-matrix-500' : 'text-black-300'
              }`}
            >
              {level.label}
            </div>
            <div className="text-[9px] text-black-500">{level.time}</div>
          </button>
        ))}
      </div>

      {/* Trend */}
      <div className="px-3 pb-3">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-black-500">30m trend</span>
          <div className="flex items-center space-x-1 text-matrix-500">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span>decreasing</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GasTracker

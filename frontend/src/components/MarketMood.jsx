import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

// The market has a mood. A vibe. An energy.
// Capture it. Display it. Let people FEEL it.

const MOODS = [
  { name: 'Extreme Fear', emoji: '▽', color: '#ef4444', position: 0 },
  { name: 'Fear', emoji: '▿', color: '#f97316', position: 25 },
  { name: 'Neutral', emoji: '◇', color: '#eab308', position: 50 },
  { name: 'Greed', emoji: '△', color: '#22c55e', position: 75 },
  { name: 'Extreme Greed', emoji: '▲', color: '#a3ff00', position: 100 },
]

function MarketMood() {
  const [moodIndex, setMoodIndex] = useState(65) // 0-100 scale
  const [isUpdating, setIsUpdating] = useState(false)

  // Simulate mood fluctuations
  useEffect(() => {
    const interval = setInterval(() => {
      setMoodIndex(prev => {
        const change = (Math.random() - 0.5) * 8
        return Math.max(0, Math.min(100, prev + change))
      })
      setIsUpdating(true)
      setTimeout(() => setIsUpdating(false), 500)
    }, 4000)

    return () => clearInterval(interval)
  }, [])

  const getCurrentMood = () => {
    if (moodIndex <= 20) return MOODS[0]
    if (moodIndex <= 40) return MOODS[1]
    if (moodIndex <= 60) return MOODS[2]
    if (moodIndex <= 80) return MOODS[3]
    return MOODS[4]
  }

  const mood = getCurrentMood()

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong rounded-2xl border border-void-600/30 overflow-hidden"
    >
      {/* Header */}
      <div className="p-4 border-b border-void-600/30 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-lg text-matrix-500">◎</span>
          <h3 className="font-display font-bold text-sm">MARKET MOOD</h3>
        </div>
        <motion.div
          animate={{ scale: isUpdating ? 1.2 : 1 }}
          className="text-xs text-void-400 flex items-center space-x-1"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-glow-500" />
          <span>Live</span>
        </motion.div>
      </div>

      {/* Mood Display */}
      <div className="p-5 text-center relative">
        {/* Animated background glow */}
        <motion.div
          animate={{
            background: [
              `radial-gradient(circle at center, ${mood.color}10 0%, transparent 70%)`,
              `radial-gradient(circle at center, ${mood.color}20 0%, transparent 70%)`,
              `radial-gradient(circle at center, ${mood.color}10 0%, transparent 70%)`,
            ]
          }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0"
        />

        {/* Emoji with animation */}
        <motion.div
          key={mood.name}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative"
        >
          <motion.span
            animate={{
              y: [0, -5, 0],
              rotate: [-5, 5, -5]
            }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-5xl inline-block"
          >
            {mood.emoji}
          </motion.span>
        </motion.div>

        {/* Mood name */}
        <motion.div
          key={mood.name + '-text'}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3"
        >
          <span
            className="text-xl font-display font-bold"
            style={{ color: mood.color }}
          >
            {mood.name}
          </span>
        </motion.div>

        {/* Index value */}
        <motion.div
          key={Math.round(moodIndex)}
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          className="text-3xl font-mono font-bold mt-2"
          style={{ color: mood.color }}
        >
          {Math.round(moodIndex)}
        </motion.div>
      </div>

      {/* Gauge */}
      <div className="px-5 pb-5">
        <div className="relative">
          {/* Gradient bar */}
          <div className="h-3 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 relative overflow-hidden">
            {/* Shimmer */}
            <motion.div
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
            />
          </div>

          {/* Indicator */}
          <motion.div
            animate={{ left: `${moodIndex}%` }}
            transition={{ type: 'spring', damping: 15 }}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
            style={{ left: `${moodIndex}%` }}
          >
            <div className="w-5 h-5 rounded-full bg-white shadow-lg border-2 border-void-900" />
          </motion.div>
        </div>

        {/* Labels */}
        <div className="flex justify-between mt-2 text-[10px] text-void-500">
          <span>Fear</span>
          <span>Neutral</span>
          <span>Greed</span>
        </div>
      </div>

      {/* Footer stats */}
      <div className="p-4 bg-void-800/30 border-t border-void-600/30">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-4">
            <div>
              <span className="text-void-400">Yesterday: </span>
              <span className="font-mono text-void-300">58</span>
            </div>
            <div>
              <span className="text-void-400">Week avg: </span>
              <span className="font-mono text-void-300">62</span>
            </div>
          </div>
          <motion.div
            className="flex items-center space-x-1"
            style={{ color: moodIndex > 62 ? '#22c55e' : '#ef4444' }}
          >
            <svg
              className={`w-3 h-3 ${moodIndex <= 62 ? 'rotate-180' : ''}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span className="font-mono">{moodIndex > 62 ? '+' : ''}{Math.round(moodIndex - 62)}</span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}

export default MarketMood

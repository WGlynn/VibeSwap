import { motion, useReducedMotion } from 'framer-motion'

// ============ BreathingDot — status indicator ============
// 2.4s breathing matrix-green dot (locked aesthetic). Static at rest-opacity
// when the user prefers reduced motion. Color is restricted to the palette.

const COLORS = {
  matrix: '#00ff41',
  terminal: '#00d4ff',
  amber: '#f59e0b',
  error: '#ff3366',
}

function BreathingDot({ color = 'matrix', size = 6, className = '' }) {
  const reduced = useReducedMotion()
  const c = COLORS[color] || COLORS.matrix

  if (reduced) {
    return (
      <span
        aria-hidden="true"
        className={`inline-block rounded-full flex-shrink-0 ${className}`}
        style={{ width: size, height: size, backgroundColor: c, opacity: 0.7 }}
      />
    )
  }

  return (
    <motion.span
      aria-hidden="true"
      className={`inline-block rounded-full flex-shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: c }}
      animate={{ opacity: [0.3, 1, 0.3], boxShadow: [`0 0 0px ${c}00`, `0 0 8px ${c}66`, `0 0 0px ${c}00`] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}

export default BreathingDot

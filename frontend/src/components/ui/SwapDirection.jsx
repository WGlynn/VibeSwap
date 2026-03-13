import { motion } from 'framer-motion'

// ============================================================
// SwapDirection — Animated swap direction toggle button
// Used for swap input/output reversal
// ============================================================

const CYAN = '#06b6d4'

export default function SwapDirection({
  onClick,
  vertical = true,
  className = '',
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-colors hover:border-cyan-500/30 group ${className}`}
      style={{
        background: 'rgba(255,255,255,0.03)',
        borderColor: 'rgba(255,255,255,0.08)',
      }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95, rotate: 180 }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        className="text-black-500 group-hover:text-cyan-400 transition-colors"
        style={{ transform: vertical ? 'rotate(90deg)' : 'none' }}
      >
        <path
          d="M4 6l4-4 4 4M4 10l4 4 4-4"
          stroke="currentColor"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.button>
  )
}

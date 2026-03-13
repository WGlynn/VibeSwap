import { motion } from 'framer-motion'

// ============================================================
// ProgressBar — Animated progress indicator
// Used in staking, badges, XP, loading states
// ============================================================

const CYAN = '#06b6d4'

const COLORS = {
  cyan: CYAN,
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
  matrix: '#00ff41',
}

export default function ProgressBar({
  value = 0,
  max = 100,
  color = 'cyan',
  size = 'md',
  showLabel = false,
  label,
  animated = true,
  glow = false,
  className = '',
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const barColor = COLORS[color] || color

  const heights = { sm: 'h-1', md: 'h-2', lg: 'h-3', xl: 'h-4' }
  const h = heights[size] || heights.md

  return (
    <div className={className}>
      {(showLabel || label) && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">{label}</span>}
          {showLabel && <span className="text-[10px] font-mono text-black-400">{Math.round(pct)}%</span>}
        </div>
      )}
      <div className={`${h} rounded-full overflow-hidden`} style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div
          className={`${h} rounded-full`}
          style={{
            background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
            ...(glow ? { boxShadow: `0 0 8px ${barColor}40` } : {}),
          }}
          initial={animated ? { width: 0 } : { width: `${pct}%` }}
          animate={{ width: `${pct}%` }}
          transition={animated ? { duration: 0.8, ease: [0.25, 0.1, 0.25, 1] } : { duration: 0 }}
        />
      </div>
    </div>
  )
}

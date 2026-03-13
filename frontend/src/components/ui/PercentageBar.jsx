import { motion } from 'framer-motion'

// ============================================================
// PercentageBar — Horizontal bar showing a proportion
// Used for voting results, allocation displays, health bars
// ============================================================

const COLOR_MAP = {
  cyan: { bar: '#06b6d4', bg: 'rgba(6,182,212,0.1)' },
  green: { bar: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  red: { bar: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  amber: { bar: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  blue: { bar: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  purple: { bar: '#a855f7', bg: 'rgba(168,85,247,0.1)' },
}

export default function PercentageBar({
  value = 0,
  max = 100,
  color = 'cyan',
  showLabel = true,
  label,
  height = 6,
  animate = true,
  className = '',
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const colors = COLOR_MAP[color] || COLOR_MAP.cyan

  return (
    <div className={className}>
      {(showLabel || label) && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-[10px] font-mono text-black-400">{label}</span>}
          {showLabel && <span className="text-[10px] font-mono text-black-500">{pct.toFixed(1)}%</span>}
        </div>
      )}
      <div
        className="rounded-full overflow-hidden"
        style={{ height, background: colors.bg }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: colors.bar }}
          initial={animate ? { width: 0 } : { width: `${pct}%` }}
          animate={{ width: `${pct}%` }}
          transition={animate ? { duration: 0.8, ease: 'easeOut' } : undefined}
        />
      </div>
    </div>
  )
}

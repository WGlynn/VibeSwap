import { motion } from 'framer-motion'

// ============================================================
// HealthBar — Visual health/risk indicator bar
// Used for collateral ratios, position health, protocol safety
// ============================================================

function getHealthColor(value, max) {
  const pct = value / max
  if (pct >= 0.7) return { color: '#22c55e', label: 'Healthy' }
  if (pct >= 0.4) return { color: '#f59e0b', label: 'Moderate' }
  if (pct >= 0.2) return { color: '#ef4444', label: 'At Risk' }
  return { color: '#dc2626', label: 'Critical' }
}

export default function HealthBar({
  value = 0,
  max = 100,
  showLabel = true,
  showPercentage = true,
  height = 8,
  className = '',
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const { color, label } = getHealthColor(value, max)

  return (
    <div className={className}>
      {(showLabel || showPercentage) && (
        <div className="flex items-center justify-between mb-1">
          {showLabel && (
            <span className="text-[10px] font-mono font-medium" style={{ color }}>
              {label}
            </span>
          )}
          {showPercentage && (
            <span className="text-[10px] font-mono text-black-400">
              {pct.toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <div
        className="rounded-full overflow-hidden"
        style={{ height, background: 'rgba(255,255,255,0.04)' }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: color, boxShadow: `0 0 8px ${color}40` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

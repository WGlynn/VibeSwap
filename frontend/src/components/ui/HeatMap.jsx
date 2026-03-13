import { motion } from 'framer-motion'

// ============================================================
// HeatMap — Color-coded grid for market/activity visualization
// Used in market overview, analytics, activity displays
// ============================================================

function getHeatColor(value, min, max) {
  const pct = (value - min) / (max - min || 1)
  if (pct < 0.3) return `rgba(239, 68, 68, ${0.3 + pct})`      // red
  if (pct < 0.45) return `rgba(245, 158, 11, ${0.4 + pct * 0.5})` // amber
  if (pct < 0.55) return `rgba(255, 255, 255, 0.1)`             // neutral
  if (pct < 0.7) return `rgba(34, 197, 94, ${0.3 + (pct - 0.55) * 2})` // green
  return `rgba(6, 182, 212, ${0.3 + (pct - 0.7) * 2})`         // cyan
}

export default function HeatMap({
  data = [],
  columns = 6,
  cellSize = 48,
  gap = 2,
  showLabels = true,
  className = '',
}) {
  if (data.length === 0) return null

  const values = data.map((d) => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)

  return (
    <div
      className={`inline-grid ${className}`}
      style={{
        gridTemplateColumns: `repeat(${columns}, ${cellSize}px)`,
        gap: `${gap}px`,
      }}
    >
      {data.map((d, i) => (
        <motion.div
          key={i}
          className="rounded flex items-center justify-center cursor-default"
          style={{
            width: cellSize,
            height: cellSize,
            background: getHeatColor(d.value, min, max),
          }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.02, duration: 0.3 }}
          title={`${d.label}: ${d.value}`}
        >
          {showLabels && (
            <span className="text-[8px] font-mono font-bold text-white/80 text-center leading-tight">
              {d.label}
            </span>
          )}
        </motion.div>
      ))}
    </div>
  )
}

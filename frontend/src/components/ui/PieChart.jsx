import { motion } from 'framer-motion'

// ============================================================
// PieChart — SVG pie chart with animated segments
// Used for allocation displays, portfolio breakdowns, revenue splits
// ============================================================

const DEFAULT_COLORS = [
  '#06b6d4', '#22c55e', '#f59e0b', '#a855f7',
  '#3b82f6', '#ef4444', '#ec4899', '#14b8a6',
]

function polarToCartesian(cx, cy, r, angle) {
  const rad = ((angle - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle)
  const end = polarToCartesian(cx, cy, r, startAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`
}

export default function PieChart({
  data = [],
  size = 160,
  colors = DEFAULT_COLORS,
  showLegend = true,
  className = '',
}) {
  if (data.length === 0) return null

  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (total === 0) return null

  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 4

  let currentAngle = 0
  const segments = data.map((d, i) => {
    const angle = (d.value / total) * 360
    const startAngle = currentAngle
    const endAngle = currentAngle + angle
    currentAngle = endAngle
    return {
      ...d,
      path: arcPath(cx, cy, r, startAngle, endAngle),
      color: colors[i % colors.length],
      pct: ((d.value / total) * 100).toFixed(1),
    }
  })

  return (
    <div className={`flex items-start gap-4 ${className}`}>
      <svg width={size} height={size} className="shrink-0">
        {segments.map((seg, i) => (
          <motion.path
            key={i}
            d={seg.path}
            fill={seg.color}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1, duration: 0.4 }}
            className="cursor-default"
          >
            <title>{`${seg.label}: ${seg.pct}%`}</title>
          </motion.path>
        ))}
      </svg>

      {showLegend && (
        <div className="flex flex-col gap-1.5 py-1">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: seg.color }} />
              <span className="text-[10px] font-mono text-black-400">
                {seg.label} <span className="text-black-500">({seg.pct}%)</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

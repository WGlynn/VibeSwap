import { motion } from 'framer-motion'

// ============================================================
// DonutChart — SVG donut/pie chart with animated segments
// Used for asset allocation, distribution, composition
// ============================================================

export default function DonutChart({
  data = [],
  size = 160,
  strokeWidth = 24,
  label,
  value,
  className = '',
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2

  // Calculate segment offsets
  const total = data.reduce((sum, d) => sum + d.value, 0)
  let accumulated = 0

  const segments = data.map((d) => {
    const pct = total > 0 ? d.value / total : 0
    const dashLength = circumference * pct
    const dashGap = circumference - dashLength
    const offset = -circumference * accumulated + circumference * 0.25 // Start at top
    accumulated += pct
    return { ...d, pct, dashLength, dashGap, offset }
  })

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          {/* Background ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={strokeWidth}
          />

          {/* Segments */}
          {segments.map((seg, i) => (
            <motion.circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={seg.color || '#06b6d4'}
              strokeWidth={strokeWidth}
              strokeDasharray={`${seg.dashLength} ${seg.dashGap}`}
              strokeDashoffset={seg.offset}
              strokeLinecap="butt"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
            />
          ))}
        </svg>

        {/* Center label */}
        {(label || value) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {value && (
              <span className="text-lg font-mono font-bold text-white">{value}</span>
            )}
            {label && (
              <span className="text-[10px] font-mono text-black-500 uppercase">{label}</span>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      {data.length > 0 && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-3">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color || '#06b6d4' }} />
              <span className="text-[10px] font-mono text-black-400">
                {d.label} {total > 0 ? `${Math.round((d.value / total) * 100)}%` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

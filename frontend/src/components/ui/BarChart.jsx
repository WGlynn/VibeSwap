import { motion } from 'framer-motion'

// ============================================================
// BarChart — Simple SVG bar chart
// Used for volume, activity, distribution displays
// ============================================================

const CYAN = '#06b6d4'

export default function BarChart({
  data = [],
  width = 300,
  height = 120,
  barColor = CYAN,
  showLabels = true,
  showValues = false,
  className = '',
}) {
  if (data.length === 0) return null

  const maxVal = Math.max(...data.map((d) => d.value), 1)
  const barWidth = Math.max(4, (width - (data.length - 1) * 2) / data.length)
  const gap = 2

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <svg width={width} height={height + (showLabels ? 20 : 0)} className="overflow-visible">
        {data.map((d, i) => {
          const barHeight = (d.value / maxVal) * height
          const x = i * (barWidth + gap)
          const y = height - barHeight

          return (
            <g key={i}>
              <motion.rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={Math.min(2, barWidth / 4)}
                fill={d.color || barColor}
                fillOpacity={0.8}
                initial={{ height: 0, y: height }}
                animate={{ height: barHeight, y }}
                transition={{ duration: 0.5, delay: i * 0.03, ease: 'easeOut' }}
              />
              {showValues && barHeight > 12 && (
                <text
                  x={x + barWidth / 2}
                  y={y + 10}
                  textAnchor="middle"
                  className="text-[8px] font-mono"
                  fill="white"
                  fillOpacity={0.7}
                >
                  {d.value}
                </text>
              )}
              {showLabels && d.label && (
                <text
                  x={x + barWidth / 2}
                  y={height + 14}
                  textAnchor="middle"
                  className="text-[8px] font-mono"
                  fill="rgba(255,255,255,0.35)"
                >
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

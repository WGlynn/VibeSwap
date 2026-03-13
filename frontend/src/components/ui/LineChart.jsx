import { useMemo } from 'react'
import { motion } from 'framer-motion'

// ============================================================
// LineChart — SVG line chart with gradient fill and animation
// Used for price charts, portfolio value, analytics trends
// ============================================================

const CYAN = '#06b6d4'

function buildPath(data, width, height, padding) {
  if (data.length < 2) return { linePath: '', areaPath: '' }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const xStep = (width - padding * 2) / (data.length - 1)

  const points = data.map((val, i) => ({
    x: padding + i * xStep,
    y: padding + (1 - (val - min) / range) * (height - padding * 2),
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`

  return { linePath, areaPath }
}

export default function LineChart({
  data = [],
  width = 300,
  height = 120,
  color = CYAN,
  showDots = false,
  showGrid = true,
  showLabels = false,
  labelFormatter,
  className = '',
}) {
  const padding = 8

  const { linePath, areaPath } = useMemo(
    () => buildPath(data, width, height, padding),
    [data, width, height]
  )

  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const xStep = (width - padding * 2) / (data.length - 1)

  const gradientId = `line-fill-${color.replace('#', '')}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`${className}`}
      style={{ width: '100%', height: 'auto' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {showGrid && (
        <g>
          {[0.25, 0.5, 0.75].map((pct) => {
            const y = padding + pct * (height - padding * 2)
            return (
              <line
                key={pct}
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke="rgba(255,255,255,0.04)"
                strokeDasharray="4 4"
              />
            )
          })}
        </g>
      )}

      {/* Area fill */}
      <motion.path
        d={areaPath}
        fill={`url(#${gradientId})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      />

      {/* Line */}
      <motion.path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />

      {/* Dots */}
      {showDots &&
        data.map((val, i) => {
          const x = padding + i * xStep
          const y = padding + (1 - (val - min) / range) * (height - padding * 2)
          return (
            <motion.circle
              key={i}
              cx={x}
              cy={y}
              r={2.5}
              fill={color}
              initial={{ opacity: 0, r: 0 }}
              animate={{ opacity: 1, r: 2.5 }}
              transition={{ delay: 0.8 + i * 0.05, duration: 0.3 }}
            />
          )
        })}

      {/* Labels */}
      {showLabels && (
        <g>
          <text x={padding} y={height - 1} fill="rgba(255,255,255,0.3)" fontSize={8} fontFamily="monospace">
            {labelFormatter ? labelFormatter(min) : min.toFixed(1)}
          </text>
          <text x={padding} y={padding + 6} fill="rgba(255,255,255,0.3)" fontSize={8} fontFamily="monospace">
            {labelFormatter ? labelFormatter(max) : max.toFixed(1)}
          </text>
        </g>
      )}
    </svg>
  )
}

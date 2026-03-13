import { useMemo } from 'react'
import { motion } from 'framer-motion'

// ============================================================
// AreaChart — SVG area chart with gradient fill
// Used for TVL, volume, price over time
// ============================================================

export default function AreaChart({
  data = [],
  width = 400,
  height = 120,
  color = '#06b6d4',
  showGrid = false,
  animated = true,
  className = '',
}) {
  const { path, area, minY, maxY } = useMemo(() => {
    if (data.length < 2) return { path: '', area: '', minY: 0, maxY: 0 }

    const values = data.map((d) => (typeof d === 'number' ? d : d.value))
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1

    const padTop = height * 0.05
    const padBottom = height * 0.05
    const usable = height - padTop - padBottom

    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = padTop + usable - ((v - min) / range) * usable
      return { x, y }
    })

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const areaD = `${pathD} L${width},${height} L0,${height} Z`

    return { path: pathD, area: areaD, minY: min, maxY: max }
  }, [data, width, height])

  const gradId = `area-grad-${color.replace('#', '')}`

  return (
    <div className={className}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {showGrid && [0.25, 0.5, 0.75].map((pct) => (
          <line
            key={pct}
            x1={0}
            y1={height * pct}
            x2={width}
            y2={height * pct}
            stroke="rgba(255,255,255,0.04)"
            strokeDasharray="4,4"
          />
        ))}

        <path d={area} fill={`url(#${gradId})`} />

        {animated ? (
          <motion.path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        ) : (
          <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        )}
      </svg>
    </div>
  )
}

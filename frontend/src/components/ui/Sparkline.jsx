import { useMemo } from 'react'

/**
 * Sparkline — Tiny inline SVG chart for trend visualization.
 * Sits next to numbers to make data feel alive.
 *
 * Props:
 *   data: number[] — values to plot (min 2 points)
 *   width: number — SVG width (default 48)
 *   height: number — SVG height (default 16)
 *   color: string — line color (auto green/red based on trend if not set)
 *   strokeWidth: number — line thickness (default 1.5)
 *   fill: boolean — show gradient fill under line
 *   seed: number — deterministic random seed (stable across re-renders)
 *   className: string
 */

// Seeded PRNG for stable mock data
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// Generate stable mock data from a seed
export function generateSparklineData(seed, points = 20, volatility = 0.03) {
  const rng = seededRandom(seed)
  let price = 100
  return Array.from({ length: points }, () => {
    price *= 1 + (rng() - 0.48) * volatility
    return price
  })
}

function Sparkline({
  data,
  width = 48,
  height = 16,
  color,
  strokeWidth = 1.5,
  fill = true,
  className = '',
}) {
  const { points, areaPoints, lineColor } = useMemo(() => {
    if (!data || data.length < 2) return { points: '', areaPoints: '', lineColor: '#22c55e' }

    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const pad = 1

    const pts = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2)
      const y = height - pad - ((v - min) / range) * (height - pad * 2)
      return `${x},${y}`
    })

    const isUp = data[data.length - 1] >= data[0]
    const lc = color || (isUp ? '#22c55e' : '#ef4444')

    const area = `${pad},${height - pad} ${pts.join(' ')} ${width - pad},${height - pad}`

    return { points: pts.join(' '), areaPoints: area, lineColor: lc }
  }, [data, width, height, color])

  if (!data || data.length < 2) return null

  const gradId = `spark-${data.length}-${Math.round(data[0] * 100)}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block align-middle ${className}`}
      style={{ overflow: 'visible' }}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} fill={`url(#${gradId})`} />
        </>
      )}
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default Sparkline

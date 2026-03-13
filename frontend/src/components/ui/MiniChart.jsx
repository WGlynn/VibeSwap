// ============================================================
// MiniChart — Tiny inline chart for table cells and compact views
// Used for sparklines in lists, token rows, compact stats
// ============================================================

export default function MiniChart({
  data = [],
  width = 48,
  height = 16,
  color,
  className = '',
}) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const isUp = data[data.length - 1] >= data[0]
  const lineColor = color || (isUp ? '#22c55e' : '#ef4444')

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((val - min) / range) * (height - 2) - 1
    return `${x},${y}`
  }).join(' ')

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

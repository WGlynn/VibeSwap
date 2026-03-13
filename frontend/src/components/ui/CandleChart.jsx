import { useMemo } from 'react'

// ============================================================
// CandleChart — SVG candlestick chart
// Used for trading page, token details, price history
// ============================================================

export default function CandleChart({
  candles = [],
  width = 400,
  height = 200,
  className = '',
}) {
  const elements = useMemo(() => {
    if (candles.length === 0) return []

    const allPrices = candles.flatMap((c) => [c.high, c.low])
    const minP = Math.min(...allPrices)
    const maxP = Math.max(...allPrices)
    const range = maxP - minP || 1

    const candleWidth = Math.max(2, (width / candles.length) * 0.7)
    const gap = width / candles.length

    return candles.map((c, i) => {
      const isGreen = c.close >= c.open
      const x = i * gap + gap / 2

      const py = (price) => ((maxP - price) / range) * (height * 0.9) + height * 0.05

      const bodyTop = py(Math.max(c.open, c.close))
      const bodyBottom = py(Math.min(c.open, c.close))
      const bodyHeight = Math.max(1, bodyBottom - bodyTop)

      return {
        key: i,
        x,
        wickTop: py(c.high),
        wickBottom: py(c.low),
        bodyTop,
        bodyHeight,
        candleWidth,
        fill: isGreen ? '#22c55e' : '#ef4444',
        stroke: isGreen ? '#22c55e' : '#ef4444',
      }
    })
  }, [candles, width, height])

  return (
    <div className={className}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {elements.map((e) => (
          <g key={e.key}>
            {/* Wick */}
            <line
              x1={e.x}
              y1={e.wickTop}
              x2={e.x}
              y2={e.wickBottom}
              stroke={e.stroke}
              strokeWidth="1"
            />
            {/* Body */}
            <rect
              x={e.x - e.candleWidth / 2}
              y={e.bodyTop}
              width={e.candleWidth}
              height={e.bodyHeight}
              fill={e.fill}
              rx="0.5"
            />
          </g>
        ))}
      </svg>
    </div>
  )
}
